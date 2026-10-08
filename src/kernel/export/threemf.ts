import { strToU8, zipSync } from 'fflate';

/** Dati minimi per esportare un oggetto in 3MF. */
export interface ExportPart {
  name: string;
  color: string;
  positions: Float32Array;
  indices: Uint32Array;
  /** Spostamento (mm) dell'oggetto nel piano di costruzione: serve a mettere i piatti uno accanto all'altro. */
  offset?: [number, number, number];
  /** Indice (da 0) del piatto di appartenenza: serve ai metadati dei piatti. */
  plate?: number;
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Numero con al massimo 5 decimali, senza zeri inutili (riduce la dimensione del file). */
const num = (n: number) => String(Math.round(n * 1e5) / 1e5);

/** Colore "#rrggbb" nel formato 3MF "#RRGGBBAA" (opaco). */
const displayColor = (hex: string) => `${/^#[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : '#4DA3FF'}FF`;

/** `Metadata/model_settings.config`: gli oggetti (id come nel modello) e, per ogni piatto, le istanze che contiene. */
function modelSettings(parts: ExportPart[], plateNames: string[]): string {
  const meta = (key: string, value: string | number) => `<metadata key="${key}" value="${escapeXml(String(value))}"/>`;
  const objects = parts.map((p, i) => `<object id="${i + 2}">${meta('name', p.name)}</object>`).join('');
  const plates = plateNames
    .map((name, plate) => {
      const instances = parts
        .map((p, i) => (p.plate === plate ? `<model_instance>${meta('object_id', i + 2)}${meta('instance_id', 0)}</model_instance>` : ''))
        .join('');
      return `<plate>${meta('plater_id', plate + 1)}${meta('plater_name', name)}${meta('locked', 'false')}${instances}</plate>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><config>${objects}${plates}</config>`;
}

/**
 * Crea un pacchetto 3MF (archivio OPC): un oggetto per ogni parte, ciascuna con il proprio materiale,
 * così lo slicer può assegnare un filamento diverso a ogni solido. Unità: millimetri.
 */
export function write3mf(parts: ExportPart[], plateNames: string[] = []): Uint8Array<ArrayBuffer> {
  // Materiali: uno per parte, indicizzati da pindex
  const materials = parts.map((p) => `<base name="${escapeXml(p.name)}" displaycolor="${displayColor(p.color)}"/>`).join('');

  const objects = parts
    .map((p, i) => {
      const vertices: string[] = [];
      for (let v = 0; v < p.positions.length; v += 3) {
        vertices.push(`<vertex x="${num(p.positions[v])}" y="${num(p.positions[v + 1])}" z="${num(p.positions[v + 2])}"/>`);
      }
      const triangles: string[] = [];
      for (let t = 0; t < p.indices.length; t += 3) {
        triangles.push(`<triangle v1="${p.indices[t]}" v2="${p.indices[t + 1]}" v3="${p.indices[t + 2]}"/>`);
      }
      // id 1 è riservato ai materiali: gli oggetti partono da 2
      return `<object id="${i + 2}" name="${escapeXml(p.name)}" type="model" pid="1" pindex="${i}"><mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object>`;
    })
    .join('');

  // Con un offset l'oggetto si sposta con una trasformazione dell'item (matrice 3×4: rotazione unitaria e traslazione)
  const items = parts
    .map((p, i) => {
      const [dx, dy, dz] = p.offset ?? [0, 0, 0];
      const moved = dx !== 0 || dy !== 0 || dz !== 0;
      return `<item objectid="${i + 2}"${moved ? ` transform="1 0 0 0 1 0 0 0 1 ${num(dx)} ${num(dy)} ${num(dz)}"` : ''}/>`;
    })
    .join('');

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xml:lang="it-IT" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Application">Construct</metadata>` +
    `<resources><basematerials id="1">${materials}</basematerials>${objects}</resources>` +
    `<build>${items}</build></model>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;

  // Con più piatti si scrivono anche i metadati di Bambu Studio e Orca (Metadata/model_settings.config): oggetti e piatti con
  // i loro nomi. Gli altri programmi li ignorano e leggono i piatti dalla posizione degli oggetti (vedi `offset`)
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
  };
  if (plateNames.length > 1) files['Metadata/model_settings.config'] = strToU8(modelSettings(parts, plateNames));
  // [Content_Types].xml deve essere la prima voce dell'archivio
  return zipSync(files) as Uint8Array<ArrayBuffer>;
}

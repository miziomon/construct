import { strToU8, zipSync } from 'fflate';

/** Dati minimi per esportare un oggetto in 3MF. */
export interface ExportPart {
  name: string;
  color: string;
  positions: Float32Array;
  indices: Uint32Array;
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Numero con al massimo 5 decimali, senza zeri inutili (riduce la dimensione del file). */
const num = (n: number) => String(Math.round(n * 1e5) / 1e5);

/** Colore "#rrggbb" nel formato 3MF "#RRGGBBAA" (opaco). */
const displayColor = (hex: string) => `${/^#[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : '#4DA3FF'}FF`;

/**
 * Crea un pacchetto 3MF (archivio OPC): un oggetto per ogni parte, ciascuna con il proprio materiale,
 * così lo slicer può assegnare un filamento diverso a ogni solido. Unità: millimetri.
 */
export function write3mf(parts: ExportPart[]): Uint8Array<ArrayBuffer> {
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

  const items = parts.map((_, i) => `<item objectid="${i + 2}"/>`).join('');

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xml:lang="it-IT" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Application">WebCAD</metadata>` +
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

  // [Content_Types].xml deve essere la prima voce dell'archivio
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
  }) as Uint8Array<ArrayBuffer>;
}

import { useEffect, useId, useRef, useState } from 'react';
import { getImage } from '../../import/assets';
import { importImageFile } from '../../import/imageImport';
import { normalizePattern, samplePatch, textureAmplitudeLimit, textureOf } from '../../scene/pattern';
import { normalizeTexture } from '../../scene/textureMap';
import type { GrayImage, TextureMode, TextureParams } from '../../scene/textureMap';
import { SAMPLE_KINDS, SAMPLE_VARIANTS } from '../../scene/textureSamples';
import type { SampleKind } from '../../scene/textureSamples';
import { imageOf, sampleImage } from '../../scene/textureImage';
import type { PatternParams } from '../../scene/types';
import { SliderField } from '../SliderField/SliderField';
import '../Array/ArrayFields.scss';

/** Nomi delle texture di esempio della libreria. */
const SAMPLE_LABELS: Record<SampleKind, string> = { knurl: 'Zigrinatura', carbon: 'Fibra di carbonio', leather: 'Pelle', bricks: 'Pietra', stone: 'Pietra', fabric: 'Tessuto', waves: 'Onde', noise: 'Rumore' };

/** Nomi delle varianti di ogni texture di esempio (vedi `SAMPLE_VARIANTS`). */
const VARIANT_LABELS: Record<SampleKind, Record<string, string>> = {
  knurl: { diamond: 'A diamante', straight: 'Dritta', dots: 'A punti' },
  carbon: { twill: 'Twill', plain: 'Tela', forged: 'Forgiato' },
  leather: { fine: 'Fine', coarse: 'Grossa', reptile: 'Rettile' },
  bricks: { plain: 'Mattoni' },
  stone: { cobbles: 'Ciottoli', slabs: 'Lastroni', gravel: 'Ghiaia' },
  fabric: { plain: 'Tela', basket: 'Panama', ribbed: 'Costine' },
  waves: { parallel: 'Parallele', concentric: 'Concentriche', fan: 'A ventaglio' },
  noise: { fine: 'Fine', clouds: 'A nuvole', grains: 'A granuli' },
};

/** Valore della tendina per l'immagine caricata dall'utente. */
const UPLOADED = '__uploaded';

/** Miniatura del grigio dell'immagine (la stessa che il Pattern usa): un canvas con i pixel, mostrato a `size` px di lato (72 di partenza). */
function GrayThumb({ image, size = 72 }: { image: GrayImage | undefined; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    const context = el?.getContext('2d');
    if (!el || !context || !image) return;
    el.width = image.w;
    el.height = image.h;
    const pixels = context.createImageData(image.w, image.h);
    for (let i = 0; i < image.data.length; i++) pixels.data.set([image.data[i], image.data[i], image.data[i], 255], i * 4);
    context.putImageData(pixels, 0, 0);
  }, [image]);
  if (!image) return <span className="array-fields__total">Immagine non disponibile</span>;
  return <canvas ref={canvas} aria-label="Anteprima in grigio dell'immagine" style={{ width: size, height: (size * image.h) / image.w, imageRendering: 'pixelated', border: '1px solid currentColor' }} />;
}

interface Props {
  params: PatternParams;
  onChange: (patch: Partial<PatternParams>) => void;
  disabled?: boolean;
  history?: boolean;
}

/**
 * Campi del Pattern «Immagine»: sorgente (libreria di esempi o file PNG/JPG), miniatura del grigio e parametri della texture
 * (piastrella, ripetizione, rotazione, scostamento, inversione, livello medio, ampiezza, sfocatura, modo). L'immagine caricata
 * si decodifica una volta sola (`importImageFile`) e il Pattern ne conserva l'id; con più Pattern la copia resta una.
 */
export function TextureFields({ params: p, onChange, disabled, history = true }: Props) {
  const sourceId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Esempio e variante come li leggono kernel e codice (un esempio sconosciuto o una variante di un'altra texture tornano ai valori di
  // partenza, i mattoni di una versione precedente diventano pietra): la miniatura mostra la stessa immagine di tendina, kernel e codice
  const { sample, sampleDesign } = normalizePattern(p);
  const kind = sample ?? 'knurl';
  const variant = sampleDesign ?? SAMPLE_VARIANTS[kind][0];
  const image = imageOf({ ...p, sample: kind, sampleDesign: variant }, getImage);
  const variantId = useId();
  // Parametri salvati (da cui si parte per modificare) ed effettivi (con il limite di profondità, quelli mostrati)
  const stored = normalizeTexture({ mode: 'groove', ...p.texture });
  const tex = textureOf(p);
  const setTexture = (patch: Partial<TextureParams>) => onChange({ texture: { ...stored, ...patch } });
  // Ampiezza massima: la parte sotto la faccia non supera il limite di profondità (vedi `textureAmplitudeLimit`)
  const ampMax = textureAmplitudeLimit(p, tex);

  const slider = (label: string, tip: string, value: number, set: (v: number) => void, range: { min: number; max: number; step: number; hardMin?: number; hardMax?: number; unit?: string }) => (
    <SliderField label={label} tooltip={tip} value={value} disabled={disabled} history={history} onCommit={set} {...range} />
  );
  const check = (label: string, tip: string, checked: boolean, set: (v: boolean) => void) => (
    <label className="array-fields__row array-fields__check" title={tip}>
      <span className="array-fields__label">{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => set(e.target.checked)} />
    </label>
  );

  /** Carica il file scelto: errore chiaro se non è leggibile o è troppo grande. */
  const load = async (file: File | undefined) => {
    if (!file) return;
    setLoading(true);
    setProblem(null);
    try {
      const asset = await importImageFile(file);
      onChange({ imageId: asset.id, sample: undefined, sampleDesign: undefined });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Impossibile leggere l\'immagine.');
    } finally {
      setLoading(false);
      // Lo stesso file si può scegliere di nuovo
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <>
      <div className="array-fields__row" title="Libreria di texture di esempio generate nel codice, oppure l'immagine che hai caricato.">
        <label className="array-fields__label" htmlFor={sourceId}>Sorgente</label>
        <select id={sourceId} className="array-fields__select" value={p.imageId ? UPLOADED : kind} disabled={disabled} onChange={(e) => (e.target.value === UPLOADED ? undefined : onChange(samplePatch(e.target.value as SampleKind)))}>
          {p.imageId && <option value={UPLOADED}>Immagine caricata</option>}
          {SAMPLE_KINDS.map((k) => (
            <option key={k} value={k}>{SAMPLE_LABELS[k]}</option>
          ))}
        </select>
      </div>
      {!p.imageId && (
        <div className="array-fields__row" title="Tre versioni di ogni texture di esempio (la zigrinatura dritta, a diamante o a punti, la pelle fine, grossa o di rettile...).">
          <label className="array-fields__label" htmlFor={variantId}>Variante</label>
          <select id={variantId} className="array-fields__select" value={variant} disabled={disabled} onChange={(e) => onChange({ sampleDesign: e.target.value })}>
            {SAMPLE_VARIANTS[kind].map((v) => (
              <option key={v} value={v}>{VARIANT_LABELS[kind][v]}</option>
            ))}
          </select>
        </div>
      )}
      {!p.imageId && (
        <div className="array-fields__row" role="group" aria-label="Miniature delle varianti">
          <span className="array-fields__label" />
          {SAMPLE_VARIANTS[kind].map((v) => (
            <button key={v} type="button" className="array-fields__button" aria-pressed={v === variant} aria-label={`Variante ${VARIANT_LABELS[kind][v]}`} title={VARIANT_LABELS[kind][v]} disabled={disabled} onClick={() => onChange({ sampleDesign: v })} style={{ padding: 2, outline: v === variant ? '2px solid currentColor' : undefined }}>
              <GrayThumb image={sampleImage(kind, v)} size={40} />
            </button>
          ))}
        </div>
      )}
      <div className="array-fields__row" title="PNG, JPG o SVG: si converte in scala di grigi (Rec. 601, la trasparenza sul bianco) e si riduce a 512 pixel sul lato maggiore; il progetto conserva il grigio, non il file.">
        <span className="array-fields__label" />
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/svg+xml,.svg" hidden aria-label="File immagine" disabled={disabled} onChange={(e) => void load(e.target.files?.[0])} />
        <button type="button" className="array-fields__button" disabled={disabled || loading} onClick={() => fileInput.current?.click()}>
          {loading ? 'Carico...' : 'Carica immagine'}
        </button>
        <GrayThumb image={image} />
      </div>
      {problem && <p className="array-fields__total array-fields__warning" role="alert">{problem}</p>}
      {slider('Piastrella', "Larghezza di una ripetizione dell'immagine sulla faccia, in mm (l'altezza segue le proporzioni).", tex.tile, (tile) => setTexture({ tile }), { min: 5, max: 200, step: 1, hardMin: 0.5, hardMax: 1000, unit: 'mm' })}
      {check('Ripetizione', "Acceso: l'immagine si ripete su tutta la faccia. Spento: compare una volta sola.", tex.repeat, (repeat) => setTexture({ repeat }))}
      {slider('Rotazione', "Rotazione dell'immagine sulla faccia, in gradi.", tex.rotation, (rotation) => setTexture({ rotation }), { min: -180, max: 180, step: 1, hardMin: -360, hardMax: 360, unit: '°' })}
      {slider('Scostamento X', "Sposta l'immagine lungo X della faccia, in mm.", tex.offset[0], (x) => setTexture({ offset: [x, tex.offset[1]] }), { min: -50, max: 50, step: 0.5, hardMin: -10000, hardMax: 10000, unit: 'mm' })}
      {slider('Scostamento Y', "Sposta l'immagine lungo Y della faccia, in mm.", tex.offset[1], (y) => setTexture({ offset: [tex.offset[0], y] }), { min: -50, max: 50, step: 0.5, hardMin: -10000, hardMax: 10000, unit: 'mm' })}
      {check('Inversione', 'Scambia il nero e il bianco: il bianco è la quota alta.', tex.invert, (invert) => setTexture({ invert }))}
      {slider('Livello medio', 'Il grigio che resta sulla faccia: più chiaro di così si rialza (rilievo), più scuro si scava (incavo).', tex.midlevel, (midlevel) => setTexture({ midlevel }), { min: 0, max: 1, step: 0.05, hardMin: 0, hardMax: 1 })}
      {slider('Ampiezza', "Quota massima della texture, in mm. L'incavo non supera lo spessore dell'ingombro del pezzo meno 0,2 mm.", tex.amplitude, (amplitude) => setTexture({ amplitude }), { min: 0, max: Math.min(3, ampMax), step: 0.05, hardMin: 0, hardMax: ampMax, unit: 'mm' })}
      {slider('Sfocatura', "Raggio della sfocatura in pixel dell'immagine (0 = nessuna): toglie la grana dei JPG e i gradini dei pixel grandi.", tex.blur, (blur) => setTexture({ blur }), { min: 0, max: 10, step: 1, hardMin: 0, hardMax: 20, unit: 'px' })}
      <div className="array-fields__row" title="Incavo: si scava dove l'immagine è più scura del livello medio. Rilievo: si aggiunge dove è più chiara. Entrambi: si scava e si aggiunge attorno al livello medio.">
        <span className="array-fields__label">Modo texture</span>
        <div className="array-fields__segmented" role="group" aria-label="Modo texture">
          {([['groove', 'Incavo'], ['relief', 'Rilievo'], ['both', 'Entrambi']] as [TextureMode, string][]).map(([mode, text]) => (
            <button key={mode} type="button" className={mode === tex.mode ? 'is-active' : undefined} aria-pressed={mode === tex.mode} disabled={disabled} onClick={() => setTexture({ mode })}>
              {text}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

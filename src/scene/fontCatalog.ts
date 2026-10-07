import robotoBold from '../assets/fonts/Roboto-Bold.ttf?url';
import playfairBold from '../assets/fonts/PlayfairDisplay-Bold.ttf?url';
import robotoMonoBold from '../assets/fonts/RobotoMono-Bold.ttf?url';
import bebasNeue from '../assets/fonts/BebasNeue-Regular.ttf?url';
import anton from '../assets/fonts/Anton-Regular.ttf?url';
import oswaldBold from '../assets/fonts/Oswald-Bold.ttf?url';
import pacifico from '../assets/fonts/Pacifico-Regular.ttf?url';
import lobster from '../assets/fonts/Lobster-Regular.ttf?url';
import dancingScriptBold from '../assets/fonts/DancingScript-Bold.ttf?url';
import permanentMarker from '../assets/fonts/PermanentMarker-Regular.ttf?url';
import ptSerifBold from '../assets/fonts/PTSerif-Bold.ttf?url';
import robotoSlabBold from '../assets/fonts/RobotoSlab-Bold.ttf?url';
import poppinsBold from '../assets/fonts/Poppins-Bold.ttf?url';
import varelaRound from '../assets/fonts/VarelaRound-Regular.ttf?url';
import caveatBold from '../assets/fonts/Caveat-Bold.ttf?url';
import stardosStencilBold from '../assets/fonts/StardosStencil-Bold.ttf?url';
import pressStart2P from '../assets/fonts/PressStart2P-Regular.ttf?url';
import unifraktur from '../assets/fonts/UnifrakturMaguntia-Regular.ttf?url';
import bangers from '../assets/fonts/Bangers-Regular.ttf?url';
import righteous from '../assets/fonts/Righteous-Regular.ttf?url';
import notoSymbols2 from '../assets/fonts/NotoSansSymbols2-Regular.ttf?url';
import notoSymbols from '../assets/fonts/NotoSansSymbols-Regular.ttf?url';
import notoMath from '../assets/fonts/NotoSansMath-Regular.ttf?url';
import notoEmoji from '../assets/fonts/NotoEmoji-Regular.ttf?url';

/**
 * Font disponibili per la forma Testo: TTF di Google Fonts (licenza OFL, vedi src/assets/fonts/README.md) di stili
 * diversi, più tre font di simboli per la tab Simboli. Servono i TTF e non i WOFF perché OpenSCAD li legge con
 * `use <file.ttf>` e perché finiscono nello ZIP dell'export. Il catalogo è leggero (nessuna libreria di lettura dei
 * font): lo usa anche il pannello.
 */
export interface FontInfo {
  /** Identificatore salvato nel nodo (stabile: non cambiare). */
  id: string;
  /** Nome mostrato nel pannello. */
  label: string;
  /** Nome del file, lo stesso che sta nello ZIP e nella riga `use <...>` del codice OpenSCAD. */
  file: string;
  /** Famiglia e stile come li dichiara il file, per `font = "Famiglia:style=Stile"` di OpenSCAD. */
  family: string;
  style: string;
  /** Indirizzo del file nell'app (asset con hash, nella cache della PWA). */
  url: string;
  /** Gruppo del menu Font del pannello Testo (i font di simboli non compaiono nel menu: si usano dalla tab Simboli). */
  category: FontCategory;
}

export type FontCategory = 'Sans' | 'Serif' | 'Display' | 'Corsivo e a mano' | 'Fantasia' | 'Simboli';

/** Ordine dei gruppi nel menu Font. */
export const FONT_CATEGORIES: FontCategory[] = ['Sans', 'Serif', 'Display', 'Corsivo e a mano', 'Fantasia'];

const font = (id: string, label: string, file: string, family: string, style: string, url: string, category: FontCategory): FontInfo => ({ id, label, file, family, style, url, category });

export const FONTS: FontInfo[] = [
  // Il primo è quello predefinito (vedi `fontInfo`)
  font('roboto-bold', 'Roboto Bold', 'Roboto-Bold.ttf', 'Roboto', 'Bold', robotoBold, 'Sans'),
  font('playfair-bold', 'Playfair Display Bold', 'PlayfairDisplay-Bold.ttf', 'Playfair Display', 'Bold', playfairBold, 'Serif'),
  font('roboto-mono-bold', 'Roboto Mono Bold', 'RobotoMono-Bold.ttf', 'Roboto Mono', 'Bold', robotoMonoBold, 'Sans'),
  font('bebas-neue', 'Bebas Neue', 'BebasNeue-Regular.ttf', 'Bebas Neue', 'Regular', bebasNeue, 'Display'),
  font('anton', 'Anton', 'Anton-Regular.ttf', 'Anton', 'Regular', anton, 'Display'),
  font('oswald-bold', 'Oswald Bold', 'Oswald-Bold.ttf', 'Oswald', 'Bold', oswaldBold, 'Display'),
  font('pacifico', 'Pacifico', 'Pacifico-Regular.ttf', 'Pacifico', 'Regular', pacifico, 'Corsivo e a mano'),
  font('lobster', 'Lobster', 'Lobster-Regular.ttf', 'Lobster', 'Regular', lobster, 'Corsivo e a mano'),
  font('dancing-script-bold', 'Dancing Script Bold', 'DancingScript-Bold.ttf', 'Dancing Script', 'Bold', dancingScriptBold, 'Corsivo e a mano'),
  font('permanent-marker', 'Permanent Marker', 'PermanentMarker-Regular.ttf', 'Permanent Marker', 'Regular', permanentMarker, 'Corsivo e a mano'),
  font('poppins-bold', 'Poppins Bold', 'Poppins-Bold.ttf', 'Poppins', 'Bold', poppinsBold, 'Sans'),
  font('varela-round', 'Varela Round', 'VarelaRound-Regular.ttf', 'Varela Round', 'Regular', varelaRound, 'Sans'),
  font('pt-serif-bold', 'PT Serif Bold', 'PTSerif-Bold.ttf', 'PT Serif', 'Bold', ptSerifBold, 'Serif'),
  font('roboto-slab-bold', 'Roboto Slab Bold', 'RobotoSlab-Bold.ttf', 'Roboto Slab', 'Bold', robotoSlabBold, 'Serif'),
  font('unifraktur', 'UnifrakturMaguntia', 'UnifrakturMaguntia-Regular.ttf', 'UnifrakturMaguntia', 'Book', unifraktur, 'Serif'),
  font('righteous', 'Righteous', 'Righteous-Regular.ttf', 'Righteous', 'Regular', righteous, 'Display'),
  font('stardos-stencil-bold', 'Stardos Stencil Bold', 'StardosStencil-Bold.ttf', 'Stardos Stencil', 'Bold', stardosStencilBold, 'Display'),
  font('caveat-bold', 'Caveat Bold', 'Caveat-Bold.ttf', 'Caveat', 'Bold', caveatBold, 'Corsivo e a mano'),
  font('bangers', 'Bangers', 'Bangers-Regular.ttf', 'Bangers', 'Regular', bangers, 'Fantasia'),
  font('press-start-2p', 'Press Start 2P', 'PressStart2P-Regular.ttf', 'Press Start 2P', 'Regular', pressStart2P, 'Fantasia'),
  // Font di simboli: contengono solo i glifi del catalogo dei simboli (symbolCatalog.ts)
  font('noto-symbols-2', 'Noto Sans Symbols 2', 'NotoSansSymbols2-Regular.ttf', 'Noto Sans Symbols 2', 'Regular', notoSymbols2, 'Simboli'),
  font('noto-symbols', 'Noto Sans Symbols', 'NotoSansSymbols-Regular.ttf', 'Noto Sans Symbols', 'Regular', notoSymbols, 'Simboli'),
  font('noto-math', 'Noto Sans Math', 'NotoSansMath-Regular.ttf', 'Noto Sans Math', 'Regular', notoMath, 'Simboli'),
  // Emoji monocromatiche a contorno (le emoji a colori non hanno un contorno da estrudere)
  font('noto-emoji', 'Noto Emoji', 'NotoEmoji-Regular.ttf', 'Noto Emoji', 'Regular', notoEmoji, 'Simboli'),
];

export const DEFAULT_FONT = 'roboto-bold';

/** Il font con questo id, oppure quello predefinito se l'id non esiste più (file di progetto di un'altra versione). */
export function fontInfo(id: string): FontInfo {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

/** Font di simboli: ripiego dei caratteri che il font scelto non ha (frecce, stelle, ...). */
export const SYMBOL_FONTS = FONTS.filter((f) => f.category === 'Simboli');

/**
 * Font (del catalogo) usati dalle forme Testo della scena, senza ripetizioni, nell'ordine del catalogo.
 * Un testo con caratteri fuori dall'ASCII chiede anche i font di simboli, su cui ripiega `textContours`.
 */
export function fontsUsed(scene: { nodes: Record<string, { type: string; kind?: string; font?: string; text?: string }> }): FontInfo[] {
  const ids = new Set<string>();
  for (const node of Object.values(scene.nodes)) {
    if (node.type !== 'shape2d' || node.kind !== 'text' || !node.font) continue;
    ids.add(fontInfo(node.font).id);
    if (node.text && [...node.text].some((c) => c.charCodeAt(0) > 127)) for (const f of SYMBOL_FONTS) ids.add(f.id);
  }
  return FONTS.filter((f) => ids.has(f.id));
}

/** Nome del font come lo vuole `text(font = ...)` di OpenSCAD, es. "Roboto:style=Bold". */
export const scadFontName = (f: FontInfo) => `${f.family}:style=${f.style}`;

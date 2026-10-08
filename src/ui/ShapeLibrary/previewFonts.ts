import { FONTS } from '../../scene/fontCatalog';

/** Nome della famiglia CSS con cui si mostra l'anteprima di un font di simboli (non confonderla con la famiglia del file). */
export const previewFamily = (fontId: string) => `construct-symbols-${fontId}`;

/** Font di simboli già registrati nel documento (una sola volta per sessione). */
const registered = new Set<string>();

/**
 * Registra come font CSS i font di simboli ed emoji del catalogo per le anteprime delle tab Simboli ed Emoji. Sono gli
 * stessi TTF dell'app (nella cache della PWA), quindi funziona anche offline.
 */
export async function registerPreviewFonts(): Promise<void> {
  await Promise.all(
    FONTS.filter((f) => f.category === 'Simboli' && !registered.has(f.id)).map(async (f) => {
      registered.add(f.id);
      try {
        const face = new FontFace(previewFamily(f.id), `url(${f.url})`);
        document.fonts.add(await face.load());
      } catch {
        // Senza il font l'anteprima ripiega sul carattere di sistema: il pulsante funziona comunque
        registered.delete(f.id);
      }
    }),
  );
}

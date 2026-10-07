import { fontsUsed } from '../scene/fontCatalog';
import { hasFont, registerFont } from '../scene/fontOutline';
import type { Scene } from '../scene/types';

/** Caricamenti in corso: due valutazioni ravvicinate non scaricano lo stesso font due volte. */
const loading = new Map<string, Promise<void>>();

/**
 * Scarica e registra i font dei testi della scena. Il kernel è sincrono, quindi va atteso prima di `evaluate`.
 * I file sono asset dell'app (nella cache della PWA): in uso offline arrivano da lì.
 */
export async function ensureFonts(scene: Scene): Promise<void> {
  const pending = fontsUsed(scene)
    .filter((f) => !hasFont(f.id))
    .map((f) => {
      let promise = loading.get(f.id);
      if (!promise) {
        promise = fetch(f.url)
          .then((response) => {
            if (!response.ok) throw new Error(`Font "${f.label}" non disponibile (${response.status}).`);
            return response.arrayBuffer();
          })
          .then((data) => registerFont(f.id, data))
          // Un errore non resta in memoria: il tentativo successivo riprova
          .finally(() => loading.delete(f.id));
        loading.set(f.id, promise);
      }
      return promise;
    });
  await Promise.all(pending);
}

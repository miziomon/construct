// Utilità condivise da constraints-sync.mjs e constraints-bench.mjs: ricavano dal modulo TypeScript del risolutore
// (src/ui/ProfileEditor/constraints.ts) il testo JavaScript che sta nel prototipo tra CORE-BEGIN e CORE-END.
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const TS_PATH = root + 'src/ui/ProfileEditor/constraints.ts';
export const HTML_PATH = root + 'docs/prototipi/profilo-quote.html';

export const BEGIN = '/* CORE-BEGIN: risolutore di vincoli. Generato da scripts/constraints-sync.mjs a partire da src/ui/ProfileEditor/constraints.ts: non modificare qui. */';
export const END = '/* CORE-END */';

/** Toglie i tipi (node:module, modalità strip: li sostituisce con spazi) e ripulisce gli spazi lasciati al loro posto. */
export function toPlain(ts) {
  // Fine riga uniformi: un file scritto da Windows può avere CRLF
  let js = stripTypeScriptTypes(ts.replaceAll('\r\n', '\n'), { mode: 'strip' });
  // Un commento di documentazione seguito da righe di soli spazi apparteneva a un tipo cancellato: va via con lui
  js = js.replace(/\/\*\*(?:(?!\*\/)[\s\S])*\*\/\n[ ]+\n/g, '\n');
  // Spazi finali, buchi lasciati dai tipi dentro la riga, spazi prima di virgole e parentesi, righe vuote multiple
  js = js.replace(/[ \t]+$/gm, '');
  js = js.replace(/(\S)[ ]{2,}(?=\S)/g, '$1 ').replace(/ ([,)\];])/g, '$1');
  js = js.replace(/^export /gm, '');
  // Ultima passata: righe di soli spazi svuotate e righe vuote multiple ridotte a una
  js = js.split('\n').map((l) => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n');
  return js.trim() + '\n';
}

/** Blocco completo, con i marcatori, pronto da incollare nel prototipo. */
export function coreBlock() {
  return BEGIN + '\n' + toPlain(readFileSync(TS_PATH, 'utf8')) + END;
}

/** Il blocco CORE del prototipo, marcatori compresi (null se manca). */
export function htmlBlock(html) {
  html = html.replaceAll('\r\n', '\n');
  const a = html.indexOf('/* CORE-BEGIN');
  const b = html.indexOf(END);
  return a < 0 || b < 0 ? null : html.slice(a, b + END.length);
}

/** Codice da eseguire: il corpo del blocco senza i marcatori. */
export function coreSource(block) {
  return block.slice(block.indexOf('*/') + 2, block.lastIndexOf(END));
}

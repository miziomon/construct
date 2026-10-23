// Genera il blocco CORE di docs/prototipi/texture-immagine.html dai sorgenti TypeScript dello studio, così le funzioni del prototipo
// sono quelle provate dai test (src/scene/textureMap.ts, src/kernel/textureMap.ts, src/codegen/textureScad.ts e le poche funzioni di
// src/kernel/relief.ts, src/scene/relief.ts e src/kernel/export/stl.ts da cui dipendono). Si toglie la tipizzazione con oxc (quello di Vite),
// si tolgono gli `import` e gli `export`, si concatena.
//
//   node scripts/texture-core.mjs write   riscrive il blocco tra CORE-BEGIN e CORE-END nell'HTML
//   node scripts/texture-core.mjs check   esce con errore se il blocco nell'HTML non coincide con i sorgenti
//   node scripts/texture-core.mjs print   stampa il blocco
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());
const HTML = join(ROOT, 'docs/prototipi/texture-immagine.html');
const BEGIN = '/* CORE-BEGIN';
const END = '/* CORE-END */';

const read = (file) => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const { transformWithOxc } = await import(pathToFileURL(join(ROOT, 'node_modules/vite/dist/node/index.js')).href);

/** Il sorgente di una dichiarazione di primo livello (funzione o costante), con il commento che la precede. */
function extract(source, name) {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^(export )?(async )?(function|const|let) ${name}\\b`).test(l));
  if (start < 0) throw new Error(`Dichiarazione non trovata: ${name}`);
  let end = start;
  // Una costante su una riga sola finisce sulla stessa riga; altrimenti si cerca la chiusura a colonna 0
  if (!(/^(export )?const /.test(lines[start]) && lines[start].trimEnd().endsWith(';'))) {
    end = start + 1;
    while (end < lines.length && !/^(\}|\];|\);|\};)/.test(lines[end])) end++;
  }
  // Commento (JSDoc o righe //) subito sopra
  let from = start;
  while (from > 0 && /^(\/\*\*| \*|\/\/)/.test(lines[from - 1])) from--;
  return lines.slice(from, end + 1).join('\n');
}

/** TypeScript -> JavaScript senza tipi, senza import e senza export. */
async function strip(code, label) {
  const { code: js } = await transformWithOxc(code, `${label}.ts`, { lang: 'ts' });
  return js
    .split('\n')
    .filter((l) => !/^import /.test(l))
    .map((l) => l.replace(/^export /, ''))
    .join('\n')
    .trim();
}

export async function buildCore() {
  const parts = [];
  const add = async (label, code) => parts.push(`/* ---------- ${label} ---------- */\n${await strip(code, label)}`);
  const relief = read('src/scene/relief.ts');
  const kernelRelief = read('src/kernel/relief.ts');
  const reliefScad = read('src/codegen/reliefScad.ts');
  // Dall'altro studio: griglia di campioni, solido di una mappa di altezze, formato dei file
  await add('scene/relief.ts', ['MAX_GRID_NODES', 'sampleGrid'].map((n) => extract(relief, n)).join('\n\n'));
  await add('kernel/relief.ts', ['ABOVE', 'EMBED', 'FLOOR', 'prism', 'heightSolid', 'clipToRegion'].map((n) => extract(kernelRelief, n)).join('\n\n'));
  await add('codegen/reliefScad.ts', extract(reliefScad, 'polyhedronLines'));
  await add('kernel/export/stl.ts', extract(read('src/kernel/export/stl.ts'), 'writeStl'));
  // Lo studio
  await add('scene/textureMap.ts', read('src/scene/textureMap.ts'));
  await add('scene/textureSamples.ts', read('src/scene/textureSamples.ts'));
  await add('kernel/textureMap.ts', read('src/kernel/textureMap.ts'));
  await add('codegen/textureScad.ts', read('src/codegen/textureScad.ts'));
  return parts.join('\n\n');
}

const mode = process.argv[2];
if (import.meta.url === pathToFileURL(process.argv[1]).href && mode) {
  const core = await buildCore();
  if (mode === 'print') console.log(core);
  else {
    const html = readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n');
    const a = html.indexOf(BEGIN);
    const b = html.indexOf(END);
    if (a < 0 || b < 0) throw new Error('Marcatori CORE-BEGIN / CORE-END non trovati nell\'HTML');
    // La riga dei marcatori di apertura resta com'è: si sostituisce il corpo
    const bodyStart = html.indexOf('\n', a) + 1;
    const next = `${html.slice(0, bodyStart)}${core}\n${html.slice(b)}`;
    if (mode === 'write') {
      writeFileSync(HTML, next);
      console.log(`CORE riscritto: ${core.split('\n').length} righe`);
    } else if (mode === 'check') {
      if (next !== html) {
        console.error('Il CORE dell\'HTML non coincide con i sorgenti: eseguire node scripts/texture-core.mjs write');
        process.exit(1);
      }
      console.log('CORE aggiornato');
    }
  }
}

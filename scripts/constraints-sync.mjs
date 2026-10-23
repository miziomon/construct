// Rigenera il blocco CORE-BEGIN / CORE-END di docs/prototipi/profilo-quote.html dal modulo TypeScript del risolutore.
// Uso: node scripts/constraints-sync.mjs          riscrive il blocco
//      node scripts/constraints-sync.mjs --check  esce con 1 se il prototipo non coincide con il modulo
import { readFileSync, writeFileSync } from 'node:fs';
import { HTML_PATH, coreBlock, htmlBlock } from './constraints-core.mjs';

const html = readFileSync(HTML_PATH, 'utf8');
const current = htmlBlock(html);
const wanted = coreBlock();
if (current === null) {
  console.error('Il prototipo non ha il blocco CORE-BEGIN / CORE-END');
  process.exit(1);
}
if (process.argv.includes('--check')) {
  if (current !== wanted) {
    console.error('Il blocco CORE del prototipo non coincide con constraints.ts: eseguire node scripts/constraints-sync.mjs');
    process.exit(1);
  }
  console.log('Blocco CORE allineato a constraints.ts');
} else if (current === wanted) {
  console.log('Blocco CORE già allineato');
} else {
  writeFileSync(HTML_PATH, html.replace(current, () => wanted));
  console.log('Blocco CORE aggiornato');
}

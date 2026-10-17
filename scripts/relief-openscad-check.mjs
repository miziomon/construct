// Verifica del codice OpenSCAD delle texture in rilievo (studio docs/studio-pattern-rilievo.md).
// Per ogni caso di <cartella>/expected.json esporta <cartella>/<caso>.scad in STL con OpenSCAD (backend Manifold), misura il
// volume dell'STL ASCII e lo confronta con quello calcolato dal kernel.
//
//   1) $env:RELIEF_SCAD_DIR='C:\temp\relief'; npx vitest run src/kernel/relief.test.ts -t "verifica OpenSCAD"
//   2) node scripts/relief-openscad-check.mjs C:\temp\relief [filtro]
//
// Il percorso di OpenSCAD si può dare con la variabile OPENSCAD (predefinito: l'installazione di Windows).
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const dir = process.argv[2];
const only = process.argv[3];
if (!dir) {
  console.error('Uso: node scripts/relief-openscad-check.mjs <cartella> [filtro]');
  process.exit(1);
}
const openscad = process.env.OPENSCAD || 'C:/Program Files/OpenSCAD/openscad.com';
const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));

/** Volume e triangoli di un STL ASCII (somma dei tetraedri con l'origine). */
function volume(file) {
  const text = readFileSync(file, 'utf8');
  const v = [...text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => [+m[1], +m[2], +m[3]]);
  let vol = 0;
  for (let i = 0; i < v.length; i += 3) {
    const [a, b, c] = [v[i], v[i + 1], v[i + 2]];
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return { tri: v.length / 3, vol };
}

for (const name of Object.keys(expected)) {
  if (only && !name.includes(only)) continue;
  const t0 = Date.now();
  const stl = join(dir, `${name}.stl`);
  const run = spawnSync(openscad, ['--backend=manifold', '-o', stl, join(dir, `${name}.scad`)], { encoding: 'utf8', timeout: 600000 });
  const warnings = `${run.stdout}${run.stderr}`.split('\n').filter((l) => /WARNING|ERROR/i.test(l)).slice(0, 2).join(' | ');
  const res = existsSync(stl) ? volume(stl) : { tri: 0, vol: NaN };
  const diff = res.vol - expected[name];
  console.log(`${name.padEnd(20)} exit=${run.status} ${((Date.now() - t0) / 1000).toFixed(1)}s tri=${res.tri} OpenSCAD=${res.vol.toFixed(1)} kernel=${expected[name].toFixed(1)} diff=${diff.toFixed(2)} mm3 ${warnings}`);
}

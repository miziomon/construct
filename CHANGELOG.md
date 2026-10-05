# Changelog

Tutte le modifiche rilevanti di WebCAD sono documentate in questo file.

Il formato segue [Keep a Changelog 1.1.0](https://keepachangelog.com/it-IT/1.1.0/) e il progetto
adotta il [Semantic Versioning](https://semver.org/lang/it/). Finché la versione maggiore è 0, le nuove
funzionalità incrementano la minor (0.x.0) e le correzioni la patch (0.x.y).

## Come si rilascia una versione

1. Sposta le voci di `[Non rilasciato]` in una nuova sezione `[x.y.z] - AAAA-MM-GG`.
2. Aggiorna `version` in `package.json`.
3. Verifica con `npm run typecheck && npm test && npm run build`.
4. Commit `chore(release): x.y.z` e tag annotato `vx.y.z` (`git tag -a vx.y.z -m "WebCAD x.y.z"`).

I messaggi di commit seguono i [Conventional Commits](https://www.conventionalcommits.org/it/v1.0.0/)
(`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).

## [Non rilasciato]

## [0.1.0] - 2026-10-05

Primo POC.

### Aggiunto
- Primitive 3D (scatola, cilindro, cono, sfera, toro) con parametri numerici in mm.
- Oggetti solidi e fori, gruppi con unione e intersezione, calcolo booleano con manifold-3d in un Web Worker.
- Viewport con piatto 256 × 256 mm, orbita, gizmo di spostamento e rotazione con snap, frecce da tastiera.
- Annulla e ripeti, outliner, pannello delle proprietà, barra di stato con ingombro, volume e validità della mesh.
- Export STL binario e 3MF (un oggetto per ogni solido, con colore).
- Pannello del codice OpenSCAD in sola lettura, mostrabile e nascondibile.
- Salvataggio automatico in IndexedDB e import/export del progetto in JSON.
- PWA con uso offline e avviso di nuova versione.

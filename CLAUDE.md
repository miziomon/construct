# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Construct è un editor CAD 3D nel browser per la stampa 3D (React + React Three Fiber + manifold-3d in WebAssembly). Esporta STL, 3MF e codice OpenSCAD equivalente. Interfaccia, commenti, CHANGELOG e messaggi di commit sono in italiano; gli identificatori restano in inglese.

## Comandi

```bash
npm run dev          # Vite su http://localhost:5173 (la versione arriva da package.json all'avvio: riavviare dopo un bump)
npm run typecheck    # tsc --noEmit
npm test             # Vitest (solo src/**/*.test.ts, ambiente node)
npx vitest run src/scene/pattern.test.ts            # un singolo file di test
npx vitest run -t "nome del test"                   # un singolo test per nome
npm run test:e2e     # Playwright: costruisce da solo la build "e2e" e la serve su :4391 con il Chrome installato
npx playwright test e2e/app.spec.ts -g "nome"       # un singolo test e2e
npm run build        # tsc --noEmit + vite build (con service worker PWA)
DOC_IMAGES=1 npx playwright test e2e/docs-images.spec.ts   # rigenera public/help e docs/images
```

## Architettura

Il flusso dati è: **store della scena (Zustand + Immer + zundo) → kernel in Web Worker → mesh → viewport R3F**, e in parallelo **store → codegen OpenSCAD**.

- `src/scene/` è il modello e contiene i calcoli puri (raccordi, guscio, serie, pattern, Voronoi, ridimensionamento, appoggio). `types.ts` definisce `Scene` (mappa `nodes` + `rootIds`) e i nodi: `primitive`, `shape2d`, `mesh`, `group` (con `GroupOp`: raggruppa, unione, differenza, intersezione, inviluppo, guscio, serie, pattern...), `edge`, `corner`. Unità mm, Z verso l'alto, rotazioni in gradi nell'ordine X, Y, Z come OpenSCAD. `store.ts` è l'unico punto di modifica della scena; la cronologia (Annulla/Ripeti) è `temporal` di zundo e `op` etichetta ogni passo per la timeline: un'operazione utente deve produrre un solo passo.
- `src/kernel/` calcola la geometria. `kernel.worker.ts` carica il WASM di manifold una sola volta ed espone via Comlink `evaluate`, `ghosts`, `exportStl`, `export3mf`, `registerAsset`; `client.ts` crea il worker unico; `useKernel.ts` ricalcola quando la scena cambia e alimenta `useResultStore` (`meshes`, `busy`, `ms`). `evaluate.ts` (classe `Evaluator`) traduce ogni nodo in `Manifold`; `pattern.ts` e `placement.ts` sono i calcoli pesanti lato kernel. I buffer delle mesh passano con `Comlink.transfer`.
- `src/codegen/openscad.ts` genera il codice OpenSCAD dallo stesso albero. **Deve restare coerente con `evaluate.ts`**: ogni nuovo tipo di nodo, modificatore o parametro va gestito in entrambi (i pattern esportano le celle già calcolate, così il risultato coincide).
- `src/import/` legge STL, 3MF, SVG; le mesh importate stanno in un registro di asset (`assets.ts`) fuori dalla scena, che ne tiene solo l'`assetId`, e vengono re-registrate nel worker al ripristino (`restore.ts`).
- Il progetto si chiamava WebCAD: i dati salvati con il vecchio nome si migrano (`src/storageMigration.ts` copia le chiavi di localStorage; `persistence.ts` e `import/assets.ts` leggono in IndexedDB anche le chiavi `webcad:*`; i progetti `.json` con formato `webcad-scene` si aprono ancora). Non rinominare più le chiavi `construct:*` senza una migrazione.
- `src/ui/commands.tsx` è il registro dei comandi sulla selezione: barra strumenti e menu contestuale (`src/ui/ContextMenu`) lo leggono entrambi; `inMenu` nasconde nel menu i comandi che per quell'oggetto non hanno senso. La schermata di benvenuto (`src/ui/Welcome`) compare solo al primo avvio (`firstVisit.ts`, da importare prima degli store in `main.tsx`).
- **Import OpenSCAD** (`src/import/scad`): `parse.ts` (analisi lessicale e sintattica di un sottoinsieme), `evaluate.ts` (valutatore con variabili, funzioni, moduli e `children()`, che compone le trasformazioni in matrici 4×4 e produce un albero di forme con limiti di passi/oggetti) e `toScene.ts` (scompone la matrice in scala assorbita nelle misure, rotazione e posizione e crea i nodi). I moduli `piatto_N` richiamati con `translate` diventano piatti (`sceneToOpenScad` li scrive così). Le impostazioni dell'utente stanno in `uiStore` (`Settings`, `cleanSettings`) e il pannello in `src/ui/Settings`.
- **Piatti** (`src/scene/plates.ts`): `scene.rootIds` è sempre l'elenco degli oggetti del **piatto attivo** (così vista, elenco, calcolo e codice non sanno nulla dei piatti); gli altri piatti sono parcheggiati in `scene.plates` con `activePlateId`. Una scena senza `plates` ha un piatto solo. Ogni radice sta in un solo posto: per cambiare piatto usare `switchPlate` (non crea passi di Annulla), per esportare un piatto `sceneForPlate`. Il 3MF esporta tutti i piatti affiancati (`transform` degli item), l'STL uno a scelta.
- `src/scene/persistence.ts` salva scena e asset in IndexedDB (`idb-keyval`) e gestisce i file di progetto versionati (`VERSION`): se cambia la forma dei dati, mantenere la lettura delle versioni precedenti.
- `src/viewport/` è la vista 3D (selezione, gizmo, overlay di Raccordo/Pattern/Misura/Appoggia, operandi fantasma); `src/ui/` ha barra strumenti, pannelli, proprietà, outliner, timeline. Un nuovo comando di barra richiede anche scorciatoia (`src/hooks/useShortcuts.ts`) e tooltip in `src/ui/Toolbar/toolbarHelp.ts`.
- Vite (`vite.config.ts`): `manifold-3d` è escluso dal pre-bundle (il glue Emscripten cerca il `.wasm` con `import.meta.url`), il codice è diviso in chunk (react, r3f, three, three-loaders, vendor) e `__APP_VERSION__` è definito da `package.json`.
- Test e2e (`e2e/`): in modalità `e2e` l'app espone `window.__construct` (`store`, `results`); gli helper `openApp` e `settled` in `e2e/helpers.ts` azzerano IndexedDB e attendono la fine del calcolo del kernel. Il service worker è bloccato nei test.

## Flusso dopo ogni modifica

Per ogni richiesta che cambia codice o documenti (non per sole domande):

1. Verifiche: `npx tsc --noEmit`, `npx vitest run`, `npx playwright test`; aggiungere o aggiornare i test della modifica.
2. Versione: alzare `version` in `package.json` e nelle prime due occorrenze di `package-lock.json` (minor per una funzione, patch per una correzione).
3. `CHANGELOG.md` (Keep a Changelog, in italiano): spostare le voci di "Non rilasciato" nella sezione `[x.y.z] - AAAA-MM-GG`.
4. Documentazione toccata dalla modifica: `README.md`, `docs/da-fare.md`, tooltip, testi del menu Scorciatoie; se cambia l'aspetto rigenerare le immagini (comando sopra).
5. Commit Conventional Commits in italiano, con la versione a chiudere il titolo, poi tag annotato `vX.Y.Z` e `git push origin main --tags`. Non committare `save/`, `.env*`, `dist*`, `test-results`; mai `push --force`.
6. Ricordare di riavviare il dev server.

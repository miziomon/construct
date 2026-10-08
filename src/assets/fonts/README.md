# Font per la forma Testo e per i simboli

Font di [Google Fonts](https://fonts.google.com), tutti con licenza **SIL Open Font License 1.1** (si possono usare, copiare e includere nei progetti, anche nello ZIP dell'export OpenSCAD).
Sono TTF **statici** (senza tabella `fvar`: opentype.js legge solo l'istanza predefinita dei font variabili) scaricati dall'API di Google Fonts, un peso per file.

## Font di testo (menu Font del pannello Testo)

| File | Famiglia | Stile | Gruppo |
|------|----------|-------|--------|
| `Roboto-Bold.ttf` | Roboto | Bold | Sans |
| `Poppins-Bold.ttf` | Poppins | Bold | Sans |
| `VarelaRound-Regular.ttf` | Varela Round | Regular | Sans |
| `RobotoMono-Bold.ttf` | Roboto Mono | Bold | Sans |
| `PlayfairDisplay-Bold.ttf` | Playfair Display | Bold | Serif |
| `PTSerif-Bold.ttf` | PT Serif | Bold | Serif |
| `RobotoSlab-Bold.ttf` | Roboto Slab | Bold | Serif |
| `UnifrakturMaguntia-Regular.ttf` | UnifrakturMaguntia | Book | Serif |
| `BebasNeue-Regular.ttf` | Bebas Neue | Regular | Display |
| `Anton-Regular.ttf` | Anton | Regular | Display |
| `Oswald-Bold.ttf` | Oswald | Bold | Display |
| `Orbitron-Bold.ttf` | Orbitron | Bold | Display |
| `Righteous-Regular.ttf` | Righteous | Regular | Display |
| `StardosStencil-Bold.ttf` | Stardos Stencil | Bold | Display |
| `Pacifico-Regular.ttf` | Pacifico | Regular | Corsivo e a mano |
| `Lobster-Regular.ttf` | Lobster | Regular | Corsivo e a mano |
| `DancingScript-Bold.ttf` | Dancing Script | Bold | Corsivo e a mano |
| `Caveat-Bold.ttf` | Caveat | Bold | Corsivo e a mano |
| `PermanentMarker-Regular.ttf` | Permanent Marker | Regular | Corsivo e a mano |
| `Bangers-Regular.ttf` | Bangers | Regular | Fantasia |
| `PressStart2P-Regular.ttf` | Press Start 2P | Regular | Fantasia |

## Font di simboli (tab Simboli)

Contengono **solo i glifi** elencati in `src/scene/symbolCatalog.ts` (scaricati con il parametro `text=` dell'API, per tenerli piccoli).
Se si aggiunge un simbolo al catalogo bisogna riscaricare il font con quel carattere (vedi `symbolCatalog.test.ts`, che controlla che ogni simbolo abbia il suo glifo).

| File | Famiglia | Contenuto |
|------|----------|-----------|
| `NotoSansSymbols2-Regular.ttf` | Noto Sans Symbols 2 | forme, stelle, cuori, segni, dingbat |
| `NotoSansSymbols-Regular.ttf` | Noto Sans Symbols | frecce semplici, musica, simboli vari |
| `NotoSansMath-Regular.ttf` | Noto Sans Math | matematica, lettere greche, frecce doppie |
| `NotoEmoji-Regular.ttf` | Noto Emoji | emoji monocromatiche a contorno (tab Emoji, elenco in `src/scene/emojiCatalog.ts`) |

L'elenco usato dall'app è in `src/scene/fontCatalog.ts`. Per aggiungerne uno: copiare qui il TTF e aggiungere una riga al catalogo
(il test `fontCatalog.test.ts` controlla che famiglia e stile coincidano con quelli dichiarati nel file e che il font sia statico).

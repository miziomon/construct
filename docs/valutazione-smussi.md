# Valutazione degli smussi e degli arrotondamenti

Data: 6 ottobre 2026. Domanda: come si possono smussare gli angoli di un solido in WebCAD, mantenendo le quote
esatte e tempi di calcolo da editor interattivo (obiettivo: sotto 300 ms per il caso tipico)?

## Opzioni valutate

| Opzione | Cosa fa | Precisione | Costo | Esito |
|---|---|---|---|---|
| a. Offset 2D arrotondato più estrusione | Quadrato con angoli arrotondati (`CrossSection.offset`, giunzione `Round`) poi estruso | Esatta | Trascurabile | **Adottata** (`cornerRadius` del quadrato 2D) |
| b. Involucro convesso di sfere | Scatola con tutti gli spigoli arrotondati: `hull` di otto sfere agli angoli | Esatta (facce piane alla quota originale) | 4 ms | **Adottata** (`cornerRadius` della scatola) |
| c. Minkowski con sfera | `minkowskiDifference` poi `minkowskiSum` con una sfera: arrotonda gli spigoli convessi di qualsiasi solido | Buona, ma perde volume e dettagli piccoli | Da 40 ms a 35 s (vedi sotto) | **Scartata** come funzione universale |
| d. `smoothOut` / `refine` | Arrotondamento organico per suddivisione | Non preserva le quote | Medio | Non adatta a pezzi tecnici |
| e. Raccordo e smusso veri su spigoli scelti | Selezione di spigoli, fillet e chamfer | Esatta | Alto | Fuori scope (richiede B-rep o selezione di spigoli stabile) |

## Benchmark del Minkowski (opzione c)

Misurato con manifold-3d 3.5.4 in Node, un solo thread. Il tempo comprende erosione e dilatazione.
Una sfera a 12 o 24 segmenti fa da elemento strutturale.

| Solido | Raggio, segmenti sfera | Tempo | Triangoli (prima → dopo) | Volume (mm³) |
|---|---|---|---|---|
| Scatola 20 mm | 1, 12 | 65 ms | 12 → 156 | 8000 → 7942 |
| Scatola 20 mm | 2, 24 | 103 ms | 12 → 444 | 8000 → 7797 |
| Cilindro r 10, h 20, 64 lati | 1, 12 | 688 ms | 252 → 1288 | 6273 → 6240 |
| Cilindro r 10, h 20, 64 lati | 5, 24 | 1645 ms | 252 → 1960 | 6273 → 5631 |
| Scatola 60 × 12 × 10 con 10 fori | 2, 12 | **16 s** | 1332 → 64366 | 5951 → 4965 |
| Scatola 60 × 12 × 10 con 10 fori | 1, 12 | **35 s** | 1332 → 60340 | 5951 → 5738 |
| Sfera r 10, 48 segmenti | 2, 12 | **10 s** | 1152 → 6300 | 4147 → 4140 |
| Scatola 20 mm, involucro di 8 sfere (opzione b) | 2, 24 | **4 ms** | 444 | 7797 |

**Lettura dei dati.** La regola di decisione fissata nel piano era: se il caso tipico (gruppo con circa 10 fori, raggio 2 mm)
resta sotto 300 ms, l'arrotondamento diventa una proprietà universale di ogni nodo. Il risultato è 16 secondi, cioè più di
cinquanta volte sopra la soglia. Il costo cresce con la non convessità e con il numero di facce, perché manifold scompone
il solido in parti convesse prima di combinarle. Anche una semplice sfera costa 10 secondi. Con raggio 5 mm il solido forato
quasi sparisce (503 mm³), quindi il metodo distrugge i pezzi sottili.

## Decisione

1. **Subito (versione 0.2.0):** arrotondamento esatto dove la geometria lo permette senza booleane costose:
   - quadrato 2D con raggio degli angoli (`cornerRadius`), che dopo l'estrusione arrotonda gli spigoli verticali;
   - scatola con raggio su tutti gli spigoli (involucro convesso di otto sfere).
2. **Non introdurre** un modificatore universale basato su Minkowski.
3. **Prossimi passi possibili**, in ordine di rapporto valore su costo:
   - Cilindro e cono con spigoli arrotondati alle basi, costruiti ruotando un profilo 2D arrotondato (stessa tecnica dell'opzione a, esatta e veloce).
   - Smusso a 45° (chamfer) per scatola e forme 2D, con la stessa tecnica dell'`offset` con giunzione `Miter` o `Square`.
   - Arrotondamento universale tramite campo di distanza con segno (SDF) e `Manifold.levelSet`: costo di meshing proporzionale al volume, qualità limitata dalla risoluzione della griglia, da valutare in un secondo spike (vedi `studio-fattibilita.md`, sezione 4).

## Limiti noti della soluzione adottata

- Le sfere agli angoli hanno 24 segmenti: il raccordo è una superficie sfaccettata, non perfettamente liscia. Il volume è entro l'1% di quello teorico.
- Il raggio è limitato a metà del lato minore meno 0,01 mm, per non produrre geometrie degeneri.
- Una scatola arrotondata che poi finisce in un gruppo con fori mantiene gli spigoli arrotondati solo all'esterno: i bordi dei fori restano vivi.

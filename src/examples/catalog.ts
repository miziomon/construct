/**
 * Modelli di esempio: progetti Construct (JSON nativo) incorporati nell'app. I due ex file OpenSCAD della cartella
 * `import/` sono stati convertiti una volta con l'importatore (`importScad`) e salvati come scene native, così si
 * aprono senza passare dall'interprete. Ogni JSON si scarica solo quando si sceglie l'esempio (`import()` dinamico) e
 * l'anteprima sta in `public/examples/<id>.webp`, generata da `e2e/docs-images.spec.ts`.
 */
export interface Example {
  /** Nome del file JSON e dell'anteprima. */
  id: string;
  title: string;
  /** Cosa mostra e quali strumenti di Construct usa. */
  text: string;
  /** Autore e licenza del modello originale. */
  credit: string;
  /** Testo del progetto (lo stesso formato dei file salvati con "Salva progetto"). */
  load: () => Promise<string>;
}

export const EXAMPLES: Example[] = [
  {
    id: 'business-card',
    title: 'Biglietto da visita',
    text: 'Una tessera sottile con nome, slogan e contatti in rilievo, un disco e una griglia di esagoni incassati per differenza e un\'emoji: testo, forme 2D e booleane.',
    credit: 'Construct, licenza MIT',
    load: () => import('./business-card.json?raw').then((m) => m.default),
  },
  {
    id: 'baby-toy',
    title: 'Gioco a incastri',
    text: 'Un vassoio con tre sedi (cubo, prisma e cilindro) e i tre pezzi da infilare, tutti arrotondati con la somma di Minkowski: differenza, unione e Minkowski.',
    credit: 'Ulrich Bär, CC0 (esempio di OpenSCAD)',
    load: () => import('./baby-toy.json?raw').then((m) => m.default),
  },
  {
    id: 'bauble',
    title: 'Pallina di Natale',
    text: 'Una goccia ottenuta per rivoluzione di un profilo, tagliata da sette pale con torsione e chiusa da un inviluppo, con l\'anello per appenderla: rivoluzione, torsione, inviluppo e intersezione.',
    credit: 'Torsten Paul, CC0 (esempio di OpenSCAD)',
    load: () => import('./bauble.json?raw').then((m) => m.default),
  },
];

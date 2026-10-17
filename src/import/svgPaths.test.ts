// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { cubicPoint, sampleContour, signedArea, segmentOf } from '../scene/bezier';
import { pathNaturalBox } from '../scene/shapes2d';
import type { PathContour, Vec2 } from '../scene/types';
import { arcToCubics, parsePathData, parseTransform, readSvgPaths } from './svgPaths';
import { ImportError } from './types';

const svg = (body: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

/** Punti dei nodi di un contorno. */
const points = (c: PathContour) => c.nodes.map((n) => n.p);
/** Area (positiva) del contorno campionato. */
const area = (c: PathContour) => Math.abs(signedArea(sampleContour(c, 0.001)));

describe('parsePathData', () => {
  it('M, L, H, V, Z assoluti e relativi; il lineto è implicito dopo il moveto', () => {
    const [sub] = parsePathData('M10 10 20 10 V30 h-10 l0 -5 Z');
    expect(sub.start).toEqual([10, 10]);
    expect(sub.segs.map((s) => s.to)).toEqual([[20, 10], [20, 30], [10, 30], [10, 25]]);
    expect(sub.closed).toBe(true);
    expect(sub.segs.every((s) => !s.c1)).toBe(true);
  });

  it('un comando dopo Z riparte dal punto iniziale del sottotracciato', () => {
    const subs = parsePathData('M0 0 L10 0 L10 10 Z L5 5 L5 0 Z');
    expect(subs).toHaveLength(2);
    expect(subs[1].start).toEqual([0, 0]);
    expect(subs[1].segs.map((s) => s.to)).toEqual([[5, 5], [5, 0]]);
    // Un moveto dopo Z inizia dove dice
    expect(parsePathData('M0 0 L1 1 Z M7 7 L8 8')[1].start).toEqual([7, 7]);
  });

  it('numeri attaccati, esponenti e separatori vari', () => {
    expect(parsePathData('M1.5.5 L-1-2 3e1,4E-1')[0].segs.map((s) => s.to)).toEqual([[-1, -2], [30, 0.4]]);
    expect(parsePathData('M1.5.5')[0].start).toEqual([1.5, 0.5]);
  });

  it('cubiche C e c; S riflette l\'ultima maniglia (o usa il punto corrente dopo un altro comando)', () => {
    const [sub] = parsePathData('M0 0 C0 10 10 10 10 0 S20 -10 20 0 s5 5 10 0');
    expect(sub.segs[0]).toEqual({ c1: [0, 10], c2: [10, 10], to: [10, 0] });
    // Riflesso di (10, 10) rispetto a (10, 0)
    expect(sub.segs[1]).toEqual({ c1: [10, -10], c2: [20, -10], to: [20, 0] });
    expect(sub.segs[2]).toEqual({ c1: [20, 10], c2: [25, 5], to: [30, 0] });
    // S senza una cubica prima: la prima maniglia è il punto corrente
    expect(parsePathData('M0 0 L5 0 S10 5 10 0')[0].segs[1]).toEqual({ c1: [5, 0], c2: [10, 5], to: [10, 0] });
  });

  it('Q e T diventano cubiche esatte: stessi punti della quadratica', () => {
    const [sub] = parsePathData('M0 0 Q10 20 20 0 T40 0');
    const [first, second] = sub.segs;
    // La quadratica a t = 0,5 passa per (10, 10)
    const mid = cubicPoint([[0, 0], first.c1!, first.c2!, first.to], 0.5);
    expect(mid[0]).toBeCloseTo(10, 9);
    expect(mid[1]).toBeCloseTo(10, 9);
    // T riflette il punto di controllo: (30, -20)
    const mid2 = cubicPoint([first.to, second.c1!, second.c2!, second.to], 0.5);
    expect(mid2[0]).toBeCloseTo(30, 9);
    expect(mid2[1]).toBeCloseTo(-10, 9);
  });

  it('un errore di sintassi ferma la lettura: restano i sottotracciati letti', () => {
    expect(parsePathData('M0 0 L10 0 X 5 5')[0].segs).toHaveLength(1);
    expect(parsePathData('M0 0 L10')[0].segs).toHaveLength(0);
    expect(parsePathData('10 10 L0 0')).toEqual([]);
    expect(parsePathData('')).toEqual([]);
  });

  it('archi: un quarto di cerchio sta sulla circonferenza, con i flag attaccati ai numeri', () => {
    // Dal punto (10, 0) a (0, 10), raggio 10, centro nell'origine
    for (const d of ['M10 0 A10 10 0 0 1 0 10', 'M10 0 a10 10 0 01-10 10']) {
      const [sub] = parsePathData(d);
      expect(sub.segs).toHaveLength(1);
      const s = sub.segs[0];
      expect(s.to).toEqual([0, 10]);
      const mid = cubicPoint([[10, 0], s.c1!, s.c2!, s.to], 0.5);
      expect(Math.hypot(mid[0], mid[1])).toBeCloseTo(10, 2);
    }
  });
});

describe('arcToCubics', () => {
  const onCircle = (segs: ReturnType<typeof arcToCubics>, from: Vec2, center: Vec2, r: number) => {
    let start = from;
    for (const s of segs) {
      for (let k = 0; k <= 10; k++) {
        const [x, y] = cubicPoint([start, s.c1!, s.c2!, s.to], k / 10);
        expect(Math.abs(Math.hypot(x - center[0], y - center[1]) - r)).toBeLessThan(r * 3e-4);
      }
      start = s.to;
    }
  };

  it('i flag scelgono l\'arco: grande o piccolo, in un verso o nell\'altro', () => {
    // Due punti a distanza 2r: l'arco è una semicirconferenza qualunque il flag grande
    const small = arcToCubics([10, 0], 10, 10, 0, false, true, [0, 10]);
    const large = arcToCubics([10, 0], 10, 10, 0, true, true, [0, 10]);
    expect(small).toHaveLength(1);
    // Con sweep = 1 l'arco piccolo ha il centro in (0, 0), quello grande copre 270° (3 quarti) attorno all'altro centro, (10, 10)
    onCircle(small, [10, 0], [0, 0], 10);
    expect(large).toHaveLength(3);
    onCircle(large, [10, 0], [10, 10], 10);
    // sweep = 0 con l'arco piccolo: l'altro centro, (10, 10)
    onCircle(arcToCubics([10, 0], 10, 10, 0, false, false, [0, 10]), [10, 0], [10, 10], 10);
  });

  it('raggi troppo piccoli si ingrandiscono (semicirconferenza), raggio nullo è una retta, estremi uguali nulla', () => {
    const half = arcToCubics([0, 0], 1, 1, 0, false, true, [10, 0]);
    expect(half).toHaveLength(2);
    onCircle(half, [0, 0], [5, 0], 5);
    expect(arcToCubics([0, 0], 0, 5, 0, false, true, [10, 0])).toEqual([{ to: [10, 0] }]);
    expect(arcToCubics([3, 3], 5, 5, 0, false, true, [3, 3])).toEqual([]);
  });

  it('l\'ultimo punto è esattamente l\'estremo richiesto, anche con ellisse ruotata', () => {
    const segs = arcToCubics([0, 0], 20, 10, 30, true, false, [7.3, 4.1]);
    expect(segs[segs.length - 1].to).toEqual([7.3, 4.1]);
  });
});

describe('parseTransform', () => {
  const apply = (m: ReturnType<typeof parseTransform>, p: Vec2): Vec2 => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
  const near = (a: Vec2, b: Vec2) => {
    expect(a[0]).toBeCloseTo(b[0], 9);
    expect(a[1]).toBeCloseTo(b[1], 9);
  };

  it('translate, scale (anche con un solo valore), matrix', () => {
    near(apply(parseTransform('translate(10 5)'), [1, 1]), [11, 6]);
    near(apply(parseTransform('translate(10)'), [1, 1]), [11, 1]);
    near(apply(parseTransform('scale(2)'), [1, 3]), [2, 6]);
    near(apply(parseTransform('scale(2, 3)'), [1, 3]), [2, 9]);
    near(apply(parseTransform('matrix(1 0 0 1 4 5)'), [1, 1]), [5, 6]);
  });

  it('rotate, anche attorno a un punto; skewX e skewY', () => {
    near(apply(parseTransform('rotate(90)'), [1, 0]), [0, 1]);
    near(apply(parseTransform('rotate(90 10 10)'), [20, 10]), [10, 20]);
    near(apply(parseTransform('skewX(45)'), [0, 2]), [2, 2]);
    near(apply(parseTransform('skewY(45)'), [2, 0]), [2, 2]);
  });

  it('le funzioni si compongono da sinistra a destra: prima l\'ultima, come in SVG', () => {
    // translate(10, 0) rotate(90): il punto (1, 0) ruota in (0, 1) e poi trasla in (10, 1)
    near(apply(parseTransform('translate(10 0) rotate(90)'), [1, 0]), [10, 1]);
    near(apply(parseTransform('rotate(90) translate(10 0)'), [1, 0]), [0, 11]);
  });

  it('assente, vuoto, sconosciuto o con argomenti sbagliati: identità', () => {
    for (const t of [undefined, null, '', 'foo(1 2)', 'translate()', 'rotate(1 2)', 'matrix(1 2 3)', 'scale(a)']) near(apply(parseTransform(t), [3, 4]), [3, 4]);
  });
});

describe('readSvgPaths', () => {
  it('un rettangolo: 4 spigoli chiusi, Y verso l\'alto, X del file conservata e fondo a y = 0', () => {
    const [c] = readSvgPaths(svg('<rect x="10" y="10" width="20" height="10"/>'), 'r');
    expect(c.closed).toBe(true);
    expect(c.nodes).toHaveLength(4);
    expect(c.nodes.every((n) => n.kind === 'corner' && !n.in && !n.out)).toBe(true);
    const box = pathNaturalBox({ paths: [c] })!;
    expect([box.minX, box.maxX, box.minY, box.maxY]).toEqual([10, 30, 0, 10]);
  });

  it('ciò che sta in alto nel disegno resta in alto', () => {
    const [c] = readSvgPaths(svg('<path d="M0 0 L10 0 L5 -20 Z"/>'), 'punta');
    const top = points(c).reduce((best, p) => (p[1] > best[1] ? p : best));
    expect(top).toEqual([5, 20]);
  });

  it('le unità fisiche dichiarate con il viewBox diventano millimetri', () => {
    const [c] = readSvgPaths(svg('<rect width="10" height="5"/>', 'width="10cm" height="10cm" viewBox="0 0 10 10"'), 'cm');
    const box = pathNaturalBox({ paths: [c] })!;
    expect(box.width).toBeCloseTo(100, 9);
    expect(box.depth).toBeCloseTo(50, 9);
  });

  it('un cerchio: 4 nodi simmetrici e area π r²', () => {
    const [c] = readSvgPaths(svg('<circle cx="50" cy="50" r="20"/>'), 'c');
    expect(c.nodes).toHaveLength(4);
    expect(c.nodes.every((n) => n.kind === 'symmetric')).toBe(true);
    expect(area(c) / (Math.PI * 400)).toBeCloseTo(1, 3);
  });

  it('un\'ellisse e un rettangolo con gli angoli arrotondati (rx da solo vale anche per ry)', () => {
    const [e] = readSvgPaths(svg('<ellipse cx="0" cy="0" rx="30" ry="10"/>'), 'e');
    expect(area(e) / (Math.PI * 300)).toBeCloseTo(1, 3);
    const [r] = readSvgPaths(svg('<rect width="40" height="20" rx="5"/>'), 'r');
    expect(r.nodes).toHaveLength(8);
    expect(area(r)).toBeCloseTo(800 - (4 - Math.PI) * 25, 0);
    // Il raggio non supera metà del lato
    const [capsule] = readSvgPaths(svg('<rect width="40" height="20" rx="100"/>'), 'k');
    expect(pathNaturalBox({ paths: [capsule] })!.depth).toBeCloseTo(20, 9);
  });

  it('polygon è chiuso, polyline con riempimento si chiude, solo con tratto resta aperta; la linea ha solo il tratto', () => {
    const [poly] = readSvgPaths(svg('<polygon points="0,0 10,0 10,10"/>'), 'g');
    expect(poly.closed).toBe(true);
    expect(poly.nodes).toHaveLength(3);
    const [filled] = readSvgPaths(svg('<polyline points="0,0 10,0 10,10"/>'), 'p');
    expect(filled.closed).toBe(true);
    const [stroked] = readSvgPaths(svg('<polyline fill="none" stroke="black" points="0,0 10,0 10,10"/>'), 'p');
    expect(stroked.closed).toBe(false);
    // La linea senza tratto non si vede (il riempimento non conta), con il tratto sì
    expect(() => readSvgPaths(svg('<line x1="0" y1="0" x2="10" y2="10"/>'), 'l')).toThrow(ImportError);
    expect(readSvgPaths(svg('<line stroke="red" x1="0" y1="0" x2="10" y2="10"/>'), 'l')[0].closed).toBe(false);
  });

  it('tracciati solo con tratto inclusi; un tracciato aperto con riempimento si chiude', () => {
    const contours = readSvgPaths(svg('<path fill="none" stroke="#000" d="M0 0 L10 0 L10 10"/><path d="M20 0 L30 0 L30 10"/>'), 's');
    expect(contours.map((c) => c.closed)).toEqual([false, true]);
  });

  it('esclusi: defs, clipPath, mask, symbol, marker, pattern, display none, senza riempimento e senza tratto, style e use', () => {
    const body = `
      <defs><path d="M0 0 H5 V5 Z"/></defs>
      <clipPath id="a"><rect width="9" height="9"/></clipPath>
      <mask id="b"><rect width="9" height="9"/></mask>
      <symbol id="c"><rect width="9" height="9"/></symbol>
      <marker id="d"><rect width="9" height="9"/></marker>
      <pattern id="e"><rect width="9" height="9"/></pattern>
      <use href="#c"/>
      <style>rect { fill: red }</style>
      <rect width="9" height="9" display="none"/>
      <rect width="9" height="9" style="display:none"/>
      <rect width="9" height="9" fill="none"/>
      <g display="none"><rect width="9" height="9"/></g>
      <rect x="100" width="9" height="9"/>`;
    const contours = readSvgPaths(svg(body), 'x');
    expect(contours).toHaveLength(1);
    expect(pathNaturalBox({ paths: contours })!.minX).toBe(100);
  });

  it('riempimento e tratto si ereditano dai gruppi e lo style in linea vince sull\'attributo', () => {
    // Il gruppo senza riempimento rende invisibile il figlio che non dice altro
    expect(() => readSvgPaths(svg('<g fill="none"><rect width="5" height="5"/></g>'), 'g')).toThrow(ImportError);
    // Un figlio che dichiara il riempimento lo riprende; il tratto ereditato basta
    expect(readSvgPaths(svg('<g fill="none"><rect width="5" height="5" fill="red"/><rect x="9" width="5" height="5" stroke="red"/></g>'), 'g')).toHaveLength(2);
    expect(readSvgPaths(svg('<g fill="none" stroke="blue"><rect width="5" height="5"/></g>'), 'g')).toHaveLength(1);
    // style vince sull'attributo
    expect(() => readSvgPaths(svg('<rect width="5" height="5" fill="red" style="fill:none"/>'), 's')).toThrow(ImportError);
    expect(readSvgPaths(svg('<rect width="5" height="5" fill="none" style="fill: red; stroke: none"/>'), 's')).toHaveLength(1);
  });

  it('le trasformazioni di tutta la catena agiscono su punti e maniglie', () => {
    // Cerchio di raggio 10 scalato 3 × 1 dal gruppo e spostato dall'elemento: un\'ellisse 60 × 20 con il centro in (30 + 7, ...)
    const [c] = readSvgPaths(svg('<g transform="scale(3 1)"><circle r="10" transform="translate(5 0)"/></g>'), 't');
    const box = pathNaturalBox({ paths: [c] })!;
    expect(box.width).toBeCloseTo(60, 9);
    expect(box.depth).toBeCloseTo(20, 9);
    expect(box.cx).toBeCloseTo(15, 9);
    // Il tipo dei nodi si riconosce dopo le trasformazioni (le maniglie restano opposte e uguali)
    expect(c.nodes.every((n) => n.kind === 'symmetric')).toBe(true);
    expect(area(c) / (Math.PI * 30 * 10)).toBeCloseTo(1, 3);
  });

  it('una rotazione di 90 gradi scambia larghezza e profondità; l\'inclinazione sposta i nodi', () => {
    const [r] = readSvgPaths(svg('<rect width="40" height="10" transform="rotate(90)"/>'), 'r');
    const box = pathNaturalBox({ paths: [r] })!;
    expect(box.width).toBeCloseTo(10, 9);
    expect(box.depth).toBeCloseTo(40, 9);
    const [k] = readSvgPaths(svg('<rect width="10" height="10" transform="skewX(45)"/>'), 'k');
    expect(pathNaturalBox({ paths: [k] })!.width).toBeCloseTo(20, 9);
  });

  it('la curva conserva i nodi e le maniglie, anche con C e S, e il tipo si riconosce', () => {
    const [c] = readSvgPaths(svg('<path d="M0 0 C0 10 10 20 20 20 S40 10 40 0 Z"/>'), 'c');
    expect(c.closed).toBe(true);
    expect(c.nodes).toHaveLength(3);
    // Il nodo a metà ha le maniglie opposte e della stessa lunghezza (S riflette): simmetrico
    expect(c.nodes[1].kind).toBe('symmetric');
    expect(c.nodes[0].kind).toBe('corner');
    expect(segmentOf(c, 0).straight).toBe(false);
  });

  it('un contorno chiuso che torna al punto iniziale prima della Z non ha un nodo doppio', () => {
    const [c] = readSvgPaths(svg('<path d="M0 0 L10 0 L10 10 L0 0 Z"/>'), 'c');
    expect(c.nodes).toHaveLength(3);
  });

  it('un cerchio a coordinate relative arrotondate che si chiude con un errore di 1e-3 ha 4 nodi simmetrici, non un nodo doppio', () => {
    // L'ultimo punto cade a (20,001, 10) invece che a (20, 10): lo stesso nodo del primo
    const relative = 'm 20,10 c 0,5.523 -4.477,10 -10,10 c -5.523,0 -10,-4.477 -10,-10 c 0,-5.523 4.477,-10 10,-10 c 5.523,0 10.001,4.477 10.001,10 z';
    const [c] = readSvgPaths(svg(`<path d="${relative}"/>`), 'relativo');
    expect(c.nodes).toHaveLength(4);
    expect(c.nodes.every((n) => n.kind === 'symmetric')).toBe(true);
    // Il primo nodo ha la maniglia in arrivo (dall'ultimo pezzo)
    expect(c.nodes[0].in).toBeDefined();
    expect(c.nodes[0].out).toBeDefined();
  });

  it('più sottotracciati diventano più contorni, nell\'ordine del file', () => {
    const contours = readSvgPaths(svg('<path fill-rule="evenodd" d="M0 0 H40 V40 H0 Z M10 10 H30 V30 H10 Z"/>'), 'f');
    expect(contours).toHaveLength(2);
    // La Y è ribaltata e il fondo a 0: il secondo contorno parte a 10 dall'alto del quadrato di 40
    expect(points(contours[1])[0]).toEqual([10, 30]);
  });

  it('i file rotti, senza radice svg o senza tracciati utilizzabili sono rifiutati con un messaggio', () => {
    expect(() => readSvgPaths('questo non è xml <<<', 'rotto')).toThrow(ImportError);
    expect(() => readSvgPaths('<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>', 'html')).toThrow('non è un file SVG valido');
    expect(() => readSvgPaths(svg('<rect width="5" height="5" fill="none"/>'), 'vuoto')).toThrow('non contiene tracciati utilizzabili');
    expect(() => readSvgPaths(svg(''), 'vuoto')).toThrow(ImportError);
  });

  it('oltre i tetti: 500 nodi per contorno e 100 contorni, con i numeri nel messaggio', () => {
    const long = `M0 0 ${Array.from({ length: 600 }, (_, i) => `L${i + 1} ${i % 2}`).join(' ')} Z`;
    expect(() => readSvgPaths(svg(`<path d="${long}"/>`), 'lungo')).toThrow('601 nodi in un contorno (massimo 500)');
    const many = Array.from({ length: 101 }, (_, i) => `<rect x="${i * 3}" width="2" height="2"/>`).join('');
    expect(() => readSvgPaths(svg(many), 'molti')).toThrow('101 contorni (massimo 100)');
    // Al limite passa
    const edge = Array.from({ length: 100 }, (_, i) => `<rect x="${i * 3}" width="2" height="2"/>`).join('');
    expect(readSvgPaths(svg(edge), 'limite')).toHaveLength(100);
  });
});

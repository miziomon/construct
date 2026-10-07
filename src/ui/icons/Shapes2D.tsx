import { createLucideIcon } from 'lucide-react';

/** Punti "x,y" arrotondati per gli attributi SVG. */
const pts = (points: [number, number][]) => points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

/** Stella a 6 punte (esagramma), in una griglia 24×24 con centro 12,12. */
const STAR6 = pts(
  Array.from({ length: 12 }, (_, i): [number, number] => {
    const angle = -Math.PI / 2 + (i * Math.PI) / 6;
    const r = i % 2 === 0 ? 10 : 5.8;
    return [12 + r * Math.cos(angle), 12 + r * Math.sin(angle)];
  }),
);

/** Stella a 6 punte: lucide-react ha solo quella a 5. */
export const Star6 = createLucideIcon('Star6', [['polygon', { points: STAR6, key: 'star6' }]]);

/** Trapezio con la base larga in basso. */
export const Trapezoid = createLucideIcon('Trapezoid', [['polygon', { points: '3,19 21,19 17,5 7,5', key: 'trapezoid' }]]);

/** Anello: due cerchi concentrici. */
export const Ring = createLucideIcon('Ring', [
  ['circle', { cx: 12, cy: 12, r: 9, key: 'outer' }],
  ['circle', { cx: 12, cy: 12, r: 4.5, key: 'inner' }],
]);

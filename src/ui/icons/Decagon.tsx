import { createLucideIcon } from 'lucide-react';

/** Vertici di un decagono regolare in una griglia 24×24 (centro 12,12, raggio 9), con il primo vertice in alto. */
const POINTS = Array.from({ length: 10 }, (_, i) => {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 10;
  return `${(12 + 9 * Math.cos(angle)).toFixed(2)},${(12 + 9 * Math.sin(angle)).toFixed(2)}`;
}).join(' ');

/** Poligono a 10 lati: lucide-react non ha un decagono. Stesse proprietà delle altre icone (size, strokeWidth, color). */
export const Decagon = createLucideIcon('Decagon', [['polygon', { points: POINTS, key: 'decagon' }]]);

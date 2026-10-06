/** Tinta (gradi) dell'ultimo colore generato: serve a tenere lontani due colori consecutivi. */
let lastHue = -1000;

/** Distanza minima di tinta (gradi) tra due colori generati di seguito. */
const MIN_HUE_GAP = 40;

/** Distanza angolare tra due tinte sul cerchio dei colori (0..180). */
const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Colore HSL (h in gradi, s e l in 0..1) come stringa "#rrggbb". */
export function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/**
 * Colore casuale per una nuova forma: tinta qualsiasi purché lontana almeno 40° dall'ultima generata,
 * saturazione e luminosità medie, così resta ben visibile sia sul tema chiaro sia su quello scuro.
 */
export function randomColor(rng: () => number = Math.random): string {
  let hue = rng() * 360;
  // Pochi tentativi bastano: si prende comunque l'ultimo se la tinta resta vicina
  for (let i = 0; i < 10 && hueDistance(hue, lastHue) < MIN_HUE_GAP; i++) hue = rng() * 360;
  lastHue = hue;
  return hslToHex(hue, 0.62 + rng() * 0.16, 0.52 + rng() * 0.1);
}

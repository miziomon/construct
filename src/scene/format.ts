/** Millimetri con due decimali alla maniera italiana, es. "20,00 mm". */
export const formatMm = (v: number) => `${v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mm`;

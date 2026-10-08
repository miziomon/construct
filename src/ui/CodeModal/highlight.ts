export type TokenKind = 'comment' | 'keyword' | 'function' | 'number' | 'param' | 'punct' | 'text';

export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS = new Set(['for', 'if', 'else', 'module', 'function', 'let', 'true', 'false', 'undef', 'center']);

const FUNCTIONS = new Set([
  'translate', 'rotate', 'scale', 'mirror', 'color', 'hull', 'minkowski', 'union', 'difference', 'intersection',
  'cube', 'sphere', 'cylinder', 'circle', 'square', 'polygon', 'polyhedron', 'offset', 'linear_extrude', 'rotate_extrude', 'import', 'text', 'use',
]);

// Un elemento per volta: commento, numero, identificatore (anche $fn), punteggiatura, spazi
const PATTERN = /(\/\/.*$)|(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_$][A-Za-z0-9_$]*)|([[\](){},;=*+\-/<>!&|?:.])|(\s+)/g;

/** Scompone una riga di codice OpenSCAD in segmenti colorabili. Non è un parser: bastano regole semplici. */
export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of line.matchAll(PATTERN)) {
    // Caratteri non riconosciuti tra un elemento e l'altro restano testo semplice
    if (m.index > last) tokens.push({ kind: 'text', text: line.slice(last, m.index) });
    last = m.index + m[0].length;

    if (m[1] !== undefined) tokens.push({ kind: 'comment', text: m[0] });
    else if (m[2] !== undefined) tokens.push({ kind: 'number', text: m[0] });
    else if (m[3] !== undefined) {
      const word = m[0];
      // Un identificatore seguito da "=" (ma non "==") è il nome di un parametro: r = 5, $fn = 64
      const next = line.slice(last).match(/^\s*=(?!=)/);
      const kind: TokenKind = KEYWORDS.has(word) ? 'keyword' : FUNCTIONS.has(word) ? 'function' : next ? 'param' : 'text';
      tokens.push({ kind, text: word });
    } else if (m[4] !== undefined) tokens.push({ kind: 'punct', text: m[0] });
    else tokens.push({ kind: 'text', text: m[0] });
  }
  if (last < line.length) tokens.push({ kind: 'text', text: line.slice(last) });
  return tokens;
}

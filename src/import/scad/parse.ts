/**
 * Lettore di un sottoinsieme di OpenSCAD: analisi lessicale e sintattica del codice. Capisce assegnazioni, espressioni
 * (numeri, vettori, intervalli, liste per comprensione, operatori, funzioni), chiamate di modulo con figli, `for`, `if`,
 * `module` e `function` definiti dall'utente. Il valutatore (`evaluate.ts`) lo trasforma in oggetti di Construct.
 */

/** Errore di sintassi con la riga in cui è stato trovato. */
export class ScadError extends Error {
  constructor(
    message: string,
    public line: number,
  ) {
    super(message);
  }
}

// --- Albero sintattico -------------------------------------------------------------------------------------------

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'undef' }
  | { t: 'id'; name: string }
  | { t: 'vec'; items: Expr[] }
  | { t: 'range'; a: Expr; b: Expr; c?: Expr }
  | { t: 'lc'; vars: [string, Expr][]; body: Expr }
  | { t: 'un'; op: string; e: Expr }
  | { t: 'bin'; op: string; l: Expr; r: Expr }
  | { t: 'tern'; c: Expr; a: Expr; b: Expr }
  | { t: 'call'; name: string; args: Arg[] }
  | { t: 'index'; e: Expr; i: Expr };

export interface Arg {
  name?: string;
  e: Expr;
}

export interface Param {
  name: string;
  def?: Expr;
}

export type Stmt =
  | { t: 'assign'; name: string; e: Expr; line: number }
  | { t: 'call'; name: string; args: Arg[]; children: Stmt[] | null; mod: string; line: number }
  | { t: 'for'; vars: [string, Expr][]; body: Stmt }
  | { t: 'if'; c: Expr; a: Stmt; b?: Stmt }
  | { t: 'block'; body: Stmt[] }
  | { t: 'module'; name: string; params: Param[]; body: Stmt[] }
  | { t: 'function'; name: string; params: Param[]; body: Expr };

// --- Analisi lessicale -------------------------------------------------------------------------------------------

/** `v` è il testo del token; per un numero `n` è il suo valore. */
type Token = { t: 'num' | 'str' | 'id' | 'p' | 'eof'; v: string; n?: number; line: number };

export interface Tokens {
  tokens: Token[];
  /** Nomi dei piatti scritti da Construct nei commenti `// === Piatto N: nome ===`, per numero di piatto. */
  plateNames: Map<number, string>;
  /** File richiamati con `use <...>` o `include <...>`: non si leggono. */
  uses: string[];
}

const TWO_CHAR = new Set(['==', '!=', '<=', '>=', '&&', '||']);
const PUNCT = new Set([...'(){}[];,=<>+-*/%?:!#.^']);

export function tokenize(src: string): Tokens {
  const tokens: Token[] = [];
  const plateNames = new Map<number, string>();
  const uses: string[] = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const text = src.slice(i, end < 0 ? src.length : end);
      const plate = /^\/\/\s*===\s*Piatto\s+(\d+):\s*(.*?)\s*===\s*$/.exec(text);
      if (plate) plateNames.set(Number(plate[1]), plate[2]);
      i = end < 0 ? src.length : end;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      line += (src.slice(i, stop).match(/\n/g) ?? []).length;
      i = stop;
    } else if (c === '"') {
      let j = i + 1;
      let text = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length) {
          j++;
          text += src[j] === 'n' ? '\n' : src[j] === 't' ? '\t' : src[j];
        } else {
          text += src[j];
        }
        j++;
      }
      if (j >= src.length) throw new ScadError('Stringa non chiusa', line);
      tokens.push({ t: 'str', v: text, line });
      i = j + 1;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      tokens.push({ t: 'num', v: m[0], n: Number(m[0]), line });
      i += m[0].length;
    } else if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i))!;
      i += m[0].length;
      // use <file> e include <file>: il nome tra < e > non è codice
      if ((m[0] === 'use' || m[0] === 'include') && /^\s*</.test(src.slice(i))) {
        const open = src.indexOf('<', i);
        const close = src.indexOf('>', open);
        if (close < 0) throw new ScadError(`Manca la > dopo ${m[0]} <`, line);
        uses.push(src.slice(open + 1, close).trim());
        i = close + 1;
        if (/^\s*;/.test(src.slice(i))) i = src.indexOf(';', i) + 1;
      } else {
        tokens.push({ t: 'id', v: m[0], line });
      }
    } else if (TWO_CHAR.has(src.slice(i, i + 2))) {
      tokens.push({ t: 'p', v: src.slice(i, i + 2), line });
      i += 2;
    } else if (PUNCT.has(c)) {
      tokens.push({ t: 'p', v: c, line });
      i++;
    } else {
      throw new ScadError(`Carattere non riconosciuto: "${c}"`, line);
    }
  }
  tokens.push({ t: 'eof', v: '', line });
  return { tokens, plateNames, uses };
}

// --- Analisi sintattica ------------------------------------------------------------------------------------------

/** Quanti livelli di annidamento si accettano: un file ostile non deve esaurire lo stack. */
const MAX_DEPTH = 120;

export function parse(tokens: Token[]): Stmt[] {
  let pos = 0;
  let depth = 0;
  const peek = (offset = 0) => tokens[Math.min(pos + offset, tokens.length - 1)];
  const next = () => tokens[pos++];
  const isP = (v: string, offset = 0) => peek(offset).t === 'p' && peek(offset).v === v;
  const isId = (v: string, offset = 0) => peek(offset).t === 'id' && peek(offset).v === v;
  const fail = (msg: string): never => {
    throw new ScadError(msg, peek().line);
  };
  const expectP = (v: string) => {
    if (!isP(v)) fail(`Atteso "${v}" ma trovato "${peek().v || 'fine del file'}"`);
    return next();
  };
  const nest = <T>(fn: () => T): T => {
    if (++depth > MAX_DEPTH) fail('Il codice è annidato troppo in profondità');
    try {
      return fn();
    } finally {
      depth--;
    }
  };

  // Espressioni, dalla precedenza più bassa alla più alta
  const expr = (): Expr => nest(ternary);

  function ternary(): Expr {
    const c = or();
    if (!isP('?')) return c;
    next();
    const a = expr();
    expectP(':');
    return { t: 'tern', c, a, b: expr() };
  }
  const binary = (ops: string[], operand: () => Expr) => (): Expr => {
    let l = operand();
    while (peek().t === 'p' && ops.includes(peek().v)) {
      const op = next().v;
      l = { t: 'bin', op, l, r: operand() };
    }
    return l;
  };
  const or = (): Expr => binary(['||'], and)();
  const and = (): Expr => binary(['&&'], equality)();
  const equality = (): Expr => binary(['==', '!='], relational)();
  const relational = (): Expr => binary(['<', '>', '<=', '>='], additive)();
  const additive = (): Expr => binary(['+', '-'], multiplicative)();
  const multiplicative = (): Expr => binary(['*', '/', '%'], unary)();

  function unary(): Expr {
    if (isP('-') || isP('+') || isP('!')) {
      const op = next().v;
      return { t: 'un', op, e: unary() };
    }
    return postfix();
  }

  function postfix(): Expr {
    let e = primary();
    for (;;) {
      if (isP('[')) {
        next();
        const i = expr();
        expectP(']');
        e = { t: 'index', e, i };
      } else if (isP('.') && peek(1).t === 'id' && 'xyz'.includes(peek(1).v) && peek(1).v.length === 1) {
        next();
        e = { t: 'index', e, i: { t: 'num', v: 'xyz'.indexOf(next().v) } };
      } else {
        return e;
      }
    }
  }

  function args(): Arg[] {
    expectP('(');
    const list: Arg[] = [];
    while (!isP(')')) {
      if (peek().t === 'id' && isP('=', 1)) {
        const name = next().v;
        next();
        list.push({ name, e: expr() });
      } else {
        list.push({ e: expr() });
      }
      if (!isP(')')) expectP(',');
    }
    next();
    return list;
  }

  function primary(): Expr {
    const tok = peek();
    if (tok.t === 'num') return next(), { t: 'num', v: tok.n ?? 0 };
    if (tok.t === 'str') return next(), { t: 'str', v: tok.v };
    if (tok.t === 'id') {
      next();
      if (tok.v === 'true' || tok.v === 'false') return { t: 'bool', v: tok.v === 'true' };
      if (tok.v === 'undef') return { t: 'undef' };
      if (isP('(')) return { t: 'call', name: tok.v, args: args() };
      return { t: 'id', name: tok.v };
    }
    if (isP('(')) {
      next();
      const e = expr();
      expectP(')');
      return e;
    }
    if (isP('[')) {
      next();
      // Lista per comprensione: [for (i = intervallo) valore]
      if (isId('for')) {
        next();
        expectP('(');
        const vars = assignments();
        expectP(')');
        const body = expr();
        expectP(']');
        return { t: 'lc', vars, body };
      }
      if (isP(']')) return next(), { t: 'vec', items: [] };
      const first = expr();
      if (isP(':')) {
        next();
        const second = expr();
        if (isP(':')) {
          next();
          const third = expr();
          expectP(']');
          return { t: 'range', a: first, c: second, b: third };
        }
        expectP(']');
        return { t: 'range', a: first, b: second };
      }
      const items = [first];
      while (isP(',')) {
        next();
        if (isP(']')) break;
        items.push(expr());
      }
      expectP(']');
      return { t: 'vec', items };
    }
    return fail(`Espressione non valida vicino a "${tok.v || 'fine del file'}"`);
  }

  /** `i = espressione, j = espressione` (dentro `for (...)`). */
  function assignments(): [string, Expr][] {
    const list: [string, Expr][] = [];
    while (!isP(')')) {
      if (peek().t !== 'id') fail('Atteso il nome di una variabile');
      const name = next().v;
      expectP('=');
      list.push([name, expr()]);
      if (!isP(')')) expectP(',');
    }
    return list;
  }

  function params(): Param[] {
    expectP('(');
    const list: Param[] = [];
    while (!isP(')')) {
      if (peek().t !== 'id') fail('Atteso il nome di un parametro');
      const name = next().v;
      if (isP('=')) {
        next();
        list.push({ name, def: expr() });
      } else {
        list.push({ name });
      }
      if (!isP(')')) expectP(',');
    }
    next();
    return list;
  }

  const bodyOf = (s: Stmt): Stmt[] => (s.t === 'block' ? s.body : [s]);

  function statement(): Stmt | null {
    return nest(() => {
      if (isP(';')) return next(), null;
      if (isP('{')) {
        next();
        const body: Stmt[] = [];
        while (!isP('}')) {
          if (peek().t === 'eof') fail('Manca una } di chiusura');
          const s = statement();
          if (s) body.push(s);
        }
        next();
        return { t: 'block', body };
      }
      if (isId('module')) {
        next();
        const name = next().v;
        const ps = params();
        const body = statement();
        return { t: 'module', name, params: ps, body: body ? bodyOf(body) : [] };
      }
      if (isId('function')) {
        next();
        const name = next().v;
        const ps = params();
        expectP('=');
        const body = expr();
        expectP(';');
        return { t: 'function', name, params: ps, body };
      }
      if (isId('for')) {
        next();
        expectP('(');
        const vars = assignments();
        expectP(')');
        return { t: 'for', vars, body: statement() ?? { t: 'block', body: [] } };
      }
      if (isId('if')) {
        next();
        expectP('(');
        const c = expr();
        expectP(')');
        const a = statement() ?? { t: 'block', body: [] };
        let b: Stmt | undefined;
        if (isId('else')) {
          next();
          b = statement() ?? { t: 'block', body: [] };
        }
        return { t: 'if', c, a, b };
      }
      // Modificatori di una chiamata: * (disattiva), ! (solo questo), # (evidenzia), % (sfondo)
      let mod = '';
      while (peek().t === 'p' && ['*', '!', '#', '%'].includes(peek().v)) mod += next().v;
      const tok = peek();
      if (tok.t !== 'id') return fail(`Istruzione non valida vicino a "${tok.v || 'fine del file'}"`);
      if (!mod && isP('=', 1)) {
        next();
        next();
        const e = expr();
        expectP(';');
        return { t: 'assign', name: tok.v, e, line: tok.line };
      }
      // Dopo un modificatore può comparire anche un for, un if o un blocco: si ripassa dall'inizio e si tiene il modificatore
      if (mod && (isId('for') || isId('if'))) {
        const inner = statement();
        return mod.includes('*') ? null : inner;
      }
      next();
      const callArgs = args();
      let children: Stmt[] | null = null;
      if (isP(';')) {
        next();
      } else {
        const child = statement();
        children = child ? bodyOf(child) : [];
      }
      return { t: 'call', name: tok.v, args: callArgs, children, mod, line: tok.line };
    });
  }

  const program: Stmt[] = [];
  while (peek().t !== 'eof') {
    const s = statement();
    if (s) program.push(s);
  }
  return program;
}

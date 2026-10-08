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
  /** `let (a = 1, b = a + 1) espressione` */
  | { t: 'let'; assigns: [string, Expr][]; body: Expr }
  /** `function (x) espressione`: funzione anonima, un valore che si può passare e richiamare */
  | { t: 'lambda'; params: Param[]; body: Expr }
  // Generatori di una lista per comprensione: ogni elemento di `[...]` può essere un'espressione o uno di questi
  | { t: 'gfor'; vars: [string, Expr][]; body: Expr }
  | { t: 'gforc'; init: [string, Expr][]; cond: Expr; step: [string, Expr][]; body: Expr }
  | { t: 'gif'; c: Expr; a: Expr; b?: Expr }
  | { t: 'geach'; e: Expr }
  | { t: 'glet'; assigns: [string, Expr][]; body: Expr }
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
  /** `let (...) istruzione` e `assign (...) istruzione` */
  | { t: 'let'; assigns: [string, Expr][]; body: Stmt }
  /** Modificatore davanti a un `for`, un `if` o un blocco: `*` disattiva, `%` sfondo, `!` solo questo, `#` evidenzia. */
  | { t: 'mod'; mod: string; body: Stmt }
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
    return power();
  }

  /** `a ^ b`: associativa a destra e più forte del meno unario (`-2 ^ 2` vale -4). */
  function power(): Expr {
    const base = postfix();
    if (!isP('^')) return base;
    next();
    return { t: 'bin', op: '^', l: base, r: unary() };
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
      if (tok.v === 'function' && isP('(')) {
        const ps = params();
        return { t: 'lambda', params: ps, body: expr() };
      }
      if (tok.v === 'let' && isP('(')) {
        next();
        const assigns = assignments();
        expectP(')');
        return { t: 'let', assigns, body: expr() };
      }
      if (isP('(')) {
        const call: Expr = { t: 'call', name: tok.v, args: args() };
        // `echo(...) valore` e `assert(...) valore`: il valore è quello dell'espressione che segue
        if ((tok.v === 'echo' || tok.v === 'assert') && startsExpression()) return expr();
        return call;
      }
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
      if (isP(']')) return next(), { t: 'vec', items: [] };
      // Un elemento che inizia con for, if, each o let è un generatore: la lista si costruisce elemento per elemento
      if (isGenerator()) {
        const items = [element()];
        while (isP(',')) {
          next();
          if (isP(']')) break;
          items.push(element());
        }
        expectP(']');
        return { t: 'vec', items };
      }
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
        items.push(element());
      }
      expectP(']');
      return { t: 'vec', items };
    }
    return fail(`Espressione non valida vicino a "${tok.v || 'fine del file'}"`);
  }

  /** Vero se il token seguente può iniziare un'espressione (serve a `echo(...) valore`). */
  function startsExpression(): boolean {
    const tok = peek();
    if (tok.t === 'num' || tok.t === 'str') return true;
    if (tok.t === 'id') return tok.v !== 'else';
    return tok.t === 'p' && ['(', '[', '-', '+', '!'].includes(tok.v);
  }

  /** Vero se qui comincia un generatore di lista (`for`, `if`, `each`, oppure `let` seguito da un generatore). */
  function isGenerator(): boolean {
    if (isId('for') || isId('if') || isId('each')) return true;
    if (!isId('let') || !isP('(', 1)) return false;
    // let (...) for/if/each: si guarda oltre la parentesi di chiusura
    let k = 2;
    for (let level = 1; level > 0 && peek(k).t !== 'eof'; k++) {
      if (isP('(', k)) level++;
      else if (isP(')', k)) level--;
    }
    return isId('for', k) || isId('if', k) || isId('each', k) || isId('let', k);
  }

  /** Elemento di una lista: un'espressione oppure un generatore (annidabile). */
  function element(): Expr {
    return nest(() => {
      if (isId('for')) {
        next();
        expectP('(');
        const vars = assignments();
        // Forma del C: for (i = 0; i < 5; i = i + 1)
        if (isP(';')) {
          next();
          const cond = expr();
          expectP(';');
          const step = assignments();
          expectP(')');
          return { t: 'gforc', init: vars, cond, step, body: element() } as Expr;
        }
        expectP(')');
        return { t: 'gfor', vars, body: element() } as Expr;
      }
      if (isId('if')) {
        next();
        expectP('(');
        const c = expr();
        expectP(')');
        const a = element();
        if (isId('else')) {
          next();
          return { t: 'gif', c, a, b: element() } as Expr;
        }
        return { t: 'gif', c, a } as Expr;
      }
      if (isId('each')) {
        next();
        return { t: 'geach', e: element() } as Expr;
      }
      if (isId('let') && isP('(', 1) && isGenerator()) {
        next();
        expectP('(');
        const assigns = assignments();
        expectP(')');
        return { t: 'glet', assigns, body: element() } as Expr;
      }
      return expr();
    });
  }

  /** `i = espressione, j = espressione` (dentro `for (...)`). */
  function assignments(): [string, Expr][] {
    const list: [string, Expr][] = [];
    while (!isP(')') && !isP(';')) {
      if (peek().t !== 'id') fail('Atteso il nome di una variabile');
      const name = next().v;
      expectP('=');
      list.push([name, expr()]);
      if (!isP(')') && !isP(';')) expectP(',');
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
      // let (...) istruzione e il vecchio assign (...) istruzione: variabili valide solo per l'istruzione che segue
      if ((isId('let') || isId('assign')) && isP('(', 1)) {
        next();
        next();
        const assigns = assignments();
        expectP(')');
        return { t: 'let', assigns, body: statement() ?? { t: 'block', body: [] } } as Stmt;
      }
      // Modificatori di una chiamata: * (disattiva), ! (solo questo), # (evidenzia), % (sfondo)
      let mod = '';
      while (peek().t === 'p' && ['*', '!', '#', '%'].includes(peek().v)) mod += next().v;
      // Dopo un modificatore può comparire anche un for, un if o un blocco: il modificatore vale per tutta l'istruzione
      if (mod && (isId('for') || isId('if') || isP('{'))) return { t: 'mod', mod, body: statement() ?? { t: 'block', body: [] } } as Stmt;
      const tok = peek();
      if (tok.t !== 'id') return fail(`Istruzione non valida vicino a "${tok.v || 'fine del file'}"`);
      if (!mod && isP('=', 1)) {
        next();
        next();
        const e = expr();
        expectP(';');
        return { t: 'assign', name: tok.v, e, line: tok.line };
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

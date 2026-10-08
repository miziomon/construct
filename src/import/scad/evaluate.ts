import { parse, ScadError, tokenize } from './parse';
import type { Arg, Expr, Param, Stmt } from './parse';

/**
 * Valutatore di un sottoinsieme di OpenSCAD: esegue il programma (variabili, funzioni, moduli, `for`, `if`) e produce un
 * albero di oggetti con la loro trasformazione già composta. Ciò che non conosce (rotate_extrude, minkowski, import, ...)
 * si salta con un avviso invece di bloccare l'importazione.
 */

// --- Matrici 4×4 (16 numeri, per righe) --------------------------------------------------------------------------

export type Mat = number[];
export const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function mulMat(a: Mat, b: Mat): Mat {
  const r = new Array<number>(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  return r;
}

const translateMat = (x: number, y: number, z: number): Mat => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const scaleMat = (x: number, y: number, z: number): Mat => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
const rad = (d: number) => (d * Math.PI) / 180;

/** `rotate([ax, ay, az])`: prima X, poi Y, poi Z (R = Rz · Ry · Rx). */
function rotateEulerMat(ax: number, ay: number, az: number): Mat {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rad(ax)), Math.sin(rad(ax)), Math.cos(rad(ay)), Math.sin(rad(ay)), Math.cos(rad(az)), Math.sin(rad(az))];
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx, 0,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, 0,
    -sy, cy * sx, cy * cx, 0,
    0, 0, 0, 1,
  ];
}

/** `rotate(a, v)`: rotazione di `a` gradi attorno all'asse `v` (formula di Rodrigues). */
function rotateAxisMat(angle: number, v: [number, number, number]): Mat {
  const len = Math.hypot(...v);
  if (len === 0) return IDENTITY;
  const [x, y, z] = v.map((c) => c / len);
  const c = Math.cos(rad(angle));
  const s = Math.sin(rad(angle));
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
}

/** `mirror(v)`: riflessione rispetto al piano che passa dall'origine con normale `v`. */
function mirrorMat(v: [number, number, number]): Mat {
  const len = Math.hypot(...v);
  if (len === 0) return IDENTITY;
  const [x, y, z] = v.map((c) => c / len);
  return [1 - 2 * x * x, -2 * x * y, -2 * x * z, 0, -2 * x * y, 1 - 2 * y * y, -2 * y * z, 0, -2 * x * z, -2 * y * z, 1 - 2 * z * z, 0, 0, 0, 0, 1];
}

// --- Valori ------------------------------------------------------------------------------------------------------

class Range {
  constructor(
    public start: number,
    public step: number,
    public end: number,
  ) {}

  /** Valori dell'intervallo (al massimo `limit`, per non bloccare l'app con intervalli enormi). */
  values(limit: number): number[] {
    const out: number[] = [];
    if (!Number.isFinite(this.start) || !Number.isFinite(this.end) || !Number.isFinite(this.step) || this.step === 0) return out;
    if (this.step > 0) for (let v = this.start; v <= this.end + 1e-9 && out.length < limit; v += this.step) out.push(v);
    else for (let v = this.start; v >= this.end - 1e-9 && out.length < limit; v += this.step) out.push(v);
    return out;
  }
}

export type Value = number | boolean | string | null | Value[] | Range;

const isNum = (v: Value): v is number => typeof v === 'number' && Number.isFinite(v);
const truthy = (v: Value): boolean => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.length > 0 : !!v && v !== 0);

/** Numero da un valore (altrimenti `fallback`). */
export const asNum = (v: Value | undefined, fallback: number): number => (v !== undefined && isNum(v) ? v : typeof v === 'boolean' ? Number(v) : fallback);

/** Terna di numeri: un numero solo vale per tutti e tre gli assi (come `scale(2)`). */
export function asVec3(v: Value | undefined, fallback: [number, number, number], scalarFills = true): [number, number, number] {
  if (v !== undefined && isNum(v)) return scalarFills ? [v, v, v] : [v, fallback[1], fallback[2]];
  if (Array.isArray(v)) return [asNum(v[0], fallback[0]), asNum(v[1], fallback[1]), asNum(v[2], fallback[2])];
  return fallback;
}

// --- Oggetti prodotti --------------------------------------------------------------------------------------------

/** Profilo 2D con i dati dell'estrusione (`linear_extrude`) che lo trasforma in un solido. */
export interface Extrude {
  h: number;
  center: boolean;
  twist: number;
  scale: number;
}

export type Shape =
  | { s: 'cube'; size: [number, number, number]; center: boolean }
  | { s: 'sphere'; r: number; fn: number }
  | { s: 'cylinder'; h: number; r1: number; r2: number; center: boolean; fn: number }
  | { s: 'circle'; r: number; fn: number; ext: Extrude }
  | { s: 'square'; size: [number, number]; center: boolean; ext: Extrude }
  | { s: 'polygon'; points: [number, number][]; ext: Extrude };

export interface PrimItem {
  kind: 'prim';
  shape: Shape;
  /** Trasformazione composta dal mondo al sistema locale dell'oggetto. */
  M: Mat;
  color?: string;
}

export type GroupOp = 'union' | 'difference' | 'intersection' | 'hull';

export interface GroupItem {
  kind: 'group';
  op: GroupOp;
  children: Item[];
}

export type Item = PrimItem | GroupItem;

/** Risultato della lettura di un file .scad. */
export interface ScadResult {
  /** Oggetti fuori dai moduli dei piatti. */
  items: Item[];
  /** Piatti riconosciuti (moduli `piatto_N` richiamati affiancati), in ordine di numero. */
  plates: { index: number; name: string; items: Item[] }[];
  warnings: string[];
}

// --- Ambiente ----------------------------------------------------------------------------------------------------

class Env {
  private vars = new Map<string, Value>();
  constructor(private parent?: Env) {}
  get(name: string): Value | undefined {
    for (let e: Env | undefined = this; e; e = e.parent) if (e.vars.has(name)) return e.vars.get(name);
    return undefined;
  }
  set(name: string, v: Value) {
    this.vars.set(name, v);
  }
}

interface ModuleDef {
  params: Param[];
  body: Stmt[];
}
interface FunctionDef {
  params: Param[];
  body: Expr;
}

interface Ctx {
  M: Mat;
  color?: string;
  /** Dentro `linear_extrude`: le forme 2D diventano solidi con questa estrusione. */
  ext?: Extrude;
  /** Figli del modulo in corso (`children()`), da valutare nel contesto di chi li richiama. */
  children?: (ctx: Ctx) => Item[];
  depth: number;
}

/** Limiti: un file enorme o ricorsivo non deve bloccare l'app. */
const LIMITS = { steps: 400_000, leaves: 3000, loop: 20_000, depth: 48 };

const NAMED_COLORS: Record<string, string> = {
  red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500', purple: '#800080', black: '#000000',
  white: '#ffffff', gray: '#808080', grey: '#808080', cyan: '#00ffff', magenta: '#ff00ff', pink: '#ffc0cb', brown: '#a52a2a',
  gold: '#ffd700', silver: '#c0c0c0', lime: '#00ff00', navy: '#000080', teal: '#008080', maroon: '#800000', olive: '#808000',
  salmon: '#fa8072', coral: '#ff7f50', crimson: '#dc143c', indigo: '#4b0082', violet: '#ee82ee', tan: '#d2b48c', beige: '#f5f5dc',
  khaki: '#f0e68c', turquoise: '#40e0d0', orchid: '#da70d6', chocolate: '#d2691e', darkgreen: '#006400', darkblue: '#00008b', darkred: '#8b0000',
};

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');

export function evaluateScad(source: string): ScadResult {
  const { tokens, plateNames, uses } = tokenize(source);
  const program = parse(tokens);

  const warnings = new Set<string>();
  const warn = (msg: string) => warnings.add(msg);
  const modules = new Map<string, ModuleDef>();
  const functions = new Map<string, FunctionDef>();
  let steps = 0;
  let leaves = 0;
  const tick = () => {
    if (++steps > LIMITS.steps) throw new ScadError('Il file è troppo complesso da leggere (troppi passaggi)', 0);
  };

  if (uses.length) warn(`Le librerie richiamate con use/include non si leggono (${uses.join(', ')}): i loro moduli sono saltati.`);

  // Definizioni di moduli e funzioni di tutto il programma (anche annidate): in OpenSCAD valgono per tutto il file
  const collect = (stmts: Stmt[]) => {
    for (const s of stmts) {
      if (s.t === 'module') {
        modules.set(s.name, { params: s.params, body: s.body });
        collect(s.body);
      } else if (s.t === 'function') functions.set(s.name, { params: s.params, body: s.body });
      else if (s.t === 'block') collect(s.body);
    }
  };
  collect(program);

  // --- Espressioni ----------------------------------------------------------------------------------------------

  const builtinFn = (name: string, a: Value[]): Value => {
    const n = (i: number) => asNum(a[i], NaN);
    switch (name) {
      case 'sin': return Math.sin(rad(n(0)));
      case 'cos': return Math.cos(rad(n(0)));
      case 'tan': return Math.tan(rad(n(0)));
      case 'asin': return (Math.asin(n(0)) * 180) / Math.PI;
      case 'acos': return (Math.acos(n(0)) * 180) / Math.PI;
      case 'atan': return (Math.atan(n(0)) * 180) / Math.PI;
      case 'atan2': return (Math.atan2(n(0), n(1)) * 180) / Math.PI;
      case 'abs': return Math.abs(n(0));
      case 'sqrt': return Math.sqrt(n(0));
      case 'pow': return Math.pow(n(0), n(1));
      case 'exp': return Math.exp(n(0));
      case 'ln': return Math.log(n(0));
      case 'log': return Math.log10(n(0));
      case 'floor': return Math.floor(n(0));
      case 'ceil': return Math.ceil(n(0));
      case 'round': return Math.round(n(0));
      case 'sign': return Math.sign(n(0));
      case 'min': case 'max': {
        const list = a.length === 1 && Array.isArray(a[0]) ? (a[0] as Value[]) : a;
        const nums = list.filter(isNum);
        return nums.length ? (name === 'min' ? Math.min(...nums) : Math.max(...nums)) : null;
      }
      case 'len': return Array.isArray(a[0]) ? a[0].length : typeof a[0] === 'string' ? a[0].length : null;
      case 'norm': return Array.isArray(a[0]) ? Math.hypot(...a[0].map((v) => asNum(v, 0))) : null;
      case 'concat': return a.flatMap((v) => (Array.isArray(v) ? v : [v]));
      case 'str': return a.map((v) => (Array.isArray(v) ? `[${v.join(', ')}]` : String(v ?? 'undef'))).join('');
      case 'is_undef': return a[0] === null || a[0] === undefined;
      case 'is_num': return isNum(a[0]);
      case 'is_list': return Array.isArray(a[0]);
      default: return undefined as unknown as Value;
    }
  };

  const evalBin = (op: string, l: Value, r: Value): Value => {
    if (op === '==') return JSON.stringify(l) === JSON.stringify(r);
    if (op === '!=') return JSON.stringify(l) !== JSON.stringify(r);
    // Vettori: somma e differenza per componente, prodotto con uno scalare
    if (Array.isArray(l) && Array.isArray(r) && (op === '+' || op === '-')) return l.map((v, i) => evalBin(op, v, r[i] ?? 0));
    if (Array.isArray(l) && isNum(r) && (op === '*' || op === '/')) return l.map((v) => evalBin(op, v, r));
    if (isNum(l) && Array.isArray(r) && op === '*') return r.map((v) => evalBin(op, l, v));
    const a = asNum(l, NaN);
    const b = asNum(r, NaN);
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return a / b;
      case '%': return a % b;
      case '<': return a < b;
      case '>': return a > b;
      case '<=': return a <= b;
      case '>=': return a >= b;
      default: return null;
    }
  };

  const ev = (e: Expr, env: Env): Value => {
    tick();
    switch (e.t) {
      case 'num': return e.v;
      case 'str': return e.v;
      case 'bool': return e.v;
      case 'undef': return null;
      case 'id': {
        if (e.name === 'PI') return Math.PI;
        if (e.name === '$t') return 0;
        const v = env.get(e.name);
        if (v === undefined) {
          if (!e.name.startsWith('$')) warn(`Variabile non definita: ${e.name}`);
          return null;
        }
        return v;
      }
      case 'vec': return e.items.map((i) => ev(i, env));
      case 'range': {
        const a = asNum(ev(e.a, env), NaN);
        const b = asNum(ev(e.b, env), NaN);
        const c = e.c ? asNum(ev(e.c, env), NaN) : undefined;
        // [inizio:passo:fine] oppure [inizio:fine] con passo 1
        return c === undefined ? new Range(a, 1, b) : new Range(a, b, c);
      }
      case 'lc': {
        const out: Value[] = [];
        const loop = (k: number, scope: Env) => {
          if (k === e.vars.length) {
            out.push(ev(e.body, scope));
            return;
          }
          for (const v of iterate(ev(e.vars[k][1], scope))) {
            const inner = new Env(scope);
            inner.set(e.vars[k][0], v);
            loop(k + 1, inner);
            if (out.length > LIMITS.loop) return;
          }
        };
        loop(0, env);
        return out;
      }
      case 'un': {
        const v = ev(e.e, env);
        if (e.op === '!') return !truthy(v);
        if (e.op === '-') return Array.isArray(v) ? v.map((x) => -asNum(x, NaN)) : -asNum(v, NaN);
        return v;
      }
      case 'bin': {
        if (e.op === '&&') return truthy(ev(e.l, env)) && truthy(ev(e.r, env));
        if (e.op === '||') return truthy(ev(e.l, env)) || truthy(ev(e.r, env));
        return evalBin(e.op, ev(e.l, env), ev(e.r, env));
      }
      case 'tern': return truthy(ev(e.c, env)) ? ev(e.a, env) : ev(e.b, env);
      case 'index': {
        const v = ev(e.e, env);
        const i = asNum(ev(e.i, env), NaN);
        return Array.isArray(v) && Number.isInteger(i) ? (v[i] ?? null) : typeof v === 'string' && Number.isInteger(i) ? (v[i] ?? null) : null;
      }
      case 'call': {
        const def = functions.get(e.name);
        if (def) return callFunction(def, e.args, env);
        const args = e.args.map((a) => ev(a.e, env));
        const r = builtinFn(e.name, args);
        if (r === undefined) {
          warn(`Funzione non supportata: ${e.name}()`);
          return null;
        }
        return r;
      }
    }
  };

  const depthOf = { n: 0 };
  function callFunction(def: FunctionDef, args: Arg[], env: Env): Value {
    if (++depthOf.n > LIMITS.depth * 4) {
      depthOf.n--;
      throw new ScadError('Funzione ricorsiva troppo profonda', 0);
    }
    try {
      return ev(def.body, bind(def.params, args, env, new Env(globalEnv)));
    } finally {
      depthOf.n--;
    }
  }

  /** Lega argomenti (posizionali e con nome) ai parametri, con i valori predefiniti. */
  function bind(params: Param[], args: Arg[], callerEnv: Env, scope: Env): Env {
    const values = new Map<string, Value>();
    let position = 0;
    for (const a of args) {
      const v = ev(a.e, callerEnv);
      if (a.name) values.set(a.name, v);
      else if (position < params.length) values.set(params[position++].name, v);
    }
    for (const p of params) scope.set(p.name, values.has(p.name) ? values.get(p.name)! : p.def ? ev(p.def, scope) : null);
    // Le variabili speciali ($fn, ...) passate come argomento valgono anche per i figli
    for (const [k, v] of values) if (k.startsWith('$')) scope.set(k, v);
    return scope;
  }

  function* iterate(v: Value): Generator<Value> {
    if (v instanceof Range) yield* v.values(LIMITS.loop);
    else if (Array.isArray(v)) yield* v.slice(0, LIMITS.loop);
    else if (v !== null) yield v;
  }

  // --- Argomenti dei moduli predefiniti --------------------------------------------------------------------------

  /** Argomenti di un modulo predefinito per nome, con l'ordine dei posizionali. */
  const named = (args: Arg[], order: string[], env: Env): Record<string, Value> => {
    const out: Record<string, Value> = {};
    let position = 0;
    for (const a of args) {
      const v = ev(a.e, env);
      if (a.name) out[a.name] = v;
      else if (position < order.length) out[order[position++]] = v;
    }
    return out;
  };

  const fnOf = (env: Env, given: Value | undefined): number => {
    const v = given !== undefined ? given : env.get('$fn');
    return v !== undefined && isNum(v) && v > 0 ? Math.round(v) : 0;
  };

  const colorOf = (v: Value): string | undefined => {
    if (typeof v === 'string') {
      if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
      if (/^#[0-9a-f]{3}$/i.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join('')}`.toLowerCase();
      return NAMED_COLORS[v.toLowerCase()];
    }
    if (Array.isArray(v) && v.length >= 3) return `#${hex2(asNum(v[0], 0))}${hex2(asNum(v[1], 0))}${hex2(asNum(v[2], 0))}`;
    return undefined;
  };

  // --- Istruzioni ------------------------------------------------------------------------------------------------

  const leaf = (shape: Shape, ctx: Ctx): Item[] => {
    if (++leaves > LIMITS.leaves) throw new ScadError(`Troppi oggetti: l'importazione si ferma a ${LIMITS.leaves}`, 0);
    return [{ kind: 'prim', shape, M: ctx.M, color: ctx.color }];
  };

  /** Figli di un'istruzione: ogni istruzione che produce più oggetti diventa un'unione (come in OpenSCAD). */
  const groupedChildren = (stmts: Stmt[], env: Env, ctx: Ctx): Item[] =>
    stmts.flatMap((s) => {
      const items = run(s, env, ctx);
      return items.length > 1 ? [{ kind: 'group', op: 'union', children: items } as GroupItem] : items;
    });

  /** Esegue una sequenza di istruzioni nello stesso ambiente (le assegnazioni valgono per le successive). */
  const runAll = (stmts: Stmt[], env: Env, ctx: Ctx): Item[] => stmts.flatMap((s) => run(s, env, ctx));

  const extrudeOf = (ctx: Ctx, what: string): Extrude | null => {
    if (!ctx.ext) {
      warn(`${what}() è una forma 2D: si importa solo dentro linear_extrude() (saltata).`);
      return null;
    }
    return ctx.ext;
  };

  function builtin(s: Extract<Stmt, { t: 'call' }>, env: Env, ctx: Ctx): Item[] | undefined {
    const a = (order: string[]) => named(s.args, order, env);
    const kids = s.children ?? [];
    switch (s.name) {
      case 'cube': {
        const p = a(['size', 'center']);
        const size = asVec3(p.size, [1, 1, 1]);
        return leaf({ s: 'cube', size, center: truthy(p.center ?? false) }, ctx);
      }
      case 'sphere': {
        const p = a(['r']);
        const r = p.d !== undefined ? asNum(p.d, 2) / 2 : asNum(p.r, 1);
        return leaf({ s: 'sphere', r, fn: fnOf(env, p.$fn) }, ctx);
      }
      case 'cylinder': {
        const p = a(['h', 'r1', 'r2', 'center']);
        const base = p.r !== undefined ? asNum(p.r, 1) : p.d !== undefined ? asNum(p.d, 2) / 2 : 1;
        const r1 = p.r1 !== undefined ? asNum(p.r1, base) : p.d1 !== undefined ? asNum(p.d1, 2) / 2 : base;
        const r2 = p.r2 !== undefined ? asNum(p.r2, base) : p.d2 !== undefined ? asNum(p.d2, 2) / 2 : base;
        return leaf({ s: 'cylinder', h: asNum(p.h, 1), r1, r2, center: truthy(p.center ?? false), fn: fnOf(env, p.$fn) }, ctx);
      }
      case 'circle': {
        const ext = extrudeOf(ctx, 'circle');
        if (!ext) return [];
        const p = a(['r']);
        const r = p.d !== undefined ? asNum(p.d, 2) / 2 : asNum(p.r, 1);
        return leaf({ s: 'circle', r, fn: fnOf(env, p.$fn), ext }, ctx);
      }
      case 'square': {
        const ext = extrudeOf(ctx, 'square');
        if (!ext) return [];
        const p = a(['size', 'center']);
        const size = Array.isArray(p.size) ? ([asNum(p.size[0], 1), asNum(p.size[1], 1)] as [number, number]) : ([asNum(p.size, 1), asNum(p.size, 1)] as [number, number]);
        return leaf({ s: 'square', size, center: truthy(p.center ?? false), ext }, ctx);
      }
      case 'polygon': {
        const ext = extrudeOf(ctx, 'polygon');
        if (!ext) return [];
        const p = a(['points', 'paths']);
        const points = (Array.isArray(p.points) ? p.points : []).map((pt) => [asNum(Array.isArray(pt) ? pt[0] : null, NaN), asNum(Array.isArray(pt) ? pt[1] : null, NaN)] as [number, number]);
        if (points.length < 3 || points.some((pt) => !Number.isFinite(pt[0]) || !Number.isFinite(pt[1]))) {
          warn('polygon(): punti non validi (saltato).');
          return [];
        }
        if (p.paths !== undefined && p.paths !== null) warn('polygon(): i fori (paths) non si leggono, si usa il contorno dei punti.');
        return leaf({ s: 'polygon', points, ext }, ctx);
      }
      case 'linear_extrude': {
        const p = a(['height', 'center', 'convexity', 'twist', 'slices', 'scale']);
        const scale = Array.isArray(p.scale) ? asNum(p.scale[0], 1) : asNum(p.scale, 1);
        const ext: Extrude = { h: asNum(p.height, 1), center: truthy(p.center ?? false), twist: asNum(p.twist, 0), scale };
        return runAll(kids, new Env(env), { ...ctx, ext });
      }
      case 'translate': {
        const p = a(['v']);
        const [x, y, z] = asVec3(p.v, [0, 0, 0], false);
        return runAll(kids, new Env(env), { ...ctx, M: mulMat(ctx.M, translateMat(x, y, z)) });
      }
      case 'rotate': {
        const p = a(['a', 'v']);
        const m = Array.isArray(p.a) ? rotateEulerMat(...asVec3(p.a, [0, 0, 0])) : p.v !== undefined ? rotateAxisMat(asNum(p.a, 0), asVec3(p.v, [0, 0, 1])) : rotateEulerMat(0, 0, asNum(p.a, 0));
        return runAll(kids, new Env(env), { ...ctx, M: mulMat(ctx.M, m) });
      }
      case 'scale': {
        const p = a(['v']);
        const [x, y, z] = asVec3(p.v, [1, 1, 1]);
        return runAll(kids, new Env(env), { ...ctx, M: mulMat(ctx.M, scaleMat(x, y, z)) });
      }
      case 'mirror': {
        const p = a(['v']);
        return runAll(kids, new Env(env), { ...ctx, M: mulMat(ctx.M, mirrorMat(asVec3(p.v, [1, 0, 0]))) });
      }
      case 'color': {
        const p = a(['c', 'alpha']);
        const color = colorOf(p.c ?? null);
        if (!color) warn('color(): colore non riconosciuto (ignorato).');
        return runAll(kids, new Env(env), { ...ctx, color: color ?? ctx.color });
      }
      case 'union': case 'render': case 'group': {
        const items = groupedChildren(kids, new Env(env), ctx);
        return s.name === 'union' && items.length > 1 ? [{ kind: 'group', op: 'union', children: items }] : items;
      }
      case 'difference': case 'intersection': case 'hull': {
        const items = groupedChildren(kids, new Env(env), ctx);
        if (!items.length) return [];
        // Una differenza di un solo oggetto è l'oggetto stesso
        if (items.length === 1 && s.name !== 'hull') return items;
        return [{ kind: 'group', op: s.name as GroupOp, children: items }];
      }
      case 'children': return ctx.children ? ctx.children(ctx) : [];
      case 'echo': case 'assert': return [];
      case 'rotate_extrude': case 'minkowski': case 'offset': case 'projection': case 'resize': case 'multmatrix': case 'polyhedron':
      case 'surface': case 'import': case 'text': case 'roof':
        warn(`${s.name}() non è supportato: saltato.`);
        return [];
      default: return undefined;
    }
  }

  function run(s: Stmt, env: Env, ctx: Ctx): Item[] {
    tick();
    switch (s.t) {
      case 'assign': env.set(s.name, ev(s.e, env)); return [];
      case 'module': case 'function': return [];
      case 'block': return runAll(s.body, new Env(env), ctx);
      case 'if': {
        const branch = truthy(ev(s.c, env)) ? s.a : s.b;
        return branch ? run(branch, env, ctx) : [];
      }
      case 'for': {
        const out: Item[] = [];
        let count = 0;
        const loop = (k: number, scope: Env) => {
          if (k === s.vars.length) {
            if (++count > LIMITS.loop) throw new ScadError(`Un ciclo for supera ${LIMITS.loop} iterazioni`, 0);
            out.push(...run(s.body, scope, ctx));
            return;
          }
          for (const v of iterate(ev(s.vars[k][1], scope))) {
            const inner = new Env(scope);
            inner.set(s.vars[k][0], v);
            loop(k + 1, inner);
          }
        };
        loop(0, env);
        return out;
      }
      case 'call': {
        // Con * il modulo è disattivato, con % è solo di sfondo: non producono nulla
        if (s.mod.includes('*') || s.mod.includes('%')) return [];
        const user = modules.get(s.name);
        if (user) {
          if (ctx.depth >= LIMITS.depth) throw new ScadError('Moduli annidati troppo in profondità', s.line);
          const scope = bind(user.params, s.args, env, new Env(globalEnv));
          const kids = s.children ?? [];
          // I figli si valutano nell'ambiente di chi chiama, ma nella trasformazione di dove `children()` è usato
          const inner: Ctx = { ...ctx, depth: ctx.depth + 1, children: (at) => runAll(kids, new Env(env), { ...at, children: ctx.children, depth: at.depth }) };
          return runAll(user.body, scope, inner);
        }
        const result = builtin(s, env, ctx);
        if (result !== undefined) return result;
        warn(`Modulo sconosciuto: ${s.name}() (saltato).`);
        return [];
      }
    }
  }

  // --- Programma -------------------------------------------------------------------------------------------------

  const globalEnv = new Env();
  const root: Ctx = { M: IDENTITY, depth: 0 };
  const items: Item[] = [];
  const platesByIndex = new Map<number, Item[]>();

  /** Numero del piatto se l'istruzione richiama `piatto_N()`, anche dentro un `translate([x, y, z])` (lo spostamento si toglie). */
  const plateCall = (s: Stmt): number | null => {
    if (s.t !== 'call') return null;
    const direct = /^piatto_(\d+)$/.exec(s.name);
    if (direct && modules.has(s.name) && !s.children) return Number(direct[1]);
    if (s.name === 'translate' && s.children?.length === 1) return plateCall(s.children[0]);
    return null;
  };

  for (const s of program) {
    const plate = plateCall(s);
    if (plate !== null) {
      const call = s.t === 'call' && s.name === 'translate' ? (s.children![0] as Extract<Stmt, { t: 'call' }>) : (s as Extract<Stmt, { t: 'call' }>);
      platesByIndex.set(plate, run(call, globalEnv, root));
    } else {
      items.push(...run(s, globalEnv, root));
    }
  }

  const plates = [...platesByIndex].sort((x, y) => x[0] - y[0]).map(([index, list]) => ({ index, name: plateNames.get(index) ?? `Piatto ${index}`, items: list }));
  return { items, plates, warnings: [...warnings] };
}

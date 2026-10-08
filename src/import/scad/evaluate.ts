import { parse, ScadError, tokenize } from './parse';
import type { Arg, Expr, Param, Stmt } from './parse';
import { NAMED_COLORS } from './colors';

/**
 * Valutatore di un sottoinsieme di OpenSCAD: esegue il programma (variabili, funzioni, moduli, `for`, `if`, `let`) e
 * produce un albero di oggetti con la loro trasformazione già composta. Ciò che non conosce (polyhedron,
 * import, ...) si salta con un avviso invece di bloccare l'importazione.
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

/** Funzione anonima (`function (x) x * 2`): ricorda l'ambiente in cui è nata. */
class Closure {
  constructor(
    public params: Param[],
    public body: Expr,
    public env: Env,
  ) {}
}

export type Value = number | boolean | string | null | Value[] | Range | Closure;

const isNum = (v: Value | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const truthy = (v: Value): boolean => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.length > 0 : !!v && v !== 0);

/** Numero da un valore (altrimenti `fallback`). */
export const asNum = (v: Value | undefined, fallback: number): number => (v !== undefined && isNum(v) ? v : typeof v === 'boolean' ? Number(v) : fallback);

/** Terna di numeri: un numero solo vale per tutti e tre gli assi (come `scale(2)`). */
export function asVec3(v: Value | undefined, fallback: [number, number, number], scalarFills = true): [number, number, number] {
  if (v !== undefined && isNum(v)) return scalarFills ? [v, v, v] : [v, fallback[1], fallback[2]];
  if (Array.isArray(v)) return [asNum(v[0], fallback[0]), asNum(v[1], fallback[1]), asNum(v[2], fallback[2])];
  return fallback;
}

/** Uguaglianza di due valori (liste confrontate elemento per elemento, come fa OpenSCAD). */
function deepEq(a: Value, b: Value): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEq(v, b[i]));
  if (a instanceof Range && b instanceof Range) return a.start === b.start && a.step === b.step && a.end === b.end;
  return a === b;
}

/** Numero come lo scrive `str()` di OpenSCAD: al massimo 6 cifre significative. */
const fmtNum = (v: number) => String(Number(v.toPrecision(6)));

function strOf(v: Value | undefined): string {
  if (v === null || v === undefined) return 'undef';
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'boolean' || typeof v === 'string') return String(v);
  if (Array.isArray(v)) return `[${v.map(strOf).join(', ')}]`;
  if (v instanceof Range) return `[${fmtNum(v.start)} : ${fmtNum(v.step)} : ${fmtNum(v.end)}]`;
  return 'function';
}

/** Generatore pseudocasuale con seme (mulberry32): la sequenza NON coincide con quella di OpenSCAD. */
function seeded(seed: number): () => number {
  let a = Math.floor(seed * 1000) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isVec = (v: Value): v is number[] => Array.isArray(v) && v.every(isNum);
const isMatrix = (v: Value): v is number[][] => Array.isArray(v) && v.length > 0 && v.every(isVec);
const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0);

/** Prodotto tra vettori e matrici: scalare, matrice per vettore, vettore per matrice, matrice per matrice. */
function mulValues(l: Value, r: Value): Value {
  if (isVec(l) && isVec(r)) return l.length === r.length ? dot(l, r) : null;
  if (isMatrix(l) && isVec(r)) return l.every((row) => row.length === r.length) ? l.map((row) => dot(row, r)) : null;
  if (isVec(l) && isMatrix(r)) return r.length === l.length ? r[0].map((_, j) => dot(l, r.map((row) => row[j]))) : null;
  if (isMatrix(l) && isMatrix(r)) return l.every((row) => row.length === r.length) ? l.map((row) => r[0].map((_, j) => dot(row, r.map((rr) => rr[j])))) : null;
  return null;
}

// --- Oggetti prodotti --------------------------------------------------------------------------------------------

/** Profilo 2D con i dati dell'estrusione (`linear_extrude`) che lo trasforma in un solido. */
export interface Extrude {
  h: number;
  center: boolean;
  twist: number;
  scale: number;
}

/** Estrusione usata dai profili di `rotate_extrude`: l'altezza non conta, il profilo gira attorno all'asse. */
const NO_EXTRUDE: Extrude = { h: 1, center: true, twist: 0, scale: 1 };

/** Profilo dentro `rotate_extrude`: gradi del giro, segmenti e trasformazione 2D del profilo rispetto al giro. */
export interface Revolve {
  angle: number;
  fn: number;
  /** $fa e $fs del file, quando non c'è $fn: i segmenti si calcolano dal raggio massimo del profilo (come fa OpenSCAD). */
  auto?: { fa: number; fs: number };
  profile: Mat;
}

/** `offset()` applicato al profilo: `r` arrotonda gli angoli, `delta` li lascia vivi. */
export interface Offset {
  v: number;
  join: 'round' | 'sharp';
}

interface Flat {
  ext: Extrude;
  rev?: Revolve;
  off?: Offset;
}

export type Shape =
  | { s: 'cube'; size: [number, number, number]; center: boolean }
  | { s: 'sphere'; r: number; fn: number }
  | { s: 'cylinder'; h: number; r1: number; r2: number; center: boolean; fn: number }
  | ({ s: 'circle'; r: number; fn: number } & Flat)
  | ({ s: 'square'; size: [number, number]; center: boolean } & Flat)
  /** `paths`: elenco di indici dei punti per ogni contorno (il primo è l'esterno, gli altri sono fori). */
  | ({ s: 'polygon'; points: [number, number][]; paths?: number[][] } & Flat)
  | ({ s: 'text'; text: string; font: string; size: number; halign: string; valign: string; spacing: number } & Flat);

/** Un problema trovato leggendo il codice: `error` = parte saltata o non capita, `note` = approssimazione o informazione. */
export interface ScadIssue {
  message: string;
  /** Riga del codice a cui si riferisce (null se non si sa o riguarda tutto il file). */
  line: number | null;
  level: 'error' | 'note';
}

export interface PrimItem {
  kind: 'prim';
  shape: Shape;
  /** Riga del codice che ha creato la forma (serve a indicare i problemi dell'importazione). */
  line?: number;
  /** Trasformazione composta dal mondo al sistema locale dell'oggetto. */
  M: Mat;
  color?: string;
}

export type GroupOp = 'union' | 'difference' | 'intersection' | 'hull' | 'minkowski';

export interface GroupItem {
  kind: 'group';
  op: GroupOp;
  children: Item[];
  /**
   * Solo per `minkowski`: trasformazione del gruppo. I figli stanno nel suo sistema locale, perché la somma di Minkowski
   * non commuta con le traslazioni dei singoli operandi (`translate(t) minkowski() { A; B; }` sposta il risultato una
   * volta sola, mentre due operandi già traslati lo sposterebbero due volte).
   */
  M?: Mat;
}

export type Item = PrimItem | GroupItem;

/** Risultato della lettura di un file .scad. */
export interface ScadResult {
  /** Oggetti fuori dai moduli dei piatti. */
  items: Item[];
  /** Piatti riconosciuti (moduli `piatto_N` richiamati affiancati), in ordine di numero. */
  plates: { index: number; name: string; items: Item[] }[];
  /** Messaggi dei problemi, senza ripetizioni (compatibile con chi non serve la riga). */
  warnings: string[];
  /** Problemi con la riga e il livello. */
  issues: ScadIssue[];
}

/** Applica una trasformazione a tutti gli oggetti (moltiplicandola a sinistra della loro). */
export function transformItems(items: Item[], A: Mat): Item[] {
  return items.map((it) => {
    if (it.kind === 'prim') return { ...it, M: mulMat(A, it.M) };
    // Un gruppo con la propria trasformazione (minkowski) si muove tutto intero: i figli restano nel suo sistema
    if (it.M) return { ...it, M: mulMat(A, it.M) };
    return { ...it, children: transformItems(it.children, A) };
  });
}

// --- Ingombro degli oggetti (per resize) ---------------------------------------------------------------------------

interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

const unionBox = (a: Box, b: Box): Box => ({
  min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
  max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
});

/** Ingombro di un parallelepipedo locale dopo la trasformazione (si guardano gli otto spigoli). */
function boxOfCorners(M: Mat, lo: [number, number, number], hi: [number, number, number]): Box {
  let out: Box | null = null;
  for (let i = 0; i < 8; i++) {
    const p = [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
    const w = [0, 1, 2].map((r) => M[r * 4] * p[0] + M[r * 4 + 1] * p[1] + M[r * 4 + 2] * p[2] + M[r * 4 + 3]) as [number, number, number];
    out = out ? unionBox(out, { min: w, max: w }) : { min: w, max: w };
  }
  return out!;
}

/** Ingombro in coordinate del mondo, oppure null se non si sa calcolare (testo, estrusione rotazionale). */
function boxOf(items: Item[]): Box | null {
  let total: Box | null = null;
  for (const it of items) {
    let b: Box | null;
    if (it.kind === 'group' && it.op === 'minkowski') {
      // Somma di Minkowski: l'ingombro è la somma degli ingombri dei figli (nel sistema del gruppo), poi trasformata
      const boxes = it.children.map((child) => boxOf([child]));
      b = boxes.every((x): x is Box => x !== null)
        ? boxOfCorners(
            it.M ?? IDENTITY,
            boxes.reduce((s, x) => [s[0] + x.min[0], s[1] + x.min[1], s[2] + x.min[2]], [0, 0, 0]) as [number, number, number],
            boxes.reduce((s, x) => [s[0] + x.max[0], s[1] + x.max[1], s[2] + x.max[2]], [0, 0, 0]) as [number, number, number],
          )
        : null;
    } else if (it.kind === 'group') {
      // Una differenza ha l'ingombro della sola base
      b = boxOf(it.op === 'difference' ? it.children.slice(0, 1) : it.children);
    } else {
      const sh = it.shape;
      if (sh.s === 'cube') {
        const lo: [number, number, number] = sh.center ? [-sh.size[0] / 2, -sh.size[1] / 2, -sh.size[2] / 2] : [0, 0, 0];
        b = boxOfCorners(it.M, lo, [lo[0] + sh.size[0], lo[1] + sh.size[1], lo[2] + sh.size[2]]);
      } else if (sh.s === 'sphere') {
        // Ellissoide: la semiampiezza lungo ogni asse del mondo è la lunghezza della riga della matrice per il raggio
        const half = [0, 1, 2].map((r) => Math.hypot(it.M[r * 4], it.M[r * 4 + 1], it.M[r * 4 + 2]) * sh.r);
        const c = [it.M[3], it.M[7], it.M[11]];
        b = { min: [c[0] - half[0], c[1] - half[1], c[2] - half[2]], max: [c[0] + half[0], c[1] + half[1], c[2] + half[2]] };
      } else if (sh.s === 'cylinder') {
        const r = Math.max(sh.r1, sh.r2);
        const z0 = sh.center ? -sh.h / 2 : 0;
        b = boxOfCorners(it.M, [-r, -r, z0], [r, r, z0 + sh.h]);
      } else if (sh.s === 'text' || sh.rev) {
        b = null;
      } else {
        // Forme 2D estruse: ingombro del profilo per l'altezza (torsione e scala della cima ingrandiscono la base)
        let lo: [number, number];
        let hi: [number, number];
        if (sh.s === 'circle') [lo, hi] = [[-sh.r, -sh.r], [sh.r, sh.r]];
        else if (sh.s === 'square') [lo, hi] = [sh.center ? [-sh.size[0] / 2, -sh.size[1] / 2] : [0, 0], sh.center ? [sh.size[0] / 2, sh.size[1] / 2] : sh.size];
        else [lo, hi] = [[Math.min(...sh.points.map((p) => p[0])), Math.min(...sh.points.map((p) => p[1]))], [Math.max(...sh.points.map((p) => p[0])), Math.max(...sh.points.map((p) => p[1]))]];
        const grow = Math.max(1, sh.ext.scale);
        const z0 = sh.ext.center ? -sh.ext.h / 2 : 0;
        b = boxOfCorners(it.M, [lo[0] * grow, lo[1] * grow, z0], [hi[0] * grow, hi[1] * grow, z0 + sh.ext.h]);
      }
    }
    if (!b) return null;
    total = total ? unionBox(total, b) : b;
  }
  return total;
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
  /** Dentro `rotate_extrude`: `M` è la trasformazione 2D del profilo e `outer` quella di fuori, applicata al solido. */
  rev?: { angle: number; fn: number; auto?: { fa: number; fs: number }; outer: Mat };
  /** Dentro `offset()`: contorno da applicare alle forme 2D. */
  off?: Offset;
  /** Figli del modulo in corso (`children()`), da valutare nel contesto di chi li richiama; `which` sceglie quali. */
  children?: (ctx: Ctx, which: number[] | null) => Item[];
  depth: number;
}

/** Limiti: un file enorme o ricorsivo non deve bloccare l'app. */
const LIMITS = { steps: 400_000, leaves: 3000, loop: 20_000, depth: 48 };

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');

/** Istruzioni che producono geometria (le altre definiscono solo variabili, moduli e funzioni): contano come figli. */
const isGeometry = (s: Stmt) => s.t !== 'assign' && s.t !== 'module' && s.t !== 'function';

export function evaluateScad(source: string): ScadResult {
  const { tokens, plateNames, uses } = tokenize(source);
  const program = parse(tokens);

  /** Problemi trovati, senza ripetizioni (stesso messaggio sulla stessa riga). */
  const issues = new Map<string, ScadIssue>();
  /** Riga dell'istruzione in esecuzione: i problemi si riferiscono ad essa. */
  let curLine: number | null = null;
  const warn = (message: string, level: ScadIssue['level'] = 'error') => {
    const key = `${level}|${curLine}|${message}`;
    if (!issues.has(key)) issues.set(key, { message, line: curLine, level });
  };
  /** Informazione o approssimazione: non è una parte saltata. */
  const note = (message: string) => warn(message, 'note');
  const modules = new Map<string, ModuleDef>();
  const functions = new Map<string, FunctionDef>();
  /** Oggetti marcati con `!` ("solo questo"): se ce ne sono, sono gli unici importati. */
  const rooted: Item[] = [];
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
      else if (s.t === 'let' || s.t === 'mod' || s.t === 'for') collect([s.body]);
      else if (s.t === 'if') collect(s.b ? [s.a, s.b] : [s.a]);
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
      // log(x) è in base 10; con due argomenti log(base, x)
      case 'log': return a.length >= 2 ? Math.log(n(1)) / Math.log(n(0)) : Math.log10(n(0));
      case 'floor': return Math.floor(n(0));
      case 'ceil': return Math.ceil(n(0));
      // Come OpenSCAD: la metà si arrotonda allontanandosi dallo zero (-2.5 diventa -3)
      case 'round': return Math.sign(n(0)) * Math.round(Math.abs(n(0)));
      case 'sign': return Math.sign(n(0));
      case 'min': case 'max': {
        const list = a.length === 1 && Array.isArray(a[0]) ? (a[0] as Value[]) : a;
        const nums = list.filter(isNum);
        return nums.length ? (name === 'min' ? Math.min(...nums) : Math.max(...nums)) : null;
      }
      case 'len': return Array.isArray(a[0]) ? a[0].length : typeof a[0] === 'string' ? a[0].length : null;
      case 'norm': return Array.isArray(a[0]) ? Math.hypot(...a[0].map((v) => asNum(v, 0))) : null;
      case 'cross': {
        const [u, v] = [a[0], a[1]];
        if (!isVec(u) || !isVec(v) || u.length !== v.length) return null;
        if (u.length === 2) return u[0] * v[1] - u[1] * v[0];
        if (u.length === 3) return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        return null;
      }
      case 'concat': return a.flatMap((v) => (Array.isArray(v) ? v : [v]));
      case 'str': return a.map(strOf).join('');
      case 'chr': return (Array.isArray(a[0]) ? a[0] : a).filter(isNum).map((c) => String.fromCodePoint(Math.max(0, Math.floor(c)))).join('');
      case 'ord': return typeof a[0] === 'string' && a[0].length ? (a[0].codePointAt(0) ?? null) : null;
      case 'lookup': {
        // Interpolazione lineare in una tabella [[chiave, valore], ...] ordinata per chiave
        const table = Array.isArray(a[1]) ? a[1].filter((row): row is Value[] => Array.isArray(row) && isNum(row[0]) && isNum(row[1])) : [];
        if (!table.length || !isNum(a[0])) return null;
        const key = a[0];
        const keys = table.map((row) => row[0] as number);
        const vals = table.map((row) => row[1] as number);
        if (key <= keys[0]) return vals[0];
        if (key >= keys[keys.length - 1]) return vals[vals.length - 1];
        const i = keys.findIndex((k) => k >= key);
        return keys[i] === keys[i - 1] ? vals[i] : vals[i - 1] + ((vals[i] - vals[i - 1]) * (key - keys[i - 1])) / (keys[i] - keys[i - 1]);
      }
      case 'search': {
        // search(cosa, dove, quanti_per_cosa = 1, colonna = 0): indici delle posizioni in cui compare ciò che si cerca
        const hay = typeof a[1] === 'string' ? [...a[1]] : Array.isArray(a[1]) ? a[1] : [];
        const per = a[2] === undefined ? 1 : Math.max(0, Math.floor(n(2)));
        const col = a[3] === undefined ? 0 : Math.floor(n(3));
        const find = (needle: Value): Value => {
          const hits: number[] = [];
          hay.forEach((item, i) => {
            const key = Array.isArray(item) && typeof a[1] !== 'string' && !Array.isArray(needle) ? item[col] : item;
            if (deepEq(key as Value, needle) && (per === 0 || hits.length < per)) hits.push(i);
          });
          return per === 1 ? (hits.length ? hits[0] : []) : hits;
        };
        if (typeof a[0] === 'string') return a[0].length === 1 ? [find(a[0])].flat() : [...a[0]].map(find);
        if (Array.isArray(a[0])) return a[0].map(find);
        const one = find(a[0] ?? null);
        return Array.isArray(one) ? one : [one];
      }
      case 'rands': {
        // rands(minimo, massimo, quanti, seme): la sequenza è ripetibile ma NON uguale a quella di OpenSCAD
        note('rands() produce numeri casuali ripetibili ma diversi da quelli di OpenSCAD.');
        const next = seeded(a[3] === undefined ? 1 : n(3));
        const [lo, hi] = [n(0), n(1)];
        return Array.from({ length: Math.min(LIMITS.loop, Math.max(0, Math.floor(n(2)) || 0)) }, () => lo + next() * (hi - lo));
      }
      case 'is_undef': return a[0] === null || a[0] === undefined;
      case 'is_num': return isNum(a[0]);
      case 'is_list': return Array.isArray(a[0]);
      case 'is_string': return typeof a[0] === 'string';
      case 'is_bool': return typeof a[0] === 'boolean';
      case 'is_function': return a[0] instanceof Closure;
      case 'version': return [2021, 1, 0];
      case 'version_num': return 20210100;
      default: return undefined as unknown as Value;
    }
  };

  const evalBin = (op: string, l: Value, r: Value): Value => {
    if (op === '==') return deepEq(l, r);
    if (op === '!=') return !deepEq(l, r);
    // Stringhe: confronto alfabetico
    if (typeof l === 'string' && typeof r === 'string') {
      if (op === '<') return l < r;
      if (op === '>') return l > r;
      if (op === '<=') return l <= r;
      if (op === '>=') return l >= r;
    }
    // Vettori: somma e differenza per componente, prodotto con uno scalare o con un altro vettore o matrice
    if (Array.isArray(l) && Array.isArray(r) && (op === '+' || op === '-')) return l.map((v, i) => evalBin(op, v, r[i] ?? 0));
    if (op === '*' && Array.isArray(l) && Array.isArray(r)) return mulValues(l, r);
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
      case '^': return Math.pow(a, b);
      case '<': return a < b;
      case '>': return a > b;
      case '<=': return a <= b;
      case '>=': return a >= b;
      default: return null;
    }
  };

  /** Assegnazioni in sequenza (`let`): ognuna vede le precedenti. */
  const bindLet = (assigns: [string, Expr][], env: Env): Env => {
    const scope = new Env(env);
    for (const [name, e] of assigns) scope.set(name, ev(e, scope));
    return scope;
  };

  /** Valuta un elemento di lista: un'espressione dà un valore, un generatore (for, if, each, let) ne dà molti. */
  const elem = (e: Expr, env: Env, out: Value[]): void => {
    tick();
    if (out.length > LIMITS.loop) return;
    switch (e.t) {
      case 'gfor': {
        const loop = (k: number, scope: Env) => {
          if (k === e.vars.length) return elem(e.body, scope, out);
          for (const v of iterate(ev(e.vars[k][1], scope))) {
            const inner = new Env(scope);
            inner.set(e.vars[k][0], v);
            loop(k + 1, inner);
            if (out.length > LIMITS.loop) return;
          }
        };
        return loop(0, env);
      }
      case 'gforc': {
        // for (i = 0; i < 5; i = i + 1): le variabili si aggiornano tutte insieme
        const scope = bindLet(e.init, env);
        for (let count = 0; truthy(ev(e.cond, scope)); count++) {
          if (count > LIMITS.loop) throw new ScadError(`Un ciclo for supera ${LIMITS.loop} iterazioni`, 0);
          elem(e.body, scope, out);
          const next = e.step.map(([name, x]) => [name, ev(x, scope)] as const);
          for (const [name, v] of next) scope.set(name, v);
        }
        return;
      }
      case 'gif': {
        const branch = truthy(ev(e.c, env)) ? e.a : e.b;
        if (branch) elem(branch, env, out);
        return;
      }
      case 'geach': {
        const inner: Value[] = [];
        elem(e.e, env, inner);
        for (const v of inner) out.push(...iterate(v));
        return;
      }
      case 'glet': return elem(e.body, bindLet(e.assigns, env), out);
      default: out.push(ev(e, env));
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
        if (e.name === '$preview') return false;
        const v = env.get(e.name);
        if (v === undefined) {
          if (!e.name.startsWith('$')) warn(`Variabile non definita: ${e.name}`);
          return null;
        }
        return v;
      }
      case 'vec': {
        const out: Value[] = [];
        for (const item of e.items) elem(item, env, out);
        return out;
      }
      case 'range': {
        const a = asNum(ev(e.a, env), NaN);
        const b = asNum(ev(e.b, env), NaN);
        const c = e.c ? asNum(ev(e.c, env), NaN) : undefined;
        // [inizio:passo:fine] oppure [inizio:fine] con passo 1. Il parser mette il passo in `c` e la fine in `b`
        return c === undefined ? new Range(a, 1, b) : new Range(a, c, b);
      }
      case 'gfor': case 'gforc': case 'gif': case 'geach': case 'glet': {
        const out: Value[] = [];
        elem(e, env, out);
        return out;
      }
      case 'let': return ev(e.body, bindLet(e.assigns, env));
      case 'lambda': return new Closure(e.params, e.body, env);
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
        if (def) return callFunction(def.params, def.body, e.args, env, new Env(globalEnv));
        // Una variabile che contiene una funzione anonima si richiama come una funzione
        const held = env.get(e.name);
        if (held instanceof Closure) return callFunction(held.params, held.body, e.args, env, new Env(held.env));
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
  function callFunction(params: Param[], body: Expr, args: Arg[], env: Env, scope: Env): Value {
    if (++depthOf.n > LIMITS.depth * 4) {
      depthOf.n--;
      throw new ScadError('Funzione ricorsiva troppo profonda', 0);
    }
    try {
      return ev(body, bind(params, args, env, scope));
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

  /**
   * Segmenti di un cerchio: `$fn` (dell'oggetto o globale), altrimenti — solo se il file imposta `$fa` o `$fs` — la formula
   * di OpenSCAD `ceil(max(min(360 / $fa, r * 2π / $fs), 5))`. 0 vuol dire "usa il predefinito di Construct".
   */
  const fnOf = (env: Env, given: Value | undefined, r: number): number => {
    const v = given !== undefined ? given : env.get('$fn');
    if (v !== undefined && isNum(v) && v > 0) return Math.round(v);
    const fa = env.get('$fa');
    const fs = env.get('$fs');
    if ((fa === undefined && fs === undefined) || !Number.isFinite(r)) return 0;
    const minAngle = Math.max(0.01, isNum(fa) ? fa : 12);
    const minSize = Math.max(0.01, isNum(fs) ? fs : 2);
    return Math.ceil(Math.max(Math.min(360 / minAngle, (Math.abs(r) * 2 * Math.PI) / minSize), 5));
  };

  const colorOf = (v: Value): string | undefined => {
    if (typeof v === 'string') {
      // #rgb, #rgba, #rrggbb e #rrggbbaa: l'alfa si scarta
      if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) return v.slice(0, 7).toLowerCase();
      if (/^#[0-9a-f]{3,4}$/i.test(v)) return `#${[...v.slice(1, 4)].map((c) => c + c).join('')}`.toLowerCase();
      return NAMED_COLORS[v.toLowerCase()];
    }
    if (Array.isArray(v) && v.length >= 3) return `#${hex2(asNum(v[0], 0))}${hex2(asNum(v[1], 0))}${hex2(asNum(v[2], 0))}`;
    return undefined;
  };

  /** Matrice 4×4 da un vettore di righe (anche 3×4 o 3×3: le righe mancanti sono quelle dell'identità). */
  const toMat = (v: Value | undefined): Mat | null => {
    if (!Array.isArray(v) || v.length < 3) return null;
    const rows = v.slice(0, 4).map((row) => (Array.isArray(row) ? row : null));
    if (rows.slice(0, 3).some((row) => !row || row.length < 3)) return null;
    const m: Mat = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) m.push(asNum(rows[i]![j], 0));
    return [...m, ...(rows[3] && rows[3].length >= 4 ? rows[3].map((x) => asNum(x, 0)) : [0, 0, 0, 1])];
  };

  // --- Istruzioni ------------------------------------------------------------------------------------------------

  const push = (shape: Shape, M: Mat, ctx: Ctx): Item[] => {
    if (++leaves > LIMITS.leaves) throw new ScadError(`Troppi oggetti: l'importazione si ferma a ${LIMITS.leaves}`, 0);
    return [{ kind: 'prim', shape, M, color: ctx.color, line: curLine ?? undefined }];
  };

  /** Forma 3D. Dentro `rotate_extrude` non ha senso (OpenSCAD lo rifiuta): si salta. */
  const leaf = (shape: Shape, ctx: Ctx): Item[] => {
    if (ctx.rev) {
      warn('Una forma 3D dentro rotate_extrude() non si importa (saltata).');
      return [];
    }
    return push(shape, ctx.M, ctx);
  };

  /** Forma 2D: serve `linear_extrude` o `rotate_extrude` che la trasformi in un solido. */
  const leaf2d = (shape: { s: 'circle' | 'square' | 'polygon' | 'text' } & Record<string, unknown>, ctx: Ctx, what: string): Item[] => {
    if (!ctx.ext && !ctx.rev) {
      warn(`${what}() è una forma 2D: si importa solo dentro linear_extrude() o rotate_extrude() (saltata).`);
      return [];
    }
    const flat: Flat = {
      ext: ctx.ext ?? NO_EXTRUDE,
      rev: ctx.rev ? { angle: ctx.rev.angle, fn: ctx.rev.fn, auto: ctx.rev.auto, profile: ctx.M } : undefined,
      off: ctx.off && ctx.off.v !== 0 ? ctx.off : undefined,
    };
    // Per un profilo di rotate_extrude la trasformazione del solido è quella di fuori
    return push({ ...shape, ...flat } as unknown as Shape, ctx.rev ? ctx.rev.outer : ctx.M, ctx);
  };

  /** Figli di un'istruzione: ogni istruzione che produce più oggetti diventa un'unione (come in OpenSCAD). */
  const groupedChildren = (stmts: Stmt[], env: Env, ctx: Ctx): Item[] => {
    prepass(stmts, env);
    return stmts.flatMap((s) => {
      const items = run(s, env, ctx);
      return items.length > 1 ? [{ kind: 'group', op: 'union', children: items } as GroupItem] : items;
    });
  };

  /**
   * Assegnazioni di un elenco di istruzioni: in OpenSCAD valgono per tutto l'ambito e vince l'ultima (`x = 1; cube(x);
   * x = 2;` fa un cubo di lato 2). Si valutano quindi tutte, in ordine, prima di eseguire le altre istruzioni.
   */
  function prepass(stmts: Stmt[], env: Env) {
    const seen = new Set<string>();
    for (const s of stmts) {
      if (s.t !== 'assign') continue;
      curLine = s.line;
      if (seen.has(s.name) && !s.name.startsWith('$')) note(`La variabile ${s.name} è assegnata più volte: vale l'ultima assegnazione.`);
      seen.add(s.name);
      env.set(s.name, ev(s.e, env));
    }
  }

  /** Esegue una sequenza di istruzioni nello stesso ambiente (le assegnazioni valgono per tutte). */
  const runAll = (stmts: Stmt[], env: Env, ctx: Ctx): Item[] => {
    prepass(stmts, env);
    return stmts.flatMap((s) => run(s, env, ctx));
  };

  /** Come `runAll`, ma esegue solo i figli scelti (per `children(i)`); le assegnazioni valgono comunque. */
  const runSelected = (stmts: Stmt[], which: number[] | null, env: Env, ctx: Ctx): Item[] => {
    if (!which) return runAll(stmts, env, ctx);
    prepass(stmts, env);
    const geometry = stmts.filter(isGeometry);
    return which.flatMap((i) => (geometry[i] ? run(geometry[i], env, ctx) : []));
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
        return leaf({ s: 'sphere', r, fn: fnOf(env, p.$fn, r) }, ctx);
      }
      case 'cylinder': {
        const p = a(['h', 'r1', 'r2', 'center']);
        const base = p.r !== undefined ? asNum(p.r, 1) : p.d !== undefined ? asNum(p.d, 2) / 2 : 1;
        const r1 = p.r1 !== undefined ? asNum(p.r1, base) : p.d1 !== undefined ? asNum(p.d1, 2) / 2 : base;
        const r2 = p.r2 !== undefined ? asNum(p.r2, base) : p.d2 !== undefined ? asNum(p.d2, 2) / 2 : base;
        return leaf({ s: 'cylinder', h: asNum(p.h, 1), r1, r2, center: truthy(p.center ?? false), fn: fnOf(env, p.$fn, Math.max(r1, r2)) }, ctx);
      }
      case 'circle': {
        const p = a(['r']);
        const r = p.d !== undefined ? asNum(p.d, 2) / 2 : asNum(p.r, 1);
        return leaf2d({ s: 'circle', r, fn: fnOf(env, p.$fn, r) }, ctx, 'circle');
      }
      case 'square': {
        const p = a(['size', 'center']);
        const size = Array.isArray(p.size) ? ([asNum(p.size[0], 1), asNum(p.size[1], 1)] as [number, number]) : ([asNum(p.size, 1), asNum(p.size, 1)] as [number, number]);
        return leaf2d({ s: 'square', size, center: truthy(p.center ?? false) }, ctx, 'square');
      }
      case 'polygon': {
        const p = a(['points', 'paths']);
        const points = (Array.isArray(p.points) ? p.points : []).map((pt) => [asNum(Array.isArray(pt) ? pt[0] : null, NaN), asNum(Array.isArray(pt) ? pt[1] : null, NaN)] as [number, number]);
        if (points.length < 3 || points.some((pt) => !Number.isFinite(pt[0]) || !Number.isFinite(pt[1]))) {
          warn('polygon(): punti non validi (saltato).');
          return [];
        }
        // Contorni (paths): il primo è l'esterno, gli altri sono fori. Senza paths si usano tutti i punti in ordine
        let paths: number[][] | undefined;
        if (Array.isArray(p.paths)) {
          const valid = p.paths
            .map((path) => (Array.isArray(path) ? path.map((i) => asNum(i, NaN)) : []))
            .filter((path) => path.length >= 3 && path.every((i) => Number.isInteger(i) && i >= 0 && i < points.length));
          if (valid.length < p.paths.length) warn('polygon(): alcuni percorsi (paths) non sono validi e si saltano.');
          paths = valid.length ? valid : undefined;
        }
        return leaf2d({ s: 'polygon', points, paths }, ctx, 'polygon');
      }
      case 'text': {
        const p = a(['text', 'size', 'font', 'halign', 'valign', 'spacing']);
        if (ctx.rev) {
          warn('text() dentro rotate_extrude() non si importa (saltato).');
          return [];
        }
        const text = typeof p.text === 'string' ? p.text : p.text === undefined || p.text === null ? '' : strOf(p.text);
        // La spaziatura è un moltiplicatore dell'avanzamento: Construct accetta da 0,1 a 10
        const spacing = asNum(p.spacing, 1);
        const clamped = Math.min(10, Math.max(0.1, spacing));
        if (clamped !== spacing) note(`text(): la spaziatura (spacing = ${spacing}) è fuori dai limiti e diventa ${clamped}.`);
        return leaf2d(
          { s: 'text', text, font: typeof p.font === 'string' ? p.font : '', size: asNum(p.size, 10), halign: typeof p.halign === 'string' ? p.halign : 'left', valign: typeof p.valign === 'string' ? p.valign : 'baseline', spacing: clamped },
          ctx,
          'text',
        );
      }
      case 'linear_extrude': {
        const p = a(['height', 'center', 'convexity', 'twist', 'slices', 'scale']);
        const scale = Array.isArray(p.scale) ? asNum(p.scale[0], 1) : asNum(p.scale, 1);
        const ext: Extrude = { h: asNum(p.height, 1), center: truthy(p.center ?? false), twist: asNum(p.twist, 0), scale };
        return runAll(kids, new Env(env), { ...ctx, ext });
      }
      case 'rotate_extrude': {
        const p = a(['angle', 'convexity']);
        let angle = p.angle === undefined ? 360 : asNum(p.angle, 360);
        if (!(angle > 0 && angle <= 360)) {
          note('rotate_extrude(): l\'angolo non è tra 0 e 360 gradi: si usa il giro intero.');
          angle = 360;
        }
        // Dentro, `M` è la trasformazione 2D del profilo: parte dall'identità, quella di fuori si applica al solido
        const fn = fnOf(env, p.$fn, NaN);
        // Senza $fn, se il file imposta $fa o $fs i segmenti dipendono dal raggio del profilo, noto solo alla conversione
        const fa = env.get('$fa');
        const fs = env.get('$fs');
        const auto = !fn && (fa !== undefined || fs !== undefined) ? { fa: Math.max(0.01, isNum(fa) ? fa : 12), fs: Math.max(0.01, isNum(fs) ? fs : 2) } : undefined;
        return runAll(kids, new Env(env), { ...ctx, M: IDENTITY, ext: undefined, rev: { angle, fn, auto, outer: ctx.M } });
      }
      case 'offset': {
        const p = a(['r', 'delta', 'chamfer']);
        if (!ctx.ext && !ctx.rev) {
          warn('offset() è un\'operazione 2D: si importa solo dentro linear_extrude() o rotate_extrude() (saltata).');
          return [];
        }
        if (truthy(p.chamfer ?? false)) note('offset(): lo smusso (chamfer) non esiste in Construct, gli angoli restano vivi.');
        const sharp = p.delta !== undefined && p.r === undefined;
        const v = asNum(sharp ? p.delta : p.r, 0);
        if (ctx.off) note('offset() annidati: i contorni si sommano.');
        return runAll(kids, new Env(env), { ...ctx, off: { v: v + (ctx.off?.v ?? 0), join: ctx.off?.join ?? (sharp ? 'sharp' : 'round') } });
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
      case 'multmatrix': {
        const p = a(['m']);
        const m = toMat(p.m);
        if (!m) {
          warn('multmatrix(): matrice non valida (saltato).');
          return [];
        }
        return runAll(kids, new Env(env), { ...ctx, M: mulMat(ctx.M, m) });
      }
      case 'resize': {
        const p = a(['newsize', 'auto']);
        const target = asVec3(p.newsize, [0, 0, 0], false);
        // Gli oggetti si calcolano prima senza trasformazione, per misurarne l'ingombro; poi si scalano rispetto all'origine
        const items = runAll(kids, new Env(env), { ...ctx, M: IDENTITY });
        const box = boxOf(items);
        if (!box) {
          warn('resize(): l\'ingombro non si può calcolare per questi oggetti: sono importati senza ridimensionarli.');
          return transformItems(items, ctx.M);
        }
        const size = [0, 1, 2].map((i) => box.max[i] - box.min[i]);
        const scale = [1, 1, 1];
        let first: number | null = null;
        for (let i = 0; i < 3; i++) {
          if (target[i] > 0 && size[i] > 1e-9) {
            scale[i] = target[i] / size[i];
            first ??= scale[i];
          }
        }
        // auto: gli assi con misura 0 seguono il primo asse ridimensionato (mantiene le proporzioni)
        const auto = Array.isArray(p.auto) ? [0, 1, 2].map((i) => truthy((p.auto as Value[])[i] ?? false)) : [truthy(p.auto ?? false), truthy(p.auto ?? false), truthy(p.auto ?? false)];
        for (let i = 0; i < 3; i++) if (auto[i] && target[i] === 0 && first !== null) scale[i] = first;
        return transformItems(items, mulMat(ctx.M, scaleMat(scale[0], scale[1], scale[2])));
      }
      case 'color': {
        const p = a(['c', 'alpha']);
        const color = colorOf(p.c ?? null);
        if (!color) note('color(): colore non riconosciuto (ignorato).');
        return runAll(kids, new Env(env), { ...ctx, color: color ?? ctx.color });
      }
      case 'union': case 'render': case 'group': {
        const items = groupedChildren(kids, new Env(env), ctx);
        return s.name === 'union' && items.length > 1 ? [{ kind: 'group', op: 'union', children: items }] : items;
      }
      case 'minkowski': {
        // I figli si calcolano nel sistema del gruppo: la trasformazione di fuori si applica al risultato, una volta sola
        const items = groupedChildren(kids, new Env(env), { ...ctx, M: IDENTITY });
        if (!items.length) return [];
        // Un solo figlio: la somma è il figlio stesso
        if (items.length === 1) return transformItems(items, ctx.M);
        return [{ kind: 'group', op: 'minkowski', children: items, M: ctx.M }];
      }
      case 'difference': case 'intersection': case 'hull': {
        const items = groupedChildren(kids, new Env(env), ctx);
        if (!items.length) return [];
        // Una differenza di un solo oggetto è l'oggetto stesso
        if (items.length === 1 && s.name !== 'hull') return items;
        return [{ kind: 'group', op: s.name as GroupOp, children: items }];
      }
      case 'children': {
        if (!ctx.children) return [];
        // children(), children(2), children([0, 2]) o children([0 : 1])
        const p = a(['index']);
        const which = p.index instanceof Range ? p.index.values(LIMITS.loop) : Array.isArray(p.index) ? p.index.filter(isNum) : isNum(p.index) ? [p.index] : null;
        return ctx.children(ctx, which);
      }
      case 'intersection_for': {
        // intersection_for(i = [...], j = [...]): intersezione dei risultati di ogni combinazione
        const lists = s.args.filter((arg) => arg.name).map((arg) => [arg.name!, [...iterate(ev(arg.e, env))]] as const);
        const scopes: Env[] = [];
        const loop = (k: number, scope: Env) => {
          if (k === lists.length) {
            if (scopes.length >= LIMITS.loop) throw new ScadError(`Un ciclo intersection_for supera ${LIMITS.loop} iterazioni`, s.line);
            scopes.push(scope);
            return;
          }
          for (const v of lists[k][1]) {
            const inner = new Env(scope);
            inner.set(lists[k][0], v);
            loop(k + 1, inner);
          }
        };
        loop(0, new Env(env));
        const parts = scopes.flatMap((scope) => {
          const its = groupedChildren(kids, new Env(scope), ctx);
          return its.length > 1 ? [{ kind: 'group', op: 'union', children: its } as GroupItem] : its;
        });
        return parts.length > 1 ? [{ kind: 'group', op: 'intersection', children: parts }] : parts;
      }
      case 'echo': case 'assert': return [];
      case 'fill': case 'projection': case 'polyhedron': case 'surface': case 'import': case 'roof':
        warn(`${s.name}() non è supportato: saltato.`);
        return [];
      default: return undefined;
    }
  }

  function run(s: Stmt, env: Env, ctx: Ctx): Item[] {
    tick();
    if (s.t === 'call' || s.t === 'assign') curLine = s.line;
    switch (s.t) {
      // Le assegnazioni sono già state valutate da `prepass`
      case 'assign': case 'module': case 'function': return [];
      case 'block': return runAll(s.body, new Env(env), ctx);
      case 'let': return run(s.body, bindLet(s.assigns, env), ctx);
      case 'mod': {
        // * disattiva e % è solo di sfondo: non producono nulla; # evidenzia (si importa normalmente); ! è "solo questo"
        if (s.mod.includes('*') || s.mod.includes('%')) return [];
        const items = run(s.body, env, ctx);
        if (s.mod.includes('!')) rooted.push(...items);
        return items;
      }
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
        const items = callModule(s, env, ctx);
        if (s.mod.includes('!')) rooted.push(...items);
        return items;
      }
    }
  }

  function callModule(s: Extract<Stmt, { t: 'call' }>, env: Env, ctx: Ctx): Item[] {
    const user = modules.get(s.name);
    if (user) {
      if (ctx.depth >= LIMITS.depth) throw new ScadError('Moduli annidati troppo in profondità', s.line);
      const scope = bind(user.params, s.args, env, new Env(globalEnv));
      const kids = s.children ?? [];
      scope.set('$children', kids.filter(isGeometry).length);
      // I figli si valutano nell'ambiente di chi chiama, ma nella trasformazione di dove `children()` è usato
      const inner: Ctx = { ...ctx, depth: ctx.depth + 1, children: (at, which) => runSelected(kids, which, new Env(env), { ...at, children: ctx.children, depth: at.depth }) };
      return runAll(user.body, scope, inner);
    }
    const result = builtin(s, env, ctx);
    if (result !== undefined) return result;
    warn(`Modulo sconosciuto: ${s.name}() (saltato).`);
    return [];
  }

  // --- Programma -------------------------------------------------------------------------------------------------

  const globalEnv = new Env();
  const root: Ctx = { M: IDENTITY, depth: 0 };
  let items: Item[] = [];
  const platesByIndex = new Map<number, Item[]>();

  /** Numero del piatto se l'istruzione richiama `piatto_N()`, anche dentro un `translate([x, y, z])` (lo spostamento si toglie). */
  const plateCall = (s: Stmt): number | null => {
    if (s.t !== 'call') return null;
    const direct = /^piatto_(\d+)$/.exec(s.name);
    if (direct && modules.has(s.name) && !s.children) return Number(direct[1]);
    if (s.name === 'translate' && s.children?.length === 1) return plateCall(s.children[0]);
    return null;
  };

  prepass(program, globalEnv);
  for (const s of program) {
    const plate = plateCall(s);
    if (plate !== null) {
      const call = s.t === 'call' && s.name === 'translate' ? (s.children![0] as Extract<Stmt, { t: 'call' }>) : (s as Extract<Stmt, { t: 'call' }>);
      platesByIndex.set(plate, run(call, globalEnv, root));
    } else {
      items.push(...run(s, globalEnv, root));
    }
  }

  let plates = [...platesByIndex].sort((x, y) => x[0] - y[0]).map(([index, list]) => ({ index, name: plateNames.get(index) ?? `Piatto ${index}`, items: list }));
  // Con il modificatore ! ("solo questo") OpenSCAD mostra soltanto gli oggetti marcati
  if (rooted.length) {
    note('Nel file c\'è il modificatore ! (solo questo): si importano soltanto gli oggetti marcati.');
    items = rooted;
    plates = [];
  }
  const all = [...issues.values()];
  return { items, plates, warnings: [...new Set(all.map((i) => i.message))], issues: all };
}

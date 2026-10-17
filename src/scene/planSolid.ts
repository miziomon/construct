import { cleanPlan, featureAngles, isDefaultPlan, isPlainCircle, planOutline, planPaths, planTolerance } from './planShape';
import type { PlanDraft } from './planShape';
import { preparePlan, revolveMesh } from './planRevolve';
import type { RevolveMesh } from './planRevolve';
import { isRotational, pathContours, revolveParams } from './shapes2d';
import type { Shape2DNode, Vec2 } from './types';

/**
 * Solido di un Profilo rotazionale con una sagoma (sperimentale): la stessa mesh per il kernel e per il codice OpenSCAD,
 * così i due coincidono. Il profilo sono i contorni di `pathContours` spostati di `radius` dall'asse (come in
 * `rotate_extrude`), ritagliati a x ≥ 0; gli anelli seguono la sagoma. Con un angolo minore di 360° il solido si taglia con
 * un settore: i piani di taglio passano per l'asse agli angoli 0 e `angle`, come per un giro circolare.
 * Il contorno 2D (`offset`) non si applica alla sagoma.
 */

type PathShape = Extract<Shape2DNode, { kind: 'path' }>;

/** Settore da tagliare: poligono nel piano XY ed estensione in Z. */
export interface PlanWedge {
  polygon: Vec2[];
  z0: number;
  z1: number;
}

export interface PlanSolid {
  mesh: RevolveMesh;
  wedge: PlanWedge | null;
  /** Raggio massimo della sagoma (mm) e fattore con cui il profilo si è scalato in X. */
  rt: number;
  k: number;
}

/** Vero se il nodo si costruisce lungo una sagoma (Profilo rotazionale con una sagoma diversa dal cerchio). */
export function hasPlan(p: Shape2DNode): p is PathShape & { plan: PlanDraft } {
  return p.kind === 'path' && isRotational(p) && !!p.plan && !isDefaultPlan(p.plan);
}

/** Ritaglia un contorno al semipiano x ≥ 0 (Sutherland-Hodgman): la parte oltre l'asse non si ruota. */
export function clipAxis(poly: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ina = a[0] >= 0;
    const inb = b[0] >= 0;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = a[0] / (a[0] - b[0]);
      out.push([0, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

const area = (p: Vec2[]) => p.reduce((s, q, i) => s + (q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1]) / 2, 0);
const inside = (pt: Vec2, poly: Vec2[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

/** Orienta i contorni secondo l'annidamento (pari-dispari): esterni antiorari, fori orari. */
export function orientEvenOdd(polys: Vec2[][]): Vec2[][] {
  return polys.map((p, i) => {
    const depth = polys.reduce((d, q, j) => d + (j !== i && inside(p[0], q) ? 1 : 0), 0);
    const ccw = area(p) > 0;
    return ccw === (depth % 2 === 0) ? p : p.slice().reverse();
  });
}

/**
 * Raggi della mesh: i segmenti del giro intero, come `$fn` per il cerchio (lo slider Segmenti vale anche per la sagoma).
 * I raggi dei nodi della sagoma ci sono sempre (sostituiscono quelli uniformi più vicini), così gli spigoli restano vivi.
 */
export const planRays = (segments: number) => Math.min(720, Math.max(3, Math.round(segments)));

/**
 * Errore di corda ammesso (mm) con `segments` segmenti e raggio `r`: quello di un cerchio dello stesso raggio. Dove la
 * sagoma curva di più si aggiungono raggi fino a questo errore, così gli angoli arrotondati sono lisci quanto un cerchio
 * con gli stessi segmenti (e la vista non vi disegna spigoli di selezione).
 */
export const planChordTolerance = (segments: number, r: number) => r * (1 - Math.cos(Math.PI / Math.max(3, segments)));

/** Settore da 0 a `angle` gradi, di raggio `r`, con un punto ogni grado al più. */
export function sectorPolygon(angle: number, r: number): Vec2[] {
  const steps = Math.max(2, Math.ceil(angle));
  const pts: Vec2[] = [[0, 0]];
  for (let i = 0; i <= steps; i++) {
    const a = ((angle * i) / steps) * (Math.PI / 180);
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

/** Mesh del solido lungo la sagoma, o null se il nodo non ne ha una valida (sagoma non stellata, profilo vuoto). */
export function planSolid(p: Shape2DNode): PlanSolid | null {
  if (!hasPlan(p)) return null;
  // I dati del file non sono fidati: parametri nei limiti, contorni validi
  const plan = cleanPlan(p.plan);
  const { angle, radius, segments } = revolveParams(p);
  const polys = orientEvenOdd(
    pathContours(p)
      .map((c) => clipAxis(c.map(([x, y]): Vec2 => [x + radius, y])))
      .filter((c) => c.length >= 3 && Math.abs(area(c)) > 1e-9),
  );
  const rmaxP = Math.max(0, ...polys.flatMap((c) => c.map((q) => q[0])));
  if (!(rmaxP > 1e-6)) return null;
  const rt = plan.fit === 'profileToPlan' ? plan.planW / 2 : rmaxP;
  const k = rt / rmaxP;
  const scaled = polys.map((c) => c.map(([x, y]): Vec2 => [x * k, y]));
  const { paths } = planPaths(plan, rt);
  const outline = planOutline(paths, planTolerance(rt));
  if (outline.length < 3) return null;
  const prep = preparePlan(outline, featureAngles(paths), planRays(segments), 160, rt, isPlainCircle(plan), planChordTolerance(segments, rt));
  if (!prep.ok) return null;
  const mesh = revolveMesh(prep, plan.model, scaled, rt);
  if (!mesh.indices.length) return null;
  let wedge: PlanWedge | null = null;
  if (angle < 360) {
    const r = 2 * Math.max(Math.abs(mesh.bbox.min[0]), Math.abs(mesh.bbox.max[0]), Math.abs(mesh.bbox.min[1]), Math.abs(mesh.bbox.max[1])) + 1;
    wedge = { polygon: sectorPolygon(angle, r), z0: mesh.bbox.min[2] - 1, z1: mesh.bbox.max[2] + 1 };
  }
  return { mesh, wedge, rt, k };
}

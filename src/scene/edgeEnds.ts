import { composeTransform, eulerToMatrix } from './math';
import { edgeProfile } from './edgeProfile';
import { CORNER_OVERSHOOT } from './cornerProfile';
import type { EdgeNode, EndPlane, Scene, SceneNode, Vec3 } from './types';

/**
 * Piani di chiusura "vivi" dei taglierini.
 *
 * Quando due smussi si incontrano in un angolo, il secondo taglierino finisce sulla faccia del primo e viene ritagliato
 * dal suo piano. Se quel piano fosse salvato come numeri, cambiando poi la misura del primo smusso il secondo
 * resterebbe ritagliato dal piano vecchio e all'angolo resterebbe del materiale (o ne verrebbe tolto troppo).
 * Per questo il secondo taglierino ricorda quale smusso chiude la sua estremità (`endVia`) e il piano si ricalcola
 * a ogni valutazione dai valori correnti di quello smusso. Funzioni pure: le usano kernel e generatore OpenSCAD.
 */

type Frame = { position: Vec3; rotation: Vec3 };

/** Sovrapposizione (mm) del piano di chiusura oltre la faccia dello smusso che lo chiude. */
const END_OVERLAP = 0.01;

/** Id del gruppo che contiene il nodo (scansione della scena: nel worker non c'è lo store). */
function parentIdOf(scene: Scene, id: string): string | undefined {
  return Object.values(scene.nodes).find((n) => n.type === 'group' && n.children.includes(id))?.id;
}

/**
 * Trasformazione di `id` nel sistema dell'antenato `ancestorId`: composizione dei nodi sul percorso, dall'antenato
 * (escluso) al nodo. Null se `id` non discende dall'antenato.
 */
export function frameWithin(scene: Scene, id: string, ancestorId: string): Frame | null {
  const chain: SceneNode[] = [];
  let cur: string | undefined = id;
  while (cur && cur !== ancestorId) {
    chain.unshift(scene.nodes[cur]);
    cur = parentIdOf(scene, cur);
  }
  if (cur !== ancestorId) return null;
  let frame: Frame = { position: [0, 0, 0], rotation: [0, 0, 0] };
  for (const node of chain) frame = composeTransform(frame, node);
  return frame;
}

/**
 * Piano della faccia di uno smusso, nel sistema locale del suo taglierino: normale uscente dal materiale (verso lo
 * spigolo originale, cioè l'apice del profilo) e offset, come per `EndPlane` (si tiene normal·p ≤ offset).
 */
export function chamferFacePlane(edge: Pick<EdgeNode, 'angle' | 'distance1' | 'distance2'>): EndPlane {
  // La faccia dello smusso passa per i due punti del profilo a distanza d1 e d2 dall'apice ed è parallela allo spigolo (Z)
  const [, p1, p2] = edgeProfile({ ...edge, treatment: 'chamfer', radius: 0 }).polygon;
  const v: [number, number] = [p2[0] - p1[0], p2[1] - p1[1]];
  const length = Math.hypot(v[0], v[1]) || 1;
  let normal: Vec3 = [v[1] / length, -v[0] / length, 0];
  // L'apice (origine) sta dalla parte dello smusso rimosso: la normale uscente guarda verso di lui
  if (normal[0] * -p1[0] + normal[1] * -p1[1] < 0) normal = [-normal[0], -normal[1], 0];
  return { normal, offset: normal[0] * p1[0] + normal[1] * p1[1] };
}

/** Riporta un piano da un sistema di riferimento a un altro (tutti e due espressi nello stesso sistema esterno). */
export function planeBetweenFrames(plane: EndPlane, from: Frame, to: Frame): EndPlane {
  const rotateFrom = eulerToMatrix(from.rotation);
  const rotateTo = eulerToMatrix(to.rotation);
  const apply = (m: ReturnType<typeof eulerToMatrix>, v: readonly number[]): Vec3 => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as Vec3;
  /** Trasposta per un vettore (inversa di una rotazione). */
  const applyInverse = (m: ReturnType<typeof eulerToMatrix>, v: readonly number[]): Vec3 => [0, 1, 2].map((i) => m[0][i] * v[0] + m[1][i] * v[1] + m[2][i] * v[2]) as Vec3;

  const normalSize = Math.hypot(...plane.normal) || 1;
  // Un punto del piano nel sistema di partenza, poi nel sistema esterno, poi in quello di arrivo
  const point = plane.normal.map((c) => (c * plane.offset) / (normalSize * normalSize)) as Vec3;
  const outer = apply(rotateFrom, point).map((c, i) => c + from.position[i]) as Vec3;
  const inner = applyInverse(rotateTo, outer.map((c, i) => c - to.position[i]));
  const normal = applyInverse(rotateTo, apply(rotateFrom, plane.normal));
  return { normal, offset: normal[0] * inner[0] + normal[1] * inner[1] + normal[2] * inner[2] };
}

/**
 * Piani di chiusura correnti di un taglierino: per ogni estremità, il piano ricalcolato dallo smusso indicato in
 * `endVia` (se esiste ancora, è convesso e sta nello stesso gruppo o sotto di esso), altrimenti quello salvato in `ends`.
 */
export function resolveEnds(scene: Scene, edge: EdgeNode): [EndPlane | null, EndPlane | null] {
  const resolved: [EndPlane | null, EndPlane | null] = [edge.ends[0], edge.ends[1]];
  const parentId = parentIdOf(scene, edge.id);
  if (!edge.endVia || !parentId) return resolved;
  for (const i of [0, 1] as const) {
    const via = edge.endVia[i] ? scene.nodes[edge.endVia[i]!] : undefined;
    if (via?.type !== 'edge' || via.treatment !== 'chamfer' || !via.convex) continue;
    const viaFrame = frameWithin(scene, via.id, parentId);
    if (!viaFrame) continue;
    // Piano della faccia dello smusso nel sistema del gruppo, poi nel sistema di questo taglierino
    const plane = planeBetweenFrames(chamferFacePlane(via), viaFrame, { position: edge.position, rotation: edge.rotation });
    // Oltre la faccia dello smusso c'è già aria: il piano si sposta di poco in fuori, così il taglio non è complanare
    // con quella faccia (altrimenti la booleana lascia una pellicola a spessore zero oltre lo smusso)
    resolved[i] = { normal: plane.normal, offset: plane.offset + END_OVERLAP };
  }
  return resolved;
}

/**
 * Quale smusso già presente chiude ciascuna estremità di un nuovo taglierino: si cercano, tra i taglierini a smusso del
 * pezzo, quelli la cui faccia coincide con il piano di chiusura trovato nella mesh. `viaWorld` è la trasformazione nel
 * mondo di ogni smusso candidato e `edgeWorld` quella del nuovo taglierino.
 */
export function matchEndVia(
  ends: [EndPlane | null, EndPlane | null],
  edgeWorld: Frame,
  candidates: { edge: EdgeNode; world: Frame }[],
): [string | null, string | null] {
  const TOLERANCE = 1e-3;
  const via: [string | null, string | null] = [null, null];
  ends.forEach((end, i) => {
    if (!end) return;
    for (const { edge, world } of candidates) {
      if (edge.treatment !== 'chamfer' || !edge.convex) continue;
      const plane = planeBetweenFrames(chamferFacePlane(edge), world, edgeWorld);
      const sameNormal = plane.normal.every((c, k) => Math.abs(c - end.normal[k]) < TOLERANCE);
      if (sameNormal && Math.abs(plane.offset - end.offset) < TOLERANCE) {
        via[i] = edge.id;
        return;
      }
    }
  });
  return via;
}

/**
 * Raccordi che si incontrano in un angolo. Dopo il primo raccordo la faccia piana finisce sulla sua linea di tangenza,
 * quindi il secondo spigolo risulta più corto del vero e il suo taglierino si fermerebbe lì, lasciando una pinna di
 * materiale fino all'angolo. Il bordo di un raccordo è un cilindro (non un piano, quindi niente piano di chiusura):
 * l'incontro corretto è quello di due cilindri, cioè il secondo taglierino deve proseguire fino allo spigolo originale,
 * oltre la tangenza di una distanza pari a quella tra apice e punto di tangenza.
 *
 * Per ogni estremità che cade sulla linea di tangenza di un raccordo esistente (spigolo perpendicolare al suo asse,
 * dentro la sua lunghezza) si allunga il taglierino. L'estensione è numerica: cambiando poi il raggio del primo
 * raccordo il secondo non si riallinea da solo.
 */
export function extendOverFillets(
  geometry: { origin: Vec3; rotation: Vec3; length: number },
  fillets: { edge: EdgeNode; world: Frame }[],
): { origin: Vec3; length: number; before: number; after: number } {
  const TOLERANCE = 1e-2;
  const rotateEdge = eulerToMatrix(geometry.rotation);
  // Asse Z del nuovo taglierino (lungo lo spigolo) nel mondo: terza colonna della matrice di rotazione
  const axis: Vec3 = [rotateEdge[0][2], rotateEdge[1][2], rotateEdge[2][2]];
  /** Quanto allungare l'estremità, in quella direzione di uscita (+1 fine, -1 inizio). */
  const extension = (point: Vec3, exit: 1 | -1): number => {
    for (const { edge, world } of fillets) {
      if (edge.treatment !== 'fillet' || !edge.convex) continue;
      const rotateFillet = eulerToMatrix(world.rotation);
      // Da mondo a sistema del raccordo: trasposta della rotazione (la sua inversa) applicata al vettore
      const toFillet = (v: Vec3): Vec3 => [0, 1, 2].map((i) => rotateFillet[0][i] * v[0] + rotateFillet[1][i] * v[1] + rotateFillet[2][i] * v[2]) as Vec3;
      const p = toFillet(point.map((c, i) => c - world.position[i]) as Vec3);
      const direction = toFillet(axis);
      // Lo spigolo nuovo deve essere perpendicolare all'asse (Z locale) del raccordo e cadere nella sua lunghezza
      if (Math.abs(direction[2]) > 1e-3 || p[2] < -TOLERANCE || p[2] > edge.length + TOLERANCE) continue;
      const [, t1, t2] = edgeProfile(edge).polygon;
      for (const t of [t1, t2]) {
        if (Math.hypot(p[0] - t[0], p[1] - t[1]) > TOLERANCE) continue;
        // L'uscita deve andare verso l'apice del raccordo (l'origine del suo sistema), non allontanarsi
        if ((-t[0]) * direction[0] * exit + (-t[1]) * direction[1] * exit <= 0) continue;
        return Math.hypot(t[0], t[1]) + CORNER_OVERSHOOT;
      }
    }
    return 0;
  };
  const end = geometry.origin.map((c, i) => c + axis[i] * geometry.length) as Vec3;
  const before = extension(geometry.origin, -1);
  const after = extension(end, 1);
  return {
    origin: geometry.origin.map((c, i) => c - axis[i] * before) as Vec3,
    length: geometry.length + before + after,
    before,
    after,
  };
}

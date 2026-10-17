import { ringCache } from '../../scene/planRevolve';
import type { PlanPrep, PlanRingModel } from '../../scene/planRevolve';
import type { PlanSym } from '../../scene/planShape';
import type { Vec2 } from '../../scene/types';
import type { CanvasContext } from './DrawingCanvas';

interface Props {
  ctx: CanvasContext;
  prep: PlanPrep;
  model: PlanRingModel;
  /** Raggio massimo del profilo (mm): l'anello del bordo. */
  rmax: number;
  /** Distanze minima e massima dall'asse del profilo: l'ingombro è la corona tra i loro anelli. */
  xmin: number;
  xmax: number;
  /** Distanze dall'asse a cui la quota di sezione attraversa il profilo. */
  slice: number[];
  /** Quota della sezione (mm) per l'etichetta, o null se la sezione è nascosta. */
  zs: number | null;
  sym: PlanSym;
  /** Livelli a passo costante (sottili). */
  levels: boolean;
}

/** Numero di livelli, dal bordo al centro. */
const LEVELS = 8;

/**
 * Sotto i contorni della sagoma: l'ingombro del solido visto dall'alto (area più scura), i livelli a passo costante, la
 * sezione alla quota scelta e gli assi di simmetria. Gli anelli sono quelli stessi con cui si costruisce il solido.
 */
export function PlanUnderlay({ ctx, prep, model, rmax, xmin, xmax, slice, zs, sym, levels }: Props) {
  const ring = ringCache(prep, model, rmax);
  const path = (x: number): string => {
    const r = ring(x);
    let d = '';
    for (let k = 0; k < prep.K; k++) {
      const [sx, sy] = ctx.toS([r[k] * prep.cos[k], r[k] * prep.sin[k]]);
      d += `${k ? 'L' : 'M'}${sx.toFixed(1)} ${sy.toFixed(1)}`;
    }
    return `${d}Z`;
  };
  const o = ctx.toS([0, 0]);
  const far = Math.max(ctx.size.w, ctx.size.h) * 2;
  const axes: Vec2[][] = [];
  if (sym === 'v' || sym === 'q') axes.push([[o[0], o[1] - far], [o[0], o[1] + far]]);
  if (sym === 'h' || sym === 'q') axes.push([[o[0] - far, o[1]], [o[0] + far, o[1]]]);
  return (
    <g className="profile-editor__plan-underlay" data-plan-underlay="">
      <path className="profile-editor__plan-ing" d={path(xmax) + (xmin > 0.05 ? path(xmin) : '')} fillRule="evenodd" />
      {levels && Array.from({ length: LEVELS - 1 }, (_, i) => <path key={i} className="profile-editor__plan-level" d={path(rmax * (1 - (i + 1) / LEVELS))} />)}
      {slice.length > 0 && <path className="profile-editor__plan-slice" d={slice.map(path).join('')} fillRule="evenodd" />}
      {zs !== null && (
        <text className="profile-editor__plan-slice-label" x={10} y={ctx.size.h - 30}>
          Sezione a z = {String(Math.round(zs * 10) / 10).replace('.', ',')} mm
        </text>
      )}
      {axes.map((a, i) => (
        <line key={i} className="profile-editor__plan-sym" x1={a[0][0]} y1={a[0][1]} x2={a[1][0]} y2={a[1][1]} />
      ))}
    </g>
  );
}

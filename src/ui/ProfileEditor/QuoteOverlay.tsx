import type { ReactNode } from 'react';
import { ANGLE_R_PX, CONSTRAINT_GLYPHS, DIM_GAP_PX, angleLayout, arcPoints, dimLabel, dimLayout, dimText, isDimension, nodeNames, pillWidthPx, pointMap, describeConstraint } from './dimensions';
import type { NodeRef } from './model';
import type { PathContour, ProfileConstraint, Vec2 } from '../../scene/types';

/** Coordinata per l'attributo SVG: un decimale basta e tiene corto il markup. */
const f1 = (n: number) => n.toFixed(1);
/** Punto (pixel) al centro dell'etichetta di una quota, o null se un nodo citato non c'è: serve a posizionare il campo che la modifica. */
export function quoteLabelPoint(c: ProfileConstraint, paths: PathContour[], toS: (p: Vec2) => Vec2, pxPerMm: number): Vec2 | null {
  const label = dimLabel(c, pointMap(paths), (c.t === 'angle' ? ANGLE_R_PX : DIM_GAP_PX) / Math.max(pxPerMm, 1e-6));
  return label ? toS(label) : null;
}

/** Nome di classe BEM con i modificatori di stato: `bem('x', ['ref', 'sel'])` = «x x--ref x--sel». */
const bem = (base: string, state: string[]) => base + state.map((m) => ` ${base}--${m}`).join('');

/** Punta di freccia a V in (x, y), con le code lungo (ux, uy). */
const arrow = (x: number, y: number, ux: number, uy: number) => `M${f1(x + ux * 7 - uy * 3)} ${f1(y + uy * 7 + ux * 3)}L${f1(x)} ${f1(y)}L${f1(x + ux * 7 + uy * 3)} ${f1(y + uy * 7 - ux * 3)}`;

interface Props {
  paths: PathContour[];
  constraints: ProfileConstraint[];
  /** Disegno -> pixel dell'area. */
  toS: (p: Vec2) => Vec2;
  /** Zoom: pixel per mm, per la posizione di riserva delle quote senza `off`. */
  pxPerMm: number;
  /** Vincoli in conflitto o ridondanti (rossi). */
  bad: Set<string>;
  /** Vincoli da evidenziare per qualche secondo (dopo un rifiuto). */
  flash: Set<string>;
  /** Vincolo scelto nell'elenco del pannello (o più quote scelte insieme). */
  selected: string | string[] | null;
  /** Quota nuova in attesa del valore: tratteggiata, con i nodi del disegno com'erano quando è stata scelta. */
  draft: { con: ProfileConstraint; paths: PathContour[] } | null;
  /** Nodi già scelti con lo strumento Quota (il primo dei due). */
  pick: NodeRef[];
}

/**
 * Livello SVG di quote e vincoli sopra il disegno: linee di richiamo e di quota con frecce, etichetta a pillola con il
 * valore (clic = campo di modifica), icone dei vincoli geometrici accanto ai segmenti o ai nodi. Ogni elemento cliccabile
 * ha `data-qid` con l'id del vincolo (la nuova quota ha `draft`). Stati come nel prototipo dello studio: quota di
 * riferimento tratteggiata e tra parentesi, vincolo scelto con il colore d'accento, in conflitto in rosso.
 */
export function QuoteOverlay({ paths, constraints, toS, pxPerMm, bad, flash, selected, draft, pick }: Props) {
  const fallback = DIM_GAP_PX / Math.max(pxPerMm, 1e-6);
  const names = nodeNames(paths);
  const pm = pointMap(paths);
  // Più icone sullo stesso segmento o nodo si impilano: quante ce ne sono già per ogni chiave
  const slots = new Map<string, number>();
  const slot = (key: string) => {
    const k = (slots.get(key) ?? 0) + 1;
    slots.set(key, k);
    return k;
  };

  const pill = (key: string, x: number, y: number, text: string, state: string[]): ReactNode => {
    const w = pillWidthPx(text);
    return (
      <g key={`l:${key}`} className={bem('profile-editor__qlabel', state)} data-qid={key} data-quote-label={key}>
        <rect x={f1(x - w / 2)} y={f1(y - 9)} width={f1(w)} height={18} rx={9} />
        <text x={f1(x)} y={f1(y + 4)} textAnchor="middle">
          {text}
        </text>
      </g>
    );
  };

  /** Quota angolare: l'arco centrato nel vertice (con due soli punti anche il riferimento sull'asse X) e l'etichetta sull'arco. */
  const angle = (c: ProfileConstraint, ps: PathContour[], state: string[], key: string): ReactNode => {
    const layout = angleLayout(c, ps === paths ? pm : pointMap(ps), ANGLE_R_PX / Math.max(pxPerMm, 1e-6));
    if (!layout) return null;
    const arc = arcPoints(layout).map(toS);
    const d = arc.map((q, i) => `${i ? 'L' : 'M'}${f1(q[0])} ${f1(q[1])}`).join('');
    const [V, L] = [toS(layout.vertex), toS(layout.label)];
    // Con due punti l'angolo è rispetto all'asse X: una semiretta di riferimento oltre l'arco
    const ray = c.p.length === 2 ? (() => { const e = toS([layout.vertex[0] + layout.radius * 1.3, layout.vertex[1]]); return `M${f1(V[0])} ${f1(V[1])}L${f1(e[0])} ${f1(e[1])}`; })() : '';
    return (
      <g key={`d:${key}`}>
        <g className={bem('profile-editor__dim', state)}>
          <path d={`${d}${ray}`} />
        </g>
        {key !== 'draft' && <path className="profile-editor__qline" d={d} data-qline={key} />}
        {pill(key, L[0], L[1], dimText(c, ps), state)}
      </g>
    );
  };

  const dimension = (c: ProfileConstraint, ps: PathContour[], state: string[], key: string): ReactNode => {
    if (c.t === 'angle') return angle(c, ps, state, key);
    const layout = dimLayout(c, ps === paths ? pm : pointMap(ps), fallback);
    if (!layout) return null;
    const [A, B, A2, B2, L] = [toS(layout.a), toS(layout.b), toS(layout.a2), toS(layout.b2), toS(layout.label)];
    // Linee di richiamo: dal nodo verso la linea di quota, con un piccolo stacco dal nodo e un po' oltre la linea
    const extension = (P: Vec2, P2: Vec2) => {
      const len = Math.hypot(P2[0] - P[0], P2[1] - P[1]);
      if (len < 8) return '';
      const [ux, uy] = [(P2[0] - P[0]) / len, (P2[1] - P[1]) / len];
      return `M${f1(P[0] + ux * 3)} ${f1(P[1] + uy * 3)}L${f1(P2[0] + ux * 4)} ${f1(P2[1] + uy * 4)}`;
    };
    const len = Math.hypot(B2[0] - A2[0], B2[1] - A2[1]);
    const [ux, uy] = len > 0.5 ? [(B2[0] - A2[0]) / len, (B2[1] - A2[1]) / len] : [1, 0];
    const line = `M${f1(A2[0])} ${f1(A2[1])}L${f1(B2[0])} ${f1(B2[1])}${arrow(A2[0], A2[1], ux, uy)}${arrow(B2[0], B2[1], -ux, -uy)}`;
    return (
      <g key={`d:${key}`}>
        <g className={bem('profile-editor__dim', state)}>
          <path d={`${extension(A, A2)}${extension(B, B2)}${line}`} />
        </g>
        {/* La linea di quota si afferra e si trascina (cambia `off`): un tracciato trasparente più largo, non per la quota in attesa del valore */}
        {key !== 'draft' && <path className="profile-editor__qline" d={`M${f1(A2[0])} ${f1(A2[1])}L${f1(B2[0])} ${f1(B2[1])}`} data-qline={key} />}
        {pill(key, L[0], L[1], dimText(c, ps), state)}
      </g>
    );
  };

  const glyph = (c: ProfileConstraint, state: string[]): ReactNode => {
    const out: ReactNode[] = [];
    const put = (n: number, x: number, y: number) =>
      out.push(
        <g key={`g:${c.id}:${n}`} className={bem('profile-editor__qglyph', state)} data-qid={c.id} data-constraint-glyph={c.t}>
          <circle cx={f1(x)} cy={f1(y)} r={8} />
          <text x={f1(x)} y={f1(y + 4)} textAnchor="middle">
            {CONSTRAINT_GLYPHS[c.t]}
          </text>
          <title>{describeConstraint(c, names)}</title>
        </g>,
      );
    // Accanto al segmento (p[i], p[j]): a 13 px dal suo punto medio, e le altre icone dello stesso segmento di fianco
    const onSegment = (n: number, i: number, j: number) => {
      const [a, b] = [pm.get(c.p[i]), pm.get(c.p[j])];
      if (!a || !b) return;
      const [A, B] = [toS(a), toS(b)];
      const k = slot(`${c.p[i]}|${c.p[j]}`);
      const [dx, dy] = [B[0] - A[0], B[1] - A[1]];
      const l = Math.hypot(dx, dy) || 1;
      put(n, (A[0] + B[0]) / 2 - (dy / l) * 13 + (dx / l) * (k - 1) * 17, (A[1] + B[1]) / 2 + (dx / l) * 13 + (dy / l) * (k - 1) * 17);
    };
    // Accanto al nodo p[i]: in alto a destra, e le altre icone dello stesso nodo di fianco
    const onPoint = (n: number, i: number) => {
      const p = pm.get(c.p[i]);
      if (!p) return;
      const q = toS(p);
      const k = slot(c.p[i]);
      put(n, q[0] + 12 + (k - 1) * 17, q[1] - 12);
    };
    if (c.t === 'fixed' || c.t === 'coincident' || c.t === 'midpoint') onPoint(0, 0);
    else if (c.t === 'horizontal' || c.t === 'vertical' || c.t === 'symmetric' || (c.t === 'angle' && c.p.length === 2)) onSegment(0, 0, 1);
    else {
      onSegment(0, 0, 1);
      onSegment(1, 2, 3);
    }
    return out;
  };

  const ring = (r: NodeRef, i: number): ReactNode => {
    const n = paths[r.path]?.nodes[r.node];
    if (!n) return null;
    const [x, y] = toS(n.p);
    return <circle key={`r:${i}`} className="profile-editor__qring" cx={f1(x)} cy={f1(y)} r={11} />;
  };

  return (
    <g className="profile-editor__quotes" data-quotes="">
      {pick.map(ring)}
      {constraints.map((c) => {
        if (!c.p.every((id) => pm.has(id))) return null;
        const state = [...(c.ref ? ['ref'] : []), ...((Array.isArray(selected) ? selected.includes(c.id) : selected === c.id) ? ['sel'] : []), ...(bad.has(c.id) || flash.has(c.id) ? ['err'] : [])];
        return isDimension(c) ? dimension(c, paths, state, c.id) : glyph(c, state);
      })}
      {draft && dimension(draft.con, draft.paths, ['draft'], 'draft')}
    </g>
  );
}

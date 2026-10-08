import { useMemo, useRef, useState } from 'react';
import { Html, Line } from '@react-three/drei';
import { Lock, Unlock } from 'lucide-react';
import { useResultStore } from '../kernel/useKernel';
import { queueKeepBase } from '../kernel/placement';
import { apply, eulerToMatrix, round } from '../scene/math';
import { MIN_DIMENSION, resizeAxisPatch, sizeOfBox, type Axis } from '../scene/dimensions';
import { isRatioLocked } from '../scene/resize';
import { localBounds } from '../scene/shell';
import { isLocked, useSceneStore, worldTransform } from '../scene/store';
import type { Vec3 } from '../scene/types';
import { useArrayTool } from '../ui/Array/arrayToolStore';
import { useEdgeTool } from '../ui/EdgeTool/edgeToolStore';
import { useLayFlat } from '../ui/LayFlat/layFlatStore';
import { useMeasure } from '../ui/Measure/measureStore';
import { usePatternTool } from '../ui/Pattern/patternToolStore';
import { useShellTool } from '../ui/Shell/shellToolStore';
import { useUiStore } from '../ui/uiStore';

/** Distanza (mm) tra l'ingombro e la linea di quota, verso l'esterno. */
const OFFSET = 8;

/** Colori degli assi, gli stessi del gizmo di orientamento. */
const AXES: { letter: string; color: string }[] = [
  { letter: 'X', color: '#ff5d5d' },
  { letter: 'Y', color: '#46c47a' },
  { letter: 'Z', color: '#4da3ff' },
];

/** Spigoli quotati dell'ingombro locale (angoli come 0 = min, 1 = max per asse) e direzione verso l'esterno. */
const EDGES: { axis: Axis; from: Vec3; to: Vec3; out: Vec3 }[] = [
  { axis: 0, from: [0, 0, 0], to: [1, 0, 0], out: [0, -1, 0] },
  { axis: 1, from: [1, 0, 0], to: [1, 1, 0], out: [1, 0, 0] },
  // La quota Z sta a sinistra: così non si sovrappone alle altre due sugli oggetti piccoli
  { axis: 2, from: [0, 0, 0], to: [0, 0, 1], out: [-1, -1, 0] },
];

const formatValue = (v: number) => v.toLocaleString('it-IT', { maximumFractionDigits: 2 });

/** Etichetta di una quota: un clic la trasforma in un campo dove si digita la misura (Invio applica, Esc annulla). */
function Quote({ axis, value, readOnly, onCommit }: { axis: Axis; value: number; readOnly: boolean; onCommit: (value: number) => void }) {
  const [editing, setEditing] = useState(false);
  // Invio e perdita del fuoco arrivano di seguito: la misura si applica una sola volta
  const settled = useRef(false);
  const { letter, color } = AXES[axis];

  const finish = (raw: string | null) => {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    if (raw !== null) onCommit(Number(raw));
  };

  if (editing) {
    return (
      <input
        className="dimension-input"
        data-axis={letter.toLowerCase()}
        type="number"
        step="any"
        min={MIN_DIMENSION}
        aria-label={`Misura ${letter} in mm`}
        defaultValue={round(value, 2)}
        style={{ borderColor: color }}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(e.currentTarget.value);
          else if (e.key === 'Escape') finish(null);
        }}
        onBlur={(e) => finish(e.currentTarget.value)}
      />
    );
  }
  const text = (
    <>
      <b style={{ color }}>{letter}</b> {formatValue(value)}
    </>
  );
  if (readOnly) return <span className="dimension-label dimension-label--readonly" data-axis={letter.toLowerCase()}>{text}</span>;
  return (
    <button
      type="button"
      className="dimension-label"
      data-axis={letter.toLowerCase()}
      title={`Misura ${letter}: clic per assegnarla`}
      onClick={() => {
        settled.current = false;
        setEditing(true);
      }}
    >
      {text}
    </button>
  );
}

/** Lucchetto accanto alle quote: chiuso, cambiando una misura anche le altre scalano dello stesso fattore. */
function RatioLock({ closed, readOnly, forced, onToggle }: { closed: boolean; readOnly: boolean; forced: boolean; onToggle: () => void }) {
  const Icon = closed ? Lock : Unlock;
  const title = forced
    ? 'Proporzioni sempre bloccate: una mesh importata si scala solo in modo uniforme'
    : closed
      ? 'Proporzioni bloccate: cambiando una quota cambiano anche le altre. Clic per sbloccare'
      : 'Proporzioni libere: ogni quota cambia da sola. Clic per bloccare';
  return (
    <button type="button" className="dimension-lock" aria-label={closed ? 'Proporzioni bloccate' : 'Proporzioni libere'} aria-pressed={closed} title={title} disabled={readOnly || forced} onClick={onToggle}>
      <Icon size={13} />
    </button>
  );
}

/**
 * Quote dell'oggetto selezionato: larghezza (X), profondità (Y) e altezza (Z) del suo ingombro nel sistema locale,
 * disegnate accanto allo spigolo. Un clic su una quota permette di digitare la misura in mm: l'oggetto si ridimensiona
 * come con il gizmo, senza passare dal pannello laterale. Con l'oggetto bloccato le quote sono di sola lettura.
 */
export function DimensionOverlay() {
  const scene = useSceneStore((s) => s.scene);
  const selection = useSceneStore((s) => s.selection);
  const updateNode = useSceneStore((s) => s.updateNode);
  const meshes = useResultStore((s) => s.meshes);
  const dragging = useUiStore((s) => s.gizmoDragging);
  const enabled = useUiStore((s) => s.showDimensions);
  // Con uno strumento aperto l'oggetto è in anteprima: le quote non servono e sarebbero fuorvianti
  const edgeTool = useEdgeTool((s) => s.tool !== null);
  const shell = useShellTool((s) => s.active);
  const measure = useMeasure((s) => s.active);
  const layFlat = useLayFlat((s) => s.active);
  const array = useArrayTool((s) => s.active);
  const pattern = usePatternTool((s) => s.active);

  const id = selection.length === 1 && scene.rootIds.includes(selection[0]) ? selection[0] : undefined;
  const node = id ? scene.nodes[id] : undefined;
  const quotable = !!node && (node.type === 'primitive' || node.type === 'shape2d' || node.type === 'group' || node.type === 'mesh');

  // Ingombro nel sistema locale dell'oggetto, dalle mesh calcolate dal kernel
  const box = useMemo(() => {
    if (!id || !quotable) return null;
    const own = meshes.filter((m) => !m.empty && m.path.includes(id));
    if (!own.length) return null;
    const b = localBounds(own, worldTransform(scene, id));
    return [...b.min, ...b.max].every(Number.isFinite) ? b : null;
  }, [meshes, scene, id, quotable]);

  if (!enabled || !id || !node || !box || dragging || edgeTool || shell || measure || layFlat || array || pattern) return null;

  const world = worldTransform(scene, id);
  const rotation = eulerToMatrix(world.rotation);
  /** Punto del sistema locale in coordinate del mondo: R · D · locale + posizione. */
  const toWorld = (l: Vec3): Vec3 => {
    const r = apply(rotation, l.map((v, i) => (world.mirror?.[i] ? -v : v)) as Vec3);
    return [r[0] + world.position[0], r[1] + world.position[1], r[2] + world.position[2]];
  };
  const size = sizeOfBox(box);
  const locked = isLocked(scene, id);
  // Proporzioni: stesso campo del pulsante "Proporzioni" delle proprietà (per i gruppi vale solo qui); una mesh è sempre uniforme
  const forced = node.type === 'mesh';
  const ratioClosed = forced || (node.type === 'primitive' || node.type === 'shape2d' ? isRatioLocked(node) : node.lockRatio === true);

  const commit = (axis: Axis, value: number) => {
    // Nessuna modifica (e nessun passo di Annulla) se la misura non cambia
    if (Math.abs(value - size[axis]) < 0.005) return;
    const patch = resizeAxisPatch(node, box, axis, value, ratioClosed);
    if (!patch) return;
    // Come dal pannello: la base dell'oggetto resta dov'era (sul piatto o impilata)
    queueKeepBase(id);
    updateNode(id, patch as never);
  };

  return (
    <group>
      {EDGES.map(({ axis, from, to, out }) => {
        // Angolo come min/max per asse, spostato verso l'esterno dello spigolo
        const point = (corner: Vec3): Vec3 => toWorld([0, 1, 2].map((i) => (corner[i] ? box.max[i] : box.min[i]) + out[i] * OFFSET) as Vec3);
        const a = point(from);
        const b = point(to);
        const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        return (
          <group key={axis}>
            <Line points={[a, b]} color={AXES[axis].color} lineWidth={1.5} depthTest={false} renderOrder={4} raycast={() => null} />
            <Html position={mid} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
              <span className="dimension-row">
                <Quote key={`${id}-${axis}-${size[axis]}`} axis={axis} value={size[axis]} readOnly={locked} onCommit={(v) => commit(axis, v)} />
                {/* Un lucchetto per ogni quota: sono lo stesso interruttore, cambiarne uno cambia tutti */}
                <RatioLock closed={ratioClosed} readOnly={locked} forced={forced} onToggle={() => updateNode(id, { lockRatio: !ratioClosed } as never)} />
              </span>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

import { Box, Circle, CircleDot, Cone, Cylinder, Diamond, Donut, Gem, Hexagon, Pentagon, Square } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSceneStore } from '../../scene/store';
import { PRIMITIVE_LABELS, SHAPE2D_LABELS } from '../../scene/defaults';
import type { PrimitiveKind, Shape2DKind } from '../../scene/types';
import './ShapeLibrary.scss';

/** Icona di ogni primitiva, condivisa con l'outliner. */
export const PRIMITIVE_ICONS: Record<PrimitiveKind, LucideIcon> = {
  box: Box,
  cylinder: Cylinder,
  cone: Cone,
  sphere: Circle,
  torus: Donut,
  octahedron: Diamond,
  decahedron: Gem,
  dodecahedron: Pentagon,
  icosahedron: Hexagon,
};

/** Icona di ogni forma 2D estrudibile. */
export const SHAPE2D_ICONS: Record<Shape2DKind, LucideIcon> = { circle: CircleDot, square: Square };

const KINDS = Object.keys(PRIMITIVE_LABELS) as PrimitiveKind[];
const KINDS_2D = Object.keys(SHAPE2D_LABELS) as Shape2DKind[];

export function ShapeLibrary() {
  const addPrimitive = useSceneStore((s) => s.addPrimitive);
  const addShape2D = useSceneStore((s) => s.addShape2D);
  return (
    <section className="shape-library">
      <h2 className="shape-library__title">Forme</h2>
      <div className="shape-library__grid">
        {KINDS.map((kind) => {
          const Icon = PRIMITIVE_ICONS[kind];
          return (
            <button key={kind} type="button" className="shape-library__item" onClick={() => addPrimitive(kind)} title={`Aggiungi: ${PRIMITIVE_LABELS[kind]}`}>
              <Icon size={24} strokeWidth={1.6} />
              <span className="shape-library__label">{PRIMITIVE_LABELS[kind]}</span>
            </button>
          );
        })}
      </div>
      <h2 className="shape-library__title">Forme 2D (estrudibili)</h2>
      <div className="shape-library__grid">
        {KINDS_2D.map((kind) => {
          const Icon = SHAPE2D_ICONS[kind];
          return (
            <button key={kind} type="button" className="shape-library__item" onClick={() => addShape2D(kind)} title={`Aggiungi: ${SHAPE2D_LABELS[kind]} estruso`}>
              <Icon size={24} strokeWidth={1.6} />
              <span className="shape-library__label">{SHAPE2D_LABELS[kind]}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

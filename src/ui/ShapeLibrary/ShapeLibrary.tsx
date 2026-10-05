import { Box, Circle, Cone, Cylinder, Donut } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSceneStore } from '../../scene/store';
import { PRIMITIVE_LABELS } from '../../scene/defaults';
import type { PrimitiveKind } from '../../scene/types';
import './ShapeLibrary.scss';

/** Icona di ogni primitiva, condivisa con l'outliner. */
export const PRIMITIVE_ICONS: Record<PrimitiveKind, LucideIcon> = {
  box: Box,
  cylinder: Cylinder,
  cone: Cone,
  sphere: Circle,
  torus: Donut,
};

const KINDS = Object.keys(PRIMITIVE_LABELS) as PrimitiveKind[];

export function ShapeLibrary() {
  const addPrimitive = useSceneStore((s) => s.addPrimitive);
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
    </section>
  );
}

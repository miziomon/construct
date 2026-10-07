import { Box, Circle, CircleDot, Cone, Cylinder, Diamond, Donut, Droplet, Egg, Heart, Hexagon, Moon, Pentagon, Plus, Shapes, Square, Star, Type } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Decagon } from '../icons/Decagon';
import { Ring, Star6, Trapezoid } from '../icons/Shapes2D';
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
  decahedron: Decagon,
  dodecahedron: Pentagon,
  icosahedron: Hexagon,
};

/** Icona di ogni forma 2D estrudibile. */
export const SHAPE2D_ICONS: Record<Shape2DKind, LucideIcon> = {
  circle: CircleDot,
  square: Square,
  ring: Ring,
  heart: Heart,
  star5: Star,
  star6: Star6,
  egg: Egg,
  trapezoid: Trapezoid,
  cross: Plus,
  drop: Droplet,
  crescent: Moon,
  text: Type,
  svg: Shapes,
};

const KINDS = Object.keys(PRIMITIVE_LABELS) as PrimitiveKind[];
// L'SVG non si aggiunge dalla libreria: nasce dall'importazione di un file (menu Importa)
const KINDS_2D = (Object.keys(SHAPE2D_LABELS) as Shape2DKind[]).filter((kind) => kind !== 'svg');

/** Griglia delle primitive 3D (prima tab della libreria). */
export function Shapes3DGrid() {
  const addPrimitive = useSceneStore((s) => s.addPrimitive);
  return (
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
  );
}

/** Griglia delle forme 2D estrudibili (seconda tab della libreria). */
export function Shapes2DGrid() {
  const addShape2D = useSceneStore((s) => s.addShape2D);
  return (
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
  );
}

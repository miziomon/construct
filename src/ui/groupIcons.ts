import { Group, SquareRoundCorner, SquaresIntersect, SquaresSubtract, SquaresUnite, TriangleRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { GroupOp } from '../scene/types';

/** Icona di ogni tipo di gruppo: il Raggruppa e le tre operazioni booleane si riconoscono a colpo d'occhio. */
export const GROUP_ICONS: Record<GroupOp, LucideIcon> = {
  group: Group,
  union: SquaresUnite,
  difference: SquaresSubtract,
  intersection: SquaresIntersect,
};

/** Nome di ogni tipo di gruppo (titolo nella sidebar di destra e tooltip dell'elenco oggetti). */
export const GROUP_NAMES: Record<GroupOp, string> = {
  group: 'Gruppo',
  union: 'Unione',
  difference: 'Differenza',
  intersection: 'Intersezione',
};

/** Icona di un raccordo e di uno smusso: si usa nei pulsanti della barra, nell'elenco oggetti e nella sidebar. */
export const EDGE_ICONS: Record<'fillet' | 'chamfer', LucideIcon> = { fillet: SquareRoundCorner, chamfer: TriangleRight };

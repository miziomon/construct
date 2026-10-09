import { createLucideIcon } from 'lucide-react';

/** Icone dei profilati strutturali: la sezione a L, a T e a H disegnata come poligono su griglia 24 × 24. */

export const ProfileL = createLucideIcon('ProfileL', [['path', { d: 'M4 3v18h16v-5H9V3Z', key: 'profile-l' }]]);

export const ProfileT = createLucideIcon('ProfileT', [['path', { d: 'M3 3h18v5h-6.5v13h-5V8H3Z', key: 'profile-t' }]]);

export const ProfileH = createLucideIcon('ProfileH', [['path', { d: 'M4 3h4v6.5h8V3h4v18h-4v-6.5H8V21H4Z', key: 'profile-h' }]]);

export const ProfileU = createLucideIcon('ProfileU', [['path', { d: 'M4 3h4v13h8V3h4v18H4Z', key: 'profile-u' }]]);

export const TubeRect = createLucideIcon('TubeRect', [
  ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2', key: 'tube-rect-outer' }],
  ['rect', { x: '7', y: '7', width: '10', height: '10', rx: '1', key: 'tube-rect-inner' }],
]);

export const TubeRound = createLucideIcon('TubeRound', [
  ['circle', { cx: '12', cy: '12', r: '9', key: 'tube-round-outer' }],
  ['circle', { cx: '12', cy: '12', r: '5', key: 'tube-round-inner' }],
]);

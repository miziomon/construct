import { createLucideIcon } from 'lucide-react';

/** Icone dei profilati strutturali: la sezione a L, a T e a H disegnata come poligono su griglia 24 × 24. */

export const ProfileL = createLucideIcon('ProfileL', [['path', { d: 'M4 3v18h16v-5H9V3Z', key: 'profile-l' }]]);

export const ProfileT = createLucideIcon('ProfileT', [['path', { d: 'M3 3h18v5h-6.5v13h-5V8H3Z', key: 'profile-t' }]]);

export const ProfileH = createLucideIcon('ProfileH', [['path', { d: 'M4 3h4v6.5h8V3h4v18h-4v-6.5H8V21H4Z', key: 'profile-h' }]]);

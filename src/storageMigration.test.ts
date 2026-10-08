import { describe, expect, it } from 'vitest';
import { migrateLocalKey } from './storageMigration';

/** localStorage finto in memoria. */
const fakeStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
};

describe('migrazione delle chiavi salvate', () => {
  it('copia il valore della chiave vecchia in quella nuova e lascia la vecchia', () => {
    const s = fakeStorage({ 'webcad:ui': '{"state":{"theme":"dark"}}' });
    migrateLocalKey('webcad:ui', 'construct:ui', s);
    expect(s.getItem('construct:ui')).toBe('{"state":{"theme":"dark"}}');
    expect(s.getItem('webcad:ui')).toBe('{"state":{"theme":"dark"}}');
  });

  it('non sovrascrive una chiave nuova già presente', () => {
    const s = fakeStorage({ 'webcad:ui': 'vecchio', 'construct:ui': 'nuovo' });
    migrateLocalKey('webcad:ui', 'construct:ui', s);
    expect(s.getItem('construct:ui')).toBe('nuovo');
  });

  it('senza la chiave vecchia non crea nulla', () => {
    const s = fakeStorage();
    migrateLocalKey('webcad:ui', 'construct:ui', s);
    expect(s.data.size).toBe(0);
  });

  it('un localStorage che lancia errori non rompe l\'avvio', () => {
    const broken = { getItem: () => { throw new Error('negato'); }, setItem: () => { throw new Error('negato'); } };
    expect(() => migrateLocalKey('webcad:ui', 'construct:ui', broken)).not.toThrow();
  });
});

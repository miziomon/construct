import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDraft, flushDrafts, loadDraft, saveDraft } from './draft';
import { emptyDraft } from './model';
import type { Draft } from './model';
import { useProfileEditor } from './profileEditorStore';

/** localStorage finto in memoria. */
const fakeStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
};

const triangle: Draft = {
  ...emptyDraft(),
  extrusion: 'rotate',
  height: 12,
  paths: [{ closed: true, nodes: [{ p: [0, 0], kind: 'corner' }, { p: [10, 0], out: [1, 2], in: [-1, 0], kind: 'smooth' }, { p: [5, 8], kind: 'corner' }] }],
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('bozza del disegno', () => {
  it('salva dopo 500 ms dall\'ultima modifica con la chiave del nodo (o :new) e si rilegge uguale', () => {
    const s = fakeStorage();
    saveDraft('abc', triangle, s);
    vi.advanceTimersByTime(499);
    expect(s.data.size).toBe(0);
    vi.advanceTimersByTime(1);
    expect([...s.data.keys()]).toEqual(['construct:profile-draft:abc']);
    expect(loadDraft('abc', s)).toEqual(triangle);
    saveDraft(null, triangle, s);
    vi.advanceTimersByTime(500);
    expect(s.data.has('construct:profile-draft:new')).toBe(true);
  });

  it('più modifiche ravvicinate producono una sola scrittura, con l\'ultima', () => {
    const s = fakeStorage();
    const setItem = vi.spyOn(s, 'setItem');
    saveDraft('abc', { ...triangle, height: 1 }, s);
    vi.advanceTimersByTime(300);
    saveDraft('abc', { ...triangle, height: 2 }, s);
    vi.advanceTimersByTime(300);
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(loadDraft('abc', s)?.height).toBe(2);
  });

  it('clearDraft elimina la bozza e annulla la scrittura in attesa (nessuna bozza risorge dopo OK o Annulla)', () => {
    const s = fakeStorage();
    saveDraft('abc', triangle, s);
    vi.advanceTimersByTime(500);
    saveDraft('abc', { ...triangle, height: 99 }, s);
    clearDraft('abc', s);
    vi.advanceTimersByTime(2000);
    expect(s.data.size).toBe(0);
    expect(loadDraft('abc', s)).toBeNull();
  });

  it('flushDrafts scrive subito le bozze in attesa (pagehide, chiusura della modale) e il timer non scrive una seconda volta', () => {
    const s = fakeStorage();
    const setItem = vi.spyOn(s, 'setItem');
    saveDraft('abc', triangle, s);
    saveDraft(null, { ...triangle, height: 3 }, s);
    flushDrafts();
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(loadDraft('abc', s)).toEqual(triangle);
    expect(loadDraft(null, s)?.height).toBe(3);
    vi.advanceTimersByTime(2000);
    expect(setItem).toHaveBeenCalledTimes(2);
    // Dopo clearDraft non resta nulla da scrivere
    saveDraft('abc', triangle, s);
    clearDraft('abc', s);
    flushDrafts();
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  it('un contorno appena iniziato (un solo nodo) non si salva, così la bozza resta valida', () => {
    const s = fakeStorage();
    const started: Draft = { ...triangle, paths: [...triangle.paths, { closed: false, nodes: [{ p: [1, 1], kind: 'corner' }] }] };
    saveDraft('abc', started, s);
    vi.advanceTimersByTime(500);
    expect(loadDraft('abc', s)?.paths).toEqual(triangle.paths);
  });

  it('dati rovinati o manomessi si scartano: JSON non valido, versione ignota, nodi o parametri fuori dai limiti', () => {
    const s = fakeStorage();
    const key = 'construct:profile-draft:abc';
    expect(loadDraft('abc', s)).toBeNull();
    s.data.set(key, '{non json');
    expect(loadDraft('abc', s)).toBeNull();
    const put = (draft: unknown, v = 1) => s.data.set(key, JSON.stringify({ v, draft }));
    put(triangle, 2);
    expect(loadDraft('abc', s)).toBeNull();
    put({ ...triangle, paths: [{ closed: true, nodes: [{ p: [0, 'x'], kind: 'corner' }, { p: [1, 1], kind: 'corner' }] }] });
    expect(loadDraft('abc', s)).toBeNull();
    put({ ...triangle, paths: [{ closed: true, nodes: [{ p: [0, 0], kind: 'corner' }] }] });
    expect(loadDraft('abc', s)).toBeNull();
    put({ ...triangle, extrusion: 'spirale' });
    expect(loadDraft('abc', s)).toBeNull();
    put({ ...triangle, tolerance: 50 });
    expect(loadDraft('abc', s)).toBeNull();
    put({ ...triangle, revolveSegments: NaN });
    expect(loadDraft('abc', s)).toBeNull();
    put({ ...triangle, height: undefined });
    expect(loadDraft('abc', s)).toBeNull();
    put(null);
    expect(loadDraft('abc', s)).toBeNull();
    // I campi in più si scartano
    put({ ...triangle, extra: 'x' });
    expect(loadDraft('abc', s)).toEqual(triangle);
  });

  it('senza localStorage (ambiente node) o con uno che lancia errori nulla si rompe', () => {
    const broken = { getItem: () => { throw new Error('negato'); }, setItem: () => { throw new Error('pieno'); }, removeItem: () => { throw new Error('negato'); } };
    expect(() => {
      saveDraft('abc', triangle, broken);
      vi.advanceTimersByTime(500);
      clearDraft('abc', broken);
    }).not.toThrow();
    expect(loadDraft('abc', broken)).toBeNull();
    // Nessuno storage passato e nessun localStorage globale
    vi.stubGlobal('localStorage', undefined);
    expect(loadDraft('abc')).toBeNull();
    expect(() => clearDraft('abc')).not.toThrow();
    vi.unstubAllGlobals();
  });
});

describe('store della modale del Profilo', () => {
  it('apre su un nodo o su un Profilo nuovo e chiude', () => {
    expect(useProfileEditor.getState().target).toBeNull();
    useProfileEditor.getState().open({ nodeId: 'n1' });
    expect(useProfileEditor.getState().target).toEqual({ nodeId: 'n1' });
    useProfileEditor.getState().open({ new: true, at: [5, 6] });
    expect(useProfileEditor.getState().target).toEqual({ new: true, at: [5, 6] });
    useProfileEditor.getState().close();
    expect(useProfileEditor.getState().target).toBeNull();
  });
});

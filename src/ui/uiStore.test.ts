import { beforeEach, describe, expect, it } from 'vitest';
import { BED_LIMITS, DEFAULT_BED, MAX_RECENT, useUiStore } from './uiStore';

const st = () => useUiStore.getState();

beforeEach(() => {
  useUiStore.setState({ libraryFavorites: [], libraryRecent: [], libraryGroupsOpen: {} });
});

describe('Recenti, Preferiti e gruppi della libreria', () => {
  it('i Recenti mettono l\'ultimo in testa, senza ripetizioni e fino a un massimo', () => {
    st().pushLibraryRecent('symbols:★');
    st().pushLibraryRecent('emoji:😂');
    st().pushLibraryRecent('symbols:★');
    expect(st().libraryRecent).toEqual(['symbols:★', 'emoji:😂']);

    for (let i = 0; i < MAX_RECENT + 5; i++) st().pushLibraryRecent(`symbols:${i}`);
    expect(st().libraryRecent).toHaveLength(MAX_RECENT);
    // Il più recente è il primo
    expect(st().libraryRecent[0]).toBe(`symbols:${MAX_RECENT + 4}`);
  });

  it('i Preferiti si aggiungono e si tolgono con lo stesso comando', () => {
    st().toggleLibraryFavorite('emoji:😂');
    st().toggleLibraryFavorite('symbols:★');
    expect(st().libraryFavorites).toEqual(['emoji:😂', 'symbols:★']);
    st().toggleLibraryFavorite('emoji:😂');
    expect(st().libraryFavorites).toEqual(['symbols:★']);
  });

  it('apre e chiude insieme più gruppi senza toccare gli altri', () => {
    st().setLibraryGroupOpen('symbols:Frecce', true);
    st().setLibraryGroupsOpen(['emoji:A', 'emoji:B'], true);
    expect(st().libraryGroupsOpen).toEqual({ 'symbols:Frecce': true, 'emoji:A': true, 'emoji:B': true });
    st().setLibraryGroupsOpen(['emoji:A', 'emoji:B'], false);
    expect(st().libraryGroupsOpen).toEqual({ 'symbols:Frecce': true, 'emoji:A': false, 'emoji:B': false });
  });
});

describe('Dimensioni del piano', () => {
  it('parte da 256 × 256, accetta valori validi e li limita tra 20 e 2000 mm', () => {
    useUiStore.setState({ bedSize: DEFAULT_BED });
    expect(st().bedSize).toEqual({ width: 256, depth: 256 });
    st().setBedSize({ width: 300, depth: 180.04 });
    expect(st().bedSize).toEqual({ width: 300, depth: 180 });
    st().setBedSize({ width: 5, depth: 99999 });
    expect(st().bedSize).toEqual({ width: BED_LIMITS.min, depth: BED_LIMITS.max });
  });

  it('un valore non valido lascia quello precedente e un solo lato si cambia da solo', () => {
    useUiStore.setState({ bedSize: { width: 220, depth: 220 } });
    st().setBedSize({ width: Number.NaN });
    expect(st().bedSize).toEqual({ width: 220, depth: 220 });
    st().setBedSize({ depth: 350 });
    expect(st().bedSize).toEqual({ width: 220, depth: 350 });
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_RECENT, useUiStore } from './uiStore';

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

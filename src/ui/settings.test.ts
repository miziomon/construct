import { beforeEach, describe, expect, it } from 'vitest';
import { cleanSettings, DEFAULT_BED, DEFAULT_SETTINGS, SETTING_LIMITS, useUiStore } from './uiStore';
import { useSceneStore } from '../scene/store';
import { importScad } from '../import/scad/toScene';
import { platesOf } from '../scene/plates';

beforeEach(() => {
  useUiStore.getState().resetSettings();
  useSceneStore.getState().loadScene({ nodes: {}, rootIds: [] });
  useSceneStore.temporal.getState().clear();
});

describe('impostazioni', () => {
  it('i valori mancanti o assurdi tornano ai predefiniti, quelli fuori limite si riportano nei limiti', () => {
    expect(cleanSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings({ nudgeStep: 'x', snapRotate: Number.NaN, autosave: 'sì', showDimensions: 0 })).toEqual(DEFAULT_SETTINGS);
    const clamped = cleanSettings({ nudgeStep: 9999, snapMove: 0, snapRotate: 500 });
    expect(clamped.nudgeStep).toBe(SETTING_LIMITS.nudgeStep.max);
    expect(clamped.snapMove).toBe(SETTING_LIMITS.snapMove.min);
    expect(clamped.snapRotate).toBe(SETTING_LIMITS.snapRotate.max);
  });

  it('il benvenuto compare a ogni avvio di default, ma chi ha salvato false lo mantiene', () => {
    expect(DEFAULT_SETTINGS.welcomeAlways).toBe(true);
    expect(cleanSettings({}).welcomeAlways).toBe(true);
    expect(cleanSettings({ welcomeAlways: false }).welcomeAlways).toBe(false);
  });

  it('setSettings cambia solo quanto richiesto e rispetta i limiti', () => {
    useUiStore.getState().setSettings({ nudgeStep: 2.5, autosave: false });
    const s = useUiStore.getState();
    expect(s.nudgeStep).toBe(2.5);
    expect(s.autosave).toBe(false);
    expect(s.snapMove).toBe(DEFAULT_SETTINGS.snapMove);
    useUiStore.getState().setSettings({ snapRotate: 1000 });
    expect(useUiStore.getState().snapRotate).toBe(SETTING_LIMITS.snapRotate.max);
  });

  it('resetSettings riporta impostazioni, tema e piano ai valori iniziali', () => {
    const ui = useUiStore.getState();
    ui.setSettings({ nudgeStep: 5, showDimensions: false, welcomeAlways: false });
    useUiStore.setState({ theme: 'dark', bedMode: 'none', bedSize: { width: 400, depth: 300 } });
    useUiStore.getState().resetSettings();
    const s = useUiStore.getState();
    expect(s).toMatchObject({ ...DEFAULT_SETTINGS, theme: 'light', bedMode: 'full', bedSize: DEFAULT_BED });
  });
});

describe('importazione di un file OpenSCAD nel progetto', () => {
  const st = () => useSceneStore.getState();

  it('aggiunge gli oggetti in un solo passo di Annulla e li seleziona', () => {
    const before = useSceneStore.temporal.getState().pastStates.length;
    const roots = st().importScad(importScad('cube(10); translate([20, 0, 0]) sphere(4);'), 'prova.scad');
    expect(roots).toBe(2);
    expect(st().scene.rootIds).toHaveLength(2);
    expect(st().selection).toEqual(st().scene.rootIds);
    expect(useSceneStore.temporal.getState().pastStates.length).toBe(before + 1);
    useSceneStore.temporal.getState().undo();
    expect(st().scene.rootIds).toHaveLength(0);
    expect(Object.keys(st().scene.nodes)).toHaveLength(0);
  });

  it('i nomi restano unici anche importando due volte lo stesso file', () => {
    st().importScad(importScad('cube(5);'), 'a.scad');
    st().importScad(importScad('cube(5);'), 'a.scad');
    expect(Object.values(st().scene.nodes).map((n) => n.name).sort()).toEqual(['Cubo', 'Cubo 2']);
  });

  it('un file con due piatti crea il secondo piatto con il suo nome, senza cambiare quello in vista', () => {
    st().importScad(
      importScad('// === Piatto 1: Base ===\nmodule piatto_1() { cube(5); }\n// === Piatto 2: Tappo ===\nmodule piatto_2() { sphere(3); }\npiatto_1();\ntranslate([276, 0, 0]) piatto_2();'),
      'piatti.scad',
    );
    const plates = platesOf(st().scene);
    expect(plates).toHaveLength(2);
    expect(plates[1].name).toBe('Tappo');
    expect(plates[1].rootIds).toHaveLength(1);
    // Il piatto in vista ha il suo cubo
    expect(st().scene.rootIds).toHaveLength(1);
    expect(st().scene.nodes[st().scene.rootIds[0]]).toMatchObject({ kind: 'box' });
  });

  it('un file senza nulla da importare non cambia la scena', () => {
    expect(st().importScad(importScad('cube(;'), 'rotto.scad')).toBe(0);
    expect(st().scene.rootIds).toHaveLength(0);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { applicableGroups, COMMANDS, COMMAND_GROUPS, getCommandContext, helpOf } from './commands';
import { TOOLBAR_HELP } from './Toolbar/toolbarHelp';
import { useSceneStore } from '../scene/store';

/** Id dei comandi applicabili adesso (quelli che il menu contestuale mostra). */
const applicable = () => applicableGroups(getCommandContext()).flatMap((g) => g.commands.map((c) => c.id));

beforeEach(() => {
  useSceneStore.getState().loadScene({ nodes: {}, rootIds: [] });
});

describe('registro dei comandi', () => {
  it('ogni comando sta in un solo gruppo e ogni voce ha il suo aiuto', () => {
    const ids = COMMAND_GROUPS.flatMap((g) => g.ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(Object.keys(COMMANDS).sort());
    const c = getCommandContext();
    for (const cmd of Object.values(COMMANDS)) expect(TOOLBAR_HELP[helpOf(cmd, c)]).toBeDefined();
  });

  it('senza oggetti nessun comando di selezione è applicabile', () => {
    expect(applicable()).toEqual([]);
  });

  it('un solo oggetto: niente Unisci, Raggruppa, Allinea; sì Duplica, Elimina, Specchia, Blocca', () => {
    const s = useSceneStore.getState();
    s.addPrimitive('box');
    const ids = applicable();
    for (const id of ['duplicate', 'delete', 'mirror', 'lock', 'hole', 'drop', 'shell', 'pattern', 'array'] as const) expect(ids).toContain(id);
    for (const id of ['union', 'group', 'hull', 'align', 'ungroup'] as const) expect(ids).not.toContain(id);
  });

  it('due oggetti: compaiono le booleane e Allinea', () => {
    const s = useSceneStore.getState();
    s.addPrimitive('box');
    s.addPrimitive('cylinder');
    s.select(useSceneStore.getState().scene.rootIds);
    const ids = applicable();
    for (const id of ['union', 'group', 'hull', 'align'] as const) expect(ids).toContain(id);
  });

  it('il menu non include le modalità del gizmo e un gruppo selezionato offre Separa', () => {
    const s = useSceneStore.getState();
    s.addPrimitive('box');
    s.addPrimitive('box');
    s.select(useSceneStore.getState().scene.rootIds);
    s.unionSelected();
    const ids = applicable();
    expect(ids).toContain('ungroup');
    for (const id of ['select', 'translate', 'rotate', 'resize', 'extrude'] as const) expect(ids).not.toContain(id);
  });

  it('un oggetto bloccato si può solo sbloccare o eliminare, non specchiare', () => {
    const s = useSceneStore.getState();
    s.addPrimitive('box');
    s.toggleLockSelected();
    const c = getCommandContext();
    expect(helpOf(COMMANDS.lock, c)).toBe('unlock');
    expect(COMMANDS.mirror.enabled(c)).toBe(false);
    expect(COMMANDS.lock.enabled(c)).toBe(true);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { applicableGroups, COMMANDS, COMMAND_GROUPS, getCommandContext, helpOf, isUsable } from './commands';
import { useEdgeTool } from './EdgeTool/edgeToolStore';
import { useSplitTool } from './Split/splitToolStore';
import { TOOLBAR_HELP } from './Toolbar/toolbarHelp';
import { useResultStore } from '../kernel/useKernel';
import type { NodeMesh } from '../kernel/evaluate';
import { useSceneStore } from '../scene/store';

/** Id dei comandi che il menu contestuale mostra adesso per la selezione. */
const applicable = () => applicableGroups(getCommandContext()).flatMap((g) => g.commands.map((c) => c.id));

/** Mesh finta con il solo ingombro: al menu serve per sapere se l'oggetto poggia sul piatto. */
const meshAt = (rootId: string, minZ: number) => ({ id: rootId, rootId, path: [rootId], empty: false, bbox: { min: [0, 0, minZ], max: [10, 10, minZ + 10] } }) as NodeMesh;

beforeEach(() => {
  useSceneStore.getState().loadScene({ nodes: {}, rootIds: [] });
  useResultStore.setState({ meshes: [] });
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

  it('un solo cubo: niente Unisci, Raggruppa, Allinea, Separa; sì Duplica, Elimina, Specchia, Blocca, Raccordo', () => {
    useSceneStore.getState().addPrimitive('box');
    const ids = applicable();
    for (const id of ['duplicate', 'delete', 'mirror', 'lock', 'hole', 'shell', 'pattern', 'array', 'fillet', 'chamfer', 'corner', 'layflat', 'lay', 'split'] as const) expect(ids).toContain(id);
    for (const id of ['union', 'group', 'hull', 'minkowski', 'align', 'ungroup'] as const) expect(ids).not.toContain(id);
  });

  it('due oggetti: compaiono le booleane e Allinea, ma non gli strumenti sulle facce né Separa', () => {
    const s = useSceneStore.getState();
    s.addPrimitive('box');
    s.addPrimitive('cylinder');
    s.select(useSceneStore.getState().scene.rootIds);
    const ids = applicable();
    for (const id of ['union', 'group', 'hull', 'minkowski', 'align'] as const) expect(ids).toContain(id);
    for (const id of ['fillet', 'chamfer', 'corner', 'layflat', 'ungroup'] as const) expect(ids).not.toContain(id);
  });

  it('Separa solo su un gruppo, e il menu non include le modalità del gizmo', () => {
    const s = useSceneStore.getState();
    s.addPrimitive('box');
    s.addPrimitive('box');
    s.select(useSceneStore.getState().scene.rootIds);
    s.unionSelected();
    const ids = applicable();
    expect(ids).toContain('ungroup');
    for (const id of ['select', 'translate', 'rotate', 'resize', 'extrude'] as const) expect(ids).not.toContain(id);
  });

  it('una sfera non ha facce piane: niente Raccordo, Smusso, Smusso angolare, Appoggia su una faccia', () => {
    useSceneStore.getState().addPrimitive('sphere');
    const ids = applicable();
    for (const id of ['fillet', 'chamfer', 'corner', 'layflat'] as const) expect(ids).not.toContain(id);
    expect(ids).toContain('duplicate');
  });

  it('Appoggia sul piatto compare solo se l\'oggetto non è già sul piatto', () => {
    useSceneStore.getState().addPrimitive('box');
    const id = useSceneStore.getState().scene.rootIds[0];
    useResultStore.setState({ meshes: [meshAt(id, 0)] });
    expect(applicable()).not.toContain('drop');
    useResultStore.setState({ meshes: [meshAt(id, 5)] });
    expect(applicable()).toContain('drop');
  });

  it('un oggetto bloccato offre solo Sblocca, Duplica, Nascondi e Misura', () => {
    const s = useSceneStore.getState();
    s.addPrimitive('box');
    s.toggleLockSelected();
    const c = getCommandContext();
    expect(helpOf(COMMANDS.lock, c)).toBe('unlock');
    expect(COMMANDS.mirror.enabled(c)).toBe(false);
    expect(applicable().sort()).toEqual(['duplicate', 'hide', 'lock', 'measure']);
  });

  it('Nascondi: con una selezione alla radice nasconde, senza selezione (e con nascosti) mostra tutti', () => {
    const s = useSceneStore.getState();
    // Senza oggetti non c'è nulla da nascondere né da mostrare
    expect(COMMANDS.hide.enabled(getCommandContext())).toBe(false);
    s.addPrimitive('box');
    let c = getCommandContext();
    expect(COMMANDS.hide.enabled(c)).toBe(true);
    expect(helpOf(COMMANDS.hide, c)).toBe('hide');
    expect(applicable()).toContain('hide');
    COMMANDS.hide.run(c);
    // Nascosto: la selezione si svuota, il comando offre "Mostra tutti" sulla barra ma non nel menu
    c = getCommandContext();
    expect(c.hasSelection).toBe(false);
    expect(c.someHidden).toBe(true);
    expect(helpOf(COMMANDS.hide, c)).toBe('showAll');
    expect(COMMANDS.hide.enabled(c)).toBe(true);
    expect(applicable()).not.toContain('hide');
    COMMANDS.hide.run(c);
    expect(getCommandContext().someHidden).toBe(false);
  });
});

describe('pulsanti utilizzabili solo quando servono sull\'oggetto selezionato', () => {
  const st = () => useSceneStore.getState();
  const on = (id: keyof typeof COMMANDS) => COMMANDS[id].enabled(getCommandContext());
  const lit = (id: keyof typeof COMMANDS) => COMMANDS[id].active?.(getCommandContext()) ?? false;

  it('Estrudi sta in Modifica, non in Trasforma', () => {
    const group = (label: string) => COMMAND_GROUPS.find((g) => g.label === label)!.ids;
    expect(group('Modifica')[0]).toBe('extrude');
    expect(group('Trasforma')).not.toContain('extrude');
  });

  it('senza selezione i modi del gizmo sono spenti e disabilitati, Seleziona resta sempre acceso', () => {
    st().addPrimitive('box');
    st().select([]);
    st().setGizmoMode('translate');
    for (const id of ['translate', 'rotate', 'resize', 'extrude'] as const) expect(on(id)).toBe(false);
    expect(lit('translate')).toBe(false);
    expect(on('select')).toBe(true);
    // Con un oggetto adatto Sposta torna utilizzabile e si riaccende (il modo era rimasto salvato)
    st().select(st().scene.rootIds);
    expect(on('translate')).toBe(true);
    expect(lit('translate')).toBe(true);
  });

  it('un oggetto bloccato, più oggetti o uno strumento aperto spengono il gizmo', () => {
    st().addPrimitive('box');
    st().addPrimitive('cone');
    st().setGizmoMode('translate');
    st().select(st().scene.rootIds);
    expect(on('translate')).toBe(false);
    st().select([st().scene.rootIds[0]]);
    expect(lit('translate')).toBe(true);
    st().toggleLockSelected();
    expect(on('translate')).toBe(false);
    expect(lit('translate')).toBe(false);
    // Anche Seleziona e Blocca restano utilizzabili su un bloccato
    expect(on('select')).toBe(true);
    expect(on('lock')).toBe(true);
  });

  it('Estrudi serve solo alle forme 2D lineari, Ridimensiona non alle mesh', () => {
    st().addPrimitive('box');
    expect(on('resize')).toBe(true);
    expect(on('extrude')).toBe(false);
    st().loadScene({ nodes: {}, rootIds: [] });
    st().addShape2D('circle');
    expect(on('extrude')).toBe(true);
    const id = st().scene.rootIds[0];
    st().updateNode(id, { extrusion: 'rotate' } as never);
    expect(on('extrude')).toBe(false);
    st().loadScene({ nodes: {}, rootIds: [] });
    st().addMesh({ assetId: 'a', name: 'Mesh', fileName: 'm.stl', origin: [0, 0, 0], size: [10, 10, 10], triangles: 12 });
    expect(on('translate')).toBe(true);
    expect(on('resize')).toBe(false);
  });

  it('Unisci e Allinea, Appoggia, Elimina e Solido/Foro rispettano i bloccati', () => {
    st().addPrimitive('box');
    st().addPrimitive('cone');
    const [a, b] = st().scene.rootIds;
    // Uno dei due bloccato: Unisci non ha due oggetti liberi, Allinea sì (il bloccato fa da riferimento)
    st().select([a]);
    st().toggleLockSelected();
    st().select([a, b]);
    expect(on('union')).toBe(false);
    expect(on('align')).toBe(true);
    expect(on('delete')).toBe(true);
    expect(on('hole')).toBe(true);
    // Solo bloccati: niente Elimina, Solido/Foro, Appoggia sul piatto, Allinea
    st().select([a]);
    for (const id of ['delete', 'hole', 'drop', 'mirror', 'lay'] as const) expect(on(id)).toBe(false);
    expect(on('duplicate')).toBe(true);
  });

  it('Raccordo, Smusso e Appoggia su una faccia hanno bisogno di un oggetto libero nella scena', () => {
    expect(on('fillet')).toBe(false);
    st().addPrimitive('box');
    for (const id of ['fillet', 'chamfer', 'corner', 'layflat'] as const) expect(on(id)).toBe(true);
    st().toggleLockSelected();
    for (const id of ['fillet', 'chamfer', 'corner', 'layflat'] as const) expect(on(id)).toBe(false);
  });

  it('Separa non funziona su un gruppo bloccato', () => {
    st().addPrimitive('box');
    st().addPrimitive('cone');
    st().select(st().scene.rootIds);
    st().groupSelected();
    expect(on('ungroup')).toBe(true);
    st().toggleLockSelected();
    expect(on('ungroup')).toBe(false);
  });
});

describe('barra con uno strumento a pannello aperto', () => {
  const st = () => useSceneStore.getState();
  const usable = (id: keyof typeof COMMANDS) => isUsable(COMMANDS[id], getCommandContext());

  it('senza strumenti aperti isUsable coincide con enabled', () => {
    st().addPrimitive('box');
    for (const cmd of Object.values(COMMANDS)) expect(isUsable(cmd, getCommandContext())).toBe(cmd.enabled(getCommandContext()));
  });

  it('con Dividi aperto restano utilizzabili solo il suo pulsante e nient\'altro', () => {
    st().addPrimitive('box');
    useSplitTool.setState({ active: true });
    try {
      expect(getCommandContext().toolActive).toBe(true);
      expect(usable('split')).toBe(true);
      for (const id of ['select', 'translate', 'duplicate', 'delete', 'lock', 'hide', 'hole', 'shell', 'fillet', 'measure', 'mirror', 'drop'] as const) expect(usable(id), id).toBe(false);
    } finally {
      useSplitTool.setState({ active: false });
    }
  });

  it('con Raccordo aperto si può passare a Smusso e Smusso angolare, ma non agli altri strumenti', () => {
    st().addPrimitive('box');
    useEdgeTool.setState({ tool: 'fillet' });
    try {
      for (const id of ['fillet', 'chamfer', 'corner'] as const) expect(usable(id), id).toBe(true);
      for (const id of ['split', 'shell', 'measure', 'layflat', 'duplicate'] as const) expect(usable(id), id).toBe(false);
    } finally {
      useEdgeTool.setState({ tool: null });
    }
  });
});

describe('Modifica profilo (D6)', () => {
  const rect = { closed: true, nodes: [{ p: [0, 0] as [number, number], kind: 'corner' as const }, { p: [10, 0] as [number, number], kind: 'corner' as const }, { p: [10, 10] as [number, number], kind: 'corner' as const }] };

  it('non ha un pulsante sulla barra e sta nel gruppo Modifica', () => {
    expect(COMMANDS.profile.toolbar).toBe(false);
    expect(COMMAND_GROUPS.find((g) => g.label === 'Modifica')!.ids).toContain('profile');
    expect(COMMANDS.profile.shortcut).toBe('⇧P');
  });

  it('si può usare solo con un solo Profilo non bloccato selezionato', () => {
    expect(COMMANDS.profile.enabled(getCommandContext())).toBe(false);
    useSceneStore.getState().addPrimitive('box');
    expect(applicable()).not.toContain('profile');
    const id = useSceneStore.getState().addPath({ paths: [rect] });
    expect(COMMANDS.profile.enabled(getCommandContext())).toBe(true);
    expect(applicable()).toContain('profile');
    // Due oggetti selezionati: no
    useSceneStore.getState().select(useSceneStore.getState().scene.rootIds);
    expect(applicable()).not.toContain('profile');
    // Bloccato: no, né nel menu
    useSceneStore.getState().select([id]);
    useSceneStore.getState().toggleLockSelected();
    expect(COMMANDS.profile.enabled(getCommandContext())).toBe(false);
    expect(applicable()).not.toContain('profile');
  });

  it('run apre la modale sul nodo', async () => {
    const { useProfileEditor } = await import('./ProfileEditor/profileEditorStore');
    const id = useSceneStore.getState().addPath({ paths: [rect] });
    COMMANDS.profile.run(getCommandContext());
    expect(useProfileEditor.getState().target).toEqual({ nodeId: id });
    useProfileEditor.getState().close();
  });
});

describe('Converti in profilo', () => {
  it('non ha un pulsante sulla barra né una scorciatoia e sta nel gruppo Modifica', () => {
    expect(COMMANDS.toPath.toolbar).toBe(false);
    expect(COMMANDS.toPath.shortcut).toBe('');
    expect(COMMAND_GROUPS.find((g) => g.label === 'Modifica')!.ids).toContain('toPath');
  });

  it('si può usare solo con una forma 2D non bloccata che non sia Testo né Profilo', () => {
    const st = () => useSceneStore.getState();
    expect(COMMANDS.toPath.enabled(getCommandContext())).toBe(false);
    st().addPrimitive('box');
    expect(applicable()).not.toContain('toPath');
    st().addShape2D('circle');
    expect(applicable()).toContain('toPath');
    // Due oggetti selezionati: no
    st().select(st().scene.rootIds);
    expect(applicable()).not.toContain('toPath');
    // Testo e Profilo: no
    st().addShape2D('text');
    expect(applicable()).not.toContain('toPath');
    st().addPath({ paths: [{ closed: true, nodes: [{ p: [0, 0], kind: 'corner' }, { p: [10, 0], kind: 'corner' }, { p: [10, 10], kind: 'corner' }] }] });
    expect(applicable()).not.toContain('toPath');
    // Bloccata: no
    st().addShape2D('square');
    st().toggleLockSelected();
    expect(COMMANDS.toPath.enabled(getCommandContext())).toBe(false);
    expect(applicable()).not.toContain('toPath');
  });

  it('run converte la forma selezionata in un Profilo, in un solo passo', () => {
    const st = () => useSceneStore.getState();
    st().addShape2D('square');
    const [id] = st().scene.rootIds;
    const steps = useSceneStore.temporal.getState().pastStates.length;
    COMMANDS.toPath.run(getCommandContext());
    expect(st().scene.nodes[id]).toMatchObject({ kind: 'path' });
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(steps + 1);
  });
});

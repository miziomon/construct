import { beforeEach, describe, expect, it } from 'vitest';
import { isHidden, isLocked, useSceneStore } from './store';
import { useNotifyStore } from '../ui/notify/notifyStore';
import { composeTransform, eulerToMatrix, matrixToEuler } from './math';
import { draftFromNode, pathCenter } from '../ui/ProfileEditor/model';
import { bboxOf } from './bezier';
import { pathContours, pathNaturalSize } from './shapes2d';
import { scalePercent } from './resize';
import type { Shape2DNode } from './types';

const st = () => useSceneStore.getState();
const undo = () => useSceneStore.temporal.getState().undo();

beforeEach(() => {
  st().clear();
  useSceneStore.temporal.getState().clear();
});

describe('store della scena', () => {
  it('aggiunge una primitiva appoggiata sul piatto e la seleziona', () => {
    st().addPrimitive('box');
    const [id] = st().scene.rootIds;
    expect(st().scene.nodes[id].position).toEqual([0, 0, 10]); // metà dell'altezza di 20 mm
    expect(st().selection).toEqual([id]);
    st().addPrimitive('box');
    expect(Object.values(st().scene.nodes).map((x) => x.name)).toEqual(['Cubo', 'Cubo 2']);
  });

  it('raggruppa mantenendo le posizioni nel mondo e separa ripristinandole', () => {
    st().addPrimitive('box');
    st().addPrimitive('sphere');
    const [a, b] = st().scene.rootIds;
    st().updateNode(a, { position: [10, 0, 10] });
    st().updateNode(b, { position: [30, 0, 10] });
    st().select([a, b]);
    st().groupSelected();
    const [gid] = st().scene.rootIds;
    const g = st().scene.nodes[gid];
    expect(g.type).toBe('group');
    expect(g.position).toEqual([20, 0, 10]);
    expect(st().scene.nodes[a].position).toEqual([-10, 0, 0]);

    // Ruoto il gruppo di 90° attorno a Z: separandolo, i figli devono finire dove sono nel mondo
    st().updateNode(gid, { rotation: [0, 0, 90] });
    st().ungroupSelected();
    expect(st().scene.rootIds).toEqual([a, b]);
    const pa = st().scene.nodes[a].position;
    expect(pa[0]).toBeCloseTo(20, 3);
    expect(pa[1]).toBeCloseTo(-10, 3);
    expect(st().scene.nodes[a].rotation[2]).toBeCloseTo(90, 3);
    expect(st().scene.nodes[gid]).toBeUndefined();
  });

  it('toggle solid/hole, duplica ed elimina', () => {
    st().addPrimitive('cylinder');
    const [id] = st().scene.rootIds;
    st().toggleHoleSelected();
    expect(st().scene.nodes[id].mode).toBe('hole');
    st().duplicateSelected();
    expect(st().scene.rootIds).toHaveLength(2);
    expect(st().selection).not.toContain(id);
    // La copia resta nelle stesse coordinate dell'originale, già selezionata e in cima all'elenco
    const copy = st().selection[0];
    expect(st().scene.rootIds[0]).toBe(copy);
    expect(st().scene.nodes[copy].position).toEqual(st().scene.nodes[id].position);
    expect(st().scene.nodes[copy].rotation).toEqual(st().scene.nodes[id].rotation);
    st().removeSelected();
    expect(st().scene.rootIds).toEqual([id]);
  });

  it('undo e redo ripristinano la scena ma non la selezione', () => {
    st().addPrimitive('box');
    st().addPrimitive('cone');
    expect(st().scene.rootIds).toHaveLength(2);
    undo();
    expect(st().scene.rootIds).toHaveLength(1);
    useSceneStore.temporal.getState().redo();
    expect(st().scene.rootIds).toHaveLength(2);
  });

  it('euler ⇄ matrice sono inversi', () => {
    for (const r of [[10, 20, 30], [-45, 60, 170], [0, 0, 90], [90, 0, 0]] as const) {
      const back = matrixToEuler(eulerToMatrix([...r]));
      r.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 6));
    }
    const w = composeTransform({ position: [1, 2, 3], rotation: [0, 0, 90] }, { position: [1, 0, 0], rotation: [0, 0, 0] });
    expect(w.position[0]).toBeCloseTo(1, 6);
    expect(w.position[1]).toBeCloseTo(3, 6);
  });

  describe('blocco oggetti', () => {
    it('un oggetto bloccato non si sposta, non si elimina e non si modifica nella geometria', () => {
      st().addPrimitive('box');
      const [id] = st().scene.rootIds;
      st().toggleLockSelected();
      expect(st().scene.nodes[id].locked).toBe(true);

      st().nudgeSelected([10, 0, 0]);
      st().updateNode(id, { position: [50, 50, 50] });
      st().updateNode(id, { size: [5, 5, 5] } as never);
      st().toggleHoleSelected();
      st().removeSelected();
      const n = st().scene.nodes[id];
      expect(n.position).toEqual([0, 0, 10]);
      expect(n.mode).toBe('solid');
      expect(st().scene.rootIds).toEqual([id]);

      // Nome e colore restano modificabili
      st().updateNode(id, { name: 'Base', color: '#ff0000' });
      expect(st().scene.nodes[id].name).toBe('Base');

      // Sbloccando torna tutto possibile
      st().toggleLockSelected();
      st().nudgeSelected([10, 0, 0]);
      expect(st().scene.nodes[id].position[0]).toBe(10);
    });

    it('un gruppo bloccato blocca anche i figli; la copia nasce sbloccata', () => {
      st().addPrimitive('box');
      st().addPrimitive('sphere');
      st().select(st().scene.rootIds);
      st().groupSelected();
      const [gid] = st().scene.rootIds;
      const child = (st().scene.nodes[gid] as { children: string[] }).children[0];
      st().toggleLockSelected();
      expect(isLocked(st().scene, child)).toBe(true);
      st().updateNode(child, { position: [99, 0, 0] });
      expect(st().scene.nodes[child].position[0]).not.toBe(99);

      st().duplicateSelected();
      const copy = st().selection[0];
      expect(st().scene.nodes[copy].locked).toBe(false);
      expect(st().scene.nodes[gid].locked).toBe(true);
    });

    it('i bloccati non entrano nei gruppi e non si separano', () => {
      st().addPrimitive('box');
      st().addPrimitive('cone');
      const [a, b] = st().scene.rootIds;
      st().select([a]);
      st().toggleLockSelected();
      st().select([a, b]);
      st().groupSelected(); // resta un solo oggetto sbloccato: nessun gruppo
      expect(st().scene.rootIds).toEqual([a, b]);
    });
  });

  describe('oggetti nascosti', () => {
    it('nascondere toglie dalla selezione e select ignora i nascosti', () => {
      st().addPrimitive('box');
      st().addPrimitive('cone');
      const [a, b] = st().scene.rootIds;
      st().select([a]);
      st().hideSelected();
      expect(st().scene.nodes[a].hidden).toBe(true);
      expect(st().scene.nodes[b].hidden).toBeUndefined();
      expect(st().selection).toEqual([]);
      st().select([a, b]);
      expect(st().selection).toEqual([b]);
    });

    it('un figlio di un gruppo nascosto risulta nascosto; un figlio da solo non si nasconde', () => {
      st().addPrimitive('box');
      st().addPrimitive('sphere');
      st().select(st().scene.rootIds);
      st().groupSelected();
      const [gid] = st().scene.rootIds;
      const child = (st().scene.nodes[gid] as { children: string[] }).children[0];
      st().select([child]);
      st().hideSelected();
      expect(st().scene.nodes[child].hidden).toBeUndefined();
      st().setHidden(gid, true);
      expect(isHidden(st().scene, child)).toBe(true);
      st().select([child]);
      expect(st().selection).toEqual([]);
    });

    it('setHidden agisce anche su un oggetto bloccato, Mostra tutti li rimostra e ogni azione è un solo passo', () => {
      st().addPrimitive('box');
      st().addPrimitive('cone');
      const [a, b] = st().scene.rootIds;
      st().select([a]);
      st().toggleLockSelected();
      const steps = () => useSceneStore.temporal.getState().pastStates.length;
      const before = steps();
      st().setHidden(a, true);
      st().setHidden(b, true);
      expect(steps()).toBe(before + 2);
      st().showAllHidden();
      expect(steps()).toBe(before + 3);
      expect(st().scene.nodes[a].hidden).toBeUndefined();
      expect(st().scene.nodes[b].hidden).toBeUndefined();
      undo();
      expect(st().scene.nodes[a].hidden).toBe(true);
    });
  });

  it('dropToBed abbassa gli oggetti selezionati fino al piatto e ignora i bloccati', () => {
    st().addPrimitive('box');
    st().addPrimitive('box');
    const [a, b] = st().scene.rootIds;
    st().updateNode(a, { position: [0, 0, 35] });
    st().updateNode(b, { position: [0, 0, 35] });
    st().select([b]);
    st().toggleLockSelected();
    st().select([a, b]);
    // Il kernel dice che il punto più basso di entrambi è a Z = 25
    st().dropToBed({ [a]: 25, [b]: 25 });
    expect(st().scene.nodes[a].position[2]).toBe(10);
    expect(st().scene.nodes[b].position[2]).toBe(35);
  });

  describe('operazioni booleane rapide', () => {
    it('combineSelected rispetta l ordine di selezione e cycleBase cambia la base', () => {
      st().addPrimitive('box');
      st().addPrimitive('sphere');
      const [a, b] = st().scene.rootIds;
      // Seleziono prima la sfera, poi la scatola: la sfera sarà la base
      st().select([b]);
      st().select([a], true);
      st().combineSelected('difference');
      const [gid] = st().scene.rootIds;
      const g = st().scene.nodes[gid];
      expect(g.type === 'group' && g.op).toBe('difference');
      expect(g.type === 'group' && g.children).toEqual([b, a]);
      expect(g.name).toBe('Differenza');

      st().cycleBase(gid);
      const after = st().scene.nodes[gid];
      expect(after.type === 'group' && after.children).toEqual([a, b]);
    });
  });
});

describe('etichette della timeline', () => {
  /** Etichette in ordine cronologico: passati, corrente, futuri. */
  const labels = () => {
    const t = useSceneStore.temporal.getState();
    return [...t.pastStates.map((p) => p.op), st().op, ...[...t.futureStates].reverse().map((p) => p.op)];
  };

  it('ogni stato porta il nome dell\'operazione che lo ha prodotto', () => {
    st().addPrimitive('box');
    const [id] = st().scene.rootIds;
    st().updateNode(id, { position: [5, 0, 10] });
    st().updateNode(id, { size: [30, 20, 20] });
    st().updateNode(id, { name: 'Mio cubo' });
    expect(labels()).toEqual(['Nuovo progetto', 'Aggiungi Cubo', 'Sposta Cubo', 'Modifica Cubo', 'Rinomina Cubo']);
  });

  it('undo e redo riportano anche l\'etichetta e la lista resta completa', () => {
    st().addPrimitive('box');
    st().addPrimitive('sphere');
    undo();
    expect(st().op).toBe('Aggiungi Cubo');
    expect(labels()).toEqual(['Nuovo progetto', 'Aggiungi Cubo', 'Aggiungi Sfera']);
    useSceneStore.temporal.getState().redo();
    expect(st().op).toBe('Aggiungi Sfera');
  });

  it('un salto di più passi funziona come una serie di undo', () => {
    st().addPrimitive('box');
    st().addPrimitive('sphere');
    st().addPrimitive('cone');
    useSceneStore.temporal.getState().undo(3);
    expect(st().scene.rootIds).toHaveLength(0);
    expect(labels()).toEqual(['Nuovo progetto', 'Aggiungi Cubo', 'Aggiungi Sfera', 'Aggiungi Cono']);
    useSceneStore.temporal.getState().redo(2);
    expect(st().scene.rootIds).toHaveLength(2);
    expect(st().op).toBe('Aggiungi Sfera');
  });

  it('con la cronologia in pausa lo stato corrente non cambia nome', () => {
    st().addPrimitive('box');
    const [id] = st().scene.rootIds;
    useSceneStore.temporal.getState().pause();
    st().updateNode(id, { position: [9, 9, 10] });
    useSceneStore.temporal.getState().resume();
    expect(st().op).toBe('Aggiungi Cubo');
  });

  it('un\'azione che non cambia nulla non rinomina lo stato', () => {
    st().addPrimitive('box');
    st().select([]);
    st().dropToBed({});
    expect(st().op).toBe('Aggiungi Cubo');
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1);
  });

  it('Inviluppo convesso: crea un gruppo hull dai due oggetti e Separa lo scioglie', () => {
    st().addPrimitive('box');
    st().addPrimitive('sphere');
    const [a, b] = st().scene.rootIds;
    st().updateNode(a, { position: [-20, 0, 10] });
    st().updateNode(b, { position: [20, 0, 10] });
    st().select([a, b]);
    st().combineSelected('hull');
    const [gid] = st().scene.rootIds;
    expect(st().scene.rootIds).toHaveLength(1);
    expect(st().scene.nodes[gid]).toMatchObject({ type: 'group', op: 'hull', name: 'Inviluppo convesso' });
    st().ungroupSelected();
    expect(st().scene.rootIds).toHaveLength(2);
  });
});

describe('addPath: Profilo di Bézier', () => {
  const corner = (p: [number, number]) => ({ p, kind: 'corner' as const });
  const rect = { closed: true, nodes: [corner([0, 0]), corner([40.123456, -0]), corner([40, 20]), corner([0, 20])] };

  it('crea il Profilo in un solo passo, con i nodi a 4 decimali, le misure naturali e il lucchetto chiuso', () => {
    const id = st().addPath({ paths: [rect], height: 6 });
    expect(st().op).toBe('Aggiungi Profilo');
    // Un solo passo oltre allo stato iniziale
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1);
    const node = st().scene.nodes[id];
    expect(node).toMatchObject({ type: 'shape2d', kind: 'path', name: 'Profilo', width: 40.1235, depth: 20, height: 6, lockRatio: true, tolerance: 0.05 });
    expect(node.position).toEqual([0, 0, 3]);
    expect(Object.is((node as { paths: typeof rect[] }).paths[0].nodes[1].p[1], 0)).toBe(true);
    expect(st().selection).toEqual([id]);
    expect(st().scene.rootIds).toEqual([id]);
  });

  it('torsione e scala della cima del disegno arrivano al nodo', () => {
    const id = st().addPath({ paths: [rect], twist: 45, scaleTop: 0.5 });
    expect(st().scene.nodes[id]).toMatchObject({ twist: 45, scaleTop: 0.5 });
  });

  it('un solo Annulla toglie il Profilo; in rotazione sta appoggiato sul piatto con metà profondità', () => {
    const id = st().addPath({ paths: [rect], extrusion: 'rotate', at: [5, 7], name: 'Bicchiere' });
    expect(st().scene.nodes[id]).toMatchObject({ name: 'Bicchiere', extrusion: 'rotate', position: [5, 7, 10] });
    undo();
    expect(st().scene.rootIds).toEqual([]);
  });
});

describe('commitProfile: applica il disegno della modale', () => {
  type PathNodeShape = Extract<Shape2DNode, { kind: 'path' }>;
  const corner = (p: [number, number]) => ({ p, kind: 'corner' as const });
  const rect = { closed: true, nodes: [corner([0, 0]), corner([40, 0]), corner([40, 20]), corner([0, 20])] };
  const bigger = { closed: true, nodes: [corner([0, 0]), corner([60.123456, 0]), corner([60, 30]), corner([0, 30])] };
  const get = (id: string) => st().scene.nodes[id] as PathNodeShape;
  const draftOf = (id: string, patch: object = {}) => ({ ...draftFromNode(get(id)), ...patch });

  it('in un solo passo "Profilo": nodi a 4 decimali, parametri, misure naturali e posizione compensata', () => {
    const id = st().addPath({ paths: [rect], height: 6, at: [10, 20] });
    useSceneStore.temporal.getState().clear();
    const draft = { ...draftOf(id, { paths: [bigger], extrusion: 'linear' as const, height: 9, twist: 30, scaleTop: 0.5, tolerance: 0.1 }) };
    // Il centro del disegno passa da (20, 10) a (30.0617, 15)
    expect(st().commitProfile(id, draft, { before: [20, 10], after: pathCenter(draft) })).toBe(true);
    expect(st().op).toBe('Profilo');
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1);
    const node = get(id);
    expect(node).toMatchObject({ width: 60.1235, depth: 30, height: 9, twist: 30, scaleTop: 0.5, tolerance: 0.1, extrusion: 'linear' });
    expect(node.paths[0].nodes[1].p).toEqual([60.1235, 0]);
    // Posizione: [10, 20, 3] + (Δx, Δy, 0) con Δ = (30.0617 - 20, 15 - 10)
    expect(node.position[0]).toBeCloseTo(10 + 10.0617, 3);
    expect(node.position[1]).toBeCloseTo(25, 6);
    expect(node.position[2]).toBe(3);
    undo();
    expect(get(id)).toMatchObject({ width: 40, depth: 20, height: 6, position: [10, 20, 3] });
  });

  it('rifiuta un Profilo bloccato (anche dentro un gruppo bloccato) e un nodo che non è un Profilo', () => {
    const id = st().addPath({ paths: [rect] });
    const draft = draftOf(id, { paths: [bigger] });
    useSceneStore.temporal.getState().clear();
    st().updateNode(id, { locked: true });
    useSceneStore.temporal.getState().clear();
    expect(st().commitProfile(id, draft, { before: [0, 0], after: [0, 0] })).toBe(false);
    expect(get(id).paths[0].nodes[1].p).toEqual([40, 0]);
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(0);
    st().addPrimitive('box');
    expect(st().commitProfile(st().scene.rootIds[0], draft, { before: [0, 0], after: [0, 0] })).toBe(false);
    expect(st().commitProfile('inesistente', draft, { before: [0, 0], after: [0, 0] })).toBe(false);
  });

  it('con una misura legata a un parametro width e depth non si scrivono; i campi legati tengono il valore', () => {
    const id = st().addPath({ paths: [rect], height: 6 });
    st().updateNode(id, { exprs: { width: { expr: '40' }, height: { expr: '6' } } });
    // Con una misura legata il disegno non si incorpora: i nodi restano quelli del nodo
    expect(draftFromNode(get(id)).paths).toBe(get(id).paths);
    st().commitProfile(id, draftOf(id, { paths: [bigger], height: 9 }), { before: [20, 10], after: [20, 10] });
    // Il disegno cambia, la misura legata no (e l'altezza legata nemmeno)
    expect(get(id)).toMatchObject({ width: 40, depth: 20, height: 6 });
    expect(get(id).paths[0].nodes[1].p).toEqual([60.1235, 0]);
  });

  it('OK senza modifiche dopo l\'incorporazione: stesso ingombro e posizione, width e depth = disegno, Scala 100%', () => {
    const id = st().addPath({ paths: [rect], at: [5, 5] });
    // Ingrandito col gizmo: 80 × 60 su un disegno naturale di 40 × 20 (la scala sta in width e depth)
    st().updateNode(id, { width: 80, depth: 60 });
    const before = get(id);
    const boxBefore = bboxOf(pathContours(before))!;
    const draft = draftFromNode(before);
    st().commitProfile(id, draft, { before: pathCenter(draft), after: pathCenter(draft) });
    const after = get(id);
    expect(after.position).toEqual(before.position);
    expect(after).toMatchObject({ width: 80, depth: 60 });
    expect(pathNaturalSize(after)).toEqual({ width: 80, depth: 60 });
    expect(scalePercent(after)).toBeCloseTo(100, 9);
    const boxAfter = bboxOf(pathContours(after))!;
    for (const key of ['minX', 'maxX', 'minY', 'maxY'] as const) expect(boxAfter[key]).toBeCloseTo(boxBefore[key], 3);
  });
});

describe('convertToPath: Converti in profilo', () => {
  const toasts = () => useNotifyStore.getState().toasts.map((t) => t.text);

  beforeEach(() => useNotifyStore.setState({ toasts: [] }));

  it('in un solo passo "Converti in profilo": stesso id, il nodo diventa un Profilo e Annulla riporta il cerchio', () => {
    st().addShape2D('circle');
    const [id] = st().scene.rootIds;
    st().updateNode(id, { segments: 6, radius: 12 });
    const before = st().scene.nodes[id];
    useSceneStore.temporal.getState().clear();
    expect(st().convertToPath(id)).toBe(true);
    expect(st().op).toBe('Converti in profilo');
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1);
    expect(st().scene.rootIds).toEqual([id]);
    expect(st().selection).toEqual([id]);
    expect(st().scene.nodes[id]).toMatchObject({ id, kind: 'path', name: before.name, color: before.color, height: 10 });
    expect((st().scene.nodes[id] as Extract<Shape2DNode, { kind: 'path' }>).paths[0].nodes).toHaveLength(6);
    undo();
    expect(st().scene.nodes[id]).toEqual(before);
  });

  it('rifiuta un oggetto bloccato, il testo, un Profilo e un nodo che non è una forma 2D: nessun passo', () => {
    st().addShape2D('square');
    st().addShape2D('text');
    st().addPrimitive('box');
    const [box, text, square] = st().scene.rootIds;
    const path = st().addPath({ paths: [{ closed: true, nodes: [{ p: [0, 0], kind: 'corner' }, { p: [10, 0], kind: 'corner' }, { p: [10, 10], kind: 'corner' }] }] });
    st().updateNode(square, { locked: true });
    useSceneStore.temporal.getState().clear();
    for (const id of [square, text, path, box, 'inesistente']) expect(st().convertToPath(id)).toBe(false);
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(0);
    expect((st().scene.nodes[square] as Shape2DNode).kind).toBe('square');
    // Un avviso per il bloccato e uno per il testo
    expect(toasts().some((t) => t.includes('bloccato'))).toBe(true);
    expect(toasts().some((t) => t.includes('Il testo non si converte'))).toBe(true);
  });

  it('un disegno oltre i tetti viene rifiutato con il messaggio che rimanda all\'import nella modale', () => {
    st().addSvg({ name: 'grande', fileName: 'g.svg', contours: [Array.from({ length: 600 }, (_, i): [number, number] => [10 * Math.cos((2 * Math.PI * i) / 600), 10 * Math.sin((2 * Math.PI * i) / 600)])], width: 20, depth: 20 });
    const [id] = st().scene.rootIds;
    expect(st().convertToPath(id)).toBe(false);
    expect(toasts().join(' ')).toContain('importa il file SVG dentro la modale del Profilo');
    expect((st().scene.nodes[id] as Shape2DNode).kind).toBe('svg');
  });

  it('il cerchio con più di 12 lati diventa una curva e l\'utente lo sa; con 12 o meno no', () => {
    st().addShape2D('circle');
    const [id] = st().scene.rootIds;
    st().updateNode(id, { segments: 12 });
    expect(st().convertToPath(id)).toBe(true);
    expect(toasts()).toEqual([]);
    undo();
    st().updateNode(id, { segments: 64 });
    expect(st().convertToPath(id)).toBe(true);
    expect(toasts().join(' ')).toContain('il cerchio con 64 lati diventa una curva e il solido cambia di poco');
  });

  it('i legami che il Profilo non ha si perdono e l\'utente lo sa', () => {
    st().addShape2D('circle');
    const [id] = st().scene.rootIds;
    st().updateNode(id, { segments: 6, exprs: { radius: { expr: '12' }, height: { expr: '10' } } });
    expect(st().convertToPath(id)).toBe(true);
    expect(Object.keys(st().scene.nodes[id].exprs ?? {})).toEqual(['height']);
    expect(toasts().join(' ')).toContain('il legame di radius al parametro si perde');
  });
});

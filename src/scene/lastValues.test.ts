import { beforeEach, describe, expect, it } from 'vitest';
import { lastShape, lastTool, lastToolNumber, rememberShape, rememberTool, useLastValues } from './lastValues';
import { useSceneStore } from './store';

const st = () => useSceneStore.getState();

beforeEach(() => {
  useLastValues.setState({ shapes: {}, tools: { edge: {}, shell: {} } });
  st().clear();
  useSceneStore.temporal.getState().clear();
});

describe('ultimi valori usati', () => {
  it('ricorda solo le misure della forma e scarta posizione, nome, colore e testo', () => {
    rememberShape('cylinder', { radius: 7, height: 30, position: [1, 2, 3], name: 'x', color: '#fff', text: 'ciao' });
    expect(lastShape('cylinder')).toEqual({ radius: 7, height: 30 });
  });

  it('scarta i valori non validi e non rompe con dati rovinati', () => {
    rememberShape('sphere', { radius: -5, segments: 2.5 });
    expect(lastShape('sphere')).toEqual({});
    // localStorage manomesso: valori di tipo sbagliato e un campo che non appartiene alla forma
    useLastValues.setState({ shapes: { box: { size: 'grande', cornerRadius: Infinity, radius: 5 } } as never });
    expect(lastShape('box')).toEqual({});
    // Il cubo vuole tre misure, i dadi una sola
    useLastValues.setState({ shapes: { box: { size: 12 }, octahedron: { size: [1, 2, 3] } } as never });
    expect(lastShape('box')).toEqual({});
    expect(lastShape('octahedron')).toEqual({});
  });

  it('un nuovo oggetto parte dalle ultime misure e il nome e la posizione restano quelli di sempre', () => {
    st().addPrimitive('box');
    const [first] = st().scene.rootIds;
    st().updateNode(first, { size: [30, 10, 50], cornerRadius: 2 } as never);
    st().addPrimitive('box');
    const second = st().scene.nodes[st().scene.rootIds[0]];
    expect(second.id).not.toBe(first);
    expect(second).toMatchObject({ kind: 'box', size: [30, 10, 50], cornerRadius: 2, name: 'Cubo 2' });
    // Appoggiato sul piatto con la nuova altezza
    expect(second.position).toEqual([0, 0, 25]);
  });

  it('le misure di una forma non finiscono in un\'altra e quelle di un oggetto bloccato non contano', () => {
    st().addPrimitive('cylinder');
    const [cyl] = st().scene.rootIds;
    st().updateNode(cyl, { radius: 4 } as never);
    st().addPrimitive('cone');
    expect(st().scene.nodes[st().scene.rootIds[0]]).toMatchObject({ kind: 'cone', radiusBottom: 10 });

    st().select([cyl]);
    st().toggleLockSelected();
    st().updateNode(cyl, { radius: 99 } as never);
    expect(lastShape('cylinder')).toEqual({ radius: 4 });
  });

  it('un testo nuovo ricorda dimensione e font ma non il contenuto', () => {
    st().addShape2D('text');
    const [id] = st().scene.rootIds;
    st().updateNode(id, { text: 'Segreto', size: 25, font: 'pacifico' } as never);
    st().addShape2D('text');
    expect(st().scene.nodes[st().scene.rootIds[0]]).toMatchObject({ text: 'Testo', size: 25, font: 'pacifico' });
  });

  it('gli strumenti ricordano le impostazioni e i numeri, validati', () => {
    rememberTool('edge', { radius: 3.5, chamferMode: 'two', cornerType: 'fillet', cornerSegments: 24, angle: 500, bogus: 1 });
    expect(lastTool('edge')).toEqual({ radius: 3.5, chamferMode: 'two', cornerType: 'fillet', cornerSegments: 24 });
    expect(lastToolNumber('edge', 'radius')).toBe(3.5);
    expect(lastToolNumber('edge', 'distance1')).toBeUndefined();
    rememberTool('shell', { wall: 1.2, bottom: 0 });
    expect(lastTool('shell')).toEqual({ wall: 1.2, bottom: 0 });
    // Il fondo può essere zero, la parete no
    rememberTool('shell', { wall: 0 });
    expect(lastTool('shell').wall).toBe(1.2);
  });
});

import { describe, expect, it } from 'vitest';
import { createHistory } from './history';

describe('cronologia locale del disegno', () => {
  it('annulla e ripete passo per passo; agli estremi non c\'è nulla da fare', () => {
    const h = createHistory<string>();
    h.reset('a');
    expect(h.canUndo()).toBe(false);
    expect(h.undo()).toBeUndefined();
    h.push('b');
    h.push('c');
    expect(h.canUndo()).toBe(true);
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
    expect(h.undo()).toBeUndefined();
    expect(h.canRedo()).toBe(true);
    expect(h.redo()).toBe('b');
    expect(h.redo()).toBe('c');
    expect(h.redo()).toBeUndefined();
    expect(h.canRedo()).toBe(false);
  });

  it('una modifica dopo un Annulla azzera i passi da ripetere', () => {
    const h = createHistory<number>();
    h.reset(1);
    h.push(2);
    h.push(3);
    h.undo();
    h.push(4);
    expect(h.canRedo()).toBe(false);
    expect(h.undo()).toBe(2);
    expect(h.redo()).toBe(4);
  });

  it('oltre il limite si scorda lo stato più vecchio (il limite conta anche lo stato corrente)', () => {
    const h = createHistory<number>(3);
    h.reset(0);
    for (const n of [1, 2, 3, 4]) h.push(n);
    // Restano 2, 3, 4
    expect(h.undo()).toBe(3);
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBeUndefined();
    expect(h.canUndo()).toBe(false);
  });

  it('il limite predefinito è 200 istantanee', () => {
    const h = createHistory<number>();
    h.reset(0);
    for (let i = 1; i <= 250; i++) h.push(i);
    let steps = 0;
    while (h.undo() !== undefined) steps++;
    expect(steps).toBe(199);
  });

  it('reset riparte da un solo stato', () => {
    const h = createHistory<string>();
    h.reset('a');
    h.push('b');
    h.reset('x');
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    h.push('y');
    expect(h.undo()).toBe('x');
  });
});

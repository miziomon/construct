import { expect, test } from '@playwright/test';
import { addShape, dragGizmoAlongX, openApp, sceneState, settled } from './helpers';
import { writeStl } from '../src/kernel/export/stl';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('aggiunge una scatola: outliner, stato della mesh e volume', async ({ page }) => {
  await addShape(page, 'Scatola');
  await expect(page.locator('.outliner__row')).toHaveCount(1);
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  await expect(page.locator('.status-bar')).toContainText('Volume 8.00 cm³');
});

test('trascinando la freccia X del gizmo la scatola si sposta e il kernel ricalcola', async ({ page }) => {
  await addShape(page, 'Scatola');
  const before = await sceneState(page);
  const id = before.rootIds[0];
  await dragGizmoAlongX(page, before.nodes[id].position);

  await expect.poll(async () => (await sceneState(page)).nodes[id].position[0]).not.toBe(0);
  const after = (await sceneState(page)).nodes[id].position;
  // Lo snap è di 1 mm: la posizione è un numero intero, solo X cambia
  expect(Number.isInteger(after[0])).toBe(true);
  expect(after[1]).toBe(0);
  expect(after[2]).toBe(10);
  await settled(page);
  // Il bbox calcolato dal kernel segue la nuova posizione
  const minX = await page.evaluate(() => window.__webcad!.results.getState().meshes[0].bbox.min[0]);
  expect(minX).toBeCloseTo(after[0] - 10, 3);
});

test('un oggetto bloccato non mostra il gizmo e non si sposta con le frecce', async ({ page }) => {
  await addShape(page, 'Scatola');
  await page.keyboard.press('l');
  await expect(page.locator('.outliner__lock')).toHaveCount(1);
  const id = (await sceneState(page)).rootIds[0];

  await page.keyboard.press('ArrowRight');
  expect((await sceneState(page)).nodes[id].position[0]).toBe(0);
  // Nessun controllo di trasformazione montato
  const gizmos = await page.evaluate(() => {
    let n = 0;
    window.__r3f!.scene.traverse((o) => { if ((o as unknown as { isTransformControls?: boolean }).isTransformControls) n++; });
    return n;
  });
  expect(gizmos).toBe(0);

  // Sbloccando torna tutto come prima
  await page.keyboard.press('l');
  await page.keyboard.press('ArrowRight');
  expect((await sceneState(page)).nodes[id].position[0]).toBe(1);
});

test('con due oggetti selezionati la barra propone la Differenza', async ({ page }) => {
  await addShape(page, 'Scatola');
  await addShape(page, 'Cilindro');
  // Seleziona prima la scatola, poi il cilindro: la scatola è la base
  await page.locator('.outliner__row', { hasText: 'Scatola' }).click();
  await page.locator('.outliner__row', { hasText: 'Cilindro' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Differenza' }).first().click();
  await settled(page);

  const scene = await sceneState(page);
  const group = scene.nodes[scene.rootIds[0]];
  expect(scene.rootIds).toHaveLength(1);
  expect(group.op).toBe('difference');
  expect(scene.nodes[group.children[0]].name).toBe('Scatola');
  // Il cilindro ha raggio 10 e altezza 20 come la scatola: sottrae circa 6,3 cm³ dagli 8 cm³ iniziali
  const volume = await page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume);
  expect(volume).toBeGreaterThan(1500);
  expect(volume).toBeLessThan(2000);
});

test('cerchio con 6 lati: esagono regolare estruso', async ({ page }) => {
  await addShape(page, 'Cerchio');
  await page.getByRole('button', { name: '6', exact: true }).click();
  await settled(page);
  const volume = await page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume);
  // Raggio 10, altezza 10: (3√3/2) · 100 · 10
  expect(volume).toBeCloseTo(((3 * Math.sqrt(3)) / 2) * 100 * 10, 0);
  await expect(page.locator('.properties__chip--active')).toHaveText('6');
});

/** STL binario di un cubo da 20 mm con le coordinate sfalsate (per provare la ricentratura). */
function cubeStl(): Buffer {
  const p = new Float32Array([0, 0, 0, 20, 0, 0, 20, 20, 0, 0, 20, 0, 0, 0, 20, 20, 0, 20, 20, 20, 20, 0, 20, 20].map((v, i) => v + [100, 50, 5][i % 3]));
  const i = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  return Buffer.from(writeStl(p, i));
}

test('importa un STL: nodo mesh centrato sul piatto, che sopravvive al ricaricamento', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Importa STL o 3MF/ }).click();
  await (await chooser).setFiles({ name: 'cubo.stl', mimeType: 'model/stl', buffer: cubeStl() });
  await expect(page.locator('.toast--info')).toContainText('Mesh importata');
  await settled(page);

  const scene = await sceneState(page);
  const node = scene.nodes[scene.rootIds[0]];
  expect(node.type).toBe('mesh');
  expect(node.position).toEqual([0, 0, 10]); // centrato in XY e appoggiato al piatto
  expect(node.origin).toEqual([110, 60, 15]); // centro dell'ingombro nel file originale
  await expect(page.locator('.status-bar')).toContainText('Volume 8.00 cm³');

  // Dopo il salvataggio automatico e il ricaricamento la mesh torna dall'archivio locale
  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForFunction(() => window.__webcad!.results.getState().meshes.length === 1);
  await expect(page.locator('.status-bar')).toContainText('Volume 8.00 cm³');
  expect((await sceneState(page)).nodes[scene.rootIds[0]].type).toBe('mesh');
});

test('un file che non è un solido chiuso viene rifiutato con un messaggio', async ({ page }) => {
  // Un solo triangolo
  const p = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
  const stl = Buffer.from(writeStl(p, new Uint32Array([0, 1, 2])));
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Importa STL o 3MF/ }).click();
  await (await chooser).setFiles({ name: 'aperto.stl', mimeType: 'model/stl', buffer: stl });
  await expect(page.locator('.toast--error')).toContainText('non è un solido chiuso');
  expect((await sceneState(page)).rootIds).toHaveLength(0);
});

test('Esporta STL scarica un file binario valido', async ({ page }) => {
  await addShape(page, 'Scatola');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Esporta STL' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('webcad.stl');
  const path = await file.path();
  const { statSync } = await import('node:fs');
  expect(statSync(path).size).toBe(84 + 50 * 12);
});

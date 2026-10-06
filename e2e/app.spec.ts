import { expect, test } from '@playwright/test';
import { addShape, dragGizmoAlongX, dragGizmoAxis, openApp, openMenuItem, sceneState, settled } from './helpers';
import { writeStl } from '../src/kernel/export/stl';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('aggiunge una scatola: outliner, stato della mesh e volume', async ({ page }) => {
  await addShape(page, 'Cubo');
  await expect(page.locator('.outliner__row')).toHaveCount(1);
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  await expect(page.locator('.status-bar')).toContainText('Volume 8.00 cm³');
});

test('trascinando la freccia X del gizmo la scatola si sposta e il kernel ricalcola', async ({ page }) => {
  await addShape(page, 'Cubo');
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
  await addShape(page, 'Cubo');
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
  await addShape(page, 'Cubo');
  await addShape(page, 'Cilindro');
  // Seleziona prima la scatola, poi il cilindro: la scatola è la base
  await page.locator('.outliner__row', { hasText: 'Cubo' }).click();
  await page.locator('.outliner__row', { hasText: 'Cilindro' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Differenza' }).first().click();
  await settled(page);

  const scene = await sceneState(page);
  const group = scene.nodes[scene.rootIds[0]];
  expect(scene.rootIds).toHaveLength(1);
  expect(group.op).toBe('difference');
  expect(scene.nodes[group.children[0]].name).toBe('Cubo');
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
  await openMenuItem(page, 'Importa');
  await page.getByRole('button', { name: /Scegli file STL o 3MF/ }).click();
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
  await openMenuItem(page, 'Importa');
  await page.getByRole('button', { name: /Scegli file STL o 3MF/ }).click();
  await (await chooser).setFiles({ name: 'aperto.stl', mimeType: 'model/stl', buffer: stl });
  await expect(page.locator('.toast--error')).toContainText('non è un solido chiuso');
  expect((await sceneState(page)).rootIds).toHaveLength(0);
});

test('Esporta STL scarica un file binario valido', async ({ page }) => {
  await addShape(page, 'Cubo');
  const download = page.waitForEvent('download');
  await openMenuItem(page, 'Esporta');
  await page.getByRole('dialog').getByRole('button', { name: 'STL' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('webcad.stl');
  const path = await file.path();
  const { statSync } = await import('node:fs');
  expect(statSync(path).size).toBe(84 + 50 * 12);
});

test('versione visibile nel title e accanto al nome nell\'header', async ({ page }) => {
  const { version } = JSON.parse((await import('node:fs')).readFileSync('package.json', 'utf8'));
  await expect(page).toHaveTitle(`WebCAD v${version}`);
  await expect(page.locator('.toolbar__brand')).toContainText(`v${version}`);
});

test('di default la modalità è Seleziona: nessun gizmo finché non si preme W', async ({ page }) => {
  await addShape(page, 'Cubo');
  const gizmos = () => page.evaluate(() => {
    let n = 0;
    window.__r3f!.scene.traverse((o) => { if ((o as unknown as { isTransformControls?: boolean }).isTransformControls) n++; });
    return n;
  });
  expect(await gizmos()).toBe(0);
  await expect(page.getByRole('button', { name: 'Seleziona (Q)' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('w');
  await expect.poll(gizmos).toBe(1);
  await page.keyboard.press('q');
  await expect.poll(gizmos).toBe(0);
});

test('il menu hamburger apre le modali Novità e About con la versione', async ({ page }) => {
  const { version } = JSON.parse((await import('node:fs')).readFileSync('package.json', 'utf8'));
  await openMenuItem(page, 'Novità');
  await expect(page.getByRole('dialog')).toContainText(`v${version}`);
  await page.getByRole('button', { name: 'Chiudi' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await openMenuItem(page, 'About');
  await expect(page.getByTestId('about-version')).toHaveText(`v${version}`);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('libreria con Cubo e solidi dei dadi; i preset dei lati sono 3, 4, 5, 6, 8, 12', async ({ page }) => {
  for (const label of ['Cubo', 'Ottaedro', 'Decaedro', 'Dodecaedro', 'Icosaedro']) {
    await expect(page.locator(`button[title^="Aggiungi: ${label}"]`)).toHaveCount(1);
  }
  await addShape(page, 'Cilindro');
  await expect(page.locator('.properties__chip')).toHaveText(['3', '4', '5', '6', '8', '12']);
});

test('icosaedro: mesh valida appoggiata sul piatto, il raccordo ne riduce il volume', async ({ page }) => {
  await addShape(page, 'Icosaedro');
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  const read = () => page.evaluate(() => window.__webcad!.results.getState().meshes[0]);
  const sharp = await read();
  expect(sharp.bbox.min[2]).toBeCloseTo(0, 3);
  expect(sharp.bbox.max[2]).toBeCloseTo(20, 3);

  const field = page.locator('.slider-field', { hasText: 'Raccordo' }).locator('.number-field__input');
  await field.fill('3');
  await field.press('Enter');
  await settled(page);
  expect((await read()).volume).toBeLessThan(sharp.volume);
});

test('trascinando uno slider la scena cambia dal vivo e Ctrl+Z lo annulla in un solo passo', async ({ page }) => {
  await addShape(page, 'Cerchio');
  const id = (await sceneState(page)).rootIds[0];
  const range = page.locator('.slider-field', { hasText: 'Altezza' }).locator('input[type=range]');
  const box = (await range.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width * (0.2 + i * 0.06), box.y + box.height / 2);
  await page.mouse.up();
  await settled(page);

  const height = (await sceneState(page)).nodes[id].height;
  expect(height).not.toBe(10);
  await page.keyboard.press('Control+z');
  expect((await sceneState(page)).nodes[id].height).toBe(10);
});

test('modalità Estrudi (T): trascinando la maniglia Z l\'altezza cresce e la base resta sul piatto', async ({ page }) => {
  await addShape(page, 'Cerchio');
  const id = (await sceneState(page)).rootIds[0];
  const start = (await sceneState(page)).nodes[id];
  await page.keyboard.press('t');
  await page.waitForTimeout(100);
  await dragGizmoAxis(page, start.position, 'Z', 60);

  await expect.poll(async () => (await sceneState(page)).nodes[id].height).toBeGreaterThan(start.height);
  const after = (await sceneState(page)).nodes[id];
  // Il profilo non cambia e la base resta a z = 0
  expect(after.radius).toBe(start.radius);
  expect(after.position[2] - after.height / 2).toBeCloseTo(0, 3);
});

test('modalità Ridimensiona (R): trascinando la maniglia X il cubo si allarga', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  await page.keyboard.press('r');
  await page.waitForTimeout(100);
  await dragGizmoAxis(page, [0, 0, 10], 'X', 50);

  await expect.poll(async () => (await sceneState(page)).nodes[id].size[0]).toBeGreaterThan(20);
  const after = (await sceneState(page)).nodes[id];
  expect(after.size[1]).toBe(20);
  expect(after.position[2]).toBe(10);
});

test('il menu contiene Nuovo, Apri, Salva e le Scorciatoie', async ({ page }) => {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  for (const name of ['Nuovo progetto', 'Apri progetto…', 'Salva progetto', 'Scorciatoie da tastiera']) {
    await expect(page.getByRole('menuitem', { name })).toBeVisible();
  }
  await page.getByRole('menuitem', { name: 'Scorciatoie da tastiera' }).click();
  await expect(page.getByRole('dialog')).toContainText('Ridimensiona');
});

test('le nuove forme stanno in cima all\'elenco e hanno colori diversi', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Sfera');
  await addShape(page, 'Cono');
  await expect(page.locator('.outliner__row').first()).toContainText('Cono');
  await expect(page.locator('.outliner__row').last()).toContainText('Cubo');
  const scene = await sceneState(page);
  const colors = scene.rootIds.map((id: string) => scene.nodes[id].color);
  expect(new Set(colors).size).toBe(3);
});

test('il pulsante Codice ha solo l\'icona e apre una modale all\'80% con il codice colorato', async ({ page }) => {
  await addShape(page, 'Cubo');
  const button = page.getByRole('button', { name: /Codice OpenSCAD/ });
  await expect(button).toHaveText('');
  await expect(page.getByRole('tab', { name: 'Codice' })).toHaveCount(0);

  await button.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.width / view.width).toBeGreaterThan(0.77);
  expect(box.width / view.width).toBeLessThan(0.83);
  expect(box.height / view.height).toBeGreaterThan(0.77);
  expect(box.height / view.height).toBeLessThan(0.83);
  // Numeri di riga e segmenti colorati per funzioni e commenti
  await expect(dialog.locator('.code-view__number').first()).toHaveText('1');
  await expect(dialog.locator('.code-view__tok--function', { hasText: 'cube' })).toHaveCount(1);
  await expect(dialog.locator('.code-view__tok--comment').first()).toBeVisible();

  // Con la modale aperta Canc non cancella la scena; Ctrl+J la chiude
  await page.keyboard.press('Delete');
  expect((await sceneState(page)).rootIds).toHaveLength(1);
  await page.keyboard.press('Control+j');
  await expect(dialog).toBeHidden();
});

test('tema chiaro di default, interruttore per lo scuro che resta dopo il ricaricamento', async ({ page }) => {
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  expect(await theme()).toBe('light');
  await page.getByRole('button', { name: 'Passa al tema scuro' }).click();
  expect(await theme()).toBe('dark');
  await page.reload();
  expect(await theme()).toBe('dark');
  await page.getByRole('button', { name: 'Passa al tema chiaro' }).click();
  expect(await theme()).toBe('light');
});

test('il tasto P cicla il piatto: completo, senza base, nascosto', async ({ page }) => {
  const parts = () => page.evaluate(() => ['bed-plate', 'bed-grid', 'bed-border'].map((n) => !!window.__r3f!.scene.getObjectByName(n)));
  expect(await parts()).toEqual([true, true, true]);
  await page.keyboard.press('p');
  await expect.poll(parts).toEqual([false, true, true]);
  await page.keyboard.press('p');
  await expect.poll(parts).toEqual([false, false, false]);
  await page.keyboard.press('p');
  await expect.poll(parts).toEqual([true, true, true]);
  // Anche il pulsante in toolbar fa avanzare lo stato
  await page.getByRole('button', { name: /^Piatto:/ }).click();
  await expect.poll(parts).toEqual([false, true, true]);
});

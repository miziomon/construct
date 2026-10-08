import { expect, test } from '@playwright/test';
import { addShape, dragGizmoAlongX, dragGizmoAxis, openApp, openMenuItem, project, readCode, sceneState, settled } from './helpers';
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
  await expect(page.getByRole('button', { name: 'Seleziona', exact: true })).toHaveAttribute('aria-pressed', 'true');
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
  // Il pannello è più alto della finestra: lo slider va portato in vista prima di trascinarlo con il mouse
  await range.scrollIntoViewIfNeeded();
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
  await expect(button.locator('.toolbar__button-label')).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Tema', exact: true }).click();
  expect(await theme()).toBe('dark');
  await page.reload();
  expect(await theme()).toBe('dark');
  await page.getByRole('button', { name: 'Tema', exact: true }).click();
  expect(await theme()).toBe('light');
});

test('il tasto P cicla il piatto e ogni stato cambia davvero quello che è disegnato', async ({ page }) => {
  // Visibile = l'oggetto e tutti i suoi antenati hanno visible = true
  const parts = () =>
    page.evaluate(() =>
      ['bed-plate', 'bed-grid', 'bed-border'].map((name) => {
        type Node = { visible: boolean; parent: Node | null };
        const found = window.__r3f!.scene.getObjectByName(name) as unknown as Node | undefined;
        for (let obj = found ?? null; obj; obj = obj.parent) if (!obj.visible) return false;
        return !!found;
      }),
    );
  // Immagine mostrata dal browser (non un rendering forzato): un canvas rimasto sull'ultimo frame darebbe due immagini uguali
  const frame = async () => {
    await page.waitForTimeout(400);
    return page.locator('canvas').screenshot();
  };

  expect(await parts()).toEqual([true, true, true]);
  const full = await frame();
  await page.keyboard.press('p');
  await expect.poll(parts).toEqual([false, true, true]);
  const noPlate = await frame();
  await page.keyboard.press('p');
  await expect.poll(parts).toEqual([false, false, false]);
  const hidden = await frame();
  expect(noPlate.equals(full)).toBe(false);
  expect(hidden.equals(noPlate)).toBe(false);
  expect(hidden.equals(full)).toBe(false);

  await page.keyboard.press('p');
  await expect.poll(parts).toEqual([true, true, true]);
  // Anche il pulsante in toolbar fa avanzare lo stato
  await page.getByRole('button', { name: 'Piatto', exact: true }).click();
  await expect.poll(parts).toEqual([false, true, true]);
});

test('ogni pulsante della toolbar ha il tooltip dettagliato con la scorciatoia', async ({ page }) => {
  // Ogni tooltip compare dopo 400 ms: con trenta pulsanti il tempo standard non basta
  test.setTimeout(120_000);
  await addShape(page, 'Cubo');
  const buttons = page.locator('header.toolbar .tooltip-host button');
  const count = await buttons.count();
  expect(count).toBeGreaterThan(25);
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    const name = await button.getAttribute('aria-label');
    // Anche i pulsanti disabilitati spiegano cosa fanno
    await button.hover({ force: true });
    const tip = page.getByRole('tooltip');
    await expect(tip, `tooltip mancante: "${name}"`).toBeVisible();
    await expect(tip.locator('.tooltip__title')).toContainText(name!);
    await expect(tip.locator('kbd'), `scorciatoia mancante nel tooltip di "${name}"`).toHaveCount(1);
  }
});

test('i tasti C, D e M aprono il codice, cambiano tema e aprono il menu', async ({ page }) => {
  await page.keyboard.press('c');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('c');
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.keyboard.press('d');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await page.keyboard.press('d');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');

  await page.keyboard.press('m');
  await expect(page.getByRole('menuitem', { name: 'Importa' })).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.getByRole('menuitem', { name: 'Importa' })).toBeHidden();
});

test('il codice va a capo dopo ogni comando', async ({ page }) => {
  await addShape(page, 'Icosaedro');
  await page.keyboard.press('c');
  await expect(page.locator('.code-view__line').first()).toBeVisible();
  const lines = await page.locator('.code-view__text').allTextContents();
  expect(lines).toContain('translate([0, 0, 10])');
  expect(lines).toContain('hull()');
  expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(100);
});

test('cilindro non proporzionale: lo slider Raggio Y cambia l\'ingombro in Y e non in X', async ({ page }) => {
  await addShape(page, 'Cilindro');
  const id = (await sceneState(page)).rootIds[0];
  const field = page.locator('.slider-field', { hasText: 'Raggio Y' }).locator('.number-field__input');
  await field.fill('4');
  await field.press('Enter');
  await settled(page);
  expect((await sceneState(page)).nodes[id].radiusY).toBe(4);
  const bbox = await page.evaluate(() => window.__webcad!.results.getState().meshes[0].bbox);
  expect(bbox.max[0] - bbox.min[0]).toBeCloseTo(20, 3);
  expect(bbox.max[1] - bbox.min[1]).toBeCloseTo(8, 3);
  // Riportando Raggio Y a quello X la forma torna tonda e il campo opzionale sparisce
  await field.fill('10');
  await field.press('Enter');
  await settled(page);
  expect((await sceneState(page)).nodes[id].radiusY).toBeUndefined();
});

test('sfera: Raggio Z la rende un ellissoide che resta appoggiato al piatto', async ({ page }) => {
  await addShape(page, 'Sfera');
  const field = page.locator('.slider-field', { hasText: 'Raggio Z' }).locator('.number-field__input');
  await field.fill('20');
  await field.press('Enter');
  await settled(page);
  const bbox = await page.evaluate(() => window.__webcad!.results.getState().meshes[0].bbox);
  expect(bbox.max[2] - bbox.min[2]).toBeCloseTo(40, 3);
});

/** Seleziona due oggetti dall'elenco (il primo con un clic, il secondo con Maiusc). */
async function selectTwo(page: import('@playwright/test').Page, first: string, second: string) {
  await page.locator('.outliner__row', { hasText: first }).click();
  await page.locator('.outliner__row', { hasText: second }).click({ modifiers: ['Shift'] });
}

test('Raggruppa tiene separati gli oggetti (colori e codice propri) e li muove insieme', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Sfera');
  await selectTwo(page, 'Cubo', 'Sfera');
  await page.getByRole('button', { name: /^Raggruppa/ }).click();
  await settled(page);

  const scene = await sceneState(page);
  expect(scene.rootIds).toHaveLength(1);
  expect(scene.nodes[scene.rootIds[0]].op).toBe('group');
  // Due mesh distinte, con colori diversi, che appartengono alla stessa radice
  const meshes = await page.evaluate(() => window.__webcad!.results.getState().meshes.map((m) => ({ rootId: m.rootId, color: m.color, x: (m.bbox.min[0] + m.bbox.max[0]) / 2 })));
  expect(meshes).toHaveLength(2);
  expect(new Set(meshes.map((m) => m.color)).size).toBe(2);
  expect(new Set(meshes.map((m) => m.rootId)).size).toBe(1);

  // Il codice non ha union() e ha un blocco per oggetto
  const code = await readCode(page);
  expect(code).not.toContain('union()');
  expect(code).toContain('cube(');
  expect(code).toContain('sphere(');

  // Spostando il gruppo si muovono entrambe le mesh
  await page.keyboard.press('Shift+ArrowRight');
  await settled(page);
  const moved = await page.evaluate(() => window.__webcad!.results.getState().meshes.map((m) => (m.bbox.min[0] + m.bbox.max[0]) / 2));
  moved.forEach((x, i) => expect(x).toBeCloseTo(meshes[i].x + 10, 3));
});

test('Unisci produce una sola mesh e union() nel codice', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Sfera');
  await selectTwo(page, 'Cubo', 'Sfera');
  await page.keyboard.press('u');
  await settled(page);

  const scene = await sceneState(page);
  expect(scene.rootIds).toHaveLength(1);
  expect(scene.nodes[scene.rootIds[0]].op).toBe('union');
  expect(await page.evaluate(() => window.__webcad!.results.getState().meshes.length)).toBe(1);
  expect(await readCode(page)).toContain('union() {');
});

test('il titolo della sidebar di destra dice il tipo del gruppo: Differenza, Unione, Gruppo', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Cilindro');
  await selectTwo(page, 'Cubo', 'Cilindro');
  await page.getByRole('button', { name: 'Differenza' }).first().click();
  await settled(page);
  await expect(page.locator('.properties__section-title').first()).toHaveText('Differenza');
  // L'elenco ha l'icona con lo stesso tipo come tooltip
  await expect(page.locator('.outliner__icon-wrap[title="Differenza"]')).toHaveCount(1);
});

test('rinomina dall\'elenco con doppio clic e con F2; Esc annulla', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  const row = page.locator('.outliner__row', { hasText: 'Cubo' });

  await row.dblclick();
  const input = page.getByRole('textbox', { name: 'Nome dell\'oggetto' });
  await input.fill('Mio cubo');
  await input.press('Enter');
  expect((await sceneState(page)).nodes[id].name).toBe('Mio cubo');
  // Un solo passo di Annulla per tutta la rinomina
  await page.locator('.outliner__row', { hasText: 'Mio cubo' }).click();
  await page.keyboard.press('Control+z');
  expect((await sceneState(page)).nodes[id].name).toBe('Cubo');

  await page.locator('.outliner__row', { hasText: 'Cubo' }).click();
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: 'Nome dell\'oggetto' }).fill('Scartato');
  await page.keyboard.press('Escape');
  expect((await sceneState(page)).nodes[id].name).toBe('Cubo');
  await expect(page.getByRole('textbox', { name: 'Nome dell\'oggetto' })).toHaveCount(0);
});

test('trascinando nell\'elenco si mette un oggetto dentro un gruppo, lo si porta fuori e si riordina', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Sfera');
  await addShape(page, 'Cono');
  await selectTwo(page, 'Cubo', 'Sfera');
  await page.getByRole('button', { name: /^Raggruppa/ }).click();
  await settled(page);

  const groupRow = page.locator('.outliner__row', { hasText: 'Gruppo' });
  const rowOf = (name: string) => page.locator('.outliner__row', { hasText: name });
  const childrenOfGroup = async () => {
    const scene = await sceneState(page);
    const g = scene.nodes[scene.rootIds.find((id: string) => scene.nodes[id].type === 'group')!];
    return g.children.map((c: string) => scene.nodes[c].name);
  };
  expect(await childrenOfGroup()).toEqual(['Cubo', 'Sfera']);

  // Il cono va dentro il gruppo (zona centrale della riga del gruppo)
  await rowOf('Cono').dragTo(groupRow, { targetPosition: { x: 80, y: 14 } });
  expect(await childrenOfGroup()).toEqual(['Cubo', 'Sfera', 'Cono']);

  // Un figlio esce dal gruppo: rilasciato sulla metà alta della riga del gruppo finisce alla radice, prima di lui
  await rowOf('Sfera').dragTo(groupRow, { targetPosition: { x: 80, y: 3 } });
  expect(await childrenOfGroup()).toEqual(['Cubo', 'Cono']);
  const roots = async () => (await sceneState(page)).rootIds.map((id: string) => id);
  expect(await roots()).toHaveLength(2);

  // Un solo Ctrl+Z annulla lo spostamento
  await page.locator('canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  expect(await childrenOfGroup()).toEqual(['Cubo', 'Sfera', 'Cono']);
});

test('un clic su un oggetto raggruppato seleziona il gruppo, Alt+clic il singolo oggetto', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Sfera');
  const [sphereId, cubeId] = (await sceneState(page)).rootIds; // l'ultimo creato sta in cima
  // Sfalsa la sfera per poter cliccare i due oggetti separatamente
  await page.evaluate(([id]) => window.__webcad!.store.getState().updateNode(id as string, { position: [60, 0, 10] }), [sphereId]);
  await selectTwo(page, 'Cubo', 'Sfera');
  await page.getByRole('button', { name: /^Raggruppa/ }).click();
  await settled(page);
  const scene = await sceneState(page);
  const gid = scene.rootIds[0];
  const cubeWorld = await page.evaluate(([id]) => {
    const m = window.__webcad!.results.getState().meshes.find((x) => x.id === id)!;
    return [(m.bbox.min[0] + m.bbox.max[0]) / 2, (m.bbox.min[1] + m.bbox.max[1]) / 2, (m.bbox.min[2] + m.bbox.max[2]) / 2] as [number, number, number];
  }, [cubeId]);
  const at = await project(page, cubeWorld);

  await page.locator('canvas').click({ position: { x: 5, y: 5 } }); // deseleziona
  await page.mouse.click(at.x, at.y);
  expect(await page.evaluate(() => window.__webcad!.store.getState().selection)).toEqual([gid]);
  await page.keyboard.down('Alt');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('Alt');
  expect(await page.evaluate(() => window.__webcad!.store.getState().selection)).toEqual([cubeId]);
});

/** Numero di passi di Annulla disponibili. */
const history = (page: import('@playwright/test').Page) => page.evaluate(() => window.__webcad!.store.temporal.getState().pastStates.length);

/** Volume della prima mesh calcolata dal kernel. */
const firstVolume = (page: import('@playwright/test').Page) => page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume);

/** Sceglie due superfici di un cubo da 20 mm: la superiore e la frontale (visibili dalla camera di partenza). */
async function pickTopAndFront(page: import('@playwright/test').Page) {
  for (const point of [[0, 0, 20], [0, -10, 10]] as [number, number, number][]) {
    const at = await project(page, point);
    await page.mouse.move(at.x, at.y);
    await page.mouse.click(at.x, at.y);
  }
}

test('Raccordo: scelta di due superfici, anteprima dal vivo, OK in un solo passo di Annulla', async ({ page }) => {
  await addShape(page, 'Cubo');
  expect(await firstVolume(page)).toBeCloseTo(8000, 3);

  await page.keyboard.press('f');
  const panel = page.getByRole('region', { name: 'Raccordo' });
  await expect(panel).toBeVisible();
  await pickTopAndFront(page);
  await settled(page);
  await expect(panel).toContainText('Spigolo convesso');
  const withFillet = await firstVolume(page);
  expect(withFillet).toBeLessThan(8000);
  expect(withFillet).toBeGreaterThan(7980);

  // Il raggio si cambia dal pannello e l'anteprima segue
  const radius = panel.locator('.slider-field', { hasText: 'Raggio' }).locator('.number-field__input');
  await radius.fill('4');
  await radius.press('Enter');
  await settled(page);
  expect(await firstVolume(page)).toBeLessThan(withFillet);

  await panel.getByRole('button', { name: 'OK' }).click();
  await expect(panel).toBeHidden();
  await settled(page);
  const scene = await sceneState(page);
  const root = scene.nodes[scene.rootIds[0]];
  expect(scene.rootIds).toHaveLength(1);
  expect(root.type).toBe('group');
  expect(root.op).toBe('difference');
  const edge = scene.nodes[root.children[1]];
  expect(edge).toMatchObject({ type: 'edge', treatment: 'fillet', convex: true, radius: 4 });
  expect(edge.name).toBe('Raccordo');

  // Il codice contiene il taglierino
  const code = await readCode(page);
  expect(code).toContain('difference() {');
  expect(code).toContain('circle(r = 4, $fn = 64);');

  // Un solo Annulla riporta il cubo intero
  await page.keyboard.press('Control+z');
  await settled(page);
  expect((await sceneState(page)).rootIds).toHaveLength(1);
  expect((await sceneState(page)).nodes[(await sceneState(page)).rootIds[0]].type).toBe('primitive');
  expect(await firstVolume(page)).toBeCloseTo(8000, 3);
});

test('Raccordo: Esc e Annulla non lasciano tracce nella scena', async ({ page }) => {
  await addShape(page, 'Cubo');
  const before = JSON.stringify(await sceneState(page));
  const historyBefore = await history(page);
  await page.keyboard.press('f');
  await pickTopAndFront(page);
  await settled(page);
  expect(await firstVolume(page)).toBeLessThan(8000);
  await page.keyboard.press('Escape');
  await settled(page);
  expect(JSON.stringify(await sceneState(page))).toBe(before);
  expect(await firstVolume(page)).toBeCloseTo(8000, 3);

  await page.getByRole('button', { name: 'Smusso', exact: true }).click();
  await pickTopAndFront(page);
  await page.getByRole('region', { name: 'Smusso' }).getByRole('button', { name: 'Annulla' }).click();
  await settled(page);
  expect(JSON.stringify(await sceneState(page))).toBe(before);
  // Annullare lo strumento non lascia voci nella cronologia (resta solo quella dell'aggiunta del cubo)
  expect(await history(page)).toBe(historyBefore);
});

test('Smusso con due distanze e modifica successiva dal pannello delle proprietà', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.keyboard.press('s');
  const panel = page.getByRole('region', { name: 'Smusso' });
  await expect(panel).toBeVisible();
  await pickTopAndFront(page);
  await settled(page);

  await panel.getByRole('button', { name: 'Due distanze' }).click();
  const field = (label: string) => panel.locator('.slider-field', { hasText: label }).locator('.number-field__input');
  await field('Distanza 1').fill('2');
  await field('Distanza 1').press('Enter');
  await field('Distanza 2').fill('5');
  await field('Distanza 2').press('Enter');
  await settled(page);
  // Triangolo con cateti 2 e 5 lungo uno spigolo di 20 mm
  expect(await firstVolume(page)).toBeCloseTo(8000 - 0.5 * 2 * 5 * 20, 2);
  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);

  // Si seleziona il taglierino dall'elenco: la sidebar di destra mostra le misure e le modifica dal vivo
  await page.locator('.outliner__row', { hasText: 'Smusso' }).last().click();
  await expect(page.locator('.properties__section-title').first()).toHaveText('Smusso');
  const d2 = page.locator('.slider-field', { hasText: 'Distanza 2' }).locator('.number-field__input');
  await d2.fill('4');
  await d2.press('Enter');
  await settled(page);
  expect(await firstVolume(page)).toBeCloseTo(8000 - 0.5 * 2 * 4 * 20, 2);
});

test('Raccordo: due sfaccettature lontane di una sfera non hanno uno spigolo in comune', async ({ page }) => {
  await addShape(page, 'Sfera');
  await page.keyboard.press('f');
  const panel = page.getByRole('region', { name: 'Raccordo' });
  for (const point of [[0, 0, 19], [9, 0, 10]] as [number, number, number][]) {
    const at = await project(page, point);
    await page.mouse.move(at.x, at.y);
    await page.mouse.click(at.x, at.y);
  }
  await expect(panel.getByRole('alert')).toBeVisible();
  // La seconda scelta si scarta e resta la prima
  await expect(panel).toContainText('Superficie 1scelta');
  await expect(panel.getByRole('button', { name: 'OK' })).toBeDisabled();
});

test('Raccordo: la stessa superficie si toglie con un secondo clic e due superfici non adiacenti sono rifiutate', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.keyboard.press('f');
  const panel = page.getByRole('region', { name: 'Raccordo' });
  const top = await project(page, [0, 0, 20]);
  await page.mouse.move(top.x, top.y);
  await page.mouse.click(top.x, top.y);
  await expect(panel.getByText('scelta', { exact: true })).toHaveCount(1);
  await page.mouse.click(top.x, top.y);
  await expect(panel.getByText('da scegliere')).toHaveCount(2);
});

test('doppio clic su un oggetto: lo seleziona e passa a Sposta, il clic singolo no', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  const top = await project(page, [0, 0, 20]);
  await page.locator('canvas').click({ position: { x: 5, y: 5 } }); // deseleziona
  const mode = () => page.evaluate(() => window.__webcad!.store.getState().gizmoMode);
  const selection = () => page.evaluate(() => window.__webcad!.store.getState().selection);

  // Clic singolo: seleziona e resta in Seleziona
  await page.mouse.click(top.x, top.y);
  expect(await selection()).toEqual([id]);
  expect(await mode()).toBe('select');

  // Doppio clic: attiva lo spostamento e compare il gizmo
  await page.locator('canvas').click({ position: { x: 5, y: 5 } });
  await page.mouse.dblclick(top.x, top.y);
  expect(await selection()).toEqual([id]);
  expect(await mode()).toBe('translate');
  await expect(page.getByRole('button', { name: 'Sposta', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('Guscio: anteprima dal vivo, Invio conferma in un solo passo di Annulla', async ({ page }) => {
  await addShape(page, 'Cubo');
  const history = () => page.evaluate(() => window.__webcad!.store.temporal.getState().pastStates.length);
  const before = await history();
  await page.keyboard.press('g');
  const panel = page.getByRole('region', { name: 'Guscio' });
  await expect(panel).toBeVisible();
  await settled(page);
  // Cubo 20 mm con parete e fondo di 2 mm (il massimo predefinito è 2): cavità 16 × 16 × 18, dal fondo alla cima
  await expect.poll(() => page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume)).toBeCloseTo(8000 - 16 * 16 * 18, 2);

  // Il pulsante della libreria ha ancora il focus: Invio lo riattiverebbe e aggiungerebbe un altro cubo
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Enter');
  await settled(page);
  await expect(panel).toHaveCount(0);
  expect(await history()).toBe(before + 1);
  const scene = await sceneState(page);
  expect(scene.nodes[scene.rootIds[0]].op).toBe('shell');
  // Il codice OpenSCAD contiene la cavità
  expect(await readCode(page)).toContain('cavità del guscio');

  await page.keyboard.press('Control+z');
  await settled(page);
  expect(await page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume)).toBeCloseTo(8000, 2);
});

test('Guscio: Esc non lascia tracce e le pareti troppo spesse sono segnalate', async ({ page }) => {
  await addShape(page, 'Cubo');
  const before = await sceneState(page);
  await page.keyboard.press('g');
  const panel = page.getByRole('region', { name: 'Guscio' });
  await expect(panel).toBeVisible();
  // Parete di 15 mm su un cubo da 20: non entra
  const wall = panel.locator('.slider-field', { hasText: 'Laterale' }).locator('.number-field__input');
  await wall.fill('15');
  await wall.press('Enter');
  await expect(panel.getByRole('alert')).toContainText('troppo spesse');
  await expect(panel.getByRole('button', { name: 'OK' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  expect(await sceneState(page)).toEqual(before);
});

test('due smussi su spigoli adiacenti della faccia superiore: il risultato coincide con due piani di taglio', async ({ page }) => {
  await addShape(page, 'Cubo');
  /** Sceglie due facce con il mouse, regola la distanza e conferma. */
  const chamfer = async (second: [number, number, number], distance: string) => {
    await page.keyboard.press('s');
    const panel = page.getByRole('region', { name: 'Smusso' });
    for (const point of [[0, 0, 20], second] as [number, number, number][]) {
      const at = await project(page, point);
      await page.mouse.move(at.x, at.y);
      await page.mouse.click(at.x, at.y);
    }
    await settled(page);
    const field = panel.locator('.slider-field', { hasText: 'Distanza' }).locator('.number-field__input');
    await field.fill(distance);
    await field.press('Enter');
    await settled(page);
    await panel.getByRole('button', { name: 'OK' }).click();
    await settled(page);
  };
  await chamfer([0, -10, 10], '3'); // sopra-fronte
  await chamfer([10, 0, 10], '3'); // sopra-destra
  // Due cunei da 4,5 mm² per 20 mm, più la parte in comune all'angolo (d³/3 = 9 mm³): 8000 − 180 + 9
  const volume = await page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume);
  expect(volume).toBeCloseTo(7829, 2);
  const scene = await sceneState(page);
  expect(Object.values(scene.nodes).filter((n: any) => n.type === 'edge')).toHaveLength(2);
});

test('dopo il Guscio il gizmo di Sposta sta sull oggetto e non nell origine del mondo', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.keyboard.press('g');
  await settled(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Enter');
  await settled(page);
  await page.keyboard.press('w');
  // Posizione dell'oggetto che il gizmo muove: quella del cubo (z = 10), non l'origine
  await expect
    .poll(() =>
      page.evaluate(() => {
        let position: number[] | undefined;
        window.__r3f!.scene.traverse((o) => {
          const c = o as unknown as { isTransformControls?: boolean; object?: { position: { toArray(): number[] } } };
          if (c.isTransformControls && c.object) position = c.object.position.toArray();
        });
        return position;
      }),
    )
    .toEqual([0, 0, 10]);
});

test('Smusso angolare: si sceglie il vertice con il mouse, piano e sferico con i segmenti, OK in un solo passo di Annulla', async ({ page }) => {
  await addShape(page, 'Cubo');
  const history = () => page.evaluate(() => window.__webcad!.store.temporal.getState().pastStates.length);
  const before = await history();
  await page.keyboard.press('a');
  const panel = page.getByRole('region', { name: 'Smusso angolare' });
  await expect(panel).toBeVisible();

  // Il vertice più vicino al puntatore, sulla faccia superiore (angolo alto-fronte-destra)
  const at = await project(page, [9, -9, 20]);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await settled(page);
  await expect(panel).toContainText('Vertici');
  await expect(panel.getByText('1 scelto', { exact: true })).toBeVisible();
  // Distanza iniziale 2 mm: si toglie un tetraedro di lato 2 (d³/6)
  await expect.poll(() => page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume)).toBeCloseTo(8000 - 8 / 6, 2);

  // Sferico: compare lo slider dei segmenti e si toglie meno del taglio piatto
  const flat = await page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume);
  await panel.getByRole('button', { name: 'Sferico' }).click();
  await settled(page);
  const segments = panel.locator('.slider-field', { hasText: 'Segmenti' }).locator('.number-field__input');
  await expect(segments).toBeVisible();
  const round = await page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume);
  expect(round).toBeGreaterThan(flat);
  await segments.fill('64');
  await segments.press('Enter');
  await settled(page);

  await panel.getByRole('button', { name: 'OK' }).click();
  await expect(panel).toBeHidden();
  await settled(page);
  expect(await history()).toBe(before + 1);
  const scene = await sceneState(page);
  const corner = Object.values(scene.nodes).find((n: any) => n.type === 'corner') as any;
  expect(corner).toMatchObject({ treatment: 'fillet', segments: 64 });
  expect(await readCode(page)).toContain('$fn = 64);');

  await page.keyboard.press('Control+z');
  await settled(page);
  expect(await page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume)).toBeCloseTo(8000, 2);
});

test('Smusso angolare: il tasto A apre e chiude lo strumento', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.keyboard.press('a');
  const panel = page.getByRole('region', { name: 'Smusso angolare' });
  await expect(panel).toBeVisible();
  await page.keyboard.press('a');
  await expect(panel).toHaveCount(0);
});


test('Guscio su due cubi uniti: la cavità attraversa il giunto, senza parete interna', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Cubo');
  const [first, second] = (await sceneState(page)).rootIds;
  // Due cubi da 20 mm che si toccano su una faccia: blocco 40 × 20 × 20
  await page.evaluate(([id]) => window.__webcad!.store.getState().updateNode(id as string, { position: [20, 0, 10] }), [second]);
  await page.evaluate(([a, b]) => window.__webcad!.store.getState().select([a as string, b as string]), [first, second]);
  await page.keyboard.press('u');
  await settled(page);
  expect(await page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume)).toBeCloseTo(40 * 20 * 20, 2);

  await page.keyboard.press('g');
  await settled(page);
  const panel = page.getByRole('region', { name: 'Guscio' });
  await expect(panel).toContainText('nessuna parete interna');
  // Laterale e fondo di 2 mm: cavità 36 × 16 per 18 di altezza
  await expect.poll(() => page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume)).toBeCloseTo(40 * 20 * 20 - 36 * 16 * 18, 2);
  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  expect(await readCode(page)).toContain('projection(cut = true)');
});

test('l\'unione appoggia il risultato sul piatto e Ctrl+Z la annulla in un solo passo', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Cilindro');
  // Il cubo viene sollevato di 50 mm: l'unione deve riportare tutto sul piatto
  const scene = await sceneState(page);
  const cubeId = Object.keys(scene.nodes).find((id) => scene.nodes[id].name === 'Cubo')!;
  await page.evaluate((id) => window.__webcad!.store.getState().updateNode(id, { position: [0, 0, 60] }), cubeId);
  await settled(page);
  await page.locator('.outliner__row', { hasText: 'Cubo' }).click();
  await page.locator('.outliner__row', { hasText: 'Cilindro' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Unione' }).first().click();
  await expect.poll(() => page.evaluate(() => Math.min(...window.__webcad!.results.getState().meshes.map((m) => m.bbox.min[2])))).toBeCloseTo(0, 3);

  await page.keyboard.press('Control+z');
  await expect(page.locator('.outliner__row')).toHaveCount(2);
  // L'annullamento riporta il cubo dov'era, non su una quota intermedia
  expect((await sceneState(page)).nodes[cubeId].position[2]).toBe(60);
});

test('cambiando l\'altezza dal pannello la base resta sul piatto', async ({ page }) => {
  await addShape(page, 'Cilindro');
  const field = page.locator('.slider-field', { hasText: 'Altezza' }).locator('.number-field__input');
  await field.fill('50');
  await field.press('Enter');
  await settled(page);
  const bbox = await page.evaluate(() => window.__webcad!.results.getState().meshes[0].bbox);
  expect(bbox.min[2]).toBeCloseTo(0, 3);
  expect(bbox.max[2]).toBeCloseTo(50, 3);
});

test('Sposta: restano le frecce X, Y, Z e il piano XY, senza maniglia libera né piani XZ e YZ', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.keyboard.press('w');
  const names = await page.evaluate(() => {
    const found: string[] = [];
    window.__r3f!.scene.traverse((o) => {
      if (!(o as unknown as { isTransformControls?: boolean }).isTransformControls) return;
      // Gizmo e picker di traslazione: gruppi con le maniglie come figli
      const inner = (o as unknown as { gizmo: { gizmo: Record<string, { children: { name: string }[] }> } }).gizmo;
      found.push(...inner.gizmo.translate.children.map((c) => c.name));
    });
    return [...new Set(found)].sort();
  });
  expect(names).toEqual(['X', 'XY', 'Y', 'Z']);
});

test('X mostra gli operandi sottratti in trasparenza e un secondo X li nasconde', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Cilindro');
  await page.locator('.outliner__row', { hasText: 'Cubo' }).click();
  await page.locator('.outliner__row', { hasText: 'Cilindro' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Differenza' }).first().click();
  await settled(page);

  const ghostCount = () =>
    page.evaluate(() => {
      let n = 0;
      window.__r3f!.scene.traverse((o) => {
        const m = o as unknown as { isMesh?: boolean; material?: { opacity: number; color: { getHexString(): string } } };
        if (m.isMesh && m.material?.opacity === 0.35 && m.material.color.getHexString() === 'ff4d4d') n++;
      });
      return n;
    });
  expect(await ghostCount()).toBe(0);
  await page.keyboard.press('x');
  await expect.poll(ghostCount).toBe(1);
  await page.keyboard.press('x');
  await expect.poll(ghostCount).toBe(0);
});

test('la timeline elenca le operazioni e un clic riporta la scena a quel punto', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Cilindro');
  const steps = page.locator('.timeline__step');
  await expect(steps).toHaveText([/Inizio/, /Aggiungi Cubo/, /Aggiungi Cilindro/]);
  await expect(steps.nth(2)).toHaveAttribute('aria-current', 'step');

  // Salto indietro di due passi: la scena è vuota e i passi successivi restano disponibili
  await steps.nth(0).click();
  await expect(page.locator('.outliner__row')).toHaveCount(0);
  await expect(steps).toHaveCount(3);
  // Salto avanti fino all'ultimo
  await steps.nth(2).click();
  await expect(page.locator('.outliner__row')).toHaveCount(2);

  // Una nuova modifica dopo un salto scarta i passi successivi
  await steps.nth(1).click();
  await expect(page.locator('.outliner__row')).toHaveCount(1);
  await addShape(page, 'Sfera');
  await expect(steps).toHaveText([/Inizio/, /Aggiungi Cubo/, /Aggiungi Sfera/]);
});

test('Smusso angolare: Maiusc+clic aggiunge e toglie vertici con anteprima sempre viva e valori modificabili', async ({ page }) => {
  await addShape(page, 'Cubo');
  const history = () => page.evaluate(() => window.__webcad!.store.temporal.getState().pastStates.length);
  const volume = () => page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume);
  const before = await history();
  await page.keyboard.press('a');
  const panel = page.getByRole('region', { name: 'Smusso angolare' });
  const distance = panel.locator('.slider-field', { hasText: 'Distanza' }).locator('.number-field__input');
  // Senza vertici gli slider sono spenti, non c'è un pulsante Anteprima
  await expect(distance).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Anteprima' })).toHaveCount(0);

  const corners: [number, number, number][] = [[9, -9, 20], [-9, -9, 20], [-9, 9, 20]];
  const click = async (c: [number, number, number], shift: boolean) => {
    const at = await project(page, c);
    await page.mouse.move(at.x, at.y);
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.click(at.x, at.y);
    if (shift) await page.keyboard.up('Shift');
    await settled(page);
  };
  // Un vertice: anteprima subito, slider attivi. Poi Maiusc+clic ne aggiunge altri e l'anteprima segue
  await click(corners[0], false);
  await expect(panel.getByText('1 scelto', { exact: true })).toBeVisible();
  await expect(distance).toBeEnabled();
  await expect.poll(volume).toBeCloseTo(8000 - 1 * (8 / 6), 2);
  await click(corners[1], true);
  await expect(panel.getByText('2 scelti', { exact: true })).toBeVisible();
  await expect.poll(volume).toBeCloseTo(8000 - 2 * (8 / 6), 2);
  await click(corners[2], true);
  await expect(panel.getByText('3 scelti', { exact: true })).toBeVisible();
  await expect.poll(volume).toBeCloseTo(8000 - 3 * (8 / 6), 2);

  // La distanza si cambia con l'anteprima aperta, per tutti i vertici insieme (tetraedro di lato 4: 4³/6)
  await distance.fill('4');
  await distance.press('Enter');
  await settled(page);
  await expect.poll(volume).toBeCloseTo(8000 - 3 * (64 / 6), 2);

  // Maiusc+clic su un vertice già scelto lo toglie
  await click(corners[2], true);
  await expect(panel.getByText('2 scelti', { exact: true })).toBeVisible();
  await expect.poll(volume).toBeCloseTo(8000 - 2 * (64 / 6), 2);

  await panel.getByRole('button', { name: 'OK' }).click();
  await expect(panel).toBeHidden();
  await settled(page);
  expect(await history()).toBe(before + 1);
  const scene = await sceneState(page);
  expect(Object.values(scene.nodes).filter((n: any) => n.type === 'corner')).toHaveLength(2);
  expect(Object.values(scene.nodes).filter((n: any) => n.type === 'group')).toHaveLength(1);
});

test('Smusso angolare: togliendo ultimo vertice si torna al pezzo intero', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.keyboard.press('a');
  const panel = page.getByRole('region', { name: 'Smusso angolare' });
  const at = await project(page, [9, -9, 20]);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await settled(page);
  await expect(panel.getByText('1 scelto', { exact: true })).toBeVisible();
  await page.keyboard.down('Shift');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('Shift');
  await settled(page);
  await expect(panel.getByText('da scegliere', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume)).toBeCloseTo(8000, 2);
  // Si può scegliere di nuovo
  await page.mouse.click(at.x, at.y);
  await settled(page);
  await expect(panel.getByText('1 scelto', { exact: true })).toBeVisible();
});

test('Nuovo: primo pulsante della toolbar, chiede conferma e tutto resta annullabile', async ({ page }) => {
  const buttons = page.locator('header.toolbar button');
  await expect(buttons.first()).toHaveAttribute('aria-label', 'Nuovo progetto');
  // Con la scena vuota non chiede nulla
  await page.keyboard.press('n');
  await expect(page.getByRole('dialog')).toBeHidden();

  await addShape(page, 'Cubo');
  await buttons.first().click();
  await expect(page.getByRole('dialog')).toContainText('Svuotare la scena');
  await page.getByRole('dialog').getByRole('button', { name: 'Svuota' }).click();
  expect((await sceneState(page)).rootIds).toHaveLength(0);
  await page.keyboard.press('Control+z');
  expect((await sceneState(page)).rootIds).toHaveLength(1);

  // Anche il tasto N apre la conferma
  await page.keyboard.press('n');
  await expect(page.getByRole('dialog')).toContainText('Svuotare la scena');
  await page.keyboard.press('Escape');
  expect((await sceneState(page)).rootIds).toHaveLength(1);
});

test('Salva senza selettore di file: chiede il nome e scarica con estensione .json', async ({ page }) => {
  await addShape(page, 'Cubo');
  await openMenuItem(page, 'Salva progetto');
  const dialog = page.getByRole('dialog');
  const name = dialog.getByRole('textbox');
  await expect(name).toHaveValue('webcad-progetto.json');
  await name.fill('il mio pezzo');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Salva' }).click();
  expect((await download).suggestedFilename()).toBe('il mio pezzo.json');
  await expect(page.locator('.toast--info')).toContainText('Salvato: il mio pezzo.json');

  // La volta dopo il nome proposto è quello scelto
  await openMenuItem(page, 'Salva con nome…');
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('il mio pezzo.json');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('Salva con il selettore di file: nome e cartella scelti, poi Salva riscrive senza chiedere', async ({ page }) => {
  await addShape(page, 'Cubo');
  // Finto selettore: registra le richieste e quello che viene scritto
  await page.evaluate(() => {
    const w = window as unknown as { showSaveFilePicker: unknown; __picks: { suggestedName?: string }[]; __written: string[] };
    w.__picks = [];
    w.__written = [];
    w.showSaveFilePicker = async (options: { suggestedName?: string }) => {
      w.__picks.push(options);
      return { name: 'scelto.json', createWritable: async () => ({ write: async (data: string) => void w.__written.push(data), close: async () => undefined }) };
    };
  });
  const state = () => page.evaluate(() => {
    const w = window as unknown as { __picks: { suggestedName?: string }[]; __written: string[] };
    return { picks: w.__picks.length, written: w.__written.length, suggested: w.__picks.at(-1)?.suggestedName, json: w.__written.at(-1) };
  });

  await openMenuItem(page, 'Salva progetto');
  await expect.poll(async () => (await state()).written).toBe(1);
  expect(await state()).toMatchObject({ picks: 1, suggested: 'webcad-progetto.json' });
  expect(JSON.parse((await state()).json!).format).toBe('webcad-scene');
  await expect(page.locator('.toast--info')).toContainText('Salvato: scelto.json');

  // Il secondo Salva riscrive lo stesso file senza riaprire il selettore
  await openMenuItem(page, 'Salva progetto');
  await expect.poll(async () => (await state()).written).toBe(2);
  expect((await state()).picks).toBe(1);

  // Salva con nome lo riapre, proponendo il nome già scelto
  await openMenuItem(page, 'Salva con nome…');
  await expect.poll(async () => (await state()).picks).toBe(2);
  expect((await state()).suggested).toBe('scelto.json');
});

test('le dodici forme 2D si aggiungono dalla libreria e danno un solido valido', async ({ page }) => {
  const labels = ['Cerchio', 'Quadrato', 'Anello', 'Cuore', 'Stella 5 punte', 'Stella 6 punte', 'Uovo', 'Trapezio', 'Croce', 'Goccia', 'Mezzaluna', 'Testo'];
  await page.getByRole('tab', { name: 'Forme 2D' }).click();
  await expect(page.locator('button[title^="Aggiungi: "][title$="estruso"]')).toHaveCount(labels.length);
  for (const label of labels) {
    await addShape(page, label);
    await settled(page);
    await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  }
  await expect(page.locator('.outliner__row')).toHaveCount(labels.length);
  // Ogni forma ha le sue proprietà: il terzo slider dell'anello è il foro
  await page.locator('.outliner__row', { hasText: 'Anello' }).click();
  await expect(page.locator('.slider-field', { hasText: 'Foro' })).toBeVisible();
});

test('Testo: scritta e font dal pannello, un passo di Annulla per ogni modifica, Esc annulla la bozza', async ({ page }) => {
  await addShape(page, 'Testo');
  await settled(page);
  const id = (await sceneState(page)).rootIds[0];
  const history = () => page.evaluate(() => window.__webcad!.store.temporal.getState().pastStates.length);
  const width = () => page.evaluate(() => { const b = window.__webcad!.results.getState().meshes[0].bbox; return b.max[0] - b.min[0]; });
  const field = page.locator('label.properties__row', { has: page.locator('.properties__label', { hasText: /^Testo$/ }) }).locator('input');

  const before = await history();
  const narrow = await width();
  // Scrivere non modifica la scena finché non si conferma: una sola voce di cronologia per l'intera scritta
  await field.fill('Ciao mondo');
  expect(await history()).toBe(before);
  await field.press('Enter');
  await settled(page);
  expect((await sceneState(page)).nodes[id].text).toBe('Ciao mondo');
  expect(await history()).toBe(before + 1);
  expect(await width()).toBeGreaterThan(narrow * 1.5);

  // Esc scarta la bozza
  await field.fill('scartato');
  await field.press('Escape');
  await expect(field).toHaveValue('Ciao mondo');
  expect((await sceneState(page)).nodes[id].text).toBe('Ciao mondo');
  expect(await history()).toBe(before + 1);

  // Cambio di font: un altro passo e un'altra larghezza
  const regular = await width();
  await page.locator('select.properties__text').selectOption('pacifico');
  await settled(page);
  expect((await sceneState(page)).nodes[id].font).toBe('pacifico');
  expect(await history()).toBe(before + 2);
  expect(await width()).not.toBeCloseTo(regular, 0);
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
});

test('Esporta OpenSCAD con il testo: ZIP con il .scad e i font usati', async ({ page }) => {
  await addShape(page, 'Testo');
  await settled(page);
  await page.locator('select.properties__text').selectOption('lobster');
  await settled(page);
  const download = page.waitForEvent('download');
  await openMenuItem(page, 'Esporta');
  await page.getByRole('dialog').getByRole('button', { name: 'OpenSCAD' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('webcad.zip');
  const { readFileSync } = await import('node:fs');
  const { unzipSync, strFromU8 } = await import('fflate');
  const entries = unzipSync(new Uint8Array(readFileSync(await file.path())));
  expect(Object.keys(entries).sort()).toEqual(['Lobster-Regular.ttf', 'webcad.scad']);
  const code = strFromU8(entries['webcad.scad']);
  expect(code).toContain('use <Lobster-Regular.ttf>;');
  expect(code).toContain('text("Testo", size = 10, font = "Lobster:style=Regular"');
  // Il TTF dello ZIP è un file font vero
  expect(entries['Lobster-Regular.ttf'].length).toBeGreaterThan(50000);
  expect(new DataView(entries['Lobster-Regular.ttf'].buffer, entries['Lobster-Regular.ttf'].byteOffset).getUint32(0)).toBe(0x00010000);
});

/** Ingombro nel mondo di ogni oggetto alla radice, dai risultati del kernel. */
const boundsOf = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.__webcad!.results.getState().meshes.map((m) => ({ name: window.__webcad!.store.getState().scene.nodes[m.rootId].name, min: m.bbox.min, max: m.bbox.max })));

test('Allinea (K): la tendina allinea cubo e sfera al lato scelto dell\'ingombro, in un solo passo di Annulla', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Sfera');
  // Cubo e sfera a distanze diverse sull'asse X
  await page.evaluate(() => {
    const st = window.__webcad!.store.getState();
    const [sfera, cubo] = st.scene.rootIds;
    st.updateNode(cubo, { position: [-40, 0, 10] });
    st.updateNode(sfera, { position: [30, 0, 10] });
    st.select([cubo, sfera]);
  });
  await settled(page);
  // Il tasto K apre la tendina; Max sull'asse X porta il lato destro di entrambi allo stesso punto
  await page.keyboard.press('k');
  const history = () => page.evaluate(() => window.__webcad!.store.temporal.getState().pastStates.length);
  const before = await history();
  await page.locator('button[title^="Allinea sull\'asse X: max"]').click();
  await settled(page);
  const [a, b] = await boundsOf(page);
  expect(a.max[0]).toBeCloseTo(b.max[0], 3);
  // La sfera (a destra) non si è mossa: l'ingombro complessivo finisce a 40
  expect(Math.max(a.max[0], b.max[0])).toBeCloseTo(40, 3);
  expect(await history()).toBe(before + 1);
  // La tendina si chiude dopo la scelta
  await expect(page.locator('button[title^="Allinea sull\'asse X: max"]')).toHaveCount(0);
});

test('Specchia (Y): due oggetti si riflettono attorno al centro della selezione, il codice ha mirror() e due volte li riporta come erano', async ({ page }) => {
  await addShape(page, 'Cono');
  await addShape(page, 'Sfera');
  const [cono, sfera] = await page.evaluate(() => {
    const st = window.__webcad!.store.getState();
    const [sfera, cono] = st.scene.rootIds;
    st.updateNode(cono, { position: [-40, 0, 10] });
    st.updateNode(sfera, { position: [30, 0, 10] });
    st.select([cono, sfera]);
    return [cono, sfera];
  });
  await settled(page);
  const mirrorX = async () => {
    await page.keyboard.press('y');
    await page.getByRole('menuitem', { name: 'Specchia X Centro' }).click();
    await settled(page);
  };

  // Ingombro complessivo da -50 a 40: il centro è -5, quindi cono e sfera si scambiano di posto
  await mirrorX();
  let nodes = (await sceneState(page)).nodes;
  expect(nodes[cono].position).toEqual([30, 0, 10]);
  expect(nodes[sfera].position).toEqual([-40, 0, 10]);
  expect(nodes[cono].mirror).toEqual([true, false, false]);
  expect(nodes[sfera].mirror).toEqual([true, false, false]);
  expect(await readCode(page)).toContain('mirror([1, 0, 0])');
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');

  await mirrorX();
  nodes = (await sceneState(page)).nodes;
  expect(nodes[cono].position).toEqual([-40, 0, 10]);
  expect(nodes[sfera].position).toEqual([30, 0, 10]);
  expect(nodes[cono].mirror).toBeUndefined();
});

test('Misura (I): due clic sugli angoli di un cubo di 20 mm danno 20,00 mm, un terzo clic ricomincia, Esc chiude', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.keyboard.press('i');
  await expect(page.getByRole('region', { name: 'Misura' })).toBeVisible();

  // Angoli superiori del cubo (centro in [0, 0, 10]); si clicca appena dentro la faccia: lo snap porta sul vertice
  const first = await project(page, [9.5, -9.5, 10]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.click(first.x, first.y);
  const second = await project(page, [-9.5, -9.5, 10]);
  await page.mouse.move(second.x, second.y);
  await page.mouse.click(second.x, second.y);
  await expect(page.getByTestId('measure-distance')).toContainText('20,00 mm');
  // La scena non è stata toccata e il cubo non si è selezionato
  expect((await sceneState(page)).rootIds).toHaveLength(1);

  // Un terzo clic avvia una nuova misura: il risultato sparisce
  await page.mouse.click(first.x, first.y);
  await expect(page.getByTestId('measure-distance')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Misura' })).toHaveCount(0);
});

test('Importa SVG: il disegno con un foro diventa una forma 2D estrusa con volume e ingombro giusti', async ({ page }) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill-rule="evenodd" d="M10 10 H50 V30 H10 Z M20 15 H30 V25 H20 Z"/></svg>';
  const chooser = page.waitForEvent('filechooser');
  await openMenuItem(page, 'Importa');
  await page.getByRole('button', { name: /Importa SVG/ }).click();
  await (await chooser).setFiles({ name: 'sagoma.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  await expect(page.locator('.toast--info')).toContainText('SVG importato');
  await settled(page);

  const scene = await sceneState(page);
  const node = scene.nodes[scene.rootIds[0]];
  expect(node).toMatchObject({ type: 'shape2d', kind: 'svg', name: 'sagoma', width: 40, depth: 20, height: 2, fileName: 'sagoma.svg' });
  // Appoggiato sul piatto: l'estrusione è centrata, quindi Z = metà altezza
  expect(node.position).toEqual([0, 0, 1]);
  // (40 × 20 − foro 10 × 10) × 2 mm = 1,4 cm³
  await expect(page.locator('.status-bar')).toContainText('Volume 1.40 cm³');
  expect(await readCode(page)).toContain('polygon(points = [');
});

test('la libreria ha quattro tab (Forme 3D, Forme 2D, Simboli, Emoji), si usano anche con le frecce e la scelta resta dopo il ricaricamento', async ({ page }) => {
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveText(['Forme 3D', 'Forme 2D', 'Simboli', 'Emoji']);
  await expect(page.getByRole('tab', { name: 'Forme 3D' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('button[title^="Aggiungi: Cubo"]')).toBeVisible();
  await expect(page.locator('button[title^="Aggiungi: Cerchio"]')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Forme 2D' }).click();
  await expect(page.locator('button[title^="Aggiungi: Cerchio"]')).toBeVisible();
  await expect(page.locator('button[title^="Aggiungi: Cubo"]')).toHaveCount(0);

  // Freccia destra: passa a Simboli e il focus la segue
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Simboli' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Simboli' })).toBeFocused();

  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Simboli' })).toHaveAttribute('aria-selected', 'true');
});

test('Simboli: il codice si scarica solo aprendo la tab e un clic crea un Testo estruso valido con quel simbolo', async ({ page }) => {
  const loaded: string[] = [];
  page.on('request', (r) => loaded.push(r.url()));
  expect(loaded.some((u) => u.includes('SymbolsPanel'))).toBe(false);

  await page.getByRole('tab', { name: 'Simboli' }).click();
  await expect(page.getByRole('searchbox', { name: 'Cerca un simbolo' })).toBeVisible();
  expect(loaded.some((u) => u.includes('SymbolsPanel'))).toBe(true);

  // La ricerca filtra per nome
  await page.getByRole('searchbox', { name: 'Cerca un simbolo' }).fill('cuore');
  await expect(page.locator('button[title^="Aggiungi simbolo: Cuore"]').first()).toBeVisible();
  await expect(page.locator('button[title="Aggiungi simbolo: Stella piena"]')).toHaveCount(0);
  // Con una ricerca in corso i gruppi con risultati si aprono da soli
  await page.getByRole('searchbox', { name: 'Cerca un simbolo' }).fill('stella piena');

  await page.locator('button[title="Aggiungi simbolo: Stella piena"]').click();
  await settled(page);
  const scene = await sceneState(page);
  const node = scene.nodes[scene.rootIds[0]];
  expect(node).toMatchObject({ type: 'shape2d', kind: 'text', text: '★', font: 'noto-symbols-2' });
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  // La stella ha davvero una geometria: volume maggiore di zero
  const volume = await page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume);
  expect(volume).toBeGreaterThan(10);
});

test('Nuovo con la casella "Svuota anche la cronologia": la timeline riparte da zero e Ctrl+Z non ripristina nulla', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Sfera');
  const history = () => page.evaluate(() => window.__webcad!.store.temporal.getState().pastStates.length);
  expect(await history()).toBeGreaterThan(1);

  await page.keyboard.press('n');
  const dialog = page.getByRole('dialog');
  const check = dialog.getByRole('checkbox', { name: /Svuota anche la cronologia/ });
  await expect(check).not.toBeChecked();
  await check.check();
  await dialog.getByRole('button', { name: 'Svuota' }).click();

  expect((await sceneState(page)).rootIds).toHaveLength(0);
  expect(await history()).toBe(0);
  await page.keyboard.press('Control+z');
  expect((await sceneState(page)).rootIds).toHaveLength(0);
});

test('Ultimi valori: le misure inserite su una forma restano per le forme nuove, anche dopo il ricaricamento', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.evaluate(() => {
    const st = window.__webcad!.store.getState();
    st.updateNode(st.scene.rootIds[0], { size: [30, 12, 40], cornerRadius: 3 } as never);
  });
  await settled(page);
  // Il ricaricamento riporta anche il primo cubo (salvataggio automatico): il nuovo è sempre in cima all'elenco
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => !!window.__webcad);
  await addShape(page, 'Cubo');
  const scene = await sceneState(page);
  const node = scene.nodes[scene.rootIds[0]];
  expect(node).toMatchObject({ size: [30, 12, 40], cornerRadius: 3 });
  // Appoggiato sul piatto con la nuova altezza
  expect(node.position[2]).toBe(20);
});

/** Numero di oggetti dell'anteprima di Allinea/Specchia nella vista (le linee hanno renderOrder 5). */
const previewLines = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    let n = 0;
    window.__r3f!.scene.traverse((o) => {
      if (o.renderOrder === 5 && o.visible) n++;
    });
    return n;
  });

/** Cubo a x = -40 (da -50 a -30) e sfera a x = 30 (da 20 a 40), entrambi selezionati. */
async function cubeAndSphere(page: import('@playwright/test').Page) {
  await addShape(page, 'Cubo');
  await addShape(page, 'Sfera');
  const ids = await page.evaluate(() => {
    const st = window.__webcad!.store.getState();
    const [sfera, cubo] = st.scene.rootIds;
    st.updateNode(cubo, { position: [-40, 0, 10] });
    st.updateNode(sfera, { position: [30, 0, 10] });
    st.select([cubo, sfera]);
    return [cubo, sfera];
  });
  await settled(page);
  return ids as [string, string];
}

test('Specchia: Min porta il piano di specchio sul lato scelto e l\'anteprima compare solo sopra il pulsante', async ({ page }) => {
  const [cubo, sfera] = await cubeAndSphere(page);
  expect(await previewLines(page)).toBe(0);

  await page.keyboard.press('y');
  const min = page.getByRole('menuitem', { name: 'Specchia X Min' });
  await min.hover();
  await expect.poll(() => previewLines(page)).toBeGreaterThan(0);
  await page.getByRole('menuitem', { name: 'Specchia X Max' }).hover();
  await expect.poll(() => previewLines(page)).toBeGreaterThan(0);
  // Fuori dal pulsante l'anteprima sparisce
  await page.mouse.move(700, 600);
  await expect.poll(() => previewLines(page)).toBe(0);

  // Min: il piano sta a x = -50 (lato sinistro del cubo): il cubo (-40) va a -60, la sfera (30) a -130
  await min.click();
  await settled(page);
  const nodes = (await sceneState(page)).nodes;
  expect(nodes[cubo].position[0]).toBe(-60);
  expect(nodes[sfera].position[0]).toBe(-130);
  expect(await previewLines(page)).toBe(0);
});

test('Allinea: passando sopra un pulsante compare l\'anteprima del risultato e Esc la toglie', async ({ page }) => {
  await cubeAndSphere(page);
  await page.keyboard.press('k');
  await page.getByRole('menuitem', { name: 'Allinea Y Centro' }).hover();
  await expect.poll(() => previewLines(page)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect.poll(() => previewLines(page)).toBe(0);
});

test('Testo: venti font in cinque gruppi, uno nuovo si applica e la mesh resta valida', async ({ page }) => {
  await addShape(page, 'Testo');
  const select = page.locator('select.properties__text');
  await expect(select.locator('optgroup')).toHaveCount(5);
  await expect(select.locator('option')).toHaveCount(20);
  await select.selectOption('stardos-stencil-bold');
  await settled(page);
  const scene = await sceneState(page);
  expect(scene.nodes[scene.rootIds[0]].font).toBe('stardos-stencil-bold');
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
});

test('Lazy loading: i pannelli degli strumenti e le modali del menu si scaricano solo quando servono', async ({ page }) => {
  const loaded: string[] = [];
  page.on('request', (r) => loaded.push(r.url()));
  await addShape(page, 'Cubo');
  const had = (name: string) => loaded.some((u) => u.includes(name));
  expect(had('MeasurePanel')).toBe(false);
  expect(had('AppMenuPanels')).toBe(false);
  expect(had('three-loaders')).toBe(false);

  await page.keyboard.press('i');
  await expect(page.getByRole('region', { name: 'Misura' })).toBeVisible();
  expect(had('MeasurePanel')).toBe(true);
  await page.keyboard.press('Escape');

  await openMenuItem(page, 'Scorciatoie da tastiera');
  await expect(page.getByRole('dialog')).toContainText('Misura');
  expect(had('AppMenuPanels')).toBe(true);
  // Il lettore SVG (SVGLoader di three) serve solo importando un SVG
  expect(had('three-loaders')).toBe(false);
});

test('Simboli: i gruppi sono accordion (solo il primo aperto), si aprono con un clic e lo stato resta dopo il ricaricamento', async ({ page }) => {
  await page.getByRole('tab', { name: 'Simboli' }).click();
  const frecce = page.getByRole('button', { name: /^Frecce/ });
  const stelle = page.getByRole('button', { name: /^Stelle e forme/ });
  await expect(frecce).toHaveAttribute('aria-expanded', 'true');
  await expect(stelle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('button[title="Aggiungi simbolo: Freccia a destra"]')).toBeVisible();
  await expect(page.locator('button[title="Aggiungi simbolo: Stella piena"]')).toHaveCount(0);

  await stelle.click();
  await expect(stelle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('button[title="Aggiungi simbolo: Stella piena"]')).toBeVisible();
  await frecce.click();
  await expect(page.locator('button[title="Aggiungi simbolo: Freccia a destra"]')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Stelle e forme/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: /^Frecce/ })).toHaveAttribute('aria-expanded', 'false');
});

test('Emoji: quarta tab con le categorie, un clic crea un Testo estruso valido con quell\'emoji', async ({ page }) => {
  await expect(page.getByRole('tab')).toHaveText(['Forme 3D', 'Forme 2D', 'Simboli', 'Emoji']);
  await page.getByRole('tab', { name: 'Emoji' }).click();
  const facce = page.getByRole('button', { name: /^Facce e gesti/ });
  await expect(facce).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: /^Animali e fantasy/ })).toHaveAttribute('aria-expanded', 'false');

  await page.locator('button[title="Aggiungi emoji: U+1F602"]').click();
  await settled(page);
  const scene = await sceneState(page);
  const node = scene.nodes[scene.rootIds[0]];
  expect(node).toMatchObject({ type: 'shape2d', kind: 'text', text: '😂', font: 'noto-emoji' });
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  const volume = await page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume);
  expect(volume).toBeGreaterThan(10);
});

test('le quattro tab hanno la stessa altezza: la sezione Oggetti non si sposta cambiando tab', async ({ page }) => {
  const box = async () => (await page.locator('.outliner').boundingBox())!;
  const first = await box();
  const panel = await page.locator('.shape-library').boundingBox();
  for (const name of ['Forme 2D', 'Simboli', 'Emoji', 'Forme 3D']) {
    await page.getByRole('tab', { name }).click();
    await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
    const now = await box();
    expect(now.y, `Oggetti si è spostato con la tab ${name}`).toBe(first.y);
    expect(now.height).toBe(first.height);
    expect((await page.locator('.shape-library').boundingBox())!.height).toBe(panel!.height);
  }
});

test('SVG: il lucchetto mantiene le proporzioni di larghezza e profondità, lo slider Scala ridimensiona in proporzione', async ({ page }) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 10 H50 V30 H10 Z"/></svg>';
  const chooser = page.waitForEvent('filechooser');
  await openMenuItem(page, 'Importa');
  await page.getByRole('button', { name: /Importa SVG/ }).click();
  await (await chooser).setFiles({ name: 'barra.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  await settled(page);
  const id = (await sceneState(page)).rootIds[0];
  const node = async () => (await sceneState(page)).nodes[id];
  expect(await node()).toMatchObject({ width: 40, depth: 20, lockRatio: true });

  const field = (label: string | RegExp) => page.locator('.slider-field').filter({ has: page.getByText(label, { exact: true }) }).locator('.number-field__input');
  const lock = page.getByRole('button', { name: /Bloccate|Libere/ });
  await expect(lock).toHaveAttribute('aria-pressed', 'true');

  // Larghezza 80 con il lucchetto: la profondità segue (40) in un solo passo di Annulla
  const history = () => page.evaluate(() => window.__webcad!.store.temporal.getState().pastStates.length);
  const before = await history();
  await field('Larghezza').fill('80');
  await field('Larghezza').press('Enter');
  await settled(page);
  expect(await node()).toMatchObject({ width: 80, depth: 40 });
  expect(await history()).toBe(before + 1);

  // Scala 50% della dimensione del file (40 mm): 20 × 10
  await field('Scala').fill('50');
  await field('Scala').press('Enter');
  await settled(page);
  expect(await node()).toMatchObject({ width: 20, depth: 10 });

  // Sbloccato: la profondità si cambia da sola; lo slider Scala continua a mantenere il rapporto attuale
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  expect((await node()).lockRatio).toBe(false);
  await field('Profondità').fill('30');
  await field('Profondità').press('Enter');
  await settled(page);
  expect(await node()).toMatchObject({ width: 20, depth: 30 });
  await field('Scala').fill('100');
  await field('Scala').press('Enter');
  await settled(page);
  expect(await node()).toMatchObject({ width: 40, depth: 60 });
});

/** Campo numerico dello slider con questa etichetta esatta (es. "Scala" non coincide con "Scala cima"). */
const numberField = (page: import('@playwright/test').Page, label: string) =>
  page.locator('.slider-field').filter({ has: page.getByText(label, { exact: true }) }).locator('.number-field__input');

test('Simbolo ed emoji: l\'oggetto dice cos\'è invece di chiamarsi "Testo", con icona e titolo del pannello propri', async ({ page }) => {
  await page.getByRole('tab', { name: 'Simboli' }).click();
  await page.locator('button[title="Aggiungi simbolo: Freccia a destra"]').click();
  await settled(page);
  let scene = await sceneState(page);
  let node = scene.nodes[scene.rootIds[0]];
  expect(node).toMatchObject({ kind: 'text', origin: 'symbol', name: 'Simbolo: Freccia a destra', text: '→' });
  await expect(page.locator('.outliner__row', { hasText: 'Simbolo: Freccia a destra' })).toBeVisible();
  await expect(page.locator('.properties__section-title', { hasText: /^Simbolo$/ })).toBeVisible();
  await expect(page.locator('.properties__label', { hasText: 'Carattere' })).toBeVisible();

  await page.getByRole('tab', { name: 'Emoji' }).click();
  await page.locator('button[title="Aggiungi emoji: U+1F602"]').click();
  await page.locator('button[title="Aggiungi emoji: U+1F602"]').first().click();
  await settled(page);
  scene = await sceneState(page);
  const names = scene.rootIds.map((id: string) => scene.nodes[id].name);
  // Il secondo uguale prende il numero progressivo
  expect(names.slice(0, 2)).toEqual(['Emoji 😂 2', 'Emoji 😂']);
  node = scene.nodes[scene.rootIds[0]];
  expect(node).toMatchObject({ origin: 'emoji', font: 'noto-emoji' });
  await expect(page.locator('.properties__section-title', { hasText: /^Emoji$/ })).toBeVisible();
  // Nessun oggetto si chiama "Testo"
  expect(names.some((n: string) => n === 'Testo')).toBe(false);
});

test('Recenti, Preferiti e Apri tutto / Chiudi tutto: si aggiornano con l\'uso e restano dopo il ricaricamento', async ({ page }) => {
  await page.getByRole('tab', { name: 'Simboli' }).click();
  await expect(page.getByRole('button', { name: /^Recenti/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Preferiti/ })).toHaveCount(0);

  // Un clic sul simbolo lo mette tra i Recenti
  await page.locator('button[title="Aggiungi simbolo: Freccia a destra"]').click();
  await settled(page);
  await expect(page.getByRole('button', { name: /^Recenti/ })).toHaveAttribute('aria-expanded', 'true');

  // La stella lo mette tra i Preferiti (compaiono anche nel gruppo delle Frecce: due pulsanti uguali)
  await page.getByRole('button', { name: 'Aggiungi ai preferiti: Freccia a sinistra' }).click({ force: true });
  await expect(page.getByRole('button', { name: /^Preferiti/ })).toBeVisible();

  // Apri tutto apre ogni categoria, Chiudi tutto le chiude
  const headings = page.locator('.accordion__title');
  await page.getByRole('button', { name: 'Apri tutto' }).click();
  // Solo le categorie del catalogo: Preferiti e Recenti restano aperti
  const categories = page.locator('.accordion__title[aria-controls^="accordion-symbols"]').filter({ hasNotText: /^(Preferiti|Recenti)/ });
  const total = await categories.count();
  expect(total).toBeGreaterThan(6);
  for (let i = 0; i < total; i++) await expect(categories.nth(i)).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Chiudi tutto' }).click();
  for (let i = 0; i < total; i++) await expect(categories.nth(i)).toHaveAttribute('aria-expanded', 'false');
  expect(await headings.count()).toBeGreaterThan(total);

  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Recenti/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Preferiti/ })).toBeVisible();
});

test('Estrusione rotazionale: un cerchio lontano dall\'asse diventa un toro, 180 gradi un mezzo toro, e il codice ha rotate_extrude', async ({ page }) => {
  await addShape(page, 'Cerchio');
  const id = (await sceneState(page)).rootIds[0];
  const node = async () => (await sceneState(page)).nodes[id];
  const bbox = () => page.evaluate(() => window.__webcad!.results.getState().meshes[0].bbox);
  const volume = () => page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume);

  await page.getByRole('button', { name: 'Rotazionale' }).click();
  await settled(page);
  // Raggio predefinito = larghezza del cerchio (20 mm): toro con tubo di raggio 10
  expect(await node()).toMatchObject({ extrusion: 'rotate', revolveAngle: 360, revolveRadius: 20, revolveSegments: 64 });
  await numberField(page, 'Raggio').fill('25');
  await numberField(page, 'Raggio').press('Enter');
  await settled(page);
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  const full = await volume();
  expect(full).toBeGreaterThan(48500);
  expect(full).toBeLessThan(49500);
  const b = await bbox();
  expect(b.max[0]).toBeCloseTo(35, 0);
  expect(b.max[2] - b.min[2]).toBeCloseTo(20, 0);

  await numberField(page, 'Angolo').fill('180');
  await numberField(page, 'Angolo').press('Enter');
  await settled(page);
  expect(await volume()).toBeCloseTo(full / 2, -2);
  expect((await bbox()).min[1]).toBeGreaterThan(-0.1);

  const code = await readCode(page);
  expect(code).toContain('rotate_extrude(angle = 180, $fn = 64)');
  expect(code).toContain('translate([25, 0])');
  expect(code).not.toContain('linear_extrude');

  // Tornando a Lineare i parametri della rotazione restano e l'altezza torna a contare
  await page.getByRole('button', { name: 'Lineare', exact: true }).click();
  await settled(page);
  expect(await node()).toMatchObject({ extrusion: 'linear', revolveRadius: 25, revolveAngle: 180 });
  expect(await volume()).toBeCloseTo(3136.5, -1);
});

test('Lucchetto e Scala sul cubo: libero di default, con il lucchetto i lati cambiano insieme e la Scala ridimensiona in proporzione', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  const size = async () => (await sceneState(page)).nodes[id].size;
  const lock = page.getByRole('button', { name: /Bloccate|Libere/ });
  await expect(lock).toHaveAttribute('aria-pressed', 'false');

  // Libero: si cambia un lato solo
  await numberField(page, 'Larghezza').fill('40');
  await numberField(page, 'Larghezza').press('Enter');
  await settled(page);
  expect(await size()).toEqual([40, 20, 20]);

  // Bloccato: gli altri lati seguono con lo stesso fattore (40 → 20 dimezza tutto)
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await numberField(page, 'Larghezza').fill('20');
  await numberField(page, 'Larghezza').press('Enter');
  await settled(page);
  expect(await size()).toEqual([20, 10, 10]);

  // Scala 200 %: 20 mm è la misura iniziale del lato X, quindi X = 40 e gli altri lati raddoppiano con lui
  await numberField(page, 'Scala').fill('200');
  await numberField(page, 'Scala').press('Enter');
  await settled(page);
  expect(await size()).toEqual([40, 20, 20]);
});

test('Appoggia su una faccia (V): un clic sulla faccia scelta ruota il cubo inclinato e lo appoggia sul piatto in un solo passo di Annulla', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = await page.evaluate(() => {
    const st = window.__webcad!.store.getState();
    const id = st.scene.rootIds[0];
    // Cubo inclinato di 30 gradi attorno a X e sollevato: nessuna faccia è sul piatto
    st.updateNode(id, { rotation: [30, 0, 0], position: [0, 0, 20] });
    return id;
  });
  await settled(page);

  await page.keyboard.press('v');
  await expect(page.getByRole('region', { name: 'Appoggia su una faccia' })).toBeVisible();

  // Centro di un triangolo della faccia che guarda più in alto (visibile dalla camera) in coordinate mondo
  const target = await page.evaluate(() => {
    const m = window.__webcad!.results.getState().meshes[0];
    let best = { nz: -2, c: [0, 0, 0] as [number, number, number] };
    for (let t = 0; t < m.indices.length / 3; t++) {
      const p = [0, 1, 2].map((k) => [0, 1, 2].map((a) => m.positions[m.indices[t * 3 + k] * 3 + a]));
      const u = p[1].map((v, i) => v - p[0][i]);
      const w = p[2].map((v, i) => v - p[0][i]);
      const nz = (u[0] * w[1] - u[1] * w[0]) / Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]);
      if (nz > best.nz) best = { nz, c: [0, 1, 2].map((a) => (p[0][a] + p[1][a] + p[2][a]) / 3) as [number, number, number] };
    }
    return best.c;
  });
  const at = await project(page, target);
  await page.mouse.move(at.x, at.y);
  const history = () => page.evaluate(() => window.__webcad!.store.temporal.getState().pastStates.length);
  const before = await history();
  await page.mouse.click(at.x, at.y);

  // Lo strumento si chiude, il cubo è di nuovo allineato agli assi e sta sul piatto (la correzione arriva dopo il kernel)
  await expect(page.getByRole('region', { name: 'Appoggia su una faccia' })).toHaveCount(0);
  await settled(page);
  await expect.poll(async () => (await page.evaluate(() => window.__webcad!.results.getState().meshes[0].bbox.min[2]))).toBeCloseTo(0, 2);
  const bbox = await page.evaluate(() => window.__webcad!.results.getState().meshes[0].bbox);
  for (let a = 0; a < 3; a++) expect(bbox.max[a] - bbox.min[a]).toBeCloseTo(20, 2);
  // Un passo per la rotazione (la correzione sul piatto non conta come passo)
  expect(await history()).toBe(before + 1);
  expect((await sceneState(page)).nodes[id].locked).toBeUndefined();
});

test('Appoggia su una faccia: Esc e il tasto V chiudono lo strumento senza toccare la scena', async ({ page }) => {
  await addShape(page, 'Cubo');
  const before = await sceneState(page);
  await page.keyboard.press('v');
  await expect(page.getByRole('region', { name: 'Appoggia su una faccia' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Appoggia su una faccia' })).toHaveCount(0);
  await page.keyboard.press('v');
  await expect(page.getByRole('region', { name: 'Appoggia su una faccia' })).toBeVisible();
  await page.keyboard.press('v');
  await expect(page.getByRole('region', { name: 'Appoggia su una faccia' })).toHaveCount(0);
  expect((await sceneState(page)).nodes).toEqual(before.nodes);
});

test('Contorno (offset 2D): un quadrato con +2 mm cresce, gli angoli vivi si scelgono e il codice ha offset()', async ({ page }) => {
  await addShape(page, 'Quadrato');
  const bbox = () => page.evaluate(() => window.__webcad!.results.getState().meshes[0].bbox);
  const field = page.locator('.slider-field').filter({ has: page.getByText('Contorno', { exact: true }) }).locator('.number-field__input');
  await field.fill('2');
  await field.press('Enter');
  await settled(page);
  let b = await bbox();
  expect(b.max[0] - b.min[0]).toBeCloseTo(24, 2);
  expect(b.max[1] - b.min[1]).toBeCloseTo(24, 2);
  expect(await readCode(page)).toContain('offset(r = 2, $fn = 32)');

  // Gli angoli vivi compaiono solo con un contorno diverso da zero
  await page.getByRole('button', { name: 'Vivi', exact: true }).click();
  await settled(page);
  expect(await readCode(page)).toContain('offset(delta = 2)');

  // Negativo: il quadrato si restringe; a zero i comandi spariscono
  await field.fill('-2');
  await field.press('Enter');
  await settled(page);
  b = await bbox();
  expect(b.max[0] - b.min[0]).toBeCloseTo(16, 2);
  await field.fill('0');
  await field.press('Enter');
  await settled(page);
  expect(await readCode(page)).not.toContain('offset(');
  await expect(page.getByRole('button', { name: 'Vivi', exact: true })).toHaveCount(0);
});

test('Inviluppo convesso (J): due oggetti diventano un solo gruppo con hull() e la barra sugli oggetti ha il pulsante', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Sfera');
  await page.evaluate(() => {
    const st = window.__webcad!.store.getState();
    const [sfera, cubo] = st.scene.rootIds;
    st.updateNode(cubo, { position: [-40, 0, 10] });
    st.updateNode(sfera, { position: [40, 0, 10] });
    st.select([cubo, sfera]);
  });
  await settled(page);
  await expect(page.getByRole('button', { name: 'Inviluppo', exact: true })).toBeVisible();

  await page.keyboard.press('j');
  await settled(page);
  const scene = await sceneState(page);
  expect(scene.rootIds).toHaveLength(1);
  expect(scene.nodes[scene.rootIds[0]]).toMatchObject({ type: 'group', op: 'hull', name: 'Inviluppo convesso' });
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  // L'inviluppo riempie lo spazio tra le due forme: molto più volume di cubo e sfera insieme
  const volume = await page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume);
  expect(volume).toBeGreaterThan(20000);
  expect(await readCode(page)).toContain('hull() {');

  // Ctrl+Z riporta i due oggetti
  await page.keyboard.press('Control+z');
  expect((await sceneState(page)).rootIds).toHaveLength(2);
});

test('Serie (O): cinque copie in fila con anteprima dal vivo, OK crea un solo gruppo Ripetizione in un passo di Annulla', async ({ page }) => {
  await addShape(page, 'Cubo');
  const history = () => page.evaluate(() => window.__webcad!.store.temporal.getState().pastStates.length);
  const before = await history();
  await page.keyboard.press('o');
  const panel = page.getByRole('region', { name: 'Serie' });
  await expect(panel).toBeVisible();
  await settled(page);

  // Anteprima viva: cinque cubi da 20 mm con passo > 20 in fila lungo X, un solo oggetto
  const bbox = () => page.evaluate(() => window.__webcad!.results.getState().meshes[0].bbox);
  await expect.poll(async () => (await bbox()).max[0] - (await bbox()).min[0]).toBeGreaterThan(100);
  await expect(panel).toContainText('5 copie in totale');
  // La cronologia è in pausa durante l'anteprima
  expect(await history()).toBe(before);

  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const scene = await sceneState(page);
  expect(scene.rootIds).toHaveLength(1);
  const group = scene.nodes[scene.rootIds[0]];
  expect(group).toMatchObject({ type: 'group', op: 'array', name: 'Ripetizione: Cubo' });
  expect(group.array).toMatchObject({ kind: 'linear', count: 5, includeOriginal: true });
  // Nell'elenco oggetti: il gruppo Ripetizione e l'unico originale, non cinque copie
  expect(group.children).toHaveLength(1);
  await expect(page.locator('.outliner__row')).toHaveCount(2);
  await expect(page.locator('.outliner__row', { hasText: 'Ripetizione: Cubo' })).toBeVisible();
  expect(await history()).toBe(before + 1);
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  expect(await readCode(page)).toContain('for (i = [0 : 4])');

  // Ctrl+Z toglie la Ripetizione in un solo passo e ridà il cubo
  await page.keyboard.press('Control+z');
  expect((await sceneState(page)).rootIds).toHaveLength(1);
  expect((await sceneState(page)).nodes[(await sceneState(page)).rootIds[0]].type).toBe('primitive');
});

test('Serie: Esc annulla senza lasciare tracce, e il pulsante è spento senza un oggetto selezionato', async ({ page }) => {
  await addShape(page, 'Cubo');
  const before = await sceneState(page);
  await page.keyboard.press('o');
  await expect(page.getByRole('region', { name: 'Serie' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Serie' })).toHaveCount(0);
  expect((await sceneState(page)).nodes).toEqual(before.nodes);

  // Nessuna selezione: il pulsante è disabilitato e il tasto non apre nulla
  await page.evaluate(() => window.__webcad!.store.getState().select([]));
  await expect(page.locator('header.toolbar button[aria-label^="Serie"]')).toBeDisabled();
  await page.keyboard.press('o');
  await expect(page.getByRole('region', { name: 'Serie' })).toHaveCount(0);
});

test('Ripetizione: i parametri si modificano dal pannello delle proprietà (tipo, copie, angolo) e le copie non sono oggetti', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.keyboard.press('o');
  await page.getByRole('region', { name: 'Serie' }).getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const id = (await sceneState(page)).rootIds[0];
  const volume = () => page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume);
  expect(await volume()).toBeCloseTo(5 * 8000, -1);

  // Cambio il numero di copie dalle proprietà: nessun nuovo oggetto, il volume segue
  const copies = page.locator('.slider-field').filter({ has: page.getByText('Copie', { exact: true }) }).locator('.number-field__input');
  await copies.fill('3');
  await copies.press('Enter');
  await settled(page);
  expect((await sceneState(page)).nodes[id].array.count).toBe(3);
  expect(await volume()).toBeCloseTo(3 * 8000, -1);
  await expect(page.locator('.outliner__row')).toHaveCount(2);

  // Passo al tipo Circolare con quattro copie, ruotate attorno a Z: il volume resta quello di quattro cubi
  await page.getByRole('button', { name: 'Circolare', exact: true }).click();
  await copies.fill('4');
  await copies.press('Enter');
  await settled(page);
  expect((await sceneState(page)).nodes[id].array).toMatchObject({ kind: 'circular', count: 4, angle: 360 });
  expect(await volume()).toBeCloseTo(4 * 8000, -1);
  expect(await readCode(page)).toContain('rotate([0, 0, i * 90])');

  // Griglia 3 × 3
  await page.getByRole('button', { name: 'Griglia', exact: true }).click();
  await settled(page);
  expect(await volume()).toBeCloseTo(9 * 8000, -1);
  await expect(page.getByText('9 copie in totale')).toBeVisible();
});

test('Pattern (Z): anteprima Voronoi dal vivo, OK crea un solo gruppo Pattern in un passo di Annulla con le celle nel codice', async ({ page }) => {
  await addShape(page, 'Cubo');
  const history = () => page.evaluate(() => window.__webcad!.store.temporal.getState().pastStates.length);
  const volume = () => page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume);
  const before = await history();
  await page.keyboard.press('z');
  const panel = page.getByRole('region', { name: 'Pattern' });
  await expect(panel).toBeVisible();
  await settled(page);

  // Anteprima viva: il cubo da 8000 mm³ perde volume (fori passanti) e la cronologia resta in pausa
  await expect.poll(volume).toBeLessThan(7500);
  expect(await volume()).toBeGreaterThan(1500);
  expect(await history()).toBe(before);

  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const scene = await sceneState(page);
  expect(scene.rootIds).toHaveLength(1);
  const group = scene.nodes[scene.rootIds[0]];
  expect(group).toMatchObject({ type: 'group', op: 'pattern', name: 'Pattern Voronoi: Cubo' });
  expect(group.pattern).toMatchObject({ kind: 'voronoi', mode: 'holes', depth: 0, algorithm: 1 });
  expect(group.children).toHaveLength(1);
  await expect(page.locator('.outliner__row')).toHaveCount(2);
  expect(await history()).toBe(before + 1);
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  const code = await readCode(page);
  expect(code).toContain('cells = [');
  expect(code).toContain('for (c = cells)');

  // Ctrl+Z toglie il Pattern in un solo passo e ridà il cubo intero
  await page.keyboard.press('Control+z');
  await settled(page);
  expect((await sceneState(page)).nodes[(await sceneState(page)).rootIds[0]].type).toBe('primitive');
  expect(await volume()).toBeCloseTo(8000, 0);
});

test('Pattern: Esc annulla senza lasciare tracce, e il pulsante è spento senza un oggetto selezionato', async ({ page }) => {
  await addShape(page, 'Cubo');
  const before = await sceneState(page);
  await page.keyboard.press('z');
  await expect(page.getByRole('region', { name: 'Pattern' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Pattern' })).toHaveCount(0);
  expect((await sceneState(page)).nodes).toEqual(before.nodes);

  await page.evaluate(() => window.__webcad!.store.getState().select([]));
  await expect(page.locator('header.toolbar button[aria-label^="Pattern"]')).toBeDisabled();
  await page.keyboard.press('z');
  await expect(page.getByRole('region', { name: 'Pattern' })).toHaveCount(0);
});

test('Pattern: seme, tipo, profondità, rombi, triangoli e facce si modificano dalle proprietà del gruppo', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.keyboard.press('z');
  await page.getByRole('region', { name: 'Pattern' }).getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const id = (await sceneState(page)).rootIds[0];
  const volume = () => page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume);
  const pattern = async () => (await sceneState(page)).nodes[id].pattern;
  const first = await volume();

  // Un altro seme cambia il disegno, non il numero di oggetti
  const seed = page.locator('.array-fields__row', { hasText: 'Seme' }).locator('input');
  await seed.fill('4242');
  await seed.press('Enter');
  await settled(page);
  expect((await pattern()).seed).toBe(4242);
  expect(await volume()).not.toBeCloseTo(first, 1);
  await expect(page.locator('.outliner__row')).toHaveCount(2);

  // Esagoni: celle regolari e codice con la stessa riduzione per la parete
  await page.getByRole('button', { name: 'Esagoni', exact: true }).click();
  await settled(page);
  expect((await pattern()).kind).toBe('hexagon');
  expect(await volume()).toBeLessThan(8000);
  expect(await readCode(page)).toContain('offset(delta = -');

  // Tasca da due lati: il cubo non è più bucato da parte a parte e resta valido
  await page.getByRole('button', { name: 'Voronoi', exact: true }).click();
  const depth = page.locator('.slider-field').filter({ has: page.getByText('Profondità', { exact: true }) }).locator('.number-field__input');
  await depth.fill('4');
  await depth.press('Enter');
  await page.getByRole('button', { name: 'Entrambe', exact: true }).click();
  await settled(page);
  expect(await pattern()).toMatchObject({ kind: 'voronoi', depth: 4, sides: 'both' });
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  expect(await readCode(page)).toContain('for (z = [-4,');

  // Rombi e Triangoli: griglie regolari con la stessa riduzione per la parete
  await page.getByRole('button', { name: 'Rombi', exact: true }).click();
  await settled(page);
  expect((await pattern()).kind).toBe('diamond');
  await page.getByRole('button', { name: 'Triangoli', exact: true }).click();
  await settled(page);
  expect((await pattern()).kind).toBe('triangle');
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');

  // Una seconda faccia (+X) si attiva dai pulsanti dei lati: due elenchi di celle nel codice
  await page.getByRole('group', { name: 'Facce' }).getByRole('button', { name: '+X', exact: true }).click();
  await settled(page);
  expect((await pattern()).faces).toHaveLength(2);
  expect(await readCode(page)).toContain('cells_2 = [');
});

test('Tooltip dettagliati: il pulsante Pattern mostra cosa fa, come si applica, la scorciatoia e un\'immagine', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.locator('header.toolbar button[aria-label^="Pattern"]').hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Fora l\'oggetto');
  await expect(tip).toContainText('Scegli facce');
  await expect(tip.locator('kbd')).toHaveText('Z');
  await expect(tip.locator('img')).toHaveAttribute('src', /help\/pattern\.webp$/);
  // Esc lo chiude e non lascia traccia
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);

  // Anche un pulsante disabilitato spiega cosa fa (senza selezione Unisci non è disponibile)
  await page.locator('header.toolbar button[aria-label^="Unisci"]').hover({ force: true });
  await expect(page.getByRole('tooltip')).toContainText('unione booleana');

  // Il pulsante a stato cambia testo: il piatto dice come è ora e qual è il prossimo
  await page.locator('header.toolbar button[aria-label^="Piatto"]').hover();
  await expect(page.getByRole('tooltip')).toContainText('Prossimo:');
});

test('Pattern: Scegli facce aggiunge e toglie facce con il clic e mostra il pezzo intero durante la scelta', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.keyboard.press('z');
  const panel = page.getByRole('region', { name: 'Pattern' });
  await settled(page);
  const volume = () => page.evaluate(() => window.__webcad!.results.getState().meshes[0].volume);
  await expect.poll(volume).toBeLessThan(7500);

  // Durante la scelta la vista mostra il cubo intero (si cliccano le facce del pezzo, non le pareti delle celle)
  await panel.getByRole('button', { name: 'Scegli facce' }).click();
  await settled(page);
  await expect.poll(volume).toBeCloseTo(8000, 0);
  await expect(panel).toContainText('Clicca le facce');

  // Un clic sulla faccia anteriore l'aggiunge (due facce), un secondo clic la toglie
  const front = await project(page, [0, -10, 10]);
  await page.mouse.move(front.x, front.y);
  await page.mouse.click(front.x, front.y);
  await expect(panel).toContainText('2 facce');
  // Il lato anteriore è uno dei sei lati dell'ingombro: il suo pulsante si accende
  await expect(panel.getByRole('group', { name: 'Facce' }).getByRole('button', { name: '-Y', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(front.x, front.y);
  await expect(panel).toContainText('1 faccia');

  // Si sceglie di nuovo e si chiude la scelta con il pulsante: l'anteprima torna con il pattern su due facce
  await page.mouse.click(front.x, front.y);
  await panel.getByRole('button', { name: 'Fine scelta' }).click();
  await settled(page);
  await expect.poll(volume).toBeLessThan(7500);
  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const scene = await sceneState(page);
  expect(scene.nodes[scene.rootIds[0]].pattern.faces).toHaveLength(2);
  expect(scene.nodes[scene.rootIds[0]].pattern.preview).toBeUndefined();
  expect(await readCode(page)).toContain('cells_2 = [');
});

test('Pattern: avviso se i calcoli sono pesanti e anteprima semplificata, che non resta nel risultato', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.keyboard.press('z');
  const panel = page.getByRole('region', { name: 'Pattern' });
  await settled(page);
  await expect(panel.getByRole('alert')).toHaveCount(0);

  // Molte celle: l'avviso preventivo compare subito
  const cells = panel.locator('.slider-field').filter({ has: page.getByText('Celle', { exact: true }) }).locator('.number-field__input');
  await cells.fill('400');
  await cells.press('Enter');
  await expect(panel.getByRole('alert')).toContainText(/Molte celle|Calcolo lento/);

  // L'anteprima semplificata si attiva a mano e il risultato dopo OK non la contiene
  await panel.getByLabel('Anteprima semplificata').check();
  await settled(page);
  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const scene = await sceneState(page);
  expect(scene.nodes[scene.rootIds[0]].pattern.cells).toBe(400);
  expect(scene.nodes[scene.rootIds[0]].pattern.preview).toBeUndefined();
});

type Page = import('@playwright/test').Page;

/** Larghezza (X) dell'insieme di tutte le mesh calcolate. */
const totalWidth = (page: Page) =>
  page.evaluate(() => {
    const meshes = window.__webcad!.results.getState().meshes.filter((m) => !m.empty);
    return Math.max(...meshes.map((m) => m.bbox.max[0])) - Math.min(...meshes.map((m) => m.bbox.min[0]));
  });

test.describe('Ridimensiona (R) su un gruppo di qualsiasi tipo', () => {
  /** Due oggetti alla radice, selezionati insieme: serve per le operazioni che combinano più oggetti. */
  async function twoShapes(page: Page) {
    await addShape(page, 'Cubo');
    await addShape(page, 'Sfera');
    await page.evaluate(() => window.__webcad!.store.getState().select(window.__webcad!.store.getState().scene.rootIds));
  }
  const cases: [string, (page: Page) => Promise<void>, string][] = [
    ['Raggruppa', async (page) => { await twoShapes(page); await page.keyboard.press('Control+g'); }, 'group'],
    ['Unione', async (page) => { await twoShapes(page); await page.keyboard.press('u'); }, 'union'],
    ['Inviluppo convesso', async (page) => { await twoShapes(page); await page.keyboard.press('j'); }, 'hull'],
    ['Differenza', async (page) => { await twoShapes(page); await page.evaluate(() => { const s = window.__webcad!.store.getState(); const ball = s.scene.rootIds.find((id) => s.scene.nodes[id].type === 'primitive' && (s.scene.nodes[id] as { kind: string }).kind === 'sphere')!; s.updateNode(ball, { radius: 4 } as never); s.select([s.scene.rootIds.find((id) => id !== ball)!, ball]); s.combineSelected('difference'); }); }, 'difference'],
    ['Intersezione', async (page) => { await twoShapes(page); await page.evaluate(() => window.__webcad!.store.getState().combineSelected('intersection')); }, 'intersection'],
    ['Guscio', async (page) => { await addShape(page, 'Cubo'); await page.keyboard.press('g'); await page.getByRole('region', { name: 'Guscio' }).getByRole('button', { name: 'OK' }).click(); }, 'shell'],
    ['Ripetizione', async (page) => { await addShape(page, 'Cubo'); await page.keyboard.press('o'); await page.getByRole('region', { name: 'Serie' }).getByRole('button', { name: 'OK' }).click(); }, 'array'],
    ['Pattern', async (page) => { await addShape(page, 'Cubo'); await page.keyboard.press('z'); await page.getByRole('region', { name: 'Pattern' }).getByRole('button', { name: 'OK' }).click(); }, 'pattern'],
  ];

  for (const [name, setup, op] of cases) {
    test(`${name}: la maniglia X del gizmo allarga tutto il gruppo`, async ({ page }) => {
      await setup(page);
      await settled(page);
      const scene = await sceneState(page);
      const id = scene.rootIds[0];
      expect(scene.nodes[id]).toMatchObject({ type: 'group', op });
      const before = await totalWidth(page);
      await page.evaluate((gid) => window.__webcad!.store.getState().select([gid]), id);
      await page.keyboard.press('r');
      await page.waitForTimeout(150);
      await dragGizmoAxis(page, scene.nodes[id].position, 'X', 60);
      await settled(page);
      const after = (await sceneState(page)).nodes[id];
      expect(after.groupScale?.[0], 'scala X del gruppo').toBeGreaterThan(1);
      expect(after.groupScale?.[1] ?? 1).toBe(1);
      await expect.poll(() => totalWidth(page)).toBeGreaterThan(before * 1.1);
      await expect(page.locator('.status-bar')).toContainText('Mesh valida');
      // Un solo passo di Annulla: tutto torna com'era
      await page.keyboard.press('Control+z');
      await settled(page);
      expect((await sceneState(page)).nodes[id].groupScale).toBeUndefined();
      expect(await totalWidth(page)).toBeCloseTo(before, 2);
    });
  }

  test('le dimensioni si cambiano anche dalle proprietà e il codice ha scale()', async ({ page }) => {
    await twoShapes(page);
    await page.keyboard.press('u');
    await settled(page);
    const id = (await sceneState(page)).rootIds[0];
    const before = await totalWidth(page);
    const x = page.locator('section', { has: page.getByText('Dimensioni del gruppo') }).locator('.number-field__input').first();
    await x.fill('200');
    await x.press('Enter');
    await settled(page);
    expect((await sceneState(page)).nodes[id].groupScale).toEqual([2, 1, 1]);
    expect(await totalWidth(page)).toBeCloseTo(before * 2, 1);
    expect(await readCode(page)).toContain('scale([2, 1, 1])');
    await page.getByRole('button', { name: 'Ripristina 100%' }).click();
    await settled(page);
    expect((await sceneState(page)).nodes[id].groupScale).toBeUndefined();
    expect(await totalWidth(page)).toBeCloseTo(before, 1);
  });
});

test('Piano di stampa: le dimensioni stanno nella barra di stato, prima dell\'ingombro, e si cambiano da una modale', async ({ page }) => {
  await addShape(page, 'Cubo');
  const status = page.locator('.status-bar');
  const items = status.locator('.status-bar__item');
  await expect(items.first()).toHaveText('Piano 256 × 256 mm');
  await expect(items.nth(1)).toContainText('Ingombro');
  const plate = () => page.evaluate(() => {
    const geometry = (window.__r3f!.scene.getObjectByName('bed-plate') as unknown as { geometry: { parameters: { width: number; height: number } } }).geometry;
    return [geometry.parameters.width, geometry.parameters.height];
  });
  expect(await plate()).toEqual([256, 256]);

  await status.getByRole('button', { name: /Piano 256/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Dimensioni del piano' });
  await expect(dialog).toBeVisible();
  const width = dialog.locator('.number-field', { hasText: 'Larghezza X' }).locator('input');
  const depth = dialog.locator('.number-field', { hasText: 'Profondità Y' }).locator('input');
  await width.fill('300');
  await width.press('Enter');
  // Annulla non cambia nulla
  await dialog.getByRole('button', { name: 'Annulla' }).click();
  await expect(status.getByRole('button')).toHaveText('Piano 256 × 256 mm');

  await status.getByRole('button', { name: /Piano 256/ }).click();
  await width.fill('300');
  await width.press('Enter');
  await depth.fill('180');
  await depth.press('Enter');
  await dialog.getByRole('button', { name: 'Applica' }).click();
  await expect(dialog).toBeHidden();
  await expect(status.getByRole('button')).toHaveText('Piano 300 × 180 mm');
  await expect.poll(plate).toEqual([300, 180]);

  // Resta dopo il ricaricamento, e "Predefinito" riporta 256 × 256
  await page.reload();
  await page.waitForFunction(() => !!window.__webcad && !!window.__r3f);
  await expect(status.getByRole('button')).toHaveText('Piano 300 × 180 mm');
  await status.getByRole('button').click();
  await dialog.getByRole('button', { name: /Predefinito/ }).click();
  await dialog.getByRole('button', { name: 'Applica' }).click();
  await expect(status.getByRole('button')).toHaveText('Piano 256 × 256 mm');
});

test('Piano di stampa: i preset delle stampanti compilano le misure e si confermano con Applica', async ({ page }) => {
  const status = page.locator('.status-bar');
  await status.getByRole('button', { name: /Piano 256/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Dimensioni del piano' });
  // Le stampanti sono raggruppate per marca e riportano nome e misure
  for (const brand of ['Bambu Lab', 'Prusa', 'Creality']) await expect(dialog.getByRole('group', { name: brand })).toBeVisible();
  const bambu = dialog.getByRole('group', { name: 'Bambu Lab' });
  await expect(bambu.getByRole('button', { name: /A1 mini.*180 × 180/ })).toBeVisible();
  await expect(bambu.getByRole('button', { name: /H2D.*350 × 320/ })).toBeVisible();
  // Il preset che coincide con le misure attuali è evidenziato
  await expect(bambu.getByRole('button', { name: /A1 \/ P1S/ })).toHaveAttribute('aria-pressed', 'true');

  await bambu.getByRole('button', { name: /A1 mini/ }).click();
  await expect(dialog.locator('.number-field', { hasText: 'Larghezza X' }).locator('input')).toHaveValue('180');
  // Non cambia nulla finché non si applica
  await expect(page.locator('.status-bar__bed')).toHaveText('Piano 256 × 256 mm');
  await dialog.getByRole('button', { name: 'Applica' }).click();
  await expect(page.locator('.status-bar__bed')).toHaveText('Piano 180 × 180 mm');
  await expect.poll(() => page.evaluate(() => (window.__r3f!.scene.getObjectByName('bed-plate') as unknown as { geometry: { parameters: { width: number } } }).geometry.parameters.width)).toBe(180);
});

test('Quote: un clic sulla quota X assegna la larghezza, con un solo passo di Annulla', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  const before = (await sceneState(page)).nodes[id];
  expect(before.size).toEqual([20, 20, 20]);

  const quote = page.locator('.dimension-label[data-axis="x"]');
  await expect(quote).toBeVisible();
  await expect(quote).toContainText('20');
  await quote.click();
  const input = page.locator('.dimension-input[data-axis="x"]');
  await input.fill('40');
  await input.press('Enter');
  await settled(page);

  const after = (await sceneState(page)).nodes[id];
  expect(after.size).toEqual([40, 20, 20]);
  // La base resta sul piatto
  expect(after.position[2]).toBeCloseTo(before.position[2], 3);
  await expect(page.locator('.dimension-label[data-axis="x"]')).toContainText('40');

  // Un solo passo di cronologia: Annulla riporta la misura di prima
  await page.keyboard.press('Control+z');
  await settled(page);
  expect((await sceneState(page)).nodes[id].size).toEqual([20, 20, 20]);
});

test('Quote: Esc annulla la modifica e un oggetto bloccato ha le quote in sola lettura', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  await page.locator('.dimension-label[data-axis="y"]').click();
  const input = page.locator('.dimension-input[data-axis="y"]');
  await input.fill('99');
  await input.press('Escape');
  await expect(input).toBeHidden();
  expect((await sceneState(page)).nodes[id].size).toEqual([20, 20, 20]);

  await page.keyboard.press('l');
  await expect(page.locator('.dimension-label--readonly')).toHaveCount(3);
  await expect(page.locator('button.dimension-label')).toHaveCount(0);
});

test('Quote: la quota Z di un cilindro ne cambia l\'altezza e lascia il raggio', async ({ page }) => {
  await addShape(page, 'Cilindro');
  const id = (await sceneState(page)).rootIds[0];
  await page.locator('.dimension-label[data-axis="z"]').click();
  const input = page.locator('.dimension-input[data-axis="z"]');
  await input.fill('50');
  await input.press('Enter');
  await settled(page);
  const node = (await sceneState(page)).nodes[id];
  expect(node.height).toBe(50);
  expect(node.radius).toBe(10);
});

test('Menu contestuale: il tasto destro su un oggetto mostra solo i comandi applicabili', async ({ page }) => {
  await addShape(page, 'Cubo');
  const menu = page.getByRole('menu', { name: 'Comandi per la selezione' });
  await expect(menu).toBeHidden();
  // Il cubo è centrato in (0, 0, 10): il tasto destro lì cade sull'oggetto
  const at = await project(page, [0, 0, 10]);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(menu).toBeVisible();
  // Un solo oggetto: si può duplicare, eliminare, specchiare; non unire, raggruppare o allineare
  for (const name of ['Duplica', 'Elimina', 'Specchia', 'Blocca', 'Raccordo']) await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
  for (const name of ['Unisci', 'Raggruppa', 'Allinea', 'Separa', 'Sposta']) await expect(menu.getByRole('menuitem', { name, exact: true })).toHaveCount(0);

  // Esc chiude il menu
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // Con due oggetti selezionati compaiono le booleane
  await addShape(page, 'Cilindro');
  await page.locator('.outliner__row', { hasText: 'Cubo' }).click();
  await page.locator('.outliner__row', { hasText: 'Cilindro' }).click({ modifiers: ['Shift'] });
  const second = await project(page, [0, 0, 10]);
  await page.mouse.click(second.x, second.y, { button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Unisci', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Allinea', exact: true })).toBeVisible();
});

test('Menu contestuale: una voce esegue il comando e chiude il menu', async ({ page }) => {
  await addShape(page, 'Cubo');
  const at = await project(page, [0, 0, 10]);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Comandi per la selezione' });
  await menu.getByRole('menuitem', { name: 'Duplica', exact: true }).click();
  await settled(page);
  await expect(menu).toBeHidden();
  expect((await sceneState(page)).rootIds).toHaveLength(2);

  // Il tasto destro nel vuoto non apre nulla
  const empty = await project(page, [-120, 120, 0]);
  await page.mouse.click(empty.x, empty.y, { button: 'right' });
  await expect(menu).toBeHidden();
});

test('Barra strumenti: i comandi sono in gruppi con il nome della sezione', async ({ page }) => {
  const toolbar = page.locator('header.toolbar');
  for (const [name, buttons] of [
    ['File', ['Nuovo progetto', 'Annulla', 'Ripeti']],
    ['Trasforma', ['Seleziona', 'Sposta', 'Ruota', 'Ridimensiona', 'Estrudi']],
    ['Combina', ['Raggruppa', 'Separa', 'Unisci', 'Inviluppo convesso']],
    ['Modifica', ['Raccordo', 'Smusso', 'Smusso angolare', 'Guscio', 'Pattern']],
    ['Disponi', ['Allinea', 'Specchia', 'Serie']],
    ['Oggetto', ['Duplica', 'Elimina', 'Misura']],
    ['Vista', ['Codice OpenSCAD', 'Tema']],
  ] as const) {
    const group = toolbar.getByRole('group', { name });
    await expect(group, `sezione "${name}"`).toBeVisible();
    for (const button of buttons) await expect(group.getByRole('button', { name: button, exact: true }), `"${button}" in "${name}"`).toBeVisible();
  }
});

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
  await page.getByRole('button', { name: /^Piatto:/ }).click();
  await expect.poll(parts).toEqual([false, true, true]);
});

test('ogni pulsante della toolbar ha la scorciatoia nel tooltip', async ({ page }) => {
  await addShape(page, 'Cubo');
  const titles = await page.locator('header.toolbar button').evaluateAll((buttons) => buttons.map((b) => b.getAttribute('title') ?? ''));
  expect(titles.length).toBeGreaterThan(15);
  for (const title of titles) expect(title, `tooltip senza scorciatoia: "${title}"`).toMatch(/\([^)]*(Ctrl|Maiusc|Canc|\b[A-Z]\b)[^)]*\)/);
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

  await page.getByRole('button', { name: /^Smusso/ }).click();
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

import { expect, test } from '@playwright/test';
import { addShape, openApp, readCode, sceneState, settled } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

/** Volume del primo solido calcolato dal kernel. */
const volume = (page: import('@playwright/test').Page) => page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);

test('Pattern Mattoni: le fughe tolgono volume, il codice contiene il rilievo e il disegno si cambia dalle proprietà', async ({ page }) => {
  await addShape(page, 'Cubo');
  expect(await volume(page)).toBeCloseTo(8000, 0);
  await page.keyboard.press('z');
  const panel = page.getByRole('region', { name: 'Pattern' });
  await expect(panel).toBeVisible();
  await panel.getByLabel('Tipo').selectOption({ label: 'Mattoni' });
  await settled(page);

  // Anteprima viva: le fughe scavano il cubo senza forarlo (poco volume in meno)
  await expect.poll(() => volume(page)).toBeLessThan(8000);
  expect(await volume(page)).toBeGreaterThan(7000);

  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const scene = await sceneState(page);
  const id = scene.rootIds[0];
  expect(scene.nodes[id]).toMatchObject({ type: 'group', op: 'pattern', name: 'Pattern Mattoni: Cubo' });
  expect(scene.nodes[id].pattern).toMatchObject({ kind: 'brick', design: 'running', reliefAlgorithm: 1 });
  expect(scene.nodes[id].pattern.relief).toMatchObject({ kind: 'brick', brickW: 24, brickH: 8, mortar: 1.2, depth: 0.8 });
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  const running = await volume(page);
  expect(running).toBeLessThan(8000);

  // Il codice OpenSCAD ha le fughe sottratte e ritagliate sulla faccia (nessun elenco di celle)
  let code = await readCode(page);
  expect(code).toContain('difference() {');
  expect(code).toContain('intersection() {');
  expect(code).toContain('projection(cut = true)');
  expect(code).toContain('for (r = [0 :');
  expect(code).not.toContain('cells = [');

  // Spina di pesce: il disegno cambia, il volume tolto anche, e il codice scrive l'elenco dei mattoni
  await page.getByLabel('Disegno').selectOption({ label: 'Spina di pesce' });
  await settled(page);
  expect((await sceneState(page)).nodes[id].pattern.design).toBe('herringbone');
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  expect(await volume(page)).toBeLessThan(8000);
  expect(await volume(page)).not.toBeCloseTo(running, 3);
  code = await readCode(page);
  expect(code).toContain('bricks = [');
  expect(code).toContain('for (b = bricks)');

  // Cesto
  await page.getByLabel('Disegno').selectOption({ label: 'Cesto' });
  await settled(page);
  expect((await sceneState(page)).nodes[id].pattern.design).toBe('basket');
  expect(await volume(page)).toBeLessThan(8000);

  // I campi dei Pattern a celle non compaiono con un rilievo
  await expect(page.locator('.array-fields__row', { hasText: 'Parete' })).toHaveCount(0);
});

test('Pattern Borchie: il pezzo cresce, il codice unisce le borchie e forma e griglia si cambiano dalle proprietà', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.keyboard.press('z');
  const panel = page.getByRole('region', { name: 'Pattern' });
  await expect(panel).toBeVisible();
  await panel.getByLabel('Tipo').selectOption({ label: 'Borchie' });
  await settled(page);

  // Anteprima viva: le borchie si aggiungono sopra la faccia, quindi il volume supera quello del cubo
  await expect.poll(() => volume(page)).toBeGreaterThan(8000);

  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const scene = await sceneState(page);
  const id = scene.rootIds[0];
  expect(scene.nodes[id]).toMatchObject({ type: 'group', op: 'pattern', name: 'Pattern Borchie: Cubo' });
  expect(scene.nodes[id].pattern).toMatchObject({ kind: 'studs', design: 'dome', reliefAlgorithm: 1 });
  expect(scene.nodes[id].pattern.relief).toMatchObject({ kind: 'studs', pitch: 12, radius: 2.5, height: 1.5, layout: 'square' });
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  const dome = await volume(page);
  expect(dome).toBeGreaterThan(8000);

  // Il solido cresce dell'altezza della borchia sopra la faccia (il cubo sta tra 0 e 20 mm)
  const maxZ = await page.evaluate(() => window.__construct!.results.getState().meshes[0].bbox.max[2]);
  expect(maxZ).toBeCloseTo(20 + 1.5, 2);

  // Il codice OpenSCAD unisce le borchie al pezzo, con l'elenco dei centri già calcolato
  let code = await readCode(page);
  expect(code).toContain('union() {');
  expect(code).toContain('studs = [');
  expect(code).toContain('rotate_extrude($fn = 24)');
  expect(code).not.toContain('cells = [');

  // Piramide: stesso numero di borchie, forma diversa (e un polyhedron nel codice)
  await page.getByLabel('Disegno').selectOption({ label: 'Piramide' });
  await settled(page);
  expect((await sceneState(page)).nodes[id].pattern.design).toBe('pyramid');
  expect(await volume(page)).toBeGreaterThan(8000);
  expect(await volume(page)).not.toBeCloseTo(dome, 3);
  code = await readCode(page);
  expect(code).toContain('polyhedron(points = [');

  // Griglia sfalsata
  await page.getByRole('button', { name: 'Sfalsata', exact: true }).click();
  await settled(page);
  expect((await sceneState(page)).nodes[id].pattern.relief.layout).toBe('staggered');
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  expect(await volume(page)).toBeGreaterThan(8000);

  // Passo troppo stretto: compare l'avviso (le basi si toccano)
  const pitch = page.locator('.slider-field').filter({ has: page.getByText('Passo', { exact: true }) }).locator('.number-field__input');
  await pitch.fill('5');
  await pitch.press('Enter');
  await settled(page);
  await expect(page.getByText('Borchie troppo vicine')).toBeVisible();
});

test('Pattern Rame battuto: gli incavi tolgono volume, il codice contiene il rilievo e il disegno e il seme si cambiano dalle proprietà', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.keyboard.press('z');
  const panel = page.getByRole('region', { name: 'Pattern' });
  await expect(panel).toBeVisible();
  await panel.getByLabel('Tipo').selectOption({ label: 'Rame battuto' });
  await settled(page);

  // Anteprima viva: gli incavi scavano il cubo senza forarlo
  await expect.poll(() => volume(page)).toBeLessThan(8000);
  expect(await volume(page)).toBeGreaterThan(7000);

  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const scene = await sceneState(page);
  const id = scene.rootIds[0];
  expect(scene.nodes[id]).toMatchObject({ type: 'group', op: 'pattern', name: 'Pattern Rame battuto: Cubo' });
  expect(scene.nodes[id].pattern).toMatchObject({ kind: 'hammered', design: 'dimples', reliefAlgorithm: 1 });
  expect(scene.nodes[id].pattern.relief).toMatchObject({ kind: 'hammered', size: 8, depth: 0.5, jitter: 0.25, regularity: 60 });
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  const dimples = await volume(page);
  expect(dimples).toBeLessThan(8000);

  // Il codice OpenSCAD ha l'elenco delle martellate e la calotta ruotata, sottratti e ritagliati sulla faccia
  let code = await readCode(page);
  expect(code).toContain('difference() {');
  expect(code).toContain('dents = [');
  expect(code).toContain('rotate_extrude($fn = 24)');
  expect(code).toContain('projection(cut = true)');
  expect(code).not.toContain('cells = [');

  // Sfaccettato: una faccetta piana per cella
  await page.getByLabel('Disegno').selectOption({ label: 'Sfaccettato' });
  await settled(page);
  expect((await sceneState(page)).nodes[id].pattern.design).toBe('facets');
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  expect(await volume(page)).toBeLessThan(8000);
  expect(await volume(page)).not.toBeCloseTo(dimples, 3);
  code = await readCode(page);
  expect(code).toContain('facets = [');
  expect(code).toContain('polyhedron(points = concat(');

  // Scaglie: calotte ovali (stirate in Y)
  await page.getByLabel('Disegno').selectOption({ label: 'Scaglie' });
  await settled(page);
  expect((await sceneState(page)).nodes[id].pattern.design).toBe('scales');
  expect(await volume(page)).toBeLessThan(8000);
  expect(await readCode(page)).toContain('scale([1, 1.1, 1])');

  // Un altro seme cambia il disegno
  const before = await volume(page);
  const seed = page.locator('.array-fields__row', { hasText: 'Seme' }).locator('input');
  await seed.fill('4242');
  await seed.press('Enter');
  await settled(page);
  expect((await sceneState(page)).nodes[id].pattern.relief.seed).toBe(4242);
  expect(await volume(page)).not.toBeCloseTo(before, 3);
});

test('Pattern Legno: fughe e venatura tolgono volume, il codice ha l\'elenco e la mappa, e il disegno si cambia dalle proprietà', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.keyboard.press('z');
  const panel = page.getByRole('region', { name: 'Pattern' });
  await expect(panel).toBeVisible();
  await panel.getByLabel('Tipo').selectOption({ label: 'Legno' });
  await settled(page);

  await expect.poll(() => volume(page)).toBeLessThan(8000);
  expect(await volume(page)).toBeGreaterThan(7000);

  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const scene = await sceneState(page);
  const id = scene.rootIds[0];
  expect(scene.nodes[id]).toMatchObject({ type: 'group', op: 'pattern', name: 'Pattern Legno: Cubo' });
  expect(scene.nodes[id].pattern).toMatchObject({ kind: 'wood', design: 'planks', reliefAlgorithm: 1 });
  expect(scene.nodes[id].pattern.relief).toMatchObject({ kind: 'wood', plankW: 12, plankL: 60, gap: 0.8, gapDepth: 0.8, grainDepth: 0.25 });
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  const planks = await volume(page);
  expect(planks).toBeLessThan(8000);

  // Doghe: elenco dei rettangoli (fughe in CSG) e mappa di altezze della venatura
  let code = await readCode(page);
  expect(code).toContain('planks = [');
  expect(code).toContain('zmap = [');
  expect(code).toContain('polyhedron(pts, faces, convexity = 10);');
  expect(code).toContain('projection(cut = true)');
  expect(code).not.toContain('cells = [');

  // Parquet: spina di pesce di listelli
  await page.getByLabel('Disegno').selectOption({ label: 'Parquet (spina di pesce)' });
  await settled(page);
  expect((await sceneState(page)).nodes[id].pattern.design).toBe('parquet');
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  expect(await volume(page)).toBeLessThan(8000);
  expect(await volume(page)).not.toBeCloseTo(planks, 3);
  expect(await readCode(page)).toContain('planks = [');

  // Tavola unica: solo venatura e nodi (nessuna fuga, quindi nessun elenco di rettangoli)
  await page.getByLabel('Disegno').selectOption({ label: 'Tavola unica' });
  await settled(page);
  expect((await sceneState(page)).nodes[id].pattern.design).toBe('single');
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  expect(await volume(page)).toBeLessThan(8000);
  code = await readCode(page);
  expect(code).not.toContain('planks');
  expect(code).toContain('zmap = [');

  // Le fughe non si regolano sulla tavola unica; la venatura sì
  await expect(page.locator('.slider-field').filter({ has: page.getByText('Profondità fuga', { exact: true }) })).toHaveCount(0);
  await expect(page.locator('.slider-field').filter({ has: page.getByText('Venatura', { exact: true }) })).toHaveCount(1);
});

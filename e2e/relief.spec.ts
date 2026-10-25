import { expect, test } from '@playwright/test';
import { addShape, openApp, openMenuItem, readCode, sceneState, settled } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

/** La texture da immagine è sperimentale: si accende nelle Impostazioni (qui direttamente nello store). */
const enableTexture = (page: import('@playwright/test').Page) => page.evaluate(() => window.__construct!.ui.setState({ experimentalTexture: true }));

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
  expect(scene.nodes[id].pattern.relief).toMatchObject({ kind: 'wood', plankW: 12, plankL: 60, gap: 0.8, gapDepth: 0.8, grainDepth: 0.4 });
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

test('Pattern Immagine: una texture della libreria incava la faccia, il codice ha la mappa e modo ed esempio si cambiano dalle proprietà', async ({ page }) => {
  await enableTexture(page);
  await addShape(page, 'Cubo');
  await page.keyboard.press('z');
  const panel = page.getByRole('region', { name: 'Pattern' });
  await expect(panel).toBeVisible();
  await panel.getByLabel('Tipo').selectOption({ label: 'Immagine (sperimentale)' });
  await settled(page);

  // Anteprima viva: di partenza il modo è incavo (la zigrinatura scava il cubo senza forarlo)
  await expect.poll(() => volume(page)).toBeLessThan(8000);
  expect(await volume(page)).toBeGreaterThan(7000);

  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const scene = await sceneState(page);
  const id = scene.rootIds[0];
  expect(scene.nodes[id]).toMatchObject({ type: 'group', op: 'pattern', name: 'Pattern Immagine: Cubo' });
  expect(scene.nodes[id].pattern).toMatchObject({ kind: 'texture', sample: 'knurl', textureAlgorithm: 1 });
  expect(scene.nodes[id].pattern.imageId).toBeUndefined();
  expect(scene.nodes[id].pattern.texture).toMatchObject({ mode: 'groove', tile: 20, amplitude: 0.6, midlevel: 0.5 });
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  const groove = await volume(page);
  expect(groove).toBeLessThan(8000);

  // Il codice OpenSCAD ha la mappa di altezze (zmap) in un solo file, ritagliata sulla faccia
  let code = await readCode(page);
  expect(code).toContain('difference() {');
  expect(code).toContain('zmap = [');
  expect(code).toContain('polyhedron(pts, faces, convexity = 10);');
  expect(code).toContain('projection(cut = true)');
  expect(code).not.toContain('surface(');

  // Un altro esempio della libreria
  await page.getByLabel('Sorgente').selectOption({ label: 'Onde' });
  await settled(page);
  expect((await sceneState(page)).nodes[id].pattern.sample).toBe('waves');
  expect(await volume(page)).toBeLessThan(8000);
  expect(await volume(page)).not.toBeCloseTo(groove, 3);

  // Rilievo: il solido cresce e il codice unisce la pelle; Entrambi: scava e aggiunge
  await page.getByRole('group', { name: 'Modo texture' }).getByRole('button', { name: 'Rilievo' }).click();
  await settled(page);
  expect((await sceneState(page)).nodes[id].pattern.texture.mode).toBe('relief');
  expect(await volume(page)).toBeGreaterThan(8000);
  expect(await readCode(page)).toContain('union() {');
  await page.getByRole('group', { name: 'Modo texture' }).getByRole('button', { name: 'Entrambi' }).click();
  await settled(page);
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  code = await readCode(page);
  expect(code).toContain('union() {');
  expect(code).toContain('difference() {');
});

test('Pattern Immagine: un PNG caricato si converte in grigio, si salva una volta sola e un file illeggibile dà un errore chiaro', async ({ page }) => {
  await enableTexture(page);
  await addShape(page, 'Cubo');
  await page.keyboard.press('z');
  const panel = page.getByRole('region', { name: 'Pattern' });
  await panel.getByLabel('Tipo').selectOption({ label: 'Immagine (sperimentale)' });
  await settled(page);
  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const id = (await sceneState(page)).rootIds[0];

  // Un PNG di prova generato in memoria nel browser: scacchiera 64 × 64 a quadri di 8 pixel
  const png = Buffer.from(
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d')!;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
        context.fillStyle = (i + j) % 2 ? '#ffffff' : '#000000';
        context.fillRect(i * 8, j * 8, 8, 8);
      }
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }),
  );
  const input = page.locator('input[type=file][aria-label="File immagine"]');
  await input.setInputFiles({ name: 'scacchiera.png', mimeType: 'image/png', buffer: png });
  await expect.poll(async () => (await sceneState(page)).nodes[id].pattern.imageId).toMatch(/^img-[0-9a-f]{16}$/);
  await settled(page);
  const pattern = (await sceneState(page)).nodes[id].pattern;
  expect(pattern.sample).toBeUndefined();
  await expect(page.getByLabel('Sorgente')).toHaveValue('__uploaded');
  await expect(page.getByLabel("Anteprima in grigio dell'immagine")).toBeVisible();
  // Il cubo è inciso dai quadri neri: meno volume, e il codice ha la mappa
  expect(await volume(page)).toBeLessThan(8000);
  expect(await readCode(page)).toContain('zmap = [');

  // Lo stesso file di nuovo: stesso id (una sola copia)
  await input.setInputFiles({ name: 'scacchiera-bis.png', mimeType: 'image/png', buffer: png });
  await settled(page);
  expect((await sceneState(page)).nodes[id].pattern.imageId).toBe(pattern.imageId);

  // Intestazione PNG valida ma dati corrotti (solo i primi 40 byte del file): immagine illeggibile, il Pattern resta com'era
  await input.setInputFiles({ name: 'corrotto.png', mimeType: 'image/png', buffer: png.subarray(0, 40) });
  await expect(page.getByRole('alert').filter({ hasText: 'immagine leggibile' })).toBeVisible();
  expect((await sceneState(page)).nodes[id].pattern.imageId).toBe(pattern.imageId);

  // Un file di testo (anche con l'estensione .png): il formato si riconosce dai primi byte, non dal nome
  await input.setInputFiles({ name: 'finto.png', mimeType: 'image/png', buffer: Buffer.from('questo non è un PNG') });
  await expect(page.getByRole('alert').filter({ hasText: 'Formato non supportato' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'immagine leggibile' })).toHaveCount(0);
  expect((await sceneState(page)).nodes[id].pattern.imageId).toBe(pattern.imageId);

  // Formato non supportato (GIF): lo stesso messaggio
  await input.setInputFiles({ name: 'animata.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
  await expect(page.getByRole('alert').filter({ hasText: 'Formato non supportato' })).toBeVisible();
});

test('Pattern Immagine: ogni esempio ha tre varianti, la variante cambia il volume e il codice e si ritrova scegliendola dalla miniatura', async ({ page }) => {
  await enableTexture(page);
  await addShape(page, 'Cubo');
  await page.keyboard.press('z');
  const panel = page.getByRole('region', { name: 'Pattern' });
  await panel.getByLabel('Tipo').selectOption({ label: 'Immagine (sperimentale)' });
  await settled(page);
  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const id = (await sceneState(page)).rootIds[0];
  const pattern = async () => (await sceneState(page)).nodes[id].pattern;
  const variant = page.getByLabel('Variante', { exact: true });

  // Zigrinatura: di partenza a diamante; le altre due varianti sono dritta e a punti
  expect(await pattern()).toMatchObject({ sample: 'knurl', sampleDesign: 'diamond' });
  await expect(variant).toHaveValue('diamond');
  const volumes: number[] = [await volume(page)];
  const codes: string[] = [await readCode(page)];
  for (const [label, value] of [['Dritta', 'straight'], ['A punti', 'dots']]) {
    await variant.selectOption({ label });
    await settled(page);
    expect((await pattern()).sampleDesign).toBe(value);
    await expect(page.locator('.status-bar')).toContainText('Mesh valida');
    volumes.push(await volume(page));
    codes.push(await readCode(page));
  }
  // Tre immagini diverse: tre volumi e tre mappe (zmap) diverse
  expect(new Set(volumes.map((v) => v.toFixed(2))).size).toBe(3);
  expect(new Set(codes).size).toBe(3);
  volumes.forEach((v) => expect(v).toBeLessThan(8000));

  // Le miniature delle varianti fanno lo stesso: «Variante Dritta» riporta alla variante dritta
  await page.getByRole('button', { name: 'Variante Dritta' }).click();
  await settled(page);
  expect((await pattern()).sampleDesign).toBe('straight');
  expect(await volume(page)).toBeCloseTo(volumes[1], 3);

  // Cambiando esempio la variante riparte dalla prima del nuovo esempio; la libreria ha pietra e tessuto al posto dei mattoni
  await page.getByLabel('Sorgente').selectOption({ label: 'Pelle' });
  await settled(page);
  // Il dato porta la variante predefinita in modo esplicito (non assente), e la tendina la mostra
  expect(await pattern()).toMatchObject({ sample: 'leather', sampleDesign: 'fine' });
  await expect(variant).toHaveValue('fine');
  await variant.selectOption({ label: 'Rettile' });
  await settled(page);
  expect((await pattern()).sampleDesign).toBe('reptile');
  await expect(page.getByLabel('Sorgente').locator('option', { hasText: 'Mattoni' })).toHaveCount(0);
  for (const label of ['Pietra', 'Tessuto']) await expect(page.getByLabel('Sorgente').locator('option', { hasText: label })).toHaveCount(1);
  await page.getByLabel('Sorgente').selectOption({ label: 'Pietra' });
  await settled(page);
  expect(await pattern()).toMatchObject({ sample: 'stone', sampleDesign: 'cobbles' });
  await expect(variant.locator('option')).toHaveText(['Ciottoli', 'Lastroni', 'Ghiaia']);
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
});

test('Pattern Immagine: un SVG si rasterizza in grigio e incava il cubo; uno con script e riferimenti esterni si ripulisce', async ({ page }) => {
  await enableTexture(page);
  await addShape(page, 'Cubo');
  await page.keyboard.press('z');
  const panel = page.getByRole('region', { name: 'Pattern' });
  await panel.getByLabel('Tipo').selectOption({ label: 'Immagine (sperimentale)' });
  await settled(page);
  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const id = (await sceneState(page)).rootIds[0];
  const input = page.locator('input[type=file][aria-label="File immagine"]');
  const before = await volume(page);

  // Cerchio nero su bianco, con la dichiarazione XML (il formato si riconosce dal contenuto, qualunque sia il nome del file)
  const circle = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#ffffff"/><circle cx="50" cy="50" r="38" fill="#000000"/></svg>';
  await input.setInputFiles({ name: 'cerchio.dat', mimeType: 'application/octet-stream', buffer: Buffer.from(circle) });
  await expect.poll(async () => (await sceneState(page)).nodes[id].pattern.imageId).toMatch(/^img-[0-9a-f]{16}$/);
  await settled(page);
  const circleId = (await sceneState(page)).nodes[id].pattern.imageId;
  await expect(page.getByLabel('Sorgente')).toHaveValue('__uploaded');
  await expect(page.getByLabel("Anteprima in grigio dell'immagine")).toBeVisible();
  // Il nero scava: meno volume di prima, e la mappa (zmap) è nel codice
  const circleVolume = await volume(page);
  expect(circleVolume).toBeLessThan(8000);
  expect(circleVolume).not.toBeCloseTo(before, 3);
  expect(await readCode(page)).toContain('zmap = [');
  // Il grigio dell'immagine: nero al centro del cerchio, bianco negli angoli (si legge il pixel dalla miniatura)
  const corners = await page.getByLabel("Anteprima in grigio dell'immagine").evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d')!;
    const at = (x: number, y: number) => context.getImageData(x, y, 1, 1).data[0];
    return { center: at(canvas.width >> 1, canvas.height >> 1), corner: at(2, 2) };
  });
  expect(corners.center).toBeLessThan(30);
  expect(corners.corner).toBeGreaterThan(225);

  // Un SVG con script, gestori di eventi e riferimenti esterni: il disegno resta, nessuno script gira e non parte nessuna richiesta
  // di rete verso l'esterno. La pulizia del testo (seconda linea di difesa: l'<img> da Blob URL non esegue script né carica risorse)
  // è coperta dai test unitari di `svgImage.ts`: da qui non si osserva, perché il browser le bloccherebbe comunque
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  const dirty = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" onload="window.__pwned = true"><script>window.__pwned = true</script><image xlink:href="http://example.invalid/x.png" width="100" height="100"/><rect width="100" height="100" fill="#fff"/><rect x="10" y="10" width="40" height="80" fill="#000" onclick="window.__pwned = true"/></svg>';
  await input.setInputFiles({ name: 'sporco.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(dirty) });
  await expect.poll(async () => (await sceneState(page)).nodes[id].pattern.imageId).not.toBe(circleId);
  await settled(page);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
  expect(requested.filter((url) => url.includes('example.invalid'))).toEqual([]);
  expect(await volume(page)).toBeLessThan(8000);
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');

  // SVG vuoto, incompleto, con entità: messaggi chiari, il Pattern resta com'era
  const kept = (await sceneState(page)).nodes[id].pattern.imageId;
  const cases: [string, string, string][] = [
    ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>', 'vuoto', 'vuoto.svg'],
    ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/>', 'incompleto', 'troncato.svg'],
    ['<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><text>&a;</text></svg>', 'entità XML', 'entita.svg'],
    ['<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><rect width="5" height="5"/></svg>', 'senza dimensioni', 'percentuali.svg'],
  ];
  for (const [text, message, name] of cases) {
    await input.setInputFiles({ name, mimeType: 'image/svg+xml', buffer: Buffer.from(text) });
    // Il nome del caso nel messaggio: il locator da solo non dice quale dei casi fallisce
    await expect(page.getByRole('alert').filter({ hasText: message }), `caso ${name}: atteso un avviso con «${message}»`).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Formato non supportato' }), `caso ${name}: non è un formato sconosciuto`).toHaveCount(0);
    expect((await sceneState(page)).nodes[id].pattern.imageId, `caso ${name}: il Pattern resta com'era`).toBe(kept);
  }
});

test('Pattern Immagine è sperimentale: spenta di default, la voce nelle Impostazioni la accende e il tipo compare nella tendina', async ({ page }) => {
  expect(await page.evaluate(() => window.__construct!.ui.getState().experimentalTexture)).toBe(false);
  await addShape(page, 'Cubo');
  await page.keyboard.press('z');
  const panel = page.getByRole('region', { name: 'Pattern' });
  await expect(panel).toBeVisible();
  const kinds = panel.getByLabel('Tipo').locator('option');
  await expect(kinds.filter({ hasText: 'Mattoni' })).toHaveCount(1);
  await expect(kinds.filter({ hasText: 'Immagine' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // La voce è nelle Impostazioni > Funzioni sperimentali, spenta di partenza
  await openMenuItem(page, 'Impostazioni');
  const dialog = page.getByRole('dialog', { name: 'Impostazioni' });
  const toggle = dialog.getByLabel('Texture da immagine del Pattern');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  expect(await page.evaluate(() => window.__construct!.ui.getState().experimentalTexture)).toBe(true);
  await page.keyboard.press('Escape');

  // Con la funzione accesa il tipo compare, marcato come sperimentale
  await page.keyboard.press('z');
  await expect(kinds.filter({ hasText: 'Immagine (sperimentale)' })).toHaveCount(1);
});

test('Pattern Immagine: a funzione spenta un Pattern già creato resta modificabile e calcolato', async ({ page }) => {
  await enableTexture(page);
  await addShape(page, 'Cubo');
  await page.keyboard.press('z');
  const panel = page.getByRole('region', { name: 'Pattern' });
  await panel.getByLabel('Tipo').selectOption({ label: 'Immagine (sperimentale)' });
  await settled(page);
  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const id = (await sceneState(page)).rootIds[0];
  const before = await volume(page);

  // Si spegne la funzione: il Pattern resta, con lo stesso volume, e il tipo resta in tendina
  await page.evaluate(() => window.__construct!.ui.setState({ experimentalTexture: false }));
  await settled(page);
  expect(await volume(page)).toBeCloseTo(before, 3);
  await page.evaluate((nodeId) => window.__construct!.store.getState().select([nodeId]), id);
  const kind = page.getByLabel('Tipo');
  await expect(kind).toHaveValue('texture');
  await expect(kind.locator('option', { hasText: 'Immagine (sperimentale)' })).toHaveCount(1);
});

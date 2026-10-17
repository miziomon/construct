import { expect, test } from '@playwright/test';
import { addShape, dragGizmoAlongX, dragGizmoAxis, hoveredAxis, openApp, openMenuItem, project, readCode, sceneSaved, sceneState, settled } from './helpers';
import { writeStl } from '../src/kernel/export/stl';
import type { GroupNode } from '../src/scene/types';

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
  const minX = await page.evaluate(() => window.__construct!.results.getState().meshes[0].bbox.min[0]);
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

test('un oggetto nascosto non si vede né si seleziona, resta nel calcolo e si mostra dall\'elenco', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  const center = await project(page, [0, 0, 10]);

  // Maiusc+H nasconde la selezione: esce dalla selezione e la riga mostra l'occhio barrato
  await page.keyboard.press('Shift+H');
  await expect(page.locator('.outliner__row--hidden')).toHaveCount(1);
  expect((await sceneState(page)).nodes[id].hidden).toBe(true);
  expect(await page.evaluate(() => window.__construct!.store.getState().selection)).toEqual([]);
  // Il calcolo resta (le esportazioni lo includono), ma nella vista non c'è nulla da cliccare
  expect(await page.evaluate((rootId) => window.__construct!.results.getState().meshes.some((m) => m.rootId === rootId), id)).toBe(true);

  // Né il clic sulla vista né quello sulla riga lo selezionano
  await page.mouse.click(center.x, center.y);
  await page.locator('.outliner__row').first().click({ position: { x: 60, y: 10 } });
  expect(await page.evaluate(() => window.__construct!.store.getState().selection)).toEqual([]);

  // L'icona nell'elenco lo mostra di nuovo, e il clic sulla vista lo seleziona
  await page.getByRole('button', { name: 'Mostra', exact: true }).click();
  await expect(page.locator('.outliner__row--hidden')).toHaveCount(0);
  await page.mouse.click(center.x, center.y);
  await expect.poll(() => page.evaluate(() => window.__construct!.store.getState().selection)).toEqual([id]);

  // Maiusc+H senza selezione mostra tutti gli oggetti nascosti
  await page.keyboard.press('Shift+H');
  await expect(page.locator('.outliner__row--hidden')).toHaveCount(1);
  await page.keyboard.press('Shift+H');
  await expect(page.locator('.outliner__row--hidden')).toHaveCount(0);
  expect((await sceneState(page)).nodes[id].hidden).toBeUndefined();
});

test('Duplica (Ctrl+D) lascia la copia nelle stesse coordinate, anche per un oggetto spostato e per un gruppo', async ({ page }) => {
  await addShape(page, 'Cubo');
  const cube = (await sceneState(page)).rootIds[0];
  // Un oggetto spostato e ruotato: la copia deve avere esattamente posizione e rotazione dell'originale
  await page.evaluate((id) => window.__construct!.store.getState().updateNode(id, { position: [30, -15, 10], rotation: [0, 0, 45] }), cube);
  await page.keyboard.press('Control+d');
  await settled(page);
  let scene = await sceneState(page);
  expect(scene.rootIds).toHaveLength(2);
  const [copy] = scene.rootIds;
  expect(copy).not.toBe(cube);
  expect(scene.nodes[copy].position).toEqual([30, -15, 10]);
  expect(scene.nodes[copy].rotation).toEqual([0, 0, 45]);
  // La copia è selezionata e il kernel la calcola nello stesso punto dell'originale
  expect(await page.evaluate(() => window.__construct!.store.getState().selection)).toEqual([copy]);
  const bbox = (id: string) => page.evaluate((rootId) => window.__construct!.results.getState().meshes.find((m) => m.rootId === rootId)!.bbox, id);
  expect(await bbox(copy)).toEqual(await bbox(cube));

  // Un gruppo: la copia ha la stessa posizione e i figli (copiati) restano alle stesse coordinate relative
  await addShape(page, 'Sfera');
  await page.evaluate(() => {
    const s = window.__construct!.store.getState();
    s.select(s.scene.rootIds.slice(0, 2));
    s.groupSelected();
  });
  await settled(page);
  const group = (await sceneState(page)).rootIds[0];
  await page.keyboard.press('Control+d');
  await settled(page);
  scene = await sceneState(page);
  const [groupCopy] = scene.rootIds;
  expect(groupCopy).not.toBe(group);
  expect(scene.nodes[groupCopy].position).toEqual(scene.nodes[group].position);
  const rel = (g: string) => scene.nodes[g].children.map((c: string) => scene.nodes[c].position);
  expect(rel(groupCopy)).toEqual(rel(group));
});

/** Esporta → Immagine: sceglie sfondo e piatto (se indicati), conferma e scarica il PNG. */
async function exportImagePng(page: import('@playwright/test').Page, options: { background?: string; plate?: string } = {}): Promise<{ name: string; path: string }> {
  const downloading = page.waitForEvent('download');
  await openMenuItem(page, 'Esporta');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Immagine', exact: true }).click();
  if (options.background) await dialog.getByLabel(options.background).check();
  if (options.plate) await dialog.getByLabel(options.plate).check();
  await dialog.getByRole('button', { name: 'Esporta', exact: true }).click();
  const download = await downloading;
  return { name: download.suggestedFilename(), path: (await download.path())! };
}

/** Pixel (r, g, b, a) di un PNG, per controllare i colori dell'immagine delle viste. */
async function readPng(file: string): Promise<{ width: number; at: (x: number, y: number) => number[] }> {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, at: (x, y) => [0, 1, 2, 3].map((c) => data[(y * info.width + x) * 4 + c]) };
}

test('Esporta immagine: un PNG 2×2 con le 4 viste, con la vista e la selezione che restano come prima', async ({ page }) => {
  await addShape(page, 'Cubo');
  const sharp = (await import('sharp')).default;
  const before = await page.evaluate(() => ({ selection: window.__construct!.store.getState().selection, camera: window.__r3f!.camera.position.toArray() }));

  const { name, path: file } = await exportImagePng(page);
  expect(name).toBe('construct-viste.png');

  // Dimensioni: quadrata, divisa esattamente in 4 sezioni da 800 px
  const meta = await sharp(file).metadata();
  expect(meta.format).toBe('png');
  expect(meta.width).toBe(1600);
  expect(meta.height).toBe(1600);
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => [0, 1, 2].map((c) => data[(y * info.width + x) * info.channels + c]);
  const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // In ogni vista il centro è il cubo e l'angolo è il piano di stampa o lo sfondo: colori diversi
  for (const [cx, cy] of [[400, 400], [1200, 400], [400, 1200], [1200, 1200]]) {
    const center = pixel(cx, cy);
    const corner = pixel(cx - 380, cy - 380);
    expect(distance(center, corner), `centro e angolo della vista in (${cx}, ${cy})`).toBeGreaterThan(40);
  }
  // Le viste sono allineate: il cubo è centrato nello stesso punto di ogni sezione (il centro non è sfondo in nessuna)
  const background = pixel(5, 795);
  for (const [cx, cy] of [[400, 400], [1200, 400], [400, 1200], [1200, 1200]]) {
    expect(distance(pixel(cx, cy), background), `il cubo è al centro della sezione (${cx}, ${cy})`).toBeGreaterThan(20);
  }

  // La vista 3D non è stata toccata
  const after = await page.evaluate(() => ({ selection: window.__construct!.store.getState().selection, camera: window.__r3f!.camera.position.toArray() }));
  expect(after).toEqual(before);
});

test('Esporta immagine: sfondo bianco o trasparente, scelto nel passo delle opzioni', async ({ page }) => {
  await addShape(page, 'Cubo');
  // Il piano di stampa nascosto: lo sfondo si vede in tutta la sezione Fronte (in alto a destra, lontano dall'etichetta)
  await page.keyboard.press('p');

  // Bianco: i pixel dello sfondo sono bianchi e opachi
  const white = await readPng((await exportImagePng(page, { background: 'Bianco' })).path);
  expect(white.at(1590, 10)).toEqual([255, 255, 255, 255]);
  expect(white.at(1590, 790)).toEqual([255, 255, 255, 255]);

  // Trasparente: lo sfondo ha alfa 0, il cubo al centro è opaco
  const clear = await readPng((await exportImagePng(page, { background: 'Trasparente' })).path);
  expect(clear.at(1590, 10)[3]).toBe(0);
  expect(clear.at(1200, 400)[3]).toBe(255);

  // Come il tema: lo sfondo è quello del tema attuale (scuro), opaco
  const theme = await readPng((await exportImagePng(page, { background: 'Come il tema attuale' })).path);
  expect(theme.at(1590, 10)).toEqual([20, 23, 28, 255]);
});

test('Esporta immagine: con più piatti si sceglie quale fotografare e dopo il piatto in vista resta quello di prima', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.getByRole('tab', { name: /Piatti/ }).click();
  await page.getByRole('button', { name: 'Aggiungi piatto' }).click();
  await addShape(page, 'Cilindro');
  const active = () => page.evaluate(() => window.__construct!.store.getState().scene.activePlateId);
  const before = await active();

  // Il piatto 1 ha il cubo: l'immagine si fa anche se il piatto in vista è il 2
  const dialogPlates = async () => {
    await openMenuItem(page, 'Esporta');
    await page.getByRole('dialog').getByRole('button', { name: 'Immagine', exact: true }).click();
    return page.getByRole('dialog').getByRole('group', { name: 'Piatto' }).locator('label');
  };
  await expect(await dialogPlates()).toHaveCount(2);
  await page.keyboard.press('Escape');

  const { name, path } = await exportImagePng(page, { plate: 'Piatto 1' });
  expect(name).toBe('construct-viste-piatto-1.png');
  // Il cubo è al centro della sezione Alto
  const png = await readPng(path);
  const corner = png.at(790, 790);
  const center = png.at(400, 400);
  expect(Math.abs(center[0] - corner[0]) + Math.abs(center[1] - corner[1]) + Math.abs(center[2] - corner[2])).toBeGreaterThan(40);
  // Il piatto in vista è tornato quello di prima
  await expect.poll(active).toBe(before);
  expect((await sceneState(page)).rootIds).toHaveLength(1);
});

test('Esporta immagine: senza oggetti il pulsante è disabilitato', async ({ page }) => {
  await openMenuItem(page, 'Esporta');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Immagine', exact: true })).toBeDisabled();
});

test('Menu contestuale dell\'elenco: Nascondi sulla riga visibile, Mostra su quella nascosta', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  const row = page.locator('.outliner__row').first();
  const selection = () => page.evaluate(() => window.__construct!.store.getState().selection);

  // Clic destro su una riga non selezionata: la seleziona e apre il menu dei comandi, con Nascondi
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__construct!.store.getState().select([]));
  await row.click({ button: 'right', position: { x: 60, y: 10 } });
  expect(await selection()).toEqual([id]);
  const menu = page.getByRole('menu', { name: 'Comandi per la selezione' });
  await menu.getByRole('menuitem', { name: 'Nascondi', exact: true }).click();
  await expect(page.locator('.outliner__row--hidden')).toHaveCount(1);

  // Sulla riga nascosta il menu offre solo Mostra e non seleziona nulla
  await row.click({ button: 'right', position: { x: 60, y: 10 } });
  const hiddenMenu = page.getByRole('menu', { name: 'Oggetto nascosto' });
  await expect(hiddenMenu.getByRole('menuitem')).toHaveCount(1);
  expect(await selection()).toEqual([]);
  await hiddenMenu.getByRole('menuitem', { name: 'Mostra', exact: true }).click();
  await expect(page.locator('.outliner__row--hidden')).toHaveCount(0);
  expect((await sceneState(page)).nodes[id].hidden).toBeUndefined();
});

/** Un cubo grande (40 mm) con dentro uno piccolo (10 mm), entrambi centrati in (0, 0, 20). Restituisce gli id. */
async function enclosedCubes(page: import('@playwright/test').Page): Promise<{ big: string; small: string }> {
  await addShape(page, 'Cubo');
  await addShape(page, 'Cubo');
  const [big, small] = (await sceneState(page)).rootIds as string[];
  await page.evaluate(([b, s]) => {
    const st = window.__construct!.store.getState();
    st.updateNode(b, { size: [40, 40, 40], position: [0, 0, 20] } as never);
    st.updateNode(s, { size: [10, 10, 10], position: [0, 0, 20] } as never);
  }, [big, small]);
  await settled(page);
  return { big, small };
}

test('un oggetto racchiuso in un altro si sposta col gizmo senza selezionare quello che gli sta davanti', async ({ page }) => {
  const { big, small } = await enclosedCubes(page);
  await page.evaluate((id) => window.__construct!.store.getState().select([id]), small);
  await page.keyboard.press('w');
  await page.waitForTimeout(100);
  await dragGizmoAxis(page, [0, 0, 20], 'X');

  // Il piccolo si è spostato e la selezione è rimasta sul piccolo
  await expect.poll(async () => (await sceneState(page)).nodes[small].position[0]).not.toBe(0);
  expect((await sceneState(page)).nodes[big].position[0]).toBe(0);
  expect(await page.evaluate(() => window.__construct!.store.getState().selection)).toEqual([small]);
});

const selectionOf = (page: import('@playwright/test').Page) => page.evaluate(() => window.__construct!.store.getState().selection);

test('un oggetto bloccato viene attraversato dal clic se dietro ce n\'è uno libero, ma isolato si seleziona', async ({ page }) => {
  const { big, small } = await enclosedCubes(page);
  await page.evaluate((id) => window.__construct!.store.getState().updateNode(id, { locked: true }), big);
  await page.evaluate(() => window.__construct!.store.getState().select([]));
  const centre = await project(page, [0, 0, 20]);
  await page.mouse.click(centre.x, centre.y);
  expect(await selectionOf(page)).toEqual([small]);

  // Bloccando anche il piccolo restano due bloccati: si sceglie il più vicino
  await page.evaluate((id) => window.__construct!.store.getState().updateNode(id, { locked: true }), small);
  await page.evaluate(() => window.__construct!.store.getState().select([]));
  await page.waitForTimeout(400);
  await page.mouse.click(centre.x, centre.y);
  expect(await selectionOf(page)).toEqual([big]);
});

test('il clic ripetuto nello stesso punto scorre gli oggetti sovrapposti', async ({ page }) => {
  const { big, small } = await enclosedCubes(page);
  await page.evaluate(() => window.__construct!.store.getState().select([]));
  const centre = await project(page, [0, 0, 20]);
  const expected = [big, small, big];
  for (const id of expected) {
    // Almeno 350 ms tra i clic: prima sarebbe un doppio clic
    await page.waitForTimeout(450);
    await page.mouse.click(centre.x, centre.y);
    expect(await selectionOf(page)).toEqual([id]);
  }
});

test('il doppio clic su oggetti sovrapposti resta sull\'oggetto e passa a Sposta', async ({ page }) => {
  const { big } = await enclosedCubes(page);
  await page.evaluate(() => window.__construct!.store.getState().select([]));
  const centre = await project(page, [0, 0, 20]);
  await page.mouse.dblclick(centre.x, centre.y);
  expect(await selectionOf(page)).toEqual([big]);
  expect(await page.evaluate(() => window.__construct!.store.getState().gizmoMode)).toBe('translate');
});

test('trascinare la vista partendo da sopra un oggetto non cambia la selezione', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.evaluate(() => window.__construct!.store.getState().select([]));
  const centre = await project(page, [0, 0, 10]);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(centre.x + i * 8, centre.y);
  await page.mouse.up();
  expect(await selectionOf(page)).toEqual([]);
  // Un clic fermo, invece, lo seleziona
  await page.mouse.click(centre.x, centre.y);
  expect((await selectionOf(page)).length).toBe(1);
});

test('un clic fermo su una maniglia del gizmo non cambia la selezione, nemmeno con un oggetto davanti', async ({ page }) => {
  const { small } = await enclosedCubes(page);
  await page.evaluate((id) => window.__construct!.store.getState().select([id]), small);
  await page.keyboard.press('w');
  await page.waitForTimeout(100);
  // Porta il puntatore sulla maniglia X (come nell'helper di trascinamento)
  const origin = await project(page, [0, 0, 20]);
  const ahead = await project(page, [1, 0, 20]);
  const len = Math.hypot(ahead.x - origin.x, ahead.y - origin.y);
  let found: { x: number; y: number } | undefined;
  for (let d = 10; d <= 140 && !found; d += 6) {
    const pt = { x: origin.x + ((ahead.x - origin.x) / len) * d, y: origin.y + ((ahead.y - origin.y) / len) * d };
    await page.mouse.move(pt.x, pt.y);
    if ((await hoveredAxis(page)) === 'X') found = pt;
  }
  expect(found, 'la maniglia X deve essere raggiungibile').toBeDefined();
  await page.mouse.down();
  await page.mouse.up();
  expect(await selectionOf(page)).toEqual([small]);
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
  const volume = await page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);
  expect(volume).toBeGreaterThan(1500);
  expect(volume).toBeLessThan(2000);
});

test('cerchio con 6 lati: esagono regolare estruso', async ({ page }) => {
  await addShape(page, 'Cerchio');
  await page.getByRole('button', { name: '6', exact: true }).click();
  await settled(page);
  const volume = await page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);
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
  await page.getByRole('dialog', { name: 'Importa' }).getByRole('button', { name: 'STL e 3MF', exact: true }).click();
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
  await sceneSaved(page);
  await page.reload();
  await page.waitForFunction(() => window.__construct!.results.getState().meshes.length === 1);
  await expect(page.locator('.status-bar')).toContainText('Volume 8.00 cm³');
  expect((await sceneState(page)).nodes[scene.rootIds[0]].type).toBe('mesh');
});

test('un file che non è un solido chiuso viene rifiutato con un messaggio', async ({ page }) => {
  // Un solo triangolo
  const p = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
  const stl = Buffer.from(writeStl(p, new Uint32Array([0, 1, 2])));
  const chooser = page.waitForEvent('filechooser');
  await openMenuItem(page, 'Importa');
  await page.getByRole('dialog', { name: 'Importa' }).getByRole('button', { name: 'STL e 3MF', exact: true }).click();
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
  expect(file.suggestedFilename()).toBe('construct.stl');
  const path = await file.path();
  const { statSync } = await import('node:fs');
  expect(statSync(path).size).toBe(84 + 50 * 12);
});

test('la versione sta nel title e non più accanto al logo; il nome dell\'app è Construct', async ({ page }) => {
  const { version } = JSON.parse((await import('node:fs')).readFileSync('package.json', 'utf8'));
  await expect(page).toHaveTitle(`Construct v${version}`);
  await expect(page.locator('.brand__name')).toHaveText('Construct');
  await expect(page.locator('.toolbar__version')).toHaveCount(0);
});

test('un calcolo lungo mostra l\'indicatore sopra la vista 3D, uno breve no', async ({ page }) => {
  const busy = (value: boolean) => page.evaluate((v) => window.__construct!.results.setState({ busy: v }), value);
  const overlay = page.getByRole('status').filter({ hasText: 'Calcolo in corso' });
  // Calcolo breve: finisce prima dell'attesa, l'indicatore non compare
  await busy(true);
  await busy(false);
  await page.waitForTimeout(500);
  await expect(overlay).toHaveCount(0);
  // Calcolo lungo: dopo l'attesa compare, e sparisce appena il kernel ha finito
  await busy(true);
  await expect(overlay).toBeVisible();
  await busy(false);
  await expect(overlay).toHaveCount(0);
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

test('libreria con Cubo e Dado (un solo pulsante per tutti i dadi); i preset dei lati sono 3, 4, 5, 6, 8, 12', async ({ page }) => {
  for (const label of ['Cubo', 'Dado']) {
    await expect(page.locator(`button[title^="Aggiungi: ${label}"]`)).toHaveCount(1);
  }
  await addShape(page, 'Cilindro');
  await expect(page.locator('.properties__chip')).toHaveText(['3', '4', '5', '6', '8', '12']);
});

test('Dado (parte da 20 facce): mesh valida appoggiata sul piatto, il raccordo ne riduce il volume', async ({ page }) => {
  await addShape(page, 'Dado');
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  const read = () => page.evaluate(() => window.__construct!.results.getState().meshes[0]);
  const sharp = await read();
  expect(sharp.bbox.min[2]).toBeCloseTo(0, 3);
  expect(sharp.bbox.max[2]).toBeCloseTo(20, 3);

  const field = page.locator('.slider-field', { hasText: 'Raccordo' }).locator('.number-field__input');
  await field.fill('3');
  await field.press('Enter');
  await settled(page);
  expect((await read()).volume).toBeLessThan(sharp.volume);
});

test('Esc in un campo numerico annulla la modifica: valore e cronologia restano quelli di prima, Invio la conferma', async ({ page }) => {
  await addShape(page, 'Cerchio');
  const id = (await sceneState(page)).rootIds[0];
  const steps = () => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);
  const before = await steps();
  const field = page.locator('.slider-field', { hasText: 'Altezza' }).locator('.number-field__input');
  await field.fill('37');
  await field.press('Escape');
  // Il testo torna al valore della scena, che non è cambiato e non ha creato passi di Annulla
  await expect(field).toHaveValue('10');
  await settled(page);
  expect((await sceneState(page)).nodes[id].height).toBe(10);
  expect(await steps()).toBe(before);
  // Invio conferma come sempre
  await field.fill('37');
  await field.press('Enter');
  await settled(page);
  expect((await sceneState(page)).nodes[id].height).toBe(37);
  expect(await steps()).toBe(before + 1);
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

test('il menu contiene Nuovo, Apri, Modelli di esempio, Salva e le Scorciatoie', async ({ page }) => {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  for (const name of ['Nuovo progetto', 'Apri progetto…', 'Modelli di esempio…', 'Salva progetto', 'Scorciatoie da tastiera']) {
    await expect(page.getByRole('menuitem', { name })).toBeVisible();
  }
  await page.getByRole('menuitem', { name: 'Scorciatoie da tastiera' }).click();
  await expect(page.getByRole('dialog')).toContainText('Ridimensiona');
});

test('Modelli di esempio: la modale elenca tre schede, una scheda sostituisce la scena (annullabile), la inquadra e chiude la modale', async ({ page }) => {
  await addShape(page, 'Cubo');
  await openMenuItem(page, 'Modelli di esempio…');
  const dialog = page.getByRole('dialog', { name: 'Modelli di esempio' });
  await expect(dialog).toBeVisible();
  const cards = dialog.locator('.examples__card');
  await expect(cards).toHaveCount(3);
  await expect(cards).toContainText(['Biglietto da visita', 'Gioco a incastri', 'Pallina di Natale']);

  // Il gioco a incastri: due oggetti alla radice (il vassoio forato e i tre pezzi uniti) al posto del cubo
  await dialog.locator('.examples__card[data-example="baby-toy"]').click();
  await expect(dialog).toBeHidden();
  // Il JSON dell'esempio si scarica dopo la chiusura della modale: si attende che la scena cambi
  await expect.poll(() => page.evaluate(() => window.__construct!.store.getState().scene.rootIds.length)).toBe(2);
  await settled(page);
  let scene = await sceneState(page);
  expect(scene.rootIds.map((id: string) => scene.nodes[id].op).sort()).toEqual(['difference', 'minkowski']);
  // Inquadratura automatica: il bersaglio della camera sta sul modello (lontano dall'origine, non più sul cubo)
  await expect.poll(() => page.evaluate(() => (window.__r3f!.controls as { target: { x: number } } | null)?.target.x)).toBeGreaterThan(20);

  // Un solo passo di Annulla riporta il cubo
  await page.keyboard.press('Control+z');
  await settled(page);
  scene = await sceneState(page);
  expect(scene.rootIds).toHaveLength(1);
  expect(scene.nodes[scene.rootIds[0]].kind).toBe('box');

  // Il biglietto da visita ha dieci oggetti alla radice, tra cui testi
  await openMenuItem(page, 'Modelli di esempio…');
  await dialog.locator('.examples__card[data-example="business-card"]').click();
  await expect.poll(() => page.evaluate(() => window.__construct!.store.getState().scene.rootIds.length)).toBe(10);
  await settled(page);
  scene = await sceneState(page);
  expect((Object.values(scene.nodes) as { kind?: string }[]).some((n) => n.kind === 'text')).toBe(true);
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

test('tema scuro di default, interruttore per il chiaro che resta dopo il ricaricamento', async ({ page }) => {
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  expect(await theme()).toBe('dark');
  await page.getByRole('button', { name: 'Tema', exact: true }).click();
  expect(await theme()).toBe('light');
  await page.reload();
  expect(await theme()).toBe('light');
  await page.getByRole('button', { name: 'Tema', exact: true }).click();
  expect(await theme()).toBe('dark');
});

test('il tasto P alterna il piatto tra visibile e nascosto e ogni stato cambia davvero quello che è disegnato', async ({ page }) => {
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
  await expect.poll(parts).toEqual([false, false, false]);
  const hidden = await frame();
  expect(hidden.equals(full)).toBe(false);

  // Un secondo P lo rimostra (non esiste più lo stato intermedio "solo griglia")
  await page.keyboard.press('p');
  await expect.poll(parts).toEqual([true, true, true]);
  // Anche il pulsante in toolbar alterna i due stati
  await page.getByRole('button', { name: 'Piatto', exact: true }).click();
  await expect.poll(parts).toEqual([false, false, false]);
  await page.getByRole('button', { name: 'Piatto', exact: true }).click();
  await expect.poll(parts).toEqual([true, true, true]);
});

test('il piano si distingue dallo sfondo in entrambi i temi', async ({ page }) => {
  // Colore del piano e dello sfondo come li disegna la vista (palette del tema)
  const colors = () =>
    page.evaluate(() => {
      const r3f = window.__r3f!;
      const plate = r3f.scene.getObjectByName('bed-plate') as unknown as { material: { color: { r: number; g: number; b: number } } };
      const bg = r3f.scene.background as unknown as { r: number; g: number; b: number };
      const lum = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      return { plate: lum(plate.material.color), bg: lum(bg) };
    });
  for (const theme of ['dark', 'light']) {
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    const { plate, bg } = await colors();
    // Differenza di luminanza (0-1, in spazio lineare) chiaramente visibile
    expect(Math.abs(plate - bg), `piano e sfondo nel tema ${theme}`).toBeGreaterThan(theme === 'dark' ? 0.015 : 0.05);
    await page.getByRole('button', { name: 'Tema', exact: true }).click();
  }
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
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  await page.keyboard.press('d');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');

  await page.keyboard.press('m');
  await expect(page.getByRole('menuitem', { name: 'Importa' })).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.getByRole('menuitem', { name: 'Importa' })).toBeHidden();
});

test('Dado: lo slider Facce sceglie 8, 10, 12, 20 o 30; un valore intermedio scatta sul più vicino e la mesh resta valida', async ({ page }) => {
  await addShape(page, 'Dado');
  const id = (await sceneState(page)).rootIds[0];
  expect((await sceneState(page)).nodes[id]).toMatchObject({ kind: 'die', faces: 20, size: 20 });
  const faces = page.locator('.slider-field', { hasText: 'Facce' }).locator('.number-field__input');
  await expect(faces).toHaveValue('20');
  const read = () => page.evaluate(() => window.__construct!.results.getState().meshes[0]);
  for (const n of [8, 10, 12, 30, 20]) {
    await faces.fill(String(n));
    await faces.press('Enter');
    await settled(page);
    await expect(page.locator('.status-bar')).toContainText('Mesh valida');
    expect(((await sceneState(page)).nodes[id] as unknown as { faces: number }).faces).toBe(n);
    // Ogni dado resta alto quanto la dimensione e poggia sul piatto
    const mesh = await read();
    expect(mesh.bbox.min[2]).toBeCloseTo(0, 3);
    expect(mesh.bbox.max[2]).toBeCloseTo(20, 3);
  }
  // A metà strada vince il numero maggiore; un valore vicino a uno valido scatta su quello
  await faces.fill('25');
  await faces.press('Enter');
  await settled(page);
  expect(((await sceneState(page)).nodes[id] as unknown as { faces: number }).faces).toBe(30);
  await expect(faces).toHaveValue('30');
  await faces.fill('11');
  await faces.press('Enter');
  await settled(page);
  expect(((await sceneState(page)).nodes[id] as unknown as { faces: number }).faces).toBe(12);
});

test('Dado: trascinando lo slider Facce il numero scatta sui valori dei dadi e tutto il trascinamento è un solo passo di Annulla', async ({ page }) => {
  await addShape(page, 'Dado');
  const id = (await sceneState(page)).rootIds[0];
  const steps = () => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);
  const before = await steps();
  const range = page.locator('.slider-field', { hasText: 'Facce' }).locator('input[type=range]');
  await range.scrollIntoViewIfNeeded();
  const box = (await range.boundingBox())!;
  // Dal 20 (a circa metà) verso destra fino in fondo, passando per i valori intermedi
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width * (0.55 + i * 0.06), box.y + box.height / 2);
  await page.mouse.up();
  await settled(page);
  const faces = () => sceneState(page).then((st) => (st.nodes[id] as unknown as { faces: number }).faces);
  expect(await faces()).toBe(30);
  expect(await steps()).toBe(before + 1);
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  await page.keyboard.press('Control+z');
  await settled(page);
  expect(await faces()).toBe(20);
});

test('il codice va a capo dopo ogni comando', async ({ page }) => {
  await addShape(page, 'Dado');
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
  const bbox = await page.evaluate(() => window.__construct!.results.getState().meshes[0].bbox);
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
  const bbox = await page.evaluate(() => window.__construct!.results.getState().meshes[0].bbox);
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
  const meshes = await page.evaluate(() => window.__construct!.results.getState().meshes.map((m) => ({ rootId: m.rootId, color: m.color, x: (m.bbox.min[0] + m.bbox.max[0]) / 2 })));
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
  const moved = await page.evaluate(() => window.__construct!.results.getState().meshes.map((m) => (m.bbox.min[0] + m.bbox.max[0]) / 2));
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
  expect(await page.evaluate(() => window.__construct!.results.getState().meshes.length)).toBe(1);
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
  await page.evaluate(([id]) => window.__construct!.store.getState().updateNode(id as string, { position: [60, 0, 10] }), [sphereId]);
  await selectTwo(page, 'Cubo', 'Sfera');
  await page.getByRole('button', { name: /^Raggruppa/ }).click();
  await settled(page);
  const scene = await sceneState(page);
  const gid = scene.rootIds[0];
  const cubeWorld = await page.evaluate(([id]) => {
    const m = window.__construct!.results.getState().meshes.find((x) => x.id === id)!;
    return [(m.bbox.min[0] + m.bbox.max[0]) / 2, (m.bbox.min[1] + m.bbox.max[1]) / 2, (m.bbox.min[2] + m.bbox.max[2]) / 2] as [number, number, number];
  }, [cubeId]);
  const at = await project(page, cubeWorld);

  await page.locator('canvas').click({ position: { x: 5, y: 5 } }); // deseleziona
  await page.mouse.click(at.x, at.y);
  expect(await page.evaluate(() => window.__construct!.store.getState().selection)).toEqual([gid]);
  await page.keyboard.down('Alt');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('Alt');
  expect(await page.evaluate(() => window.__construct!.store.getState().selection)).toEqual([cubeId]);
});

/** Numero di passi di Annulla disponibili. */
const history = (page: import('@playwright/test').Page) => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);

/** Volume della prima mesh calcolata dal kernel. */
const firstVolume = (page: import('@playwright/test').Page) => page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);

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
  const mode = () => page.evaluate(() => window.__construct!.store.getState().gizmoMode);
  const selection = () => page.evaluate(() => window.__construct!.store.getState().selection);

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
  const history = () => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);
  const before = await history();
  await page.keyboard.press('g');
  const panel = page.getByRole('region', { name: 'Guscio' });
  await expect(panel).toBeVisible();
  await settled(page);
  // Cubo 20 mm con parete e fondo di 2 mm (il massimo predefinito è 2): cavità 16 × 16 × 18, dal fondo alla cima
  await expect.poll(() => page.evaluate(() => window.__construct!.results.getState().meshes[0].volume)).toBeCloseTo(8000 - 16 * 16 * 18, 2);

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
  expect(await page.evaluate(() => window.__construct!.results.getState().meshes[0].volume)).toBeCloseTo(8000, 2);
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

test('Guscio: la faccia aperta si sceglie con un clic, Esc interrompe la scelta senza chiudere lo strumento', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.keyboard.press('g');
  const panel = page.getByRole('region', { name: 'Guscio' });
  await expect(panel).toContainText('cima (+Z)');
  await settled(page);

  // Scelta della faccia: Esc la interrompe e lo strumento resta aperto sulla cima
  await panel.getByRole('button', { name: 'Scegli faccia' }).click();
  await expect(panel.getByRole('button', { name: 'Fine scelta' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'OK' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(panel).toContainText('cima (+Z)');
  await expect(panel.getByRole('button', { name: 'Scegli faccia' })).toBeVisible();
  await settled(page);

  // Clic sulla faccia +X: la cavità si apre da quel lato (il volume resta quello di un cubo con cavità 18 × 16 × 16)
  await panel.getByRole('button', { name: 'Scegli faccia' }).click();
  const at = await project(page, [10, 0, 10]);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await settled(page);
  await expect(panel).toContainText('lato +X');
  await expect.poll(() => page.evaluate(() => window.__construct!.results.getState().meshes[0].volume)).toBeCloseTo(8000 - 18 * 16 * 16, 2);

  await page.getByRole('region', { name: 'Guscio' }).getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const scene = await sceneState(page);
  expect(scene.nodes[scene.rootIds[0]].shell.open).toEqual([1, 0, 0]);
  expect(await readCode(page)).toContain('aperto su lato +X');
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
  const volume = await page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);
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
  const history = () => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);
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
  await expect.poll(() => page.evaluate(() => window.__construct!.results.getState().meshes[0].volume)).toBeCloseTo(8000 - 8 / 6, 2);

  // Sferico: compare lo slider dei segmenti e si toglie meno del taglio piatto
  const flat = await page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);
  await panel.getByRole('button', { name: 'Sferico' }).click();
  await settled(page);
  const segments = panel.locator('.slider-field', { hasText: 'Segmenti' }).locator('.number-field__input');
  await expect(segments).toBeVisible();
  const round = await page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);
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
  expect(await page.evaluate(() => window.__construct!.results.getState().meshes[0].volume)).toBeCloseTo(8000, 2);
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
  await page.evaluate(([id]) => window.__construct!.store.getState().updateNode(id as string, { position: [20, 0, 10] }), [second]);
  await page.evaluate(([a, b]) => window.__construct!.store.getState().select([a as string, b as string]), [first, second]);
  await page.keyboard.press('u');
  await settled(page);
  expect(await page.evaluate(() => window.__construct!.results.getState().meshes[0].volume)).toBeCloseTo(40 * 20 * 20, 2);

  await page.keyboard.press('g');
  await settled(page);
  const panel = page.getByRole('region', { name: 'Guscio' });
  await expect(panel).toContainText('nessuna parete interna');
  // Laterale e fondo di 2 mm: cavità 36 × 16 per 18 di altezza
  await expect.poll(() => page.evaluate(() => window.__construct!.results.getState().meshes[0].volume)).toBeCloseTo(40 * 20 * 20 - 36 * 16 * 18, 2);
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
  await page.evaluate((id) => window.__construct!.store.getState().updateNode(id, { position: [0, 0, 60] }), cubeId);
  await settled(page);
  await page.locator('.outliner__row', { hasText: 'Cubo' }).click();
  await page.locator('.outliner__row', { hasText: 'Cilindro' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Unione' }).first().click();
  await expect.poll(() => page.evaluate(() => Math.min(...window.__construct!.results.getState().meshes.map((m) => m.bbox.min[2])))).toBeCloseTo(0, 3);

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
  const bbox = await page.evaluate(() => window.__construct!.results.getState().meshes[0].bbox);
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
  // Gli indicatori non hanno testo: il nome dell'operazione sta nel nome accessibile (e nel tooltip)
  const names = () => steps.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(await names()).toEqual(['Vai a: Inizio', 'Vai a: Aggiungi Cubo', 'Aggiungi Cilindro (stato corrente)']);
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
  expect(await names()).toEqual(['Vai a: Inizio', 'Vai a: Aggiungi Cubo', 'Aggiungi Sfera (stato corrente)']);
});

test('Smusso angolare: Maiusc+clic aggiunge e toglie vertici con anteprima sempre viva e valori modificabili', async ({ page }) => {
  await addShape(page, 'Cubo');
  const history = () => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);
  const volume = () => page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);
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
  expect(await page.evaluate(() => window.__construct!.results.getState().meshes[0].volume)).toBeCloseTo(8000, 2);
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
  await expect(name).toHaveValue('construct-progetto.json');
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
  expect(await state()).toMatchObject({ picks: 1, suggested: 'construct-progetto.json' });
  expect(JSON.parse((await state()).json!).format).toBe('construct-scene');
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

test('le undici forme 2D estrudibili si aggiungono dalla libreria, in ordine di utilità, e danno un solido valido', async ({ page }) => {
  const labels = ['Quadrato', 'Cerchio', 'Testo', 'Anello', 'Trapezio', 'Croce', 'Stella', 'Cuore', 'Goccia', 'Uovo', 'Mezzaluna'];
  await page.getByRole('tab', { name: 'Forme 2D' }).click();
  await expect(page.locator('button[title^="Aggiungi: "][title$="estruso"]')).toHaveCount(labels.length);
  // Ordine della tab: le basi e gli strumenti più usati per primi, il Profilo (si disegna in una modale) tra i primi
  await expect(page.locator('.shape-library__label')).toHaveText([...labels.slice(0, 3), 'Profilo', ...labels.slice(3)]);
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

test('Stella: un solo tipo con il numero di punte (3-20), che parte da 5', async ({ page }) => {
  await addShape(page, 'Stella');
  await settled(page);
  const id = (await sceneState(page)).rootIds[0];
  expect((await sceneState(page)).nodes[id]).toMatchObject({ kind: 'star', points: 5 });
  const points = page.locator('.slider-field', { hasText: 'Punte' }).locator('.number-field__input');
  await points.fill('8');
  await points.press('Enter');
  await settled(page);
  expect((await sceneState(page)).nodes[id].points).toBe(8);
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
});

test('la libreria Forme 3D mette i profilati dopo le primitive e il Dado in fondo', async ({ page }) => {
  await expect(page.locator('.shape-library__label')).toHaveText([
    'Cubo', 'Cilindro', 'Sfera', 'Cono', 'Toro',
    'Tubolare tondo', 'Tubolare rettangolare', 'Profilato a L', 'Profilato a U', 'Profilato a T', 'Profilato a H',
    'Dado',
  ]);
});

test('profilati a L, T e H: nella tab Forme 3D, pannello dedicato con spessori e raccordo interno, polygon nel codice', async ({ page }) => {
  // Stanno con le forme 3D (non nella tab Forme 2D) e sono anche nel menu contestuale
  const labels = ['Profilato a L', 'Profilato a T', 'Profilato a H', 'Profilato a U', 'Tubolare rettangolare', 'Tubolare tondo'];
  for (const label of labels) await expect(page.locator(`button[title="Aggiungi: ${label}"]`)).toBeVisible();
  const read = () => page.evaluate(() => window.__construct!.results.getState().meshes[0]);
  for (const label of labels) {
    await addShape(page, label);
    await expect(page.locator('.status-bar')).toContainText('Mesh valida');
    const m = await read();
    expect(m.bbox.max[0] - m.bbox.min[0]).toBeCloseTo(20, 3);
    expect(m.bbox.max[1] - m.bbox.min[1]).toBeCloseTo(20, 3);
    // Lunghezza iniziale 40 mm, appoggiato sul piatto
    expect(m.bbox.min[2]).toBeCloseTo(0, 3);
    expect(m.bbox.max[2]).toBeCloseTo(40, 3);
  }
  await expect(page.locator('.outliner__row')).toHaveCount(labels.length);
  // Il tubolare tondo appena aggiunto è selezionato: pannello con Raggio e Parete
  for (const label of ['Raggio', 'Parete']) await expect(page.locator('.slider-field', { hasText: label })).toBeVisible();

  // Pannello dedicato: sezione "Profilato" con i due spessori (etichette della H) e il raccordo interno; "Lunghezza" nell'estrusione
  await page.locator('.outliner__row', { hasText: 'Profilato a H' }).click();
  await expect(page.locator('.properties__section-title', { hasText: 'Profilato' })).toBeVisible();
  for (const label of ['Spessore ali', 'Spessore anima', 'Raccordo interno', 'Lunghezza']) {
    await expect(page.locator('.slider-field', { hasText: label })).toBeVisible();
  }
  // La mesh della H selezionata (gli oggetti sono sei)
  const readH = () => page.evaluate(() => {
    const id = window.__construct!.store.getState().selection[0];
    return window.__construct!.results.getState().meshes.find((m) => m.rootId === id)!;
  });
  const before = await readH();
  const root = page.locator('.slider-field', { hasText: 'Raccordo interno' }).locator('.number-field__input');
  await root.fill('2');
  await root.press('Enter');
  await settled(page);
  // Il raccordo interno aggiunge materiale negli angoli tra ali e anima
  const withRoot = await readH();
  expect(withRoot.volume).toBeGreaterThan(before.volume);
  // Le punte smussate tolgono materiale; lo stile compare solo con una misura
  await expect(page.locator('.properties__segmented[aria-label="Stile delle punte"]')).toHaveCount(0);
  const tips = page.locator('.slider-field', { hasText: 'Punte' }).locator('.number-field__input');
  await tips.fill('1');
  await tips.press('Enter');
  await settled(page);
  const roundedTips = await readH();
  expect(roundedTips.volume).toBeLessThan(withRoot.volume);
  await page.getByRole('button', { name: 'Smussate' }).click();
  await settled(page);
  expect((await readH()).volume).toBeLessThan(roundedTips.volume);
  type ProfileFields = { kind?: string; rootRadius?: number; flange?: number };
  const profileH = async () => Object.values((await sceneState(page)).nodes as Record<string, ProfileFields>).find((n) => n.kind === 'profileH')!;
  expect((await profileH()).rootRadius).toBe(2);
  // Uno spessore oltre l'ingombro viene ridotto: due ali da 50 mm non stanno in 20 mm di larghezza
  const flange = page.locator('.slider-field', { hasText: 'Spessore ali' }).locator('.number-field__input');
  await flange.fill('50');
  await flange.press('Enter');
  await settled(page);
  expect((await profileH()).flange).toBeLessThan(10);
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');

  // Codice OpenSCAD: estrusione lineare di un polygon
  const code = await readCode(page);
  expect(code).toContain('polygon([');
  expect(code).toContain('linear_extrude(height = 40');
});

test('Viste: 5 alterna ortografica e prospettica senza spostare il centro, 7 guarda dall\'alto, . inquadra la selezione, la proiezione resta dopo il ricaricamento', async ({ page }) => {
  const camera = () => page.evaluate(() => {
    const s = window.__r3f!;
    const c = s.camera as { type: string; position: { x: number; y: number; z: number }; zoom: number };
    const t = (s.controls as { target: { x: number; y: number; z: number } } | null)?.target;
    return { type: c.type, position: [c.position.x, c.position.y, c.position.z], zoom: c.zoom, target: t ? [t.x, t.y, t.z] : null };
  });
  const start = await camera();
  expect(start.type).toBe('PerspectiveCamera');
  expect(start.target).toEqual([0, 0, 20]);

  // Ortografica: stessa posizione e stesso centro, pulsante attivo; 5 di nuovo torna prospettica
  await page.keyboard.press('5');
  const ortho = await camera();
  expect(ortho.type).toBe('OrthographicCamera');
  expect(ortho.position.map((v) => Math.round(v))).toEqual(start.position.map((v) => Math.round(v)));
  expect(ortho.target!.map((v) => Math.round(v))).toEqual([0, 0, 20]);
  expect(ortho.zoom).toBeGreaterThan(0.1);
  await expect(page.locator('header.toolbar').getByRole('button', { name: 'Ortografica', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Dall'alto: la camera sta sopra il centro, alla stessa distanza (in ortografica la distanza è quella equivalente allo zoom)
  await page.keyboard.press('7');
  const top = await camera();
  expect(Math.abs(top.position[0])).toBeLessThan(0.01);
  expect(top.position[2]).toBeGreaterThan(100);

  // Inquadra la selezione: il centro va sul cubo spostato
  await addShape(page, 'Cubo');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await settled(page);
  await page.keyboard.press('.');
  const fit = await camera();
  expect(fit.target!.map((v) => Math.round(v))).toEqual([2, 0, 10]);

  // La proiezione resta dopo il ricaricamento, poi 5 torna prospettica con lo stesso centro
  await page.reload();
  await page.waitForFunction(() => !!window.__construct && !!window.__r3f);
  expect((await camera()).type).toBe('OrthographicCamera');
  await page.keyboard.press('5');
  const back = await camera();
  expect(back.type).toBe('PerspectiveCamera');
  // Dalla tendina Viste: Fronte mette la camera davanti (Y negativo) e alla stessa altezza del centro
  await page.locator('header.toolbar').getByRole('button', { name: 'Viste', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Fronte' }).click();
  const front = await camera();
  expect(front.position[1]).toBeLessThan(-50);
  expect(Math.abs(front.position[2] - front.target![2])).toBeLessThan(0.01);
});

test('Sdraia (Maiusc+V): la trave si stende lungo X, poi lungo Y, poi torna in piedi, sempre appoggiata, un passo di Annulla per volta', async ({ page }) => {
  await addShape(page, 'Profilato a L');
  const read = () => page.evaluate(() => window.__construct!.results.getState().meshes[0].bbox);
  const size = async () => {
    const b = await read();
    return [0, 1, 2].map((i) => Math.round(b.max[i] - b.min[i]));
  };
  expect(await size()).toEqual([20, 20, 40]);
  const steps = async () => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);
  const before = await steps();
  for (const expected of [[40, 20, 20], [20, 40, 20], [20, 20, 40]]) {
    await page.keyboard.press('Shift+V');
    await settled(page);
    expect(await size()).toEqual(expected);
    expect((await read()).min[2]).toBeCloseTo(0, 3);
  }
  expect((await steps()) - before).toBe(3);
  // Anche dalla barra e dal menu contestuale
  await page.locator('header.toolbar').getByRole('button', { name: 'Sdraia', exact: true }).click();
  await settled(page);
  expect(await size()).toEqual([40, 20, 20]);
});

test('Dividi (Maiusc+S): anteprima delle due metà, piano per asse e quota, OK in un solo passo, Esc rimette l\'originale', async ({ page }) => {
  await addShape(page, 'Cubo');
  const meshes = () => page.evaluate(() => window.__construct!.results.getState().meshes.map((m) => ({ rootId: m.rootId, volume: m.volume, status: m.status })));
  const steps = () => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);
  const before = await steps();

  await page.keyboard.press('Shift+S');
  const panel = page.getByRole('region', { name: 'Dividi' });
  await expect(panel).toBeVisible();
  // Piano a metà lungo X: due metà da 4000 mm³, già in anteprima nella scena
  const volumes = async () => (await meshes()).map((m) => Math.round(m.volume)).sort((a, b) => a - b);
  await expect.poll(volumes).toEqual([4000, 4000]);
  await settled(page);
  const parts = await meshes();
  expect(parts).toHaveLength(2);
  expect((await sceneState(page)).rootIds).toHaveLength(2);

  // Asse Z e quota a 5 mm: 20·20·5 e 20·20·15
  await panel.getByRole('group', { name: 'Asse del piano di taglio' }).getByRole('button', { name: 'Z', exact: true }).click();
  const pos = panel.locator('.slider-field', { hasText: 'Posizione' }).locator('.number-field__input');
  // Cambiando asse il campo passa da solo a metà ingombro (10): se si scrive prima, il testo si accoda al vecchio valore
  await expect(pos).toHaveValue('10');
  await pos.fill('5');
  await pos.press('Enter');
  await expect.poll(volumes).toEqual([2000, 6000]);
  await settled(page);

  // Esc: scena di partenza, nessun passo in cronologia
  await page.keyboard.press('Escape');
  await settled(page);
  await expect(panel).toBeHidden();
  expect((await sceneState(page)).rootIds).toHaveLength(1);
  expect(await steps()).toBe(before);

  // Di nuovo, con OK: due oggetti "Cubo (1)" e "Cubo (2)", un solo passo, codice con due intersection()
  await page.keyboard.press('Shift+S');
  await expect(panel).toBeVisible();
  await settled(page);
  await page.keyboard.press('Enter');
  await settled(page);
  await expect(panel).toBeHidden();
  const scene = await sceneState(page);
  expect(scene.rootIds).toHaveLength(2);
  expect(scene.rootIds.map((id: string) => scene.nodes[id].name)).toEqual(['Cubo (1)', 'Cubo (2)']);
  expect(await steps()).toBe(before + 1);
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  const code = await readCode(page);
  expect(code.split('intersection() {').length - 1).toBe(2);
  // Ctrl+Z rimette il cubo intero
  await page.keyboard.press('Control+z');
  await settled(page);
  expect((await sceneState(page)).rootIds).toHaveLength(1);
});

test('Dividi con angolo: 45° attorno a Y con il piano Z a 5 mm dà metà di 2250 e 5750 mm³, il codice ha rotate e Esc ripristina', async ({ page }) => {
  await addShape(page, 'Cubo');
  const meshes = () => page.evaluate(() => window.__construct!.results.getState().meshes.map((m) => Math.round(m.volume)).sort((a, b) => a - b));
  await page.keyboard.press('Shift+S');
  const panel = page.getByRole('region', { name: 'Dividi' });
  await expect(panel).toBeVisible();
  await panel.getByRole('group', { name: 'Asse del piano di taglio' }).getByRole('button', { name: 'Z', exact: true }).click();
  const pos = panel.locator('.slider-field', { hasText: 'Posizione' }).locator('.number-field__input');
  // Cambiando asse il campo passa da solo a metà ingombro (10): se si scrive prima, il testo si accoda al vecchio valore
  await expect(pos).toHaveValue('10');
  await pos.fill('5');
  await pos.press('Enter');
  // Senza angolo: due metà da 2000 e 6000
  await expect.poll(meshes).toEqual([2000, 6000]);

  // Con l'asse di inclinazione (Y, il predefinito per il piano Z) e 45°: il piano passa da (0, 0, 5) in diagonale
  await expect(panel.getByRole('group', { name: 'Asse di inclinazione del piano' }).getByRole('button')).toHaveCount(2);
  const angle = panel.locator('.slider-field', { hasText: 'Angolo' }).locator('.number-field__input');
  await angle.fill('45');
  await angle.press('Enter');
  await expect.poll(meshes).toEqual([2250, 5750]);

  // Cambiando asse del piano, l'asse di inclinazione non coincide mai con lui
  await panel.getByRole('group', { name: 'Asse del piano di taglio' }).getByRole('button', { name: 'Y', exact: true }).click();
  const tilt = panel.getByRole('group', { name: 'Asse di inclinazione del piano' });
  await expect(tilt.getByRole('button', { name: 'Y', exact: true })).toHaveCount(0);
  await panel.getByRole('group', { name: 'Asse del piano di taglio' }).getByRole('button', { name: 'Z', exact: true }).click();
  // Tornati al piano Z l'asse di inclinazione è passato da solo a X: si rimette Y e il piano torna a metà (10 mm)
  await tilt.getByRole('button', { name: 'Y', exact: true }).click();
  await expect(tilt.getByRole('button', { name: 'Y', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(meshes).toEqual([4000, 4000]);

  // OK: due oggetti, il cubo di taglio è ruotato e il codice lo dice
  await page.keyboard.press('Enter');
  await expect(panel).toBeHidden();
  await settled(page);
  expect((await sceneState(page)).rootIds).toHaveLength(2);
  const code = await readCode(page);
  expect(code).toContain('rotate([0, 45, 0])');
  // Annulla riporta il cubo intero
  await page.keyboard.press('Control+z');
  await settled(page);
  expect((await sceneState(page)).rootIds).toHaveLength(1);
});

test('Dividi con i connettori: Perno con sede e tolleranza, avviso se escono dal pezzo, Spine in un oggetto a parte, un solo passo di Annulla', async ({ page }) => {
  await addShape(page, 'Cubo');
  const meshes = () => page.evaluate(() => window.__construct!.results.getState().meshes.map((m) => ({ rootId: m.rootId, volume: m.volume })));
  const steps = () => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);
  const before = await steps();
  await page.keyboard.press('Shift+S');
  const panel = page.getByRole('region', { name: 'Dividi' });
  await expect(panel).toBeVisible();
  const type = panel.getByRole('group', { name: 'Tipo di connettore' });
  // Senza connettori i campi non ci sono
  await expect(panel.getByRole('group', { name: 'Forma dei connettori' })).toHaveCount(0);

  // Perno: compaiono i campi. I due predefiniti stanno sul bordo del cubo (distanza 20 su un lato di 20): avviso del kernel
  await type.getByRole('button', { name: 'Perno', exact: true }).click();
  await expect(panel.getByRole('group', { name: 'Forma dei connettori' })).toBeVisible();
  await expect(panel.getByRole('status')).toContainText('escono dal pezzo');

  // Un solo connettore al centro: l'avviso sparisce. Perno tondo da 5 mm lungo 6 e sede da 5,4 mm lunga 6,2 mm
  const count = panel.locator('.slider-field', { hasText: 'Numero' }).locator('.number-field__input');
  await count.fill('1');
  await count.press('Enter');
  await expect(panel.getByRole('status')).toHaveCount(0);
  // 4000 + 19,58 · 6 e 4000 − 22,84 · 6,2, arrotondati alla decina
  await expect.poll(async () => (await meshes()).map((m) => Math.round(m.volume / 10)).sort((a, b) => a - b)).toEqual([386, 412]);
  await settled(page);
  const roots = (await sceneState(page)).rootIds;
  expect(roots).toHaveLength(2);

  // Spine: due metà con il foro e un terzo oggetto con la spina
  await type.getByRole('button', { name: 'Spine', exact: true }).click();
  await expect.poll(async () => (await sceneState(page)).rootIds.length).toBe(3);
  await settled(page);
  const withDowels = await sceneState(page);
  expect(withDowels.nodes[withDowels.rootIds[2]].name).toBe('Spine');

  // Esc: scena di partenza e nessun passo in cronologia
  await page.keyboard.press('Escape');
  await settled(page);
  await expect(panel).toBeHidden();
  expect((await sceneState(page)).rootIds).toHaveLength(1);
  expect(await steps()).toBe(before);

  // Di nuovo con il Perno e OK: un solo passo, il codice ha la sede come foro; Ctrl+Z rimette il cubo intero
  await page.keyboard.press('Shift+S');
  await expect(panel).toBeVisible();
  await type.getByRole('button', { name: 'Perno', exact: true }).click();
  await settled(page);
  await page.keyboard.press('Enter');
  await expect(panel).toBeHidden();
  await settled(page);
  expect(await steps()).toBe(before + 1);
  expect((await readCode(page))).toContain('(foro)');
  await page.keyboard.press('Control+z');
  await settled(page);
  expect((await sceneState(page)).rootIds).toHaveLength(1);
});

test('Con uno strumento a pannello aperto la barra si ferma (resta il suo pulsante) e il clic destro sull\'oggetto non apre il menu', async ({ page }) => {
  await addShape(page, 'Cubo');
  const toolbar = page.locator('header.toolbar');
  const button = (name: string) => toolbar.getByRole('button', { name, exact: true });
  await expect(button('Duplica')).toBeEnabled();

  await page.keyboard.press('Shift+S');
  await expect(page.getByRole('region', { name: 'Dividi' })).toBeVisible();
  // Resta attivo solo il pulsante di Dividi (per chiuderlo): niente altro, nemmeno File
  await expect(button('Dividi')).toBeEnabled();
  for (const name of ['Duplica', 'Elimina', 'Blocca', 'Guscio', 'Raccordo', 'Misura', 'Sposta', 'Seleziona', 'Nuovo progetto']) await expect(button(name), name).toBeDisabled();
  // Il clic destro su una metà non apre il menu dei comandi (come con gli altri strumenti)
  const at = await project(page, [0, 0, 10]);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(page.getByRole('menu', { name: 'Comandi per la selezione' })).toHaveCount(0);

  // Esc chiude lo strumento e la barra torna normale
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Dividi' })).toBeHidden();
  await expect(button('Duplica')).toBeEnabled();
  await expect(button('Nuovo progetto')).toBeEnabled();
});

test('Con Raccordo aperto si può passare a Smusso dalla barra, ma non agli altri strumenti', async ({ page }) => {
  await addShape(page, 'Cubo');
  const toolbar = page.locator('header.toolbar');
  await page.keyboard.press('f');
  await expect(toolbar.getByRole('button', { name: 'Raccordo', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(toolbar.getByRole('button', { name: 'Smusso', exact: true })).toBeEnabled();
  await expect(toolbar.getByRole('button', { name: 'Smusso angolare', exact: true })).toBeEnabled();
  await expect(toolbar.getByRole('button', { name: 'Dividi', exact: true })).toBeDisabled();
  await toolbar.getByRole('button', { name: 'Smusso', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: 'Smusso', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('Un clic sul marchio in alto a sinistra riapre la schermata di benvenuto', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Benvenuto in Construct' });
  await expect(dialog).toHaveCount(0);
  await page.locator('button.brand').click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('Barra stretta: sotto 1440 px i pulsanti di vista stanno nella tendina Altro, con le stesse funzioni e il menu resta visibile', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const toolbar = page.locator('header.toolbar');
  await expect(toolbar.getByRole('button', { name: 'Tema', exact: true })).toHaveCount(0);
  const more = toolbar.getByRole('button', { name: 'Altro', exact: true });
  await expect(more).toBeVisible();
  // Il menu hamburger sta dentro la finestra
  const menu = (await toolbar.getByRole('button', { name: 'Menu', exact: true }).boundingBox())!;
  expect(menu.x + menu.width).toBeLessThanOrEqual(1280);
  // Il tooltip dell'Altro dice i tasti
  await more.hover();
  await expect(page.getByRole('tooltip').locator('kbd')).toHaveCount(1);

  // Tema: dal tema scuro predefinito si passa al chiaro dalla tendina
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  expect(await theme()).toBe('dark');
  await more.click();
  // La tendina sta tutta dentro la finestra (non esce dal bordo destro)
  const panel = (await page.locator('.toolbar__dropdown-panel').boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(1280);
  await page.getByRole('menuitem', { name: 'Tema chiaro', exact: true }).click();
  expect(await theme()).toBe('light');

  // Ortografica: interruttore con il segno di spunta
  await more.click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Ortografica', exact: true })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('menuitemcheckbox', { name: 'Ortografica', exact: true }).click();
  await more.click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Ortografica', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');

  // Piatto: la voce dice cosa farà
  await more.click();
  await page.getByRole('menuitem', { name: 'Nascondi piatto', exact: true }).click();
  await more.click();
  await expect(page.getByRole('menuitem', { name: 'Mostra piatto', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  // Codice OpenSCAD
  await more.click();
  await page.getByRole('menuitemcheckbox', { name: 'Codice OpenSCAD', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('c');
  await expect(page.getByRole('dialog')).toBeHidden();

  // Allargando la finestra tornano i pulsanti separati
  await page.setViewportSize({ width: 1500, height: 800 });
  await expect(toolbar.getByRole('button', { name: 'Tema', exact: true })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Altro', exact: true })).toHaveCount(0);
});

test('Guscio su un profilato: cavità esatta (nessun avviso di approssimazione), mesh valida e volume minore', async ({ page }) => {
  await addShape(page, 'Profilato a H');
  const read = () => page.evaluate(() => window.__construct!.results.getState().meshes[0]);
  const full = await read();
  await page.keyboard.press('g');
  await expect(page.getByRole('region', { name: 'Guscio' })).toBeVisible();
  await expect(page.locator('.edge-panel__hint', { hasText: 'non ha una cavità esatta' })).toHaveCount(0);
  // Pareti di 3 mm: con 2 mm di spessore per lato la cavità non entra e il pannello lo dice; con 1 mm sì
  await expect(page.locator('.edge-panel__error')).toContainText('troppo spesse');
  const wall = page.locator('.slider-field', { hasText: 'Laterale' }).locator('.number-field__input');
  await wall.fill('1');
  await wall.press('Enter');
  await settled(page);
  await expect(page.locator('.edge-panel__error')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await settled(page);
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  const hollow = await read();
  expect(hollow.volume).toBeGreaterThan(0);
  expect(hollow.volume).toBeLessThan(full.volume);
  // Nel codice la cavità è un secondo polygon dentro la difference del guscio
  const code = await readCode(page);
  expect(code.split('polygon(').length - 1).toBe(2);
});

test('Testo: scritta e font dal pannello, un passo di Annulla per ogni modifica, Esc annulla la bozza', async ({ page }) => {
  await addShape(page, 'Testo');
  await settled(page);
  const id = (await sceneState(page)).rootIds[0];
  const history = () => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);
  const width = () => page.evaluate(() => { const b = window.__construct!.results.getState().meshes[0].bbox; return b.max[0] - b.min[0]; });
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
  expect(file.suggestedFilename()).toBe('construct.zip');
  const { readFileSync } = await import('node:fs');
  const { unzipSync, strFromU8 } = await import('fflate');
  const entries = unzipSync(new Uint8Array(readFileSync(await file.path())));
  expect(Object.keys(entries).sort()).toEqual(['Lobster-Regular.ttf', 'construct.scad']);
  const code = strFromU8(entries['construct.scad']);
  expect(code).toContain('use <Lobster-Regular.ttf>;');
  expect(code).toContain('text("Testo", size = 10, font = "Lobster:style=Regular"');
  // Il TTF dello ZIP è un file font vero
  expect(entries['Lobster-Regular.ttf'].length).toBeGreaterThan(50000);
  expect(new DataView(entries['Lobster-Regular.ttf'].buffer, entries['Lobster-Regular.ttf'].byteOffset).getUint32(0)).toBe(0x00010000);
});

/** Ingombro nel mondo di ogni oggetto alla radice, dai risultati del kernel. */
const boundsOf = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.__construct!.results.getState().meshes.map((m) => ({ name: window.__construct!.store.getState().scene.nodes[m.rootId].name, min: m.bbox.min, max: m.bbox.max })));

test('Allinea (K): la tendina allinea cubo e sfera al lato scelto dell\'ingombro, in un solo passo di Annulla', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Sfera');
  // Cubo e sfera a distanze diverse sull'asse X
  await page.evaluate(() => {
    const st = window.__construct!.store.getState();
    const [sfera, cubo] = st.scene.rootIds;
    st.updateNode(cubo, { position: [-40, 0, 10] });
    st.updateNode(sfera, { position: [30, 0, 10] });
    st.select([cubo, sfera]);
  });
  await settled(page);
  // Il tasto K apre la tendina; Max sull'asse X porta il lato destro di entrambi allo stesso punto
  await page.keyboard.press('k');
  const history = () => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);
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
    const st = window.__construct!.store.getState();
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
  await page.getByRole('dialog', { name: 'Importa' }).getByRole('button', { name: 'SVG', exact: true }).click();
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
  const tabs = page.getByRole('tablist', { name: 'Libreria' }).getByRole('tab');
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
  const volume = await page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);
  expect(volume).toBeGreaterThan(10);
});

test('Nuovo con la casella "Svuota anche la cronologia": la timeline riparte da zero e Ctrl+Z non ripristina nulla', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Sfera');
  const history = () => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);
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
    const st = window.__construct!.store.getState();
    st.updateNode(st.scene.rootIds[0], { size: [30, 12, 40], cornerRadius: 3 } as never);
  });
  await settled(page);
  // Il ricaricamento riporta anche il primo cubo (salvataggio automatico): il nuovo è sempre in cima all'elenco
  await sceneSaved(page);
  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => !!window.__construct);
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
    const st = window.__construct!.store.getState();
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

test('Testo: trentadue font in cinque gruppi, uno nuovo si applica e la mesh resta valida', async ({ page }) => {
  await addShape(page, 'Testo');
  const select = page.locator('select.properties__text');
  await expect(select.locator('optgroup')).toHaveCount(5);
  await expect(select.locator('option')).toHaveCount(32);
  await select.selectOption('stardos-stencil-bold');
  await settled(page);
  const scene = await sceneState(page);
  expect(scene.nodes[scene.rootIds[0]].font).toBe('stardos-stencil-bold');
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
});

test('Testo: la Spaziatura allarga il testo, finisce nel codice e la mesh resta valida', async ({ page }) => {
  await addShape(page, 'Testo');
  await settled(page);
  const width = () => page.evaluate(() => { const b = window.__construct!.results.getState().meshes[0].bbox; return b.max[0] - b.min[0]; });
  const before = await width();
  const spacing = page.locator('.slider-field', { hasText: 'Spaziatura' }).locator('.number-field__input');
  await spacing.fill('2');
  await spacing.press('Enter');
  await settled(page);
  expect(await width()).toBeGreaterThan(before * 1.3);
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  expect(await readCode(page)).toContain('spacing = 2');
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
  // Il manuale è un modulo a parte: si scarica solo aprendo la Documentazione
  expect(had('DocsPanel')).toBe(false);
  await page.keyboard.press('Escape');
  await openMenuItem(page, 'Documentazione');
  await expect(page.getByRole('dialog', { name: 'Documentazione' })).toBeVisible();
  expect(had('DocsPanel')).toBe(true);
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
  await expect(page.getByRole('tablist', { name: 'Libreria' }).getByRole('tab')).toHaveText(['Forme 3D', 'Forme 2D', 'Simboli', 'Emoji']);
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
  const volume = await page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);
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
  await page.getByRole('dialog', { name: 'Importa' }).getByRole('button', { name: 'SVG', exact: true }).click();
  await (await chooser).setFiles({ name: 'barra.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  await settled(page);
  const id = (await sceneState(page)).rootIds[0];
  const node = async () => (await sceneState(page)).nodes[id];
  expect(await node()).toMatchObject({ width: 40, depth: 20, lockRatio: true });

  const field = (label: string | RegExp) => page.locator('.slider-field').filter({ has: page.getByText(label, { exact: true }) }).locator('.number-field__input');
  const lock = page.getByRole('button', { name: /Bloccate|Libere/ });
  await expect(lock).toHaveAttribute('aria-pressed', 'true');

  // Larghezza 80 con il lucchetto: la profondità segue (40) in un solo passo di Annulla
  const history = () => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);
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
  const bbox = () => page.evaluate(() => window.__construct!.results.getState().meshes[0].bbox);
  const volume = () => page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);

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
    const st = window.__construct!.store.getState();
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
    const m = window.__construct!.results.getState().meshes[0];
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
  const history = () => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);
  const before = await history();
  await page.mouse.click(at.x, at.y);

  // Lo strumento si chiude, il cubo è di nuovo allineato agli assi e sta sul piatto (la correzione arriva dopo il kernel)
  await expect(page.getByRole('region', { name: 'Appoggia su una faccia' })).toHaveCount(0);
  await settled(page);
  await expect.poll(async () => (await page.evaluate(() => window.__construct!.results.getState().meshes[0].bbox.min[2]))).toBeCloseTo(0, 2);
  const bbox = await page.evaluate(() => window.__construct!.results.getState().meshes[0].bbox);
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
  const bbox = () => page.evaluate(() => window.__construct!.results.getState().meshes[0].bbox);
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
    const st = window.__construct!.store.getState();
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
  const volume = await page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);
  expect(volume).toBeGreaterThan(20000);
  expect(await readCode(page)).toContain('hull() {');

  // Ctrl+Z riporta i due oggetti
  await page.keyboard.press('Control+z');
  expect((await sceneState(page)).rootIds).toHaveLength(2);
});

test('Minkowski (Maiusc+J): cubo e sfera diventano un solo gruppo con minkowski(), più grande del cubo', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Sfera');
  // Il cubo (selezionato per primo) è la base; la sfera lo arrotonda
  await page.evaluate(() => {
    const st = window.__construct!.store.getState();
    const [sfera, cubo] = st.scene.rootIds;
    st.updateNode(cubo, { position: [0, 0, 10] });
    st.updateNode(sfera, { position: [0, 0, 10] });
    st.select([cubo, sfera]);
  });
  await settled(page);
  await expect(page.getByRole('button', { name: 'Minkowski', exact: true })).toBeEnabled();

  await page.keyboard.press('Shift+J');
  await settled(page);
  const scene = await sceneState(page);
  expect(scene.rootIds).toHaveLength(1);
  expect(scene.nodes[scene.rootIds[0]]).toMatchObject({ type: 'group', op: 'minkowski', name: 'Minkowski' });
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  expect(await readCode(page)).toContain('minkowski() {');

  // Ctrl+Z riporta i due oggetti
  await page.keyboard.press('Control+z');
  expect((await sceneState(page)).rootIds).toHaveLength(2);
});

test('Serie (O): cinque copie in fila con anteprima dal vivo, OK crea un solo gruppo Ripetizione in un passo di Annulla', async ({ page }) => {
  await addShape(page, 'Cubo');
  const history = () => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);
  const before = await history();
  await page.keyboard.press('o');
  const panel = page.getByRole('region', { name: 'Serie' });
  await expect(panel).toBeVisible();
  await settled(page);

  // Anteprima viva: cinque cubi da 20 mm con passo > 20 in fila lungo X, un solo oggetto
  const bbox = () => page.evaluate(() => window.__construct!.results.getState().meshes[0].bbox);
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
  await page.evaluate(() => window.__construct!.store.getState().select([]));
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
  const volume = () => page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);
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
  const history = () => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);
  const volume = () => page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);
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

  await page.evaluate(() => window.__construct!.store.getState().select([]));
  await expect(page.locator('header.toolbar button[aria-label^="Pattern"]')).toBeDisabled();
  await page.keyboard.press('z');
  await expect(page.getByRole('region', { name: 'Pattern' })).toHaveCount(0);
});

test('Pattern: seme, tipo, profondità, rombi, triangoli e faccia si leggono e si modificano dalle proprietà del gruppo', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.keyboard.press('z');
  await page.getByRole('region', { name: 'Pattern' }).getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const id = (await sceneState(page)).rootIds[0];
  const volume = () => page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);
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
  await page.getByLabel('Tipo').selectOption({ label: 'Esagoni' });
  await settled(page);
  expect((await pattern()).kind).toBe('hexagon');
  expect(await volume()).toBeLessThan(8000);
  expect(await readCode(page)).toContain('offset(delta = -');

  // Tasca da due lati: il cubo non è più bucato da parte a parte e resta valido
  await page.getByLabel('Tipo').selectOption({ label: 'Voronoi' });
  const depth = page.locator('.slider-field').filter({ has: page.getByText('Profondità', { exact: true }) }).locator('.number-field__input');
  await depth.fill('4');
  await depth.press('Enter');
  await page.getByRole('button', { name: 'Entrambe', exact: true }).click();
  await settled(page);
  expect(await pattern()).toMatchObject({ kind: 'voronoi', depth: 4, sides: 'both' });
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  expect(await readCode(page)).toContain('for (z = [-4,');

  // Rombi e Triangoli: griglie regolari con la stessa riduzione per la parete
  await page.getByLabel('Tipo').selectOption({ label: 'Rombi' });
  await settled(page);
  expect((await pattern()).kind).toBe('diamond');
  await page.getByLabel('Tipo').selectOption({ label: 'Triangoli' });
  await settled(page);
  expect((await pattern()).kind).toBe('triangle');
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');

  // Una sola faccia: niente pulsanti dei lati, la riga Faccia dice da dove parte il taglio
  await expect(page.getByRole('group', { name: 'Facce' })).toHaveCount(0);
  // (il selettore "Lati" della tasca contiene la parola "faccia": si cerca l'etichetta esatta)
  await expect(page.locator('.array-fields__row').filter({ has: page.getByText('Faccia', { exact: true }) })).toContainText('+Z');
  expect((await pattern()).faces).toHaveLength(1);
});

test('Tooltip dettagliati: il pulsante Pattern mostra cosa fa, come si applica, la scorciatoia e un\'immagine', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.locator('header.toolbar button[aria-label^="Pattern"]').hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Fora l\'oggetto');
  await expect(tip).toContainText('Scegli faccia');
  await expect(tip.locator('kbd')).toHaveText('Z');
  await expect(tip.locator('img')).toHaveAttribute('src', /help\/pattern\.webp$/);
  // Esc lo chiude e non lascia traccia
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);

  // Anche un pulsante disabilitato spiega cosa fa (senza selezione Unisci non è disponibile)
  await page.locator('header.toolbar button[aria-label^="Unisci"]').hover({ force: true });
  await expect(page.getByRole('tooltip')).toContainText('unione booleana');

  // Il pulsante a stato cambia testo: il piatto dice come è ora
  await page.locator('header.toolbar button[aria-label^="Piatto"]').hover();
  await expect(page.getByRole('tooltip')).toContainText('Ora: visibile');
});

test('Pattern: Scegli faccia sostituisce la faccia con un clic, chiude la scelta e mostra il pezzo intero durante la scelta', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.keyboard.press('z');
  const panel = page.getByRole('region', { name: 'Pattern' });
  await settled(page);
  const volume = () => page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);
  await expect.poll(volume).toBeLessThan(7500);
  // Parte dalla cima, e non ci sono più i pulsanti dei lati
  await expect(panel.getByRole('group', { name: 'Facce' })).toHaveCount(0);
  await expect(panel.locator('.array-fields__row', { hasText: 'Faccia' })).toContainText('+Z');

  // Durante la scelta la vista mostra il cubo intero (si cliccano le facce del pezzo, non le pareti delle celle)
  await panel.getByRole('button', { name: 'Scegli faccia' }).click();
  await settled(page);
  await expect.poll(volume).toBeCloseTo(8000, 0);
  await expect(panel).toContainText('Clicca la faccia');

  // Un clic sulla faccia anteriore la sceglie al posto della cima e chiude la scelta: l'anteprima torna con il pattern
  const front = await project(page, [0, -10, 10]);
  await page.mouse.move(front.x, front.y);
  await page.mouse.click(front.x, front.y);
  await expect(panel.locator('.array-fields__row', { hasText: 'Faccia' })).toContainText('−Y');
  await expect(panel.getByRole('button', { name: 'Scegli faccia' })).toHaveAttribute('aria-pressed', 'false');
  await settled(page);
  await expect.poll(volume).toBeLessThan(7500);
  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const scene = await sceneState(page);
  const pattern = scene.nodes[scene.rootIds[0]].pattern;
  expect(pattern.faces).toHaveLength(1);
  expect(pattern.faces[0].normal).toEqual([0, -1, 0]);
  expect(pattern.preview).toBeUndefined();
  expect(await readCode(page)).toContain('cells = [');
});

test('Pattern passante su un pezzo smussato: nessuna cella sullo smusso, e "Aggiorna all\'ingombro" corregge un progetto vecchio', async ({ page }) => {
  await addShape(page, 'Cubo');
  // Smusso da 6 mm sullo spigolo tra la cima e la faccia anteriore (il cubo poggia sul piatto, z da 0 a 20: lo smusso occupa y in [-10, -4] e z in [14, 20])
  await page.keyboard.press('s');
  const chamfer = page.getByRole('region', { name: 'Smusso' });
  await pickTopAndFront(page);
  await settled(page);
  const distance = chamfer.locator('.slider-field', { hasText: 'Distanza' }).locator('.number-field__input');
  await distance.fill('6');
  await distance.press('Enter');
  await settled(page);
  await chamfer.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const chamfered = (await sceneState(page)).rootIds[0];
  await page.evaluate((id) => window.__construct!.store.setState({ selection: [id] }), chamfered);

  // Pattern passante dalla cima, senza cornice: lo smusso non deve avere celle
  await page.keyboard.press('z');
  const panel = page.getByRole('region', { name: 'Pattern' });
  await expect(panel).toBeVisible();
  await settled(page);
  await page.getByLabel('Tipo').selectOption({ label: 'Esagoni' });
  const margin = panel.locator('.slider-field', { hasText: 'Margine' }).locator('.number-field__input');
  await margin.fill('0');
  await margin.press('Enter');
  await settled(page);
  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const group = (await sceneState(page)).rootIds[0];
  const pattern = async () => (await sceneState(page)).nodes[group].pattern;
  expect(await pattern()).toMatchObject({ kind: 'hexagon', depth: 0, region: 'face' });

  /** Un foro passante sotto lo smusso lascia vertici con y in [-9,9, -4,1] sul fondo del pezzo (z < 3,9); senza fori lì non ce ne sono. */
  const holesUnderChamfer = () =>
    page.evaluate(() => {
      const mesh = window.__construct!.results.getState().meshes[0];
      let count = 0;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const y = mesh.positions[i + 1];
        const z = mesh.positions[i + 2];
        if (y > -9.9 && y < -4.1 && z < 3.9) count++;
      }
      return count;
    });
  const volume = () => page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);
  expect(await volume()).toBeLessThan(7640 - 100);
  expect(await holesUnderChamfer()).toBe(0);

  // Un progetto vecchio non ha region (= silhouette): lo smusso si fora. "Aggiorna all'ingombro" ricalcola la regione
  await page.evaluate((id) => {
    const store = window.__construct!.store.getState();
    const { region: _removed, ...rest } = (store.scene.nodes[id] as GroupNode).pattern!;
    store.updateNode(id, { pattern: rest } as Partial<GroupNode>);
  }, group);
  await settled(page);
  expect(await holesUnderChamfer()).toBeGreaterThan(0);
  await page.getByRole('button', { name: "Aggiorna all'ingombro" }).click();
  await expect.poll(async () => (await pattern()).region).toBe('face');
  await settled(page);
  expect(await holesUnderChamfer()).toBe(0);
});

test('Pattern: una faccia inclinata si sceglie con il clic, e un secondo Pattern si applica sul gruppo', async ({ page }) => {
  await addShape(page, 'Cono');
  // Piramide a base quadrata ruotata di 45°: la faccia anteriore ha la normale inclinata verso -Y
  const id = (await sceneState(page)).rootIds[0];
  await page.evaluate((nodeId) => window.__construct!.store.getState().updateNode(nodeId, { radiusBottom: 20, radiusTop: 0, height: 20, segments: 4, rotation: [0, 0, 45] }), id);
  await settled(page);
  const volume = () => page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);
  await expect.poll(volume).toBeCloseTo((800 * 20) / 3, 0);
  const box = await page.evaluate(() => window.__construct!.results.getState().meshes[0].bbox);
  const center = [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2);

  await page.keyboard.press('z');
  const panel = page.getByRole('region', { name: 'Pattern' });
  await settled(page);
  await panel.getByRole('button', { name: 'Scegli faccia' }).click();
  await settled(page);
  // Il baricentro della faccia anteriore sta a 9,43 mm davanti al centro e 3,33 mm sotto
  const face = await project(page, [center[0], center[1] - 9.43, center[2] - 3.33]);
  await page.mouse.move(face.x, face.y);
  await page.mouse.click(face.x, face.y);
  await expect(panel.locator('.array-fields__row', { hasText: 'Faccia' })).toContainText(/inclinata \(55° da \+Z\)/);
  await settled(page);
  await expect.poll(volume).toBeLessThan((800 * 20) / 3);
  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
  const first = (await sceneState(page)).rootIds[0];

  // Secondo Pattern sul gruppo appena creato (dalla cima): un gruppo dentro l'altro, ognuno con la sua faccia
  await page.keyboard.press('z');
  await expect(panel).toBeVisible();
  await settled(page);
  await panel.getByRole('button', { name: 'OK' }).click();
  await settled(page);
  const scene = await sceneState(page);
  const outer = scene.nodes[scene.rootIds[0]];
  expect(outer.op).toBe('pattern');
  expect(outer.children).toEqual([first]);
  expect(scene.nodes[first].op).toBe('pattern');
  await expect(page.locator('.status-bar')).toContainText('Mesh valida');
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
    const meshes = window.__construct!.results.getState().meshes.filter((m) => !m.empty);
    return Math.max(...meshes.map((m) => m.bbox.max[0])) - Math.min(...meshes.map((m) => m.bbox.min[0]));
  });

test.describe('Ridimensiona (R) su un gruppo di qualsiasi tipo', () => {
  /** Due oggetti alla radice, selezionati insieme: serve per le operazioni che combinano più oggetti. */
  async function twoShapes(page: Page) {
    await addShape(page, 'Cubo');
    await addShape(page, 'Sfera');
    await page.evaluate(() => window.__construct!.store.getState().select(window.__construct!.store.getState().scene.rootIds));
  }
  const cases: [string, (page: Page) => Promise<void>, string][] = [
    ['Raggruppa', async (page) => { await twoShapes(page); await page.keyboard.press('Control+g'); }, 'group'],
    ['Unione', async (page) => { await twoShapes(page); await page.keyboard.press('u'); }, 'union'],
    ['Inviluppo convesso', async (page) => { await twoShapes(page); await page.keyboard.press('j'); }, 'hull'],
    ['Differenza', async (page) => { await twoShapes(page); await page.evaluate(() => { const s = window.__construct!.store.getState(); const ball = s.scene.rootIds.find((id) => s.scene.nodes[id].type === 'primitive' && (s.scene.nodes[id] as { kind: string }).kind === 'sphere')!; s.updateNode(ball, { radius: 4 } as never); s.select([s.scene.rootIds.find((id) => id !== ball)!, ball]); s.combineSelected('difference'); }); }, 'difference'],
    ['Intersezione', async (page) => { await twoShapes(page); await page.evaluate(() => window.__construct!.store.getState().combineSelected('intersection')); }, 'intersection'],
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
      await page.evaluate((gid) => window.__construct!.store.getState().select([gid]), id);
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
  await page.waitForFunction(() => !!window.__construct && !!window.__r3f);
  await expect(status.getByRole('button')).toHaveText('Piano 300 × 180 mm');
  await status.getByRole('button').click();
  await dialog.getByRole('button', { name: /Predefinito/ }).click();
  await dialog.getByRole('button', { name: 'Applica' }).click();
  await expect(status.getByRole('button')).toHaveText('Piano 256 × 256 mm');
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
  const scene = await sceneState(page);
  expect(scene.rootIds).toHaveLength(2);
  // La copia sta nelle stesse coordinate dell'originale
  expect(scene.nodes[scene.rootIds[0]].position).toEqual(scene.nodes[scene.rootIds[1]].position);
});

test('Barra strumenti: i comandi sono in gruppi con il nome della sezione', async ({ page }) => {
  const toolbar = page.locator('header.toolbar');
  for (const [name, buttons] of [
    ['File', ['Nuovo progetto', 'Annulla', 'Ripeti']],
    ['Trasforma', ['Seleziona', 'Sposta', 'Ruota', 'Ridimensiona']],
    ['Combina', ['Raggruppa', 'Separa', 'Unisci', 'Inviluppo convesso']],
    ['Modifica', ['Estrudi', 'Raccordo', 'Smusso', 'Smusso angolare', 'Guscio', 'Pattern', 'Dividi']],
    ['Disponi', ['Allinea', 'Specchia', 'Sdraia', 'Serie']],
    ['Oggetto', ['Duplica', 'Elimina', 'Misura']],
    ['Vista', ['Viste', 'Ortografica', 'Codice OpenSCAD', 'Tema']],
  ] as const) {
    const group = toolbar.getByRole('group', { name });
    await expect(group, `sezione "${name}"`).toBeVisible();
    for (const button of buttons) await expect(group.getByRole('button', { name: button, exact: true }), `"${button}" in "${name}"`).toBeVisible();
  }
});

test('Piano di stampa: la tendina delle stampanti ha la misura per prima e compila i campi, e si conferma con Applica', async ({ page }) => {
  const status = page.locator('.status-bar');
  await status.getByRole('button', { name: /Piano 256/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Dimensioni del piano' });
  const select = dialog.getByRole('combobox', { name: 'Stampante' });
  // Ogni voce comincia dalla misura e poi elenca le stampanti che l'hanno
  const labels = await select.locator('option').allTextContents();
  expect(labels.length).toBeGreaterThan(5);
  for (const label of labels) expect(label).toMatch(/^\d+ × \d+ mm · /);
  // La marca compare una volta sola, seguita dai modelli
  expect(labels).toContain('180 × 180 mm · Bambu Lab: A1 mini · Prusa: MINI+');
  expect(labels).toContain('256 × 256 mm · Bambu Lab: A1, P1S, P1P, X1C · Elegoo: Centauri Carbon');
  expect(labels).toContain('420 × 420 mm · Anycubic: Kobra 2 Max, Kobra 3 Max · Elegoo: Neptune 3 Max, Neptune 4 Max');
  expect(labels.some((l) => l.startsWith('350 × 320 mm') && l.includes('H2D'))).toBe(true);
  // Con le misure attuali (256 × 256) è scelta la voce giusta
  await expect(select.locator('option:checked')).toHaveText(/^256 × 256 mm/);

  await select.selectOption({ label: '180 × 180 mm · Bambu Lab: A1 mini · Prusa: MINI+' });
  await expect(dialog.locator('.number-field', { hasText: 'Larghezza X' }).locator('input')).toHaveValue('180');
  // Non cambia nulla finché non si applica
  await expect(page.locator('.status-bar__bed')).toHaveText('Piano 256 × 256 mm');
  await dialog.getByRole('button', { name: 'Applica' }).click();
  await expect(page.locator('.status-bar__bed')).toHaveText('Piano 180 × 180 mm');
  await expect.poll(() => page.evaluate(() => (window.__r3f!.scene.getObjectByName('bed-plate') as unknown as { geometry: { parameters: { width: number } } }).geometry.parameters.width)).toBe(180);

  // Misure che non sono di nessuna stampante: la tendina mostra "personalizzate"
  await page.locator('.status-bar__bed').click();
  const width = dialog.locator('.number-field', { hasText: 'Larghezza X' }).locator('input');
  await width.fill('300');
  await width.press('Enter');
  await expect(select.locator('option:checked')).toHaveText(/Misure personalizzate/);
});

test('Piano di stampa: i cursori seguono le misure del piano invece del vecchio limite di 256 mm', async ({ page }) => {
  await page.locator('.status-bar__bed').click();
  const dialog = page.getByRole('dialog', { name: 'Dimensioni del piano' });
  await dialog.locator('.number-field', { hasText: 'Larghezza X' }).locator('input').fill('400');
  await dialog.getByRole('button', { name: 'Applica' }).click();
  await addShape(page, 'Cubo');
  // Il cursore della larghezza arriva al lato maggiore del piano (400)
  const range = page.locator('.slider-field', { hasText: 'Larghezza' }).locator('input[type=range]');
  expect(Number(await range.getAttribute('max'))).toBe(400);
});

test('Menu contestuale sul vuoto: propone le forme e la crea nel punto cliccato', async ({ page }) => {
  await addShape(page, 'Cubo');
  const menu = page.getByRole('menu', { name: 'Aggiungi una forma' });
  const where = [-80, 70] as const;
  const empty = await project(page, [where[0], where[1], 0]);
  await page.mouse.click(empty.x, empty.y, { button: 'right' });
  await expect(menu).toBeVisible();
  // Il menu elenca le categorie di forme (sottomenu), non i comandi della selezione
  await expect(menu.getByRole('menuitem', { name: 'Duplica', exact: true })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Forme 2D', exact: true }).hover();
  for (const name of ['Cerchio', 'Cuore']) await expect(menu.getByRole('menu', { name: 'Forme 2D' }).getByRole('menuitem', { name, exact: true })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Forme 3D', exact: true }).hover();
  for (const name of ['Cubo', 'Cilindro', 'Sfera']) await expect(menu.getByRole('menu', { name: 'Forme 3D' }).getByRole('menuitem', { name, exact: true })).toBeVisible();

  await menu.getByRole('menu', { name: 'Forme 3D' }).getByRole('menuitem', { name: 'Sfera', exact: true }).click();
  await settled(page);
  await expect(menu).toBeHidden();
  const scene = await sceneState(page);
  expect(scene.rootIds).toHaveLength(2);
  const sphere = scene.nodes[scene.rootIds[0]];
  expect(sphere.kind).toBe('sphere');
  // La sfera nasce dove si è cliccato (sul piano), appoggiata sul piatto
  // (qualche decimo di mm di scarto: il puntatore è in pixel interi)
  expect(Math.abs(sphere.position[0] - where[0])).toBeLessThan(3);
  expect(Math.abs(sphere.position[1] - where[1])).toBeLessThan(3);
  expect(sphere.position[2]).toBeCloseTo(sphere.radius, 3);
});

test('Menu contestuale: niente raccordi sulla sfera, Appoggia sul piatto solo se l\'oggetto è sollevato', async ({ page }) => {
  await addShape(page, 'Sfera');
  const menu = page.getByRole('menu', { name: 'Comandi per la selezione' });
  const at = await project(page, [0, 0, 10]);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(menu).toBeVisible();
  for (const name of ['Raccordo', 'Smusso', 'Smusso angolare', 'Raggruppa', 'Separa', 'Appoggia sul piatto']) await expect(menu.getByRole('menuitem', { name, exact: true })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Duplica', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // Sollevata dal piatto, la sfera propone di appoggiarlo
  const id = (await sceneState(page)).rootIds[0];
  await page.evaluate((nodeId) => window.__construct!.store.getState().updateNode(nodeId, { position: [0, 0, 40] } as never), id);
  await settled(page);
  const high = await project(page, [0, 0, 40]);
  await page.mouse.click(high.x, high.y, { button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Appoggia sul piatto', exact: true })).toBeVisible();
});

test('Quote: il lucchetto fa scalare tutti gli assi insieme', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  // Un lucchetto accanto a ognuna delle tre quote, tutti sullo stesso interruttore
  await expect(page.locator('.dimension-lock')).toHaveCount(3);
  const lock = page.locator('.dimension-lock').first();
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  // Libero: cambia solo X
  await page.locator('.dimension-label[data-axis="x"]').click();
  await page.locator('.dimension-input[data-axis="x"]').fill('30');
  await page.locator('.dimension-input[data-axis="x"]').press('Enter');
  await settled(page);
  expect((await sceneState(page)).nodes[id].size).toEqual([30, 20, 20]);

  // Bloccato: X a 60 raddoppia anche Y e Z (da 30 × 20 × 20 a 60 × 40 × 40)
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  expect((await sceneState(page)).nodes[id].lockRatio).toBe(true);
  for (const l of await page.locator('.dimension-lock').all()) await expect(l).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.dimension-label[data-axis="x"]').click();
  await page.locator('.dimension-input[data-axis="x"]').fill('60');
  await page.locator('.dimension-input[data-axis="x"]').press('Enter');
  await settled(page);
  expect((await sceneState(page)).nodes[id].size).toEqual([60, 40, 40]);
});

test('Benvenuto: al primo avvio propone da dove cominciare, la quarta scelta apre i modelli di esempio', async ({ browser }) => {
  // Contesto nuovo (localStorage separato): la pagina di beforeEach ha già segnato il benvenuto come visto
  const page = await (await browser.newContext()).newPage();
  await openApp(page, { welcome: true });
  const dialog = page.getByRole('dialog', { name: 'Benvenuto in Construct' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Nuovo progetto/ })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: /Parti da un cubo/ })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: /Importa/ })).toBeEnabled();
  await dialog.getByRole('button', { name: /Modelli di esempio/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Modelli di esempio' })).toBeVisible();
  await page.keyboard.press('Escape');
  await openMenuItem(page, 'Schermata di benvenuto');
  await expect(dialog).toBeVisible();

  // "Parti da un cubo" crea la scena con un cubo e chiude la finestra
  await dialog.getByRole('button', { name: /Parti da un cubo/ }).click();
  await settled(page);
  await expect(dialog).toBeHidden();
  const scene = await sceneState(page);
  expect(scene.rootIds).toHaveLength(1);
  expect(scene.nodes[scene.rootIds[0]].kind).toBe('box');

  // "Mostra ogni volta" è spuntata di default: dopo il ricaricamento la schermata ricompare
  await page.reload();
  await page.waitForFunction(() => !!window.__construct && !!window.__r3f);
  await expect(dialog).toBeVisible();
});

test('Benvenuto: Esc lo chiude senza toccare la scena e, tolta la spunta a "Mostra ogni volta", non ricompare', async ({ browser }) => {
  // Contesto nuovo (localStorage separato): la pagina di beforeEach ha già segnato il benvenuto come visto
  const page = await (await browser.newContext()).newPage();
  await openApp(page, { welcome: true });
  const dialog = page.getByRole('dialog', { name: 'Benvenuto in Construct' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect((await sceneState(page)).rootIds).toHaveLength(0);
  // Spuntata di default: ricompare al ricaricamento
  await page.reload();
  await page.waitForFunction(() => !!window.__construct && !!window.__r3f);
  await expect(dialog).toBeVisible();
  // Tolta la spunta non ricompare più
  const always = dialog.getByRole('checkbox', { name: 'Mostra ogni volta' });
  await expect(always).toBeChecked();
  await always.uncheck();
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(() => !!window.__construct && !!window.__r3f);
  await expect(page.getByRole('dialog', { name: 'Benvenuto in Construct' })).toHaveCount(0);
});

test('Benvenuto: i link Documentazione e About chiudono la schermata e aprono la relativa modale', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await openApp(page, { welcome: true });
  const dialog = page.getByRole('dialog', { name: 'Benvenuto in Construct' });
  await dialog.getByRole('button', { name: 'Documentazione' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Documentazione' })).toBeVisible();
  await page.keyboard.press('Escape');

  await openMenuItem(page, 'Schermata di benvenuto');
  await dialog.getByRole('button', { name: 'About' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'About' })).toBeVisible();
});

test('Migrazione: le preferenze salvate con il vecchio nome (webcad:ui) passano a construct:ui e il benvenuto non compare', async ({ browser }) => {
  // Contesto nuovo (localStorage separato): la pagina di beforeEach ha già segnato il benvenuto come visto
  const page = await (await browser.newContext()).newPage();
  await openApp(page, { welcome: true });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('webcad:ui', JSON.stringify({ state: { theme: 'dark', bedMode: 'full', bedSize: { width: 300, depth: 200 }, welcomeAlways: false }, version: 0 }));
  });
  await page.reload();
  await page.waitForFunction(() => !!window.__construct && !!window.__r3f);
  await expect(page.getByRole('dialog', { name: 'Benvenuto in Construct' })).toHaveCount(0);
  await expect(page.locator('.status-bar__bed')).toHaveText('Piano 300 × 200 mm');
  expect(await page.evaluate(() => localStorage.getItem('construct:ui'))).toContain('"width":300');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
});

test('Preferenze salvate: il tema chiaro resta chiaro e il vecchio piano "solo griglia" diventa il piano visibile', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await openApp(page, { welcome: true });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('construct:ui', JSON.stringify({ state: { theme: 'light', bedMode: 'grid', welcomeAlways: false }, version: 0 }));
  });
  await page.reload();
  await page.waitForFunction(() => !!window.__construct && !!window.__r3f);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  expect(await page.evaluate(() => window.__construct && document.querySelector('meta[name="theme-color"]')?.getAttribute('content'))).toBe('#e9eff6');
  const plate = await page.evaluate(() => {
    const bed = window.__r3f!.scene.getObjectByName('bed-plate') as unknown as { visible: boolean; parent: { visible: boolean } };
    return bed.visible && bed.parent.visible;
  });
  expect(plate).toBe(true);
  // Con il piano visibile il pulsante non è acceso (si accende quando il piano è nascosto)
  await expect(page.getByRole('button', { name: 'Piatto', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('Piatti: la scheda elenca i piatti, ognuno ha i suoi oggetti e se ne vede uno alla volta', async ({ page }) => {
  await addShape(page, 'Cubo');
  const tab = page.getByRole('tab', { name: /Piatti/ });
  await tab.click();
  const cards = page.locator('.plates__card');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Piatto 1');
  await expect(cards.first()).toContainText('1 oggetto');

  // Un secondo piatto, subito attivo e vuoto: gli oggetti del primo non si vedono
  await page.getByRole('button', { name: 'Aggiungi piatto' }).click();
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(1)).toHaveClass(/plates__card--active/);
  await expect(cards.nth(1)).toContainText('vuoto');
  expect((await sceneState(page)).rootIds).toHaveLength(0);
  await page.getByRole('tab', { name: 'Oggetti' }).click();
  await expect(page.locator('.outliner__row')).toHaveCount(0);
  await expect(page.locator('.outliner__plate')).toHaveText('Piatto 2');

  // Il coperchio sta sul piatto 2
  await addShape(page, 'Cilindro');
  await tab.click();
  await expect(cards.nth(1)).toContainText('Cilindro');
  await expect(cards.nth(0)).toContainText('Cubo');

  // Tornando al piatto 1 si vede solo la scatola; la vista ricalcola solo il suo contenuto
  await page.getByRole('button', { name: 'Attiva Piatto 1' }).click();
  await settled(page);
  const scene = await sceneState(page);
  expect(scene.rootIds).toHaveLength(1);
  expect(scene.nodes[scene.rootIds[0]].name).toBe('Cubo');
  const meshes = await page.evaluate(() => window.__construct!.results.getState().meshes.map((m) => m.rootId));
  expect(meshes).toEqual([scene.rootIds[0]]);
});

test('Piatti: rinominare, spostare la selezione in un altro piatto, eliminare con conferma, e annullare', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Sfera');
  await page.getByRole('tab', { name: /Piatti/ }).click();
  await page.getByRole('button', { name: 'Aggiungi piatto' }).click();
  // Rinomina con la matita
  await page.getByRole('button', { name: 'Rinomina Piatto 2' }).click();
  const name = page.getByRole('textbox', { name: /Nome del piatto/ });
  await name.fill('Coperchio');
  await name.press('Enter');
  await expect(page.locator('.plates__card').nth(1)).toContainText('Coperchio');

  // Si torna al piatto 1, si seleziona la sfera e la si sposta nel coperchio
  await page.getByRole('button', { name: 'Attiva Piatto 1' }).click();
  await page.getByRole('tab', { name: 'Oggetti' }).click();
  await page.locator('.outliner__row', { hasText: 'Sfera' }).click();
  await page.getByRole('tab', { name: /Piatti/ }).click();
  await page.getByRole('button', { name: 'Sposta qui la selezione in Coperchio' }).click();
  await settled(page);
  let scene = await sceneState(page);
  expect(scene.rootIds.map((id: string) => scene.nodes[id].name)).toEqual(['Cubo']);
  expect(scene.plates.find((p: { name: string }) => p.name === 'Coperchio').rootIds).toHaveLength(1);
  // Un solo passo di Annulla riporta la sfera
  await page.keyboard.press('Control+z');
  await settled(page);
  scene = await sceneState(page);
  expect(scene.rootIds).toHaveLength(2);
  await page.keyboard.press('Control+y');
  await settled(page);

  // Eliminare un piatto con oggetti chiede conferma e toglie gli oggetti
  await page.getByRole('button', { name: 'Elimina Coperchio' }).click();
  await page.locator('.dialog__button--primary', { hasText: 'Elimina' }).click();
  await expect(page.locator('.plates__card')).toHaveCount(1);
  scene = await sceneState(page);
  expect(Object.values(scene.nodes).map((n) => (n as { name: string }).name)).toEqual(['Cubo']);
  // L'ultimo piatto non si elimina
  await expect(page.getByRole('button', { name: 'Elimina Piatto 1' })).toBeDisabled();
});

test('Piatti: il menu contestuale sposta nel piatto e i piatti sopravvivono al ricaricamento', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.getByRole('tab', { name: /Piatti/ }).click();
  await page.getByRole('button', { name: 'Aggiungi piatto' }).click();
  await page.getByRole('button', { name: 'Attiva Piatto 1' }).click();
  await page.getByRole('tab', { name: 'Oggetti' }).click();
  await page.locator('.outliner__row', { hasText: 'Cubo' }).click();
  const at = await project(page, [0, 0, 10]);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Comandi per la selezione' });
  await menu.getByRole('menuitem', { name: 'Sposta nel piatto', exact: true }).hover();
  await menu.getByRole('menu', { name: 'Sposta nel piatto' }).getByRole('menuitem', { name: 'Piatto 2' }).click();
  await settled(page);
  expect((await sceneState(page)).rootIds).toHaveLength(0);

  // Il salvataggio automatico conserva i piatti
  await sceneSaved(page);
  await page.reload();
  await page.waitForFunction(() => !!window.__construct && !!window.__r3f);
  const scene = await sceneState(page);
  expect(scene.plates).toHaveLength(2);
  expect(scene.plates.map((p: { rootIds: string[] }) => p.rootIds.length).sort()).toEqual([0, 1]);
});

test('Esporta: il 3MF contiene tutti i piatti affiancati e l\'STL chiede quale piatto esportare', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.getByRole('tab', { name: /Piatti/ }).click();
  await page.getByRole('button', { name: 'Aggiungi piatto' }).click();
  await addShape(page, 'Cilindro');
  const { readFileSync, statSync } = await import('node:fs');
  const { unzipSync, strFromU8 } = await import('fflate');

  // 3MF: tutti i piatti, il secondo spostato di larghezza del piano + 20 mm (256 + 20)
  let download = page.waitForEvent('download');
  await openMenuItem(page, 'Esporta');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '3MF' }).click();
  let file = await download;
  expect(file.suggestedFilename()).toBe('construct.3mf');
  const xml = strFromU8(unzipSync(new Uint8Array(readFileSync(await file.path())))['3D/3dmodel.model']);
  expect((xml.match(/<item /g) ?? []).length).toBe(2);
  expect(xml).toContain('Piatto 1 – Cubo');
  expect(xml).toContain('Piatto 2 – Cilindro');
  expect(xml).toContain('transform="1 0 0 0 1 0 0 0 1 276 0 0"');

  // STL: con più piatti si sceglie quale; il cubo ha 12 triangoli
  await openMenuItem(page, 'Esporta');
  await dialog.getByRole('button', { name: 'STL' }).click();
  await expect(dialog.getByText('Quale vuoi esportare?')).toBeVisible();
  download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Piatto 1' }).click();
  file = await download;
  expect(file.suggestedFilename()).toBe('construct-piatto-1.stl');
  expect(statSync(await file.path()).size).toBe(84 + 50 * 12);
});

test('Esporta: con un piatto solo l\'STL parte subito, senza chiedere il piatto', async ({ page }) => {
  await addShape(page, 'Cubo');
  const download = page.waitForEvent('download');
  await openMenuItem(page, 'Esporta');
  await page.getByRole('dialog').getByRole('button', { name: 'STL' }).click();
  expect((await download).suggestedFilename()).toBe('construct.stl');
});

test('Menu contestuale sul vuoto: sottomenu a destra con forme, simboli ed emoji, e voci di servizio', async ({ page }) => {
  await addShape(page, 'Cubo');
  const menu = page.getByRole('menu', { name: 'Aggiungi una forma' });
  const spot = await project(page, [-90, 80, 0]);
  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await expect(menu).toBeVisible();
  // Voci principali: quattro sottomenu e quattro voci di servizio
  for (const name of ['Forme 3D', 'Forme 2D', 'Simboli', 'Emoji']) await expect(menu.getByRole('menuitem', { name, exact: true })).toHaveAttribute('aria-haspopup', 'menu');
  for (const name of ['Importa…', 'Esporta…', 'Dimensioni del piano…', 'Schermata di benvenuto']) await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();

  // Il sottomenu delle forme 3D si apre sulla destra della voce
  const entry = menu.getByRole('menuitem', { name: 'Forme 3D', exact: true });
  await entry.hover();
  const flyout = menu.getByRole('menu', { name: 'Forme 3D' });
  await expect(flyout).toBeVisible();
  const [a, b] = await Promise.all([entry.boundingBox(), flyout.boundingBox()]);
  expect(b!.x).toBeGreaterThanOrEqual(a!.x + a!.width - 1);
  await expect(flyout.getByRole('menuitem', { name: 'Cubo', exact: true })).toBeVisible();

  // Un simbolo si crea nel punto cliccato
  await menu.getByRole('menuitem', { name: 'Simboli', exact: true }).hover();
  const symbols = menu.getByRole('menu', { name: 'Simboli' });
  await expect(symbols).toBeVisible();
  await symbols.getByRole('menuitem', { name: 'Stella piena' }).first().click();
  await settled(page);
  let scene = await sceneState(page);
  const symbol = scene.nodes[scene.rootIds[0]];
  expect(symbol.origin).toBe('symbol');
  expect(Math.abs(symbol.position[0] + 90)).toBeLessThan(3);
  expect(Math.abs(symbol.position[1] - 80)).toBeLessThan(3);

  // Un'emoji, dallo stesso menu
  const spot2 = await project(page, [90, 80, 0]);
  await page.mouse.click(spot2.x, spot2.y, { button: 'right' });
  await menu.getByRole('menuitem', { name: 'Emoji', exact: true }).hover();
  await menu.getByRole('menu', { name: 'Emoji' }).getByRole('menuitem').first().click();
  await settled(page);
  scene = await sceneState(page);
  expect(scene.nodes[scene.rootIds[0]].origin).toBe('emoji');
});

test('Menu contestuale sul vuoto: le voci di servizio aprono Esporta, Dimensioni del piano e il benvenuto', async ({ page }) => {
  await addShape(page, 'Cubo');
  const menu = page.getByRole('menu', { name: 'Aggiungi una forma' });
  const spot = await project(page, [-90, 80, 0]);
  const open = async () => {
    await page.mouse.click(spot.x, spot.y, { button: 'right' });
    await expect(menu).toBeVisible();
  };
  await open();
  await menu.getByRole('menuitem', { name: 'Esporta…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Esporta' })).toBeVisible();
  await page.keyboard.press('Escape');
  await open();
  await menu.getByRole('menuitem', { name: 'Dimensioni del piano…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Dimensioni del piano' })).toBeVisible();
  await page.keyboard.press('Escape');
  await open();
  await menu.getByRole('menuitem', { name: 'Schermata di benvenuto', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Benvenuto in Construct' })).toBeVisible();
});

test('Menu hamburger: la voce Schermata di benvenuto riapre il benvenuto, e le scorciatoie hanno la modale grande', async ({ page }) => {
  await openMenuItem(page, 'Schermata di benvenuto');
  await expect(page.getByRole('dialog', { name: 'Benvenuto in Construct' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Benvenuto in Construct' })).toBeHidden();

  await openMenuItem(page, 'Scorciatoie da tastiera');
  const dialog = page.getByRole('dialog', { name: 'Scorciatoie da tastiera' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  // Grande come la modale del codice: 80% della finestra in larghezza e in altezza
  expect(box!.width).toBeGreaterThan(viewport.width * 0.78);
  expect(box!.height).toBeGreaterThan(viewport.height * 0.78);
  // E l'elenco scorre: l'ultima scorciatoia si raggiunge
  await dialog.getByText('Durante il trascinamento nella vista 3D: disattiva lo snap').scrollIntoViewIfNeeded();
  await expect(dialog.getByText('Durante il trascinamento nella vista 3D: disattiva lo snap')).toBeVisible();
});

test('Il nome dell\'app è in maiuscolo con Orbitron e il font è tra quelli del Testo', async ({ page }) => {
  const brand = page.locator('.brand__name');
  expect(await brand.evaluate((el) => getComputedStyle(el).textTransform)).toBe('uppercase');
  expect(await brand.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Orbitron');
  // Il file del font è stato caricato (@font-face)
  await page.waitForFunction(() => document.fonts.check('700 14px Orbitron'));
  await addShape(page, 'Testo');
  const fonts = await page.evaluate(() => window.__construct!.store.getState().scene.rootIds.length);
  expect(fonts).toBe(1);
  await expect(page.getByRole('option', { name: 'Orbitron Bold' })).toHaveCount(1);
});

test('Il marchio sta in cima alla barra laterale, centrato, con una tinta per lettera; la barra strumenti parte alla sua destra', async ({ page }) => {
  const box = async (selector: string) => (await page.locator(selector).boundingBox())!;
  const side = await box('aside.app__left');
  const toolbar = await box('header.toolbar');
  const mark = await box('.brand__mark');
  const name = await box('.brand__name');

  // La barra laterale sale fino in cima e il marchio è dentro, come prima cosa
  expect(side.y).toBe(0);
  await expect(page.locator('aside.app__left > :first-child')).toHaveClass(/brand/);
  await expect(page.locator('header.toolbar .brand')).toHaveCount(0);
  // La barra strumenti parte subito a destra della barra laterale, in cima
  expect(toolbar.y).toBe(0);
  expect(Math.abs(toolbar.x - (side.x + side.width))).toBeLessThanOrEqual(1);
  // Icona e scritta insieme sono centrate rispetto alla barra laterale
  const center = (mark.x + name.x + name.width) / 2;
  expect(Math.abs(center - (side.x + side.width / 2))).toBeLessThanOrEqual(4);
  // I bordi inferiori di marchio e barra strumenti sono alla stessa altezza
  expect(Math.abs(mark.y + mark.height / 2 - toolbar.height / 2)).toBeLessThanOrEqual(1);

  // Nove lettere con le cinque tinte delle sezioni, a rotazione
  const colors = await page.locator('.brand__letter').evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
  expect(colors).toHaveLength(9);
  expect(new Set(colors).size).toBe(5);
  for (let i = 5; i < colors.length; i++) expect(colors[i]).toBe(colors[i - 5]);
  // Le tinte sono quelle dei pulsanti delle sezioni (Trasforma = prima lettera)
  const transformButton = await page.locator('.toolbar__section--transform .toolbar__button').first().evaluate((el) => getComputedStyle(el).color);
  expect(colors[0]).toBe(transformButton);
});

test('Timeline: indicatori con tooltip del tipo di operazione e icona per svuotare la cronologia', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Sfera');
  const steps = page.locator('.timeline__step');
  await expect(steps).toHaveCount(3);
  // Solo indicatori grafici, senza testo
  expect(await steps.nth(1).innerText()).toBe('');
  await steps.nth(1).hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toContainText('2 · Aggiungi Cubo');
  await steps.nth(2).hover();
  await expect(tip).toContainText('3 · Aggiungi Sfera (stato corrente)');

  // Svuotare la cronologia chiede conferma, lascia la scena e riparte da un solo passo
  await page.getByRole('button', { name: 'Svuota la cronologia' }).click();
  await page.getByRole('button', { name: 'Svuota', exact: true }).click();
  await expect(steps).toHaveCount(1);
  expect((await sceneState(page)).rootIds).toHaveLength(2);
  await expect(page.getByRole('button', { name: 'Svuota la cronologia' })).toBeDisabled();
});

test('Timeline: il tooltip mostra la miniatura isometrica del passo, e la ricalcola se manca', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Sfera');
  const steps = page.locator('.timeline__step');
  const tip = page.getByRole('tooltip');
  const thumb = tip.locator('.tooltip__thumb');

  // Il passo con il solo cubo ha una miniatura (immagine), quello iniziale è vuoto
  await steps.nth(1).hover();
  await expect(thumb.locator('img')).toHaveAttribute('src', /^data:image\//);
  await steps.nth(0).hover();
  await expect(thumb).toContainText('Scena vuota');
  await expect(thumb.locator('img')).toHaveCount(0);

  // Dimenticate tutte le miniature, quella di un passo passato si ricalcola al passaggio del mouse nel worker
  // senza toccare la scena in vista
  await page.evaluate(() => window.__construct!.thumbnails.reset());
  const before = await page.evaluate(() => window.__construct!.results.getState().meshes.map((m) => m.volume));
  await page.mouse.move(0, 0);
  await steps.nth(1).hover();
  await expect(thumb.locator('img')).toHaveAttribute('src', /^data:image\//);
  await settled(page);
  expect(await page.evaluate(() => window.__construct!.results.getState().meshes.map((m) => m.volume))).toEqual(before);
  expect((await sceneState(page)).rootIds).toHaveLength(2);
});

test('Novità: modale grande come il codice, elenco che scorre e nessuna data accanto alle versioni', async ({ page }) => {
  await openMenuItem(page, 'Novità');
  const dialog = page.getByRole('dialog', { name: 'Novità' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.width).toBeGreaterThan(viewport.width * 0.78);
  expect(box!.height).toBeGreaterThan(viewport.height * 0.78);
  // Le versioni non portano la data (prima c'era scritto 2026-10-08)
  await expect(dialog.locator('.app-menu__news h3').first()).toBeVisible();
  const titles = await dialog.locator('.app-menu__news h3').allTextContents();
  expect(titles.length).toBeGreaterThan(5);
  for (const title of titles) expect(title).toMatch(/^v\d+\.\d+\.\d+$/);
  // L'ultima versione, in fondo, si raggiunge scorrendo
  await dialog.locator('.app-menu__news h3').last().scrollIntoViewIfNeeded();
  await expect(dialog.locator('.app-menu__news h3').last()).toBeVisible();
});

test('About: link al repository GitHub e informazioni sull\'autore con il suo sito', async ({ page }) => {
  await openMenuItem(page, 'About');
  const dialog = page.getByRole('dialog', { name: 'About' });
  const repo = dialog.getByRole('link', { name: 'github.com/miziomon/construct' });
  await expect(repo).toHaveAttribute('href', 'https://github.com/miziomon/construct');
  await expect(repo).toHaveAttribute('target', '_blank');
  await expect(repo).toHaveAttribute('rel', /noopener/);
  await expect(dialog.getByText('Maurizio Pelizzone')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'maurizio.mavida.com' })).toHaveAttribute('href', 'https://maurizio.mavida.com');
});

test('About: ha le sezioni descrittive e i link a Documentazione e Novità', async ({ page }) => {
  await openMenuItem(page, 'About');
  const dialog = page.getByRole('dialog', { name: 'About' });
  // Modale larga il 60% della finestra
  const box = await dialog.boundingBox();
  expect(Math.abs(box!.width - page.viewportSize()!.width * 0.6)).toBeLessThan(4);
  await expect(dialog.getByTestId('about-version')).toHaveText(/^v\d+\.\d+\.\d+/);
  for (const title of ['Cosa puoi fare', 'I tuoi dati', 'Tecnologie', 'Il progetto', "L'autore"]) await expect(dialog.getByRole('heading', { name: title })).toBeVisible();
  await expect(dialog.getByText('manifold-3d').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Novità' }).click();
  await expect(page.getByRole('dialog', { name: 'Novità' })).toBeVisible();
  await page.keyboard.press('Escape');
  await openMenuItem(page, 'About');
  await page.getByRole('dialog', { name: 'About' }).getByRole('button', { name: 'Documentazione' }).click();
  await expect(page.getByRole('dialog', { name: 'Documentazione' })).toBeVisible();
});

test('Documentazione: modale grande come il codice, con indice a ancore e FAQ', async ({ page }) => {
  await openMenuItem(page, 'Documentazione');
  const dialog = page.getByRole('dialog', { name: 'Documentazione' });
  await expect(dialog).toBeVisible();
  const viewport = page.viewportSize()!;
  const box = await dialog.boundingBox();
  expect(box!.width).toBeGreaterThan(viewport.width * 0.78);
  expect(box!.height).toBeGreaterThan(viewport.height * 0.78);

  // L'indice scorre dentro il pannello e non cambia l'URL
  const url = page.url();
  const index = dialog.getByRole('navigation', { name: 'Indice della documentazione' });
  await index.getByRole('link', { name: 'Codice OpenSCAD' }).click();
  await expect(dialog.getByRole('heading', { name: 'Codice OpenSCAD', level: 3 })).toBeInViewport();
  expect(page.url()).toBe(url);

  // Sezione OpenSCAD: comandi supportati (Minkowski compreso) e non supportati
  await index.getByRole('link', { name: 'OpenSCAD', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'OpenSCAD', level: 3, exact: true })).toBeInViewport();
  await expect(dialog.getByText('rotate_extrude').first()).toBeVisible();
  await expect(dialog.getByText('minkowski', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('polyhedron').first()).toBeVisible();

  // Sezione Font: ogni font rimanda alla sua pagina su Google Fonts
  await index.getByRole('link', { name: 'Font', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Font', level: 3, exact: true })).toBeInViewport();
  await expect(dialog.getByRole('link', { name: 'Playfair Display', exact: true }).first()).toHaveAttribute('href', 'https://fonts.google.com/specimen/Playfair+Display');

  // I testi dei comandi sono quelli dei tooltip
  await index.getByRole('link', { name: 'Modificare' }).click();
  await expect(dialog.getByRole('heading', { name: 'Raccordo' })).toBeVisible();

  // Sidebar a sinistra del contenuto e voce attiva evidenziata durante lo scorrimento
  const indexBox = await index.boundingBox();
  const contentBox = await dialog.locator('.docs__content').boundingBox();
  expect(indexBox!.x + indexBox!.width).toBeLessThanOrEqual(contentBox!.x + 1);
  await expect(index.getByRole('link', { name: 'Modificare' })).toHaveAttribute('aria-current', 'true');

  // Sezione introduttiva: prima di Primi passi, anche nell'indice
  await index.getByRole('link', { name: "Cos'è Construct" }).click();
  await expect(dialog.getByRole('heading', { name: "Cos'è Construct", level: 3 })).toBeInViewport();
  await expect(index.getByRole('link', { name: "Cos'è Construct" })).toHaveAttribute('aria-current', 'true');
  await expect(dialog.getByRole('heading', { name: 'Per chi è' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Cosa non è' })).toBeVisible();
  await expect(dialog.locator('#docs-cose').getByRole('link', { name: 'github.com/miziomon/construct' })).toHaveAttribute('href', 'https://github.com/miziomon/construct');

  // FAQ: risposte a scomparsa
  await index.getByRole('link', { name: 'Domande frequenti' }).click();
  const faq = dialog.locator('details', { hasText: 'Funziona offline?' });
  await expect(faq).toBeVisible();
  await faq.locator('summary').click();
  await expect(faq).toContainText('PWA');

  // Il rimando alle scorciatoie apre il loro pannello
  await dialog.getByRole('button', { name: 'Apri le scorciatoie da tastiera' }).click();
  await expect(page.getByRole('dialog', { name: 'Scorciatoie da tastiera' })).toBeVisible();
});

test('Impostazioni: la voce del menu apre la modale con le sezioni e le opzioni cambiano subito il comportamento', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  await openMenuItem(page, 'Impostazioni');
  const dialog = page.getByRole('dialog', { name: 'Impostazioni' });
  await expect(dialog).toBeVisible();
  for (const section of ['Aspetto', 'Piano di stampa', 'Vista e modifica', 'Passi e aggancio', 'Stampabilità', 'Funzioni sperimentali', 'Salvataggio e dati']) await expect(dialog.getByRole('heading', { name: section })).toBeVisible();

  // Tema (il predefinito è lo scuro)
  await dialog.getByRole('button', { name: 'Chiaro' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  // Visualizzazione del piano: solo visibile o nascosto
  await expect(dialog.getByLabel('Visualizzazione').locator('option')).toHaveCount(2);
  await dialog.getByLabel('Visualizzazione').selectOption('none');
  expect(await page.evaluate(() => window.__construct!.store.getState().scene.rootIds.length)).toBe(1);
  // Quote: spente, spariscono dalla vista
  await expect(page.locator('.dimension-label').first()).toBeVisible();
  await dialog.getByLabel("Quote sull'oggetto selezionato").uncheck();
  await expect(page.locator('.dimension-label')).toHaveCount(0);
  // Passo delle frecce: 5 mm
  const nudge = dialog.locator('.number-field', { hasText: 'Frecce' }).locator('input');
  await nudge.fill('5');
  await nudge.press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowRight');
  await settled(page);
  expect((await sceneState(page)).nodes[id].position[0]).toBe(5);

  // Le impostazioni restano dopo il ricaricamento
  await page.reload();
  await page.waitForFunction(() => !!window.__construct && !!window.__r3f);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  const saved = JSON.parse((await page.evaluate(() => localStorage.getItem('construct:ui'))) ?? '{}').state;
  expect(saved).toMatchObject({ showDimensions: false, nudgeStep: 5, bedMode: 'none', theme: 'light' });
});

test('Impostazioni: modale grande come la Documentazione, con le schede su più colonne', async ({ page }) => {
  // Finestra larga: due schede almeno affiancate (stessa y, x diverse)
  await page.setViewportSize({ width: 1500, height: 900 });
  await openMenuItem(page, 'Impostazioni');
  const dialog = page.getByRole('dialog', { name: 'Impostazioni' });
  await expect(dialog).toBeVisible();
  const viewport = page.viewportSize()!;
  const box = await dialog.boundingBox();
  expect(box!.width).toBeGreaterThan(viewport.width * 0.78);
  expect(box!.height).toBeGreaterThan(viewport.height * 0.78);
  const card = (name: string) => dialog.getByRole('heading', { name }).locator('xpath=..').boundingBox();
  const a = await card('Aspetto');
  const b = await card('Piano di stampa');
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  expect(b!.x).toBeGreaterThan(a!.x + 100);

  // Finestra molto alta: le righe restano ravvicinate (solo il gap, nessun vuoto) e la scheda dei dati le segue
  await page.setViewportSize({ width: 1500, height: 1600 });
  const row1Bottom = Math.max(...(await Promise.all(['Aspetto', 'Piano di stampa', 'Vista e modifica'].map(card))).map((c) => c!.y + c!.height));
  const row2Top = (await card('Passi e aggancio'))!.y;
  expect(row2Top - row1Bottom).toBeLessThan(30);
});

test('Impostazioni: il ripristino riporta le opzioni ai valori predefiniti senza toccare la scena', async ({ page }) => {
  await addShape(page, 'Cubo');
  await openMenuItem(page, 'Impostazioni');
  const dialog = page.getByRole('dialog', { name: 'Impostazioni' });
  await dialog.getByRole('button', { name: 'Chiaro' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  await dialog.getByLabel("Quote sull'oggetto selezionato").uncheck();
  await dialog.getByRole('button', { name: 'Ripristina le impostazioni' }).click();
  await page.locator('.dialog__button--primary', { hasText: 'Ripristina' }).click();
  await expect(dialog.getByLabel("Quote sull'oggetto selezionato")).toBeChecked();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  expect((await sceneState(page)).rootIds).toHaveLength(1);
});

test('Impostazioni: Pulisci tutti i dati chiede conferma, cancella localStorage e IndexedDB e riparte dal benvenuto', async ({ browser }) => {
  // Contesto nuovo: la pagina di beforeEach ha già segnato il benvenuto come visto
  const page = await (await browser.newContext()).newPage();
  await openApp(page, { welcome: true });
  await page.keyboard.press('Escape');
  await addShape(page, 'Cubo');
  await sceneSaved(page);
  // Qualcosa da cancellare: la scena salvata e le preferenze
  expect(await page.evaluate(() => localStorage.getItem('construct:welcomed'))).toBe('1');
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBeGreaterThan(0);

  await openMenuItem(page, 'Impostazioni');
  const dialog = page.getByRole('dialog', { name: 'Impostazioni' });
  await dialog.getByRole('button', { name: 'Pulisci tutti i dati…' }).click();
  // Rifiutando non succede nulla
  await page.locator('.dialog__button', { hasText: 'Annulla' }).click();
  expect((await sceneState(page)).rootIds).toHaveLength(1);

  await dialog.getByRole('button', { name: 'Pulisci tutti i dati…' }).click();
  await page.locator('.dialog__button--primary', { hasText: 'Cancella tutto' }).click();
  // La pagina si ricarica da sola e riparte come al primo avvio
  await page.waitForFunction(() => !!window.__construct && !!window.__r3f);
  await expect(page.getByRole('dialog', { name: 'Benvenuto in Construct' })).toBeVisible();
  expect((await sceneState(page)).rootIds).toHaveLength(0);
  // Il benvenuto è di nuovo da vedere e le vecchie chiavi non ci sono più
  expect(await page.evaluate(() => localStorage.getItem('construct:welcomed'))).toBeNull();
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('webcad:')))).toEqual([]);
});

test('Importa OpenSCAD: un file .scad diventa oggetti veri, con un solo passo di Annulla e gli avvisi per ciò che salta', async ({ page }) => {
  await openMenuItem(page, 'Importa');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('dialog', { name: 'Importa' }).getByRole('button', { name: 'OpenSCAD', exact: true }).click();
  const file = await chooser;
  await file.setFiles({
    name: 'scatola.scad',
    mimeType: 'text/plain',
    buffer: Buffer.from(`
      $fn = 32;
      difference() {
        cube([40, 30, 20]);
        translate([5, 5, 3]) cube([30, 20, 20]);
      }
      translate([60, 0, 0]) cylinder(h = 10, r = 8);
      projection() cube(2);
    `),
  });
  // L'importazione è asincrona: prima si aspetta che gli oggetti ci siano, poi il kernel
  await expect.poll(async () => (await sceneState(page)).rootIds.length).toBe(2);
  await settled(page);
  const scene = await sceneState(page);
  expect(scene.rootIds).toHaveLength(2);
  const names = scene.rootIds.map((id: string) => scene.nodes[id].name);
  expect(names).toContain('Differenza');
  expect(names).toContain('Cilindro');
  // Un messaggio dice quanti oggetti; ciò che è stato saltato si legge in una modale, con la riga e il codice originale
  await expect(page.getByText(/scatola\.scad: importati 4 oggetti/)).toBeVisible();
  const report = page.getByRole('dialog', { name: 'Importazione di scatola.scad' });
  await expect(report.getByText(/projection\(\) non è supportato/)).toBeVisible();
  await expect(report.getByLabel(/Codice vicino alla riga 8/)).toContainText('projection() cube(2);');
  await page.keyboard.press('Escape');
  await expect(report).toBeHidden();
  // Il risultato è un solido valido
  const volume = await page.evaluate(() => window.__construct!.results.getState().meshes.reduce((v, m) => v + m.volume, 0));
  expect(volume).toBeGreaterThan(40 * 30 * 20 - 30 * 20 * 17 - 1);
  // Un passo di cronologia
  await page.keyboard.press('Control+z');
  await settled(page);
  expect((await sceneState(page)).rootIds).toHaveLength(0);
});

test('Importa OpenSCAD: rotate_extrude, offset, multmatrix e resize diventano forme vere e il solido è quello atteso', async ({ page }) => {
  await openApp(page);
  await openMenuItem(page, 'Importa');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('dialog', { name: 'Importa' }).getByRole('button', { name: 'OpenSCAD', exact: true }).click();
  const file = await chooser;
  await file.setFiles({
    name: 'toro.scad',
    mimeType: 'text/plain',
    buffer: Buffer.from(`
      $fn = 64;
      rotate_extrude() translate([5, 0, 0]) circle(1);
      translate([30, 0, 0]) multmatrix([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]) resize([10, 0, 0], auto = true) cube(5);
    `),
  });
  // L'importazione è asincrona: prima si aspetta che gli oggetti ci siano, poi il kernel
  await expect.poll(async () => (await sceneState(page)).rootIds.length).toBe(2);
  await settled(page);
  const scene = await sceneState(page);
  expect(scene.rootIds).toHaveLength(2);
  const torus = scene.nodes[scene.rootIds[0]];
  expect(torus).toMatchObject({ type: 'shape2d', kind: 'circle', extrusion: 'rotate', revolveRadius: 5, radius: 1 });
  // Toro: 2 π² · R · r² (con i lati dei poligoni un po' meno), e il cubo ridimensionato a 10 mm
  const volumes = await page.evaluate(() => window.__construct!.results.getState().meshes.map((m) => m.volume));
  expect(volumes.some((v) => Math.abs(v - 98.7) < 4)).toBe(true);
  expect(volumes.some((v) => Math.abs(v - 1000) < 1)).toBe(true);
});

test('OpenSCAD con più piatti: il codice li contiene tutti e, riletto, ricrea i piatti', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.getByRole('tab', { name: /Piatti/ }).click();
  await page.getByRole('button', { name: 'Aggiungi piatto' }).click();
  await page.getByRole('button', { name: 'Rinomina Piatto 2' }).click();
  const name = page.getByRole('textbox', { name: /Nome del piatto/ });
  await name.fill('Coperchio');
  await name.press('Enter');
  await addShape(page, 'Cilindro');

  const code = await readCode(page);
  expect(code).toContain('// === Piatto 1: Piatto 1 ===');
  expect(code).toContain('// === Piatto 2: Coperchio ===');
  expect(code).toContain('module piatto_1()');
  expect(code).toContain('translate([276, 0, 0]) piatto_2();');

  // Si riapre il codice esportato come file .scad in un progetto nuovo: i piatti tornano
  const { readFileSync } = await import('node:fs');
  const download = page.waitForEvent('download');
  await openMenuItem(page, 'Esporta');
  await page.getByRole('dialog').getByRole('button', { name: 'OpenSCAD' }).click();
  const path = await (await download).path();
  const exported = readFileSync(path, 'utf8');
  await page.reload();
  await page.waitForFunction(() => !!window.__construct && !!window.__r3f);
  await page.evaluate(() => window.__construct!.store.getState().clear());
  await openMenuItem(page, 'Importa');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('dialog', { name: 'Importa' }).getByRole('button', { name: 'OpenSCAD', exact: true }).click();
  await (await chooser).setFiles({ name: 'piatti.scad', mimeType: 'text/plain', buffer: Buffer.from(exported) });
  // L'importazione è asincrona: prima si aspetta che i piatti ci siano, poi il kernel
  await expect.poll(async () => (await sceneState(page)).plates?.length).toBe(2);
  await settled(page);
  const scene = await sceneState(page);
  expect(scene.plates.map((p: { name: string }) => p.name)).toEqual(['Piatto 1', 'Coperchio']);
});

test('Menu hamburger: la voce Impostazioni c\'è accanto alle altre e il menu del vuoto non cambia', async ({ page }) => {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const menu = page.getByRole('menu');
  for (const name of ['Importa', 'Esporta', 'Impostazioni', 'Schermata di benvenuto', 'Documentazione', 'Scorciatoie da tastiera', 'Novità', 'About']) await expect(menu.getByRole('menuitem', { name })).toBeVisible();
});

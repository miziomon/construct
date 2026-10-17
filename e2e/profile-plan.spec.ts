import { expect, test, type Locator, type Page } from '@playwright/test';
import { openApp, settled } from './helpers';

/** Bicchiere: parete di 2 mm (x da 28 a 30) e fondo di 3 mm, per la rotazione. */
const CUP = [
  {
    closed: true,
    nodes: [[0, 0], [30, 0], [30, 50], [28, 50], [28, 3], [0, 3]].map(([x, y]) => ({ p: [x, y], kind: 'corner' })),
  },
];

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

const editor = (page: Page) => page.locator('dialog.modal[open]');
const profileCanvas = (page: Page) => editor(page).locator('.profile-editor__canvas:not([data-closed-only])');
const planCanvas = (page: Page) => editor(page).locator('.profile-editor__canvas[data-closed-only]');
const planNodes = (page: Page) => planCanvas(page).locator('[data-node]');
const view = (page: Page, name: string) => editor(page).getByRole('group', { name: 'Disegni mostrati' }).getByRole('button', { name });

async function enable(page: Page, on = true) {
  await page.evaluate((v) => window.__construct!.ui.setState({ experimentalPlan: v }), on);
}

/** Crea un Profilo rotazionale (bicchiere), apre la modale e mostra il disegno indicato. */
async function openCup(page: Page, mode: 'Profilo' | 'Sagoma' | 'Entrambe' = 'Sagoma', extrusion: 'rotate' | 'linear' = 'rotate') {
  await enable(page);
  const id = await page.evaluate(([paths, ex]) => window.__construct!.store.getState().addPath({ paths: paths as never, extrusion: ex as 'rotate' | 'linear', height: 5 }), [CUP, extrusion] as const);
  await settled(page);
  await page.evaluate((nodeId) => window.__construct!.profileEditor.getState().open({ nodeId }), id);
  await expect(editor(page)).toBeVisible();
  await expect(profileCanvas(page).locator('[data-node]').first()).toBeVisible();
  if (mode !== 'Profilo') await view(page, mode).click();
  return id;
}

async function center(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await page.mouse.up();
}
const preset = (page: Page, name: string) => editor(page).getByRole('group', { name: 'Forme pronte' }).getByRole('button', { name, exact: true }).click();
const wallMax = async (page: Page) => Number(await editor(page).locator('.profile-editor__measure-wall').getAttribute('data-wall-max'));
const wallMin = async (page: Page) => Number(await editor(page).locator('.profile-editor__measure-wall').getAttribute('data-wall-min'));
const triangles = async (page: Page) => Number(await editor(page).getByLabel('Anteprima 3D').getAttribute('data-triangles'));

test('senza la funzione sperimentale non c\'è il selettore dei disegni, ma ci sono Annulla e Ripeti accanto agli strumenti', async ({ page }) => {
  await enable(page, false);
  const id = await page.evaluate((paths) => window.__construct!.store.getState().addPath({ paths: paths as never, extrusion: 'rotate', height: 5 }), CUP);
  await settled(page);
  await page.evaluate((nodeId) => window.__construct!.profileEditor.getState().open({ nodeId }), id);
  await expect(editor(page).getByRole('group', { name: 'Disegni mostrati' })).toHaveCount(0);
  const bar = editor(page).getByRole('toolbar', { name: 'Strumenti di disegno' });
  await expect(bar.getByRole('button', { name: 'Seleziona' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Annulla ultima modifica' })).toBeDisabled();
  await expect(bar.getByRole('button', { name: 'Ripeti modifica annullata' })).toBeDisabled();
  await expect(editor(page).locator('[data-section]')).toHaveCount(0);
});

test('con un profilo lineare la sagoma non è disponibile e dice perché', async ({ page }) => {
  await openCup(page, 'Profilo', 'linear');
  const b = view(page, 'Sagoma');
  await expect(b).toBeDisabled();
  await expect(b).toHaveAttribute('title', /solo per la rotazione/);
});

test('Entrambe mostra profilo e sagoma affiancati, ognuno con i suoi nodi', async ({ page }) => {
  await openCup(page, 'Entrambe');
  await expect(profileCanvas(page)).toHaveCount(1);
  await expect(planCanvas(page)).toHaveCount(1);
  await expect(profileCanvas(page).locator('[data-node]')).toHaveCount(6);
  await expect(planNodes(page)).toHaveCount(4);
});

test('la quota di sezione si trascina solo con Seleziona e ha un colore diverso da quello dell\'asse', async ({ page }) => {
  await openCup(page, 'Profilo');
  const section = editor(page).locator('[data-section]');
  await expect(section).toHaveCount(1);
  const z0 = Number(await section.getAttribute('data-section'));
  expect(z0).toBeCloseTo(25, 1);
  // Colori: la linea della quota non usa quello dell'asse di rotazione
  const colors = await page.evaluate(() => {
    const q = (sel: string) => getComputedStyle(document.querySelector(sel)!).stroke;
    return { section: q('.profile-editor__section line'), axis: q('.profile-editor__axis--y') };
  });
  expect(colors.section).not.toBe(colors.axis);
  const line = section.locator('line');
  const box = (await line.boundingBox())!;
  const x = box.x + box.width * 0.8;
  // Con la Penna il gesto non sposta la quota
  await editor(page).getByRole('button', { name: 'Penna' }).click();
  await drag(page, { x, y: box.y + box.height / 2 }, { x, y: box.y + box.height / 2 - 60 });
  await page.keyboard.press('Escape');
  expect(Number(await section.getAttribute('data-section'))).toBeCloseTo(z0, 3);
  // Con Seleziona sì
  await editor(page).getByRole('button', { name: 'Seleziona' }).click();
  const box2 = (await line.boundingBox())!;
  await drag(page, { x, y: box2.y + box2.height / 2 }, { x, y: box2.y + box2.height / 2 - 60 });
  expect(Number(await section.getAttribute('data-section'))).toBeGreaterThan(z0 + 3);
});

test('equidistante: la parete resta di 2 mm anche con lo squircle; omotetico: cambia con la forma', async ({ page }) => {
  await openCup(page, 'Sagoma');
  await preset(page, 'Squircle');
  await expect.poll(() => wallMax(page)).toBeLessThan(2.03);
  expect(await wallMin(page)).toBeGreaterThan(1.97);
  await editor(page).getByRole('group', { name: 'Modello' }).getByRole('button', { name: 'Omotetico' }).click();
  await expect.poll(() => wallMax(page)).toBeGreaterThan(2.2);
});

test('l\'anteprima 3D segue la sagoma: la stella ha un volume diverso dal cerchio', async ({ page }) => {
  await openCup(page, 'Sagoma');
  const card = editor(page).getByLabel('Anteprima 3D');
  await expect(card).toHaveAttribute('data-state', 'ready');
  const volume = async () => Number(await card.getAttribute('data-volume'));
  await expect.poll(volume).toBeGreaterThan(0);
  const circle = await volume();
  // Con gli stessi segmenti la stella ha tanti raggi quanti il cerchio (e spesso gli stessi triangoli): cambia il volume
  await preset(page, 'Stella');
  await expect.poll(async () => Math.abs((await volume()) / circle - 1)).toBeGreaterThan(0.02);
  expect(await triangles(page)).toBeGreaterThan(0);
});

test('il primo ritocco rompe la forma parametrica; Torna ai parametri e Reset la riportano indietro', async ({ page }) => {
  await openCup(page, 'Sagoma');
  await preset(page, 'Esagono');
  const parametric = await planNodes(page).count();
  expect(parametric).toBe(12);
  await expect(editor(page).getByRole('button', { name: 'Torna ai parametri' })).toHaveCount(0);
  // Un clic su un nodo (solo selezione) non la rompe
  await planNodes(page).first().click();
  await expect(editor(page).getByRole('button', { name: 'Torna ai parametri' })).toHaveCount(0);
  // Trascinarlo sì
  const c = await center(planNodes(page).first());
  await drag(page, c, { x: c.x + 60, y: c.y + 40 });
  await expect(editor(page).getByRole('button', { name: 'Torna ai parametri' })).toBeVisible();
  expect(await planNodes(page).count()).toBe(12);
  // Il nodo si è spostato davvero (la griglia di aggancio a questo zoom è di 5 mm)
  const moved = await center(planNodes(page).first());
  expect(Math.hypot(moved.x - c.x, moved.y - c.y)).toBeGreaterThan(20);
  await editor(page).getByRole('button', { name: 'Torna ai parametri' }).click();
  await expect(editor(page).getByRole('button', { name: 'Torna ai parametri' })).toHaveCount(0);
  // Reset: torna al cerchio iniziale
  await editor(page).getByRole('button', { name: 'Reset sagoma' }).click();
  await expect(planNodes(page)).toHaveCount(4);
});

test('Annulla e Ripeti valgono per vista: ⌘Z sulla sagoma non tocca il profilo', async ({ page }) => {
  await openCup(page, 'Entrambe');
  // In "Entrambe" la sidebar segue il disegno su cui si è lavorato: si lavora sulla sagoma
  await planCanvas(page).click({ position: { x: 20, y: 60 } });
  await preset(page, 'Esagono');
  await expect(planNodes(page)).toHaveCount(12);
  const c = await center(planNodes(page).first());
  await drag(page, c, { x: c.x + 60, y: c.y + 40 });
  await expect(editor(page).getByRole('button', { name: 'Torna ai parametri' })).toBeVisible();
  const profileBefore = await profileCanvas(page).locator('[data-node]').count();
  // Annulla (icona): si torna alla forma parametrica e il profilo è com'era
  await editor(page).getByRole('button', { name: 'Annulla ultima modifica' }).click();
  await expect(editor(page).getByRole('button', { name: 'Torna ai parametri' })).toHaveCount(0);
  expect(await profileCanvas(page).locator('[data-node]').count()).toBe(profileBefore);
  // Ripeti con la tastiera
  await planCanvas(page).click({ position: { x: 20, y: 60 } });
  await page.keyboard.press('Control+Shift+z');
  await expect(editor(page).getByRole('button', { name: 'Torna ai parametri' })).toBeVisible();
  // Annulla con la tastiera
  await page.keyboard.press('Control+z');
  await expect(editor(page).getByRole('button', { name: 'Torna ai parametri' })).toHaveCount(0);
  // La cronologia del profilo non ha avuto passi: Annulla sul profilo è spento finché non si modifica
  await profileCanvas(page).click({ position: { x: 20, y: 60 } });
  await expect(editor(page).getByRole('button', { name: 'Annulla ultima modifica' })).toBeDisabled();
});

test('togliere nodi lascia la sagoma chiusa e ferma a tre nodi', async ({ page }) => {
  await openCup(page, 'Sagoma');
  await editor(page).getByRole('group', { name: 'Forma della sagoma' }).getByRole('button', { name: 'Rettangolo' }).click();
  await expect(planNodes(page)).toHaveCount(8);
  for (let n = 8; n > 3; n--) {
    await planNodes(page).first().click();
    await page.keyboard.press('Delete');
    await expect(planNodes(page)).toHaveCount(n - 1);
    // Il contorno resta chiuso (il tracciato finisce con Z)
    expect(await planCanvas(page).locator('path.profile-editor__curve').getAttribute('d')).toMatch(/Z$/);
  }
  await planNodes(page).first().click();
  await page.keyboard.press('Delete');
  await expect(planNodes(page)).toHaveCount(3);
  await expect(page.getByText(/almeno tre nodi/)).toBeVisible();
});

test('la Penna sulla sagoma inserisce nodi sulla curva e non apre né crea contorni', async ({ page }) => {
  await openCup(page, 'Sagoma');
  await editor(page).getByRole('button', { name: 'Penna' }).click();
  const curve = planCanvas(page).locator('path.profile-editor__curve');
  const b = (await curve.boundingBox())!;
  // Clic nel vuoto: nessun nodo in più
  await page.mouse.click(b.x + 8, b.y + 8);
  await expect(planNodes(page)).toHaveCount(4);
  await expect(page.getByText(/inserisce nodi sulla curva/)).toBeVisible();
  // Clic sulla curva a 45°: un nodo in più
  const r = b.width / 2;
  const cx = b.x + r;
  const cy = b.y + b.height / 2;
  await page.mouse.click(cx + r * Math.SQRT1_2, cy - r * Math.SQRT1_2);
  await expect(planNodes(page)).toHaveCount(5);
  await expect(planCanvas(page).locator('path.profile-editor__curve')).toHaveCount(1);
  expect(await curve.getAttribute('d')).toMatch(/Z$/);
});

test('con la simmetria verticale spostare un nodo muove anche il suo speculare', async ({ page }) => {
  await openCup(page, 'Sagoma');
  await editor(page).getByRole('group', { name: 'Forma della sagoma' }).getByRole('button', { name: 'Libera' }).click();
  await editor(page).getByLabel('Simmetria della forma libera').selectOption('v');
  await expect(planNodes(page)).toHaveCount(12);
  const centers = async () => Promise.all((await planNodes(page).all()).map(center));
  const symmetric = async () => {
    const pts = await centers();
    const axis = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
    return pts.every((p) => pts.some((q) => Math.abs(q.y - p.y) < 1.5 && Math.abs(q.x - (2 * axis - p.x)) < 1.5));
  };
  expect(await symmetric()).toBe(true);
  const pts = await centers();
  const axis = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
  const target = pts.find((p) => p.x > axis + 30 && p.y < pts[0].y + 400)!;
  await drag(page, target, { x: target.x + 60, y: target.y + 40 });
  expect(await symmetric()).toBe(true);
  // Il nodo si è mosso davvero
  const after = await centers();
  expect(after.some((p) => Math.abs(p.x - (target.x + 58)) < 12 && Math.abs(p.y - (target.y + 40)) < 12)).toBe(true);
  // ... e anche lo speculare
  expect(after.some((p) => Math.abs(p.x - (2 * axis - (target.x + 58))) < 12 && Math.abs(p.y - (target.y + 40)) < 12)).toBe(true);
});

test('la quota di sezione si regola dal cursore della colonna, anche con la sola vista Sagoma', async ({ page }) => {
  await openCup(page, 'Sagoma');
  const control = editor(page).locator('[data-section-control]');
  await expect(control).toBeVisible();
  await expect(planCanvas(page).locator('.profile-editor__plan-slice-label')).toHaveText(/z = 25 mm/);
  const field = control.locator('.number-field__input').first();
  await field.fill('40');
  await field.press('Enter');
  await expect(planCanvas(page).locator('.profile-editor__plan-slice-label')).toHaveText(/z = 40 mm/);
  // Nel profilo la linea è alla stessa quota
  await view(page, 'Profilo').click();
  await expect(editor(page).locator('[data-section]')).toHaveAttribute('data-section', '40.000');
  // Anche la colonna del profilo ha il cursore
  await expect(editor(page).locator('[data-section-control]')).toBeVisible();
});

test('la pastiglia della quota si trascina con Seleziona', async ({ page }) => {
  await openCup(page, 'Profilo');
  const section = editor(page).locator('[data-section]');
  const z0 = Number(await section.getAttribute('data-section'));
  const pill = (await section.locator('[data-section-pill] rect').boundingBox())!;
  const from = { x: pill.x + pill.width / 2, y: pill.y + pill.height / 2 };
  await drag(page, from, { x: from.x, y: from.y - 50 });
  expect(Number(await section.getAttribute('data-section'))).toBeGreaterThan(z0 + 3);
});

test('«Mostra la sezione» spenta nasconde linea, anelli ed etichetta', async ({ page }) => {
  await openCup(page, 'Entrambe');
  await planCanvas(page).click({ position: { x: 20, y: 60 } });
  await expect(editor(page).locator('[data-section]')).toHaveCount(1);
  await editor(page).getByLabel('Mostra la sezione').uncheck();
  await expect(editor(page).locator('[data-section]')).toHaveCount(0);
  await expect(planCanvas(page).locator('.profile-editor__plan-slice')).toHaveCount(0);
  await expect(planCanvas(page).locator('.profile-editor__plan-slice-label')).toHaveCount(0);
  await editor(page).getByLabel('Mostra la sezione').check();
  await expect(editor(page).locator('[data-section]')).toHaveCount(1);
});

test('OK salva la sagoma nel Profilo: il solido della scena è quello dell\'anteprima', async ({ page }) => {
  const id = await openCup(page, 'Sagoma');
  const before = await page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);
  await preset(page, 'Squircle');
  await expect(editor(page).getByLabel('Anteprima 3D')).toHaveAttribute('data-state', 'ready');
  const previewVolume = Number(await editor(page).getByLabel('Anteprima 3D').getAttribute('data-volume'));
  await editor(page).getByRole('button', { name: 'OK', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const node = await page.evaluate((nodeId) => window.__construct!.store.getState().scene.nodes[nodeId] as unknown as { plan?: { kind: string; base: string } }, id);
  expect(node.plan?.kind).toBe('rect');
  const after = await page.evaluate(() => window.__construct!.results.getState().meshes[0].volume);
  expect(after).toBeGreaterThan(before * 1.05);
  expect(after).toBeCloseTo(previewVolume, 0);
  // Riaprendo la modale la sagoma è quella salvata
  await page.evaluate((nodeId) => window.__construct!.profileEditor.getState().open({ nodeId }), id);
  await view(page, 'Sagoma').click();
  await expect(editor(page).getByRole('group', { name: 'Forma della sagoma' }).getByRole('button', { name: 'Rettangolo' })).toHaveAttribute('aria-pressed', 'true');
});

test('angolo parziale con la sagoma: a 180° il volume è la metà', async ({ page }) => {
  await openCup(page, 'Sagoma');
  const card = editor(page).getByLabel('Anteprima 3D');
  const volume = async () => Number(await card.getAttribute('data-volume'));
  await expect.poll(volume).toBeGreaterThan(0);
  const circle = await volume();
  await preset(page, 'Squircle');
  // Si aspetta la mesh dello squircle (più grande di quella circolare) prima di misurare il giro intero
  await expect.poll(volume).toBeGreaterThan(circle * 1.05);
  const full = await volume();
  // L'angolo sta nella colonna del profilo
  await view(page, 'Profilo').click();
  const angle = editor(page).locator('.slider-field').filter({ hasText: 'Angolo' }).locator('.number-field__input');
  await angle.fill('180');
  await angle.press('Enter');
  await expect.poll(async () => Number(await card.getAttribute('data-volume')) / full).toBeCloseTo(0.5, 2);
});

test('l\'anteprima 3D mostra gli anelli della quota di sezione', async ({ page }) => {
  await openCup(page, 'Sagoma');
  const card = editor(page).getByLabel('Anteprima 3D');
  // Il bicchiere a metà altezza ha due anelli: esterno e interno della parete
  await expect(card).toHaveAttribute('data-rings', '2');
  await editor(page).getByLabel('Mostra la sezione').uncheck();
  await expect(card).toHaveAttribute('data-rings', '0');
});

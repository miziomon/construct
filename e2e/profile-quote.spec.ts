import { expect, test, type Page } from '@playwright/test';
import { openApp, readCode, sceneState, settled } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

/** Rettangolo 40 x 20 con gli id dei nodi (n1 in basso a sinistra, poi in senso antiorario), come li scrive il Profilo. */
const RECT = [
  {
    closed: true,
    nodes: [
      { id: 'n1', p: [0, 0], kind: 'corner' },
      { id: 'n2', p: [40, 0], kind: 'corner' },
      { id: 'n3', p: [40, 20], kind: 'corner' },
      { id: 'n4', p: [0, 20], kind: 'corner' },
    ],
  },
];

/** A fisso e lati orizzontali e verticali: restano due gradi di libertà (la larghezza e l'altezza). */
const SQUARED = [
  { id: 'k1', t: 'fixed', p: ['n1'], x: 0, y: 0 },
  { id: 'k2', t: 'horizontal', p: ['n1', 'n2'] },
  { id: 'k3', t: 'horizontal', p: ['n4', 'n3'] },
  { id: 'k4', t: 'vertical', p: ['n2', 'n3'] },
  { id: 'k5', t: 'vertical', p: ['n1', 'n4'] },
];

/** Più le due quote: completamente vincolato. */
const FULL = [...SQUARED, { id: 'k6', t: 'dist', p: ['n1', 'n2'], v: 40 }, { id: 'k7', t: 'dist', p: ['n2', 'n3'], v: 20 }];

type SavedNode = { paths: { nodes: { p: [number, number] }[] }[]; constraints?: { t: string; v?: number }[] };

async function addProfile(page: Page, constraints: unknown[], shape: unknown = RECT): Promise<string> {
  const id = await page.evaluate(([paths, cons]) => window.__construct!.store.getState().addPath({ paths: paths as never, constraints: cons as never, height: 5 }), [shape, constraints] as const);
  await settled(page);
  return id;
}

async function openEditor(page: Page, id: string) {
  await page.evaluate((nodeId) => window.__construct!.profileEditor.getState().open({ nodeId }), id);
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).locator('[data-node]').first()).toBeVisible();
}

const editor = (page: Page) => page.locator('dialog.modal[open]');
const node = (page: Page, ref: string) => editor(page).locator(`[data-node="${ref}"]`);
const field = (page: Page) => editor(page).getByRole('textbox', { name: 'Valore della quota' });
const history = (page: Page) => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);
const getNode = async (page: Page, id: string) => (await sceneState(page)).nodes[id] as unknown as SavedNode;

/** Centro di un elemento in pixel di pagina. */
async function center(locator: ReturnType<typeof node>) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Clic al centro di un nodo (con il mouse: il locator.click controllerebbe che nessuna icona dei vincoli lo copra). */
async function clickNode(page: Page, ref: string) {
  const c = await center(node(page, ref));
  await page.mouse.click(c.x, c.y);
}

/** Clic a metà del segmento tra due nodi (con lo strumento Quota: la quota di quel segmento). */
async function clickSegment(page: Page, from: string, to: string) {
  const [a, b] = [await center(node(page, from)), await center(node(page, to))];
  await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
}

/** Con lo strumento Quota: scrive il valore nel campo che si apre sopra l'etichetta e conferma con Invio. */
async function typeValue(page: Page, value: string) {
  await expect(field(page)).toBeVisible();
  await field(page).fill(value);
  await field(page).press('Enter');
  await expect(field(page)).toHaveCount(0);
}

/** Trascina con piccoli passi, come una persona. */
async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (dx * i) / 8, from.y + (dy * i) / 8);
  await page.mouse.up();
}

const labels = (page: Page) => editor(page).locator('[data-quote-label]');
/** Avviso sopra il disegno (quota rifiutata) e i suoi pulsanti. */
const banner = (page: Page) => editor(page).locator('.profile-editor__qbar');
/** Centro e riquadro di un'etichetta in pixel di pagina. */
async function box(locator: ReturnType<typeof labels>) {
  const b = (await locator.boundingBox())!;
  return { ...b, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}
/** Le due etichette non si sovrappongono. */
const disjoint = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

const fit = (page: Page) => editor(page).getByRole('button', { name: 'Adatta', exact: true }).click();
const quoteTool = (page: Page) => editor(page).getByRole('button', { name: 'Quota', exact: true });
const ok = (page: Page) => editor(page).getByRole('button', { name: 'OK', exact: true });

test('rettangolo con quote di larghezza e altezza digitate: i nodi hanno le misure e il disegno è completamente vincolato', async ({ page }) => {
  const id = await addProfile(page, SQUARED);
  await openEditor(page, id);
  // Aperto così com'è: non si risolve nulla, ma la diagnosi dice che restano due gradi di libertà
  await expect(editor(page).getByText('Sottovincolato: 2 gradi di libertà')).toBeVisible();
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(5);

  // Quota di larghezza: clic sul lato in basso con lo strumento Quota, valore 60
  await quoteTool(page).click();
  await clickSegment(page, '0:0', '0:1');
  await typeValue(page, '60');
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(6);
  await expect(editor(page).getByText('Sottovincolato: 1 grado di libertà')).toBeVisible();

  // Quota di altezza: il disegno è cresciuto, si inquadra di nuovo e si quota il lato di destra
  await fit(page);
  await clickSegment(page, '0:1', '0:2');
  await typeValue(page, '30');
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(7);
  await expect(editor(page).getByText('Completamente vincolato: 0 gradi di libertà')).toBeVisible();
  // Le due etichette sono sul disegno
  await expect(editor(page).locator('[data-quote-label]')).toHaveCount(2);

  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const saved = await getNode(page, id);
  const p = saved.paths[0].nodes.map((n) => n.p);
  expect(p[0][0]).toBeCloseTo(0, 3);
  expect(p[0][1]).toBeCloseTo(0, 3);
  expect(p[1][0]).toBeCloseTo(60, 3);
  expect(p[1][1]).toBeCloseTo(0, 3);
  expect(p[2][0]).toBeCloseTo(60, 3);
  expect(p[2][1]).toBeCloseTo(30, 3);
  expect(p[3][0]).toBeCloseTo(0, 3);
  expect(p[3][1]).toBeCloseTo(30, 3);
  // Le quote si salvano esatte nel nodo
  expect(saved.constraints!.filter((c) => c.t === 'dist').map((c) => c.v)).toEqual([60, 30]);
});

test('una quota in conflitto e un vincolo ridondante si rifiutano con un avviso e il disegno non cambia', async ({ page }) => {
  const id = await addProfile(page, FULL);
  await openEditor(page, id);
  await expect(editor(page).getByText('Completamente vincolato: 0 gradi di libertà')).toBeVisible();

  // La diagonale di un rettangolo 40 x 20 vale 44,7: con 10 va in conflitto con le due quote
  await quoteTool(page).click();
  await clickNode(page, '0:0');
  await clickNode(page, '0:2');
  await typeValue(page, '10');
  await expect(page.getByText('Quota in conflitto')).toBeVisible();
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(7);
  await expect(editor(page).locator('[data-quote-label]')).toHaveCount(2);
  // L'avviso offre la quota di riferimento; qui si chiude senza aggiungerla
  await expect(banner(page).getByRole('button', { name: 'Aggiungi come quota di riferimento' })).toBeVisible();
  await banner(page).getByRole('button', { name: 'Annulla' }).click();
  await expect(banner(page)).toHaveCount(0);

  // Una quota ridondante non identica: la distanza in X tra A e B vale 40 e le altre già lo impongono (quota allineata 40 e orizzontale)
  await editor(page).getByRole('group', { name: 'Modo della quota' }).getByRole('button', { name: 'Orizzontale' }).click();
  await clickSegment(page, '0:0', '0:1');
  await typeValue(page, '40');
  await expect(banner(page)).toContainText('Quota ridondante');
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(7);
  await banner(page).getByRole('button', { name: 'Annulla' }).click();

  // Orizzontale tra A e B c'è già (e A e B sono già determinati): ridondante
  await editor(page).getByRole('button', { name: 'Seleziona', exact: true }).click();
  await clickNode(page, '0:0');
  await page.keyboard.down('Shift');
  await clickNode(page, '0:1');
  await page.keyboard.up('Shift');
  await editor(page).locator('[data-constraint-button="horizontal"]').click();
  await expect(page.getByText('Vincolo ridondante')).toBeVisible();
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(7);

  // Niente è cambiato: OK non scrive nulla
  const steps = await history(page);
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  expect(await history(page)).toBe(steps);
  const saved = await getNode(page, id);
  expect(saved.constraints).toHaveLength(7);
});

test('OK e riapertura conservano quote e vincoli; Esc nel campo annulla senza cambiare nulla', async ({ page }) => {
  const id = await addProfile(page, [...SQUARED, { id: 'k6', t: 'dist', p: ['n1', 'n2'], v: 40 }]);
  const steps = await history(page);
  await openEditor(page, id);

  // Quota di altezza 25 sul lato di destra
  await quoteTool(page).click();
  await clickSegment(page, '0:1', '0:2');
  await typeValue(page, '25');
  await expect(editor(page).getByText('Completamente vincolato: 0 gradi di libertà')).toBeVisible();
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  // Un solo passo "Profilo" per tutto il lavoro della modale
  expect(await history(page)).toBe(steps + 1);
  const saved = await getNode(page, id);
  expect(saved.constraints).toHaveLength(7);
  expect(saved.paths[0].nodes[2].p[1]).toBeCloseTo(25, 3);

  // Riaperto: ci sono gli stessi vincoli, le due etichette con i valori, e il disegno non si risolve da solo
  await openEditor(page, id);
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(7);
  await expect(editor(page).locator('[data-quote-label]')).toHaveCount(2);
  await expect(editor(page).locator('[data-quote-label]').first()).toContainText('40');
  await expect(editor(page).locator('[data-quote-label]').last()).toContainText('25');
  await expect(editor(page).getByText('Completamente vincolato: 0 gradi di libertà')).toBeVisible();

  // Un clic sull'etichetta apre il campo con il valore; Esc lo chiude senza cambiare nulla (e senza chiudere la modale)
  await editor(page).locator('[data-quote-label]').last().click();
  await expect(field(page)).toHaveValue('25');
  await field(page).press('Escape');
  await expect(field(page)).toHaveCount(0);
  await expect(editor(page)).toBeVisible();
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  expect(await history(page)).toBe(steps + 1);
});

test('Annulla toglie un vincolo o una quota in un solo passo e Ripeti li rimette', async ({ page }) => {
  const id = await addProfile(page, []);
  await openEditor(page, id);
  const items = editor(page).locator('[data-constraint]');
  await expect(items).toHaveCount(0);

  // Fisso su A (un vincolo, un passo)
  await clickNode(page, '0:0');
  await editor(page).locator('[data-constraint-button="fixed"]').click();
  await expect(items).toHaveCount(1);
  // Quota di larghezza 60 (un passo): i nodi si spostano e la quota resta una sola voce
  await quoteTool(page).click();
  await clickSegment(page, '0:0', '0:1');
  await typeValue(page, '60');
  await expect(items).toHaveCount(2);
  await expect(labels(page)).toHaveCount(1);
  await expect(editor(page).locator('.profile-editor')).toBeFocused();

  // Annulla: prima la quota (tutta, con il movimento dei nodi), poi il vincolo; Ripeti li riporta uno alla volta
  await page.keyboard.press('Control+z');
  await expect(items).toHaveCount(1);
  await expect(labels(page)).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(items).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(items).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(items).toHaveCount(2);
  await expect(labels(page)).toHaveCount(1);

  // La cronologia della scena non è cambiata: solo l'OK la tocca
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  const saved = await getNode(page, id);
  expect(saved.paths[0].nodes[1].p[0]).toBeCloseTo(60, 3);
  expect(saved.constraints).toHaveLength(2);
});

test('trascinare un nodo vincolato: Orizzontale e Verticale restano validi e il resto del disegno segue', async ({ page }) => {
  const id = await addProfile(page, SQUARED);
  await openEditor(page, id);
  // Trascina il nodo in alto a destra più in là e più in alto: i lati restano orizzontali e verticali, A resta fisso
  const c = await center(node(page, '0:2'));
  await dragBy(page, c, 60, -40);
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const p = (await getNode(page, id)).paths[0].nodes.map((n) => n.p);
  // A non si è mosso; AB è orizzontale (stessa y), BC e AD verticali (stessa x), DC orizzontale
  expect(p[0][0]).toBeCloseTo(0, 3);
  expect(p[0][1]).toBeCloseTo(0, 3);
  expect(p[1][1]).toBeCloseTo(p[0][1], 3);
  expect(p[2][0]).toBeCloseTo(p[1][0], 3);
  expect(p[3][0]).toBeCloseTo(p[0][0], 3);
  expect(p[3][1]).toBeCloseTo(p[2][1], 3);
  // Il nodo ha davvero seguito il mouse (non è rimasto dov'era)
  expect(p[2][0]).toBeGreaterThan(41);
  expect(p[2][1]).toBeGreaterThan(21);
});

test('una quota nuova nasce fuori dal rettangolo e non si sovrappone alle altre; la linea e l\'etichetta si trascinano', async ({ page }) => {
  const id = await addProfile(page, SQUARED);
  await openEditor(page, id);
  await quoteTool(page).click();
  await clickSegment(page, '0:0', '0:1');
  await typeValue(page, '60');
  await fit(page);
  await clickSegment(page, '0:1', '0:2');
  await typeValue(page, '30');
  await expect(labels(page)).toHaveCount(2);

  // Fuori dal rettangolo: la prima sotto il lato in basso, la seconda a destra del lato di destra; e non si toccano
  const [a, b, c] = [await center(node(page, '0:0')), await center(node(page, '0:1')), await center(node(page, '0:2'))];
  const [first, second] = [await box(labels(page).first()), await box(labels(page).last())];
  expect(first.y).toBeGreaterThan(a.y);
  expect(second.x).toBeGreaterThan(b.x);
  expect(c.y).toBeLessThan(b.y);
  expect(disjoint(first, second)).toBe(true);

  // Trascinare l'etichetta: si sposta lungo la linea e più lontano dal lato, con un solo passo locale
  await dragBy(page, { x: first.cx, y: first.cy }, 80, 30);
  const moved = await box(labels(page).first());
  expect(moved.cx - first.cx).toBeGreaterThan(60);
  expect(moved.cy - first.cy).toBeGreaterThan(20);
  await page.keyboard.press('Control+z');
  const back = await box(labels(page).first());
  expect(Math.abs(back.cx - first.cx)).toBeLessThan(3);
  expect(Math.abs(back.cy - first.cy)).toBeLessThan(3);
  await page.keyboard.press('Control+Shift+z');

  // Trascinare la linea di quota (non l'etichetta): cambia solo la distanza dal lato
  const before = await box(labels(page).last());
  // La linea di destra è verticale: si afferra tra le frecce, sopra l'etichetta, e si porta più a destra
  const line = { x: before.cx, y: before.cy - 25 };
  await dragBy(page, line, 50, 0);
  const after = await box(labels(page).last());
  expect(after.cx - before.cx).toBeGreaterThan(35);
  expect(Math.abs(after.cy - before.cy)).toBeLessThan(4);

  // OK e riapertura conservano la posizione: relativa al lato in basso (in unità del lato AB)
  const rel = async () => {
    const [a2, b2] = [await center(node(page, '0:0')), await center(node(page, '0:1'))];
    const l = await box(labels(page).first());
    const k = Math.hypot(b2.x - a2.x, b2.y - a2.y);
    return { x: (l.cx - a2.x) / k, y: (l.cy - a2.y) / k };
  };
  const placed = await rel();
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const saved = await getNode(page, id);
  const dims = saved.constraints!.filter((q) => q.t === 'dist') as unknown as { off: number; at: number }[];
  expect(dims).toHaveLength(2);
  // L'etichetta è stata portata verso destra lungo la linea: at oltre la metà
  expect(dims[0].at).toBeGreaterThan(0.55);
  await openEditor(page, id);
  const reopened = await rel();
  expect(Math.abs(reopened.x - placed.x)).toBeLessThan(0.03);
  expect(Math.abs(reopened.y - placed.y)).toBeLessThan(0.03);

  // Riposiziona quote: le dispone di nuovo (at torna a metà) e una sola voce di cronologia locale
  await editor(page).locator('[data-reposition]').click();
  await expect(labels(page)).toHaveCount(2);
  const [x1, x2] = [await box(labels(page).first()), await box(labels(page).last())];
  expect(disjoint(x1, x2)).toBe(true);
});

test('una quota ridondante si aggiunge come quota di riferimento: misura tra parentesi, non vincola e non si modifica', async ({ page }) => {
  const id = await addProfile(page, FULL);
  await openEditor(page, id);
  await quoteTool(page).click();
  await editor(page).getByRole('group', { name: 'Modo della quota' }).getByRole('button', { name: 'Orizzontale' }).click();
  await clickSegment(page, '0:0', '0:1');
  await typeValue(page, '40');
  await expect(banner(page)).toContainText('Quota ridondante');
  await banner(page).getByRole('button', { name: 'Aggiungi come quota di riferimento' }).click();
  await expect(banner(page)).toHaveCount(0);

  // Una voce in più, con la misura tra parentesi; il disegno è sempre completamente vincolato
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(8);
  await expect(labels(page)).toHaveCount(3);
  await expect(labels(page).last()).toContainText('(40)');
  await expect(editor(page).getByText('Completamente vincolato: 0 gradi di libertà')).toBeVisible();
  await expect(editor(page).getByText('quota di riferimento')).toBeVisible();
  // Un clic sull'etichetta non apre il campo: la quota non si modifica
  await labels(page).last().click();
  await expect(field(page)).toHaveCount(0);

  // OK e riapertura: la quota di riferimento resta, tra parentesi
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const saved = await getNode(page, id);
  expect(saved.constraints).toHaveLength(8);
  expect((saved.constraints as unknown as { ref?: boolean }[]).filter((c) => c.ref)).toHaveLength(1);
  await openEditor(page, id);
  await expect(labels(page).last()).toContainText('(40)');
});

test('Alt+clic su un segmento sceglie i suoi due nodi: Orizzontale vale per quel lato e il trascinamento lo rispetta', async ({ page }) => {
  const id = await addProfile(page, []);
  await openEditor(page, id);
  const horizontal = editor(page).locator('[data-constraint-button="horizontal"]');
  await expect(horizontal).toBeDisabled();
  // Alt+clic sul lato in basso (A e B): si scelgono solo i suoi due nodi, non tutto il contorno
  const [a, b] = [await center(node(page, '0:0')), await center(node(page, '0:1'))];
  await page.keyboard.down('Alt');
  await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
  await page.keyboard.up('Alt');
  await expect(editor(page).locator('.profile-editor__node--selected')).toHaveCount(2);
  await expect(node(page, '0:0')).toHaveClass(/profile-editor__node--selected/);
  await expect(node(page, '0:1')).toHaveClass(/profile-editor__node--selected/);
  await expect(horizontal).toBeEnabled();
  await horizontal.click();
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(1);
  // Senza il vincolo B salirebbe da solo: con Orizzontale A lo segue e la y resta la stessa
  // Un clic su B lo lascia solo nella selezione (il trascinamento sposterebbe tutti i nodi scelti)
  await clickNode(page, '0:1');
  await dragBy(page, await center(node(page, '0:1')), 0, -30);
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const saved = await getNode(page, id);
  expect(saved.constraints).toHaveLength(1);
  const p = saved.paths[0].nodes.map((n) => n.p);
  expect(Math.abs(p[1][1])).toBeGreaterThan(0.5);
  expect(p[0][1]).toBeCloseTo(p[1][1], 3);
});

test('ridimensionare un Profilo con quote avvisa con il fattore, anche all\'apertura della modale, e non riscrive le quote', async ({ page }) => {
  const id = await addProfile(page, [...SQUARED, { id: 'k6', t: 'dist', p: ['n1', 'n2'], v: 40 }]);
  await page.evaluate((nodeId) => window.__construct!.store.getState().updateNode(nodeId, { width: 80, depth: 40 }), id);
  await expect(page.locator('.toast--info')).toContainText('ridimensionato ×2 in X e ×2 in Y. Le quote non si aggiornano: 40 mm resta il valore salvato');
  // Le quote restano quelle salvate
  expect((await getNode(page, id)).constraints!.find((c) => c.t === 'dist')!.v).toBe(40);
  await openEditor(page, id);
  await expect(editor(page).getByText('Il profilo: ridimensionato ×2 in X e ×2 in Y')).toBeVisible();
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  // Il valore salvato è sempre 40
  expect((await getNode(page, id)).constraints!.find((c) => c.t === 'dist')!.v).toBe(40);
  // Salvato il disegno ridimensionato il fattore non c'è più, ma le quote non corrispondono ai nodi: la modale lo dice
  await openEditor(page, id);
  await expect(editor(page).getByText('Le quote non corrispondono al disegno')).toBeVisible();
  await expect(editor(page).getByText('Il profilo: ridimensionato')).toHaveCount(0);
});

test('con le quote che corrispondono ai nodi non compare nessun avviso di disaccordo', async ({ page }) => {
  const id = await addProfile(page, FULL);
  await openEditor(page, id);
  await expect(editor(page).getByText('Completamente vincolato: 0 gradi di libertà')).toBeVisible();
  await expect(editor(page).getByText('Le quote non corrispondono al disegno')).toHaveCount(0);
});

/** Quadrilatero con il lato di destra inclinato (da (40, 0) a (46, 20)) e il lato alto un po' storto: serve a Parallelo e Perpendicolare. */
const SLANTED = [
  {
    closed: true,
    nodes: [
      { id: 'n1', p: [0, 0], kind: 'corner' },
      { id: 'n2', p: [40, 0], kind: 'corner' },
      { id: 'n3', p: [46, 20], kind: 'corner' },
      { id: 'n4', p: [0, 24], kind: 'corner' },
    ],
  },
];

/** Alt+clic a metà del segmento tra due nodi; con `additive` anche Maiusc (aggiunge il segmento a quelli scelti). */
async function altClickSegment(page: Page, from: string, to: string, additive = false) {
  const [a, b] = [await center(node(page, from)), await center(node(page, to))];
  await page.keyboard.down('Alt');
  if (additive) await page.keyboard.down('Shift');
  await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
  if (additive) await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');
}

test('Perpendicolare e Parallelo su un lato inclinato: due segmenti scelti con Alt+clic, i pulsanti si accendono secondo la selezione', async ({ page }) => {
  const id = await addProfile(page, [], SLANTED);
  await openEditor(page, id);
  const button = (type: string) => editor(page).locator(`[data-constraint-button="${type}"]`);
  // Nessun segmento scelto: spenti
  await expect(button('perpendicular')).toBeDisabled();
  await expect(button('midpoint')).toBeDisabled();

  // Un segmento: orizzontale e verticale sì, perpendicolare no; il secondo con Maiusc+Alt+clic accende i vincoli tra due segmenti
  await altClickSegment(page, '0:0', '0:1');
  await expect(button('horizontal')).toBeEnabled();
  await expect(button('perpendicular')).toBeDisabled();
  await altClickSegment(page, '0:1', '0:2', true);
  await expect(editor(page).getByText('2 segmenti scelti.')).toBeVisible();
  for (const type of ['perpendicular', 'parallel', 'equal', 'collinear']) await expect(button(type)).toBeEnabled();
  await expect(button('horizontal')).toBeDisabled();
  await expect(button('midpoint')).toBeDisabled();
  await button('perpendicular').click();
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(1);
  await expect(editor(page).locator('[data-constraint-type="perpendicular"]')).toHaveCount(1);

  // Il lato alto parallelo alla base
  await altClickSegment(page, '0:3', '0:2');
  await altClickSegment(page, '0:0', '0:1', true);
  await button('parallel').click();
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(2);

  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const p = (await getNode(page, id)).paths[0].nodes.map((n) => n.p);
  const vec = (a: [number, number], b: [number, number]): [number, number] => [b[0] - a[0], b[1] - a[1]];
  const [bottom, right, top] = [vec(p[0], p[1]), vec(p[1], p[2]), vec(p[3], p[2])];
  // Base e lato destro a 90 gradi; lato alto parallelo alla base
  expect((bottom[0] * right[0] + bottom[1] * right[1]) / (Math.hypot(...bottom) * Math.hypot(...right))).toBeCloseTo(0, 3);
  expect((bottom[0] * top[1] - bottom[1] * top[0]) / (Math.hypot(...bottom) * Math.hypot(...top))).toBeCloseTo(0, 3);
});

test('quota angolare digitata: due segmenti con lo strumento Quota in modo Angolo, i gradi portano i nodi, etichetta con il simbolo dei gradi', async ({ page }) => {
  const id = await addProfile(page, [{ id: 'k1', t: 'fixed', p: ['n1'], x: 0, y: 0 }, { id: 'k2', t: 'fixed', p: ['n2'], x: 40, y: 0 }]);
  await openEditor(page, id);
  await quoteTool(page).click();
  await editor(page).getByRole('group', { name: 'Modo della quota' }).getByRole('button', { name: 'Angolo', exact: true }).click();
  // Il lato in basso (A-B) e quello di destra (B-C) sono a 90 gradi: l'angolo in B
  await clickSegment(page, '0:0', '0:1');
  await clickSegment(page, '0:1', '0:2');
  await expect(field(page)).toHaveValue('90');
  await typeValue(page, '75');
  await expect(editor(page).locator('[data-constraint-type="angle"]')).toHaveCount(1);
  await expect(labels(page).last()).toContainText('75°');
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const saved = await getNode(page, id);
  const p = saved.paths[0].nodes.map((n) => n.p);
  // L'angolo in B tra B->A e B->C è 75 gradi (A e B sono fissi, C ha girato attorno a B)
  const [ba, bc] = [[p[0][0] - p[1][0], p[0][1] - p[1][1]], [p[2][0] - p[1][0], p[2][1] - p[1][1]]];
  const angle = (Math.acos((ba[0] * bc[0] + ba[1] * bc[1]) / (Math.hypot(ba[0], ba[1]) * Math.hypot(bc[0], bc[1]))) * 180) / Math.PI;
  expect(angle).toBeCloseTo(75, 2);
  expect(saved.constraints!.find((c) => c.t === 'angle')!.v).toBe(75);
  // Riaperto, la quota angolare c'è con lo stesso valore, tra le voci dell'elenco
  await openEditor(page, id);
  await expect(labels(page)).toHaveCount(1);
  await expect(labels(page).first()).toContainText('75°');
  await expect(editor(page).getByRole('textbox', { name: /Valore di Angolo/ })).toHaveValue('75');
});

test('il raggio di raccordo di uno spigolo toglie volume al solido, nel disegno e nel codice OpenSCAD', async ({ page }) => {
  const id = await addProfile(page, []);
  const volume = () => page.evaluate(() => window.__construct!.results.getState().meshes.reduce((v, m) => v + (m.volume ?? 0), 0));
  const before = await volume();
  expect(before).toBeCloseTo(4000, 0);
  await openEditor(page, id);
  // Lo spigolo in alto a destra: il campo Raggio nella sezione del nodo
  await clickNode(page, '0:2');
  const radius = editor(page).getByLabel('Raggio');
  await expect(radius).toBeEnabled();
  await radius.fill('5');
  await radius.press('Enter');
  // Il disegno mostra il raccordo (il tracciato ha una curva) e il solido è più piccolo dopo l'OK
  await expect(editor(page).locator('.profile-editor__curve').first()).toHaveAttribute('d', /C/);
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  // Perde (1 - π/4) r² = 5,36 mm² di area: per 5 mm di altezza, circa 26,8 mm³
  const after = await volume();
  expect(before - after).toBeGreaterThan(24);
  expect(before - after).toBeLessThan(29);
  expect((await getNode(page, id)).paths[0].nodes[2]).toMatchObject({ r: 5 });
  // Il codice scrive lo stesso poligono (con l'arco) e la versione 2 del commento; il raggio resta nei nodi
  const code = await readCode(page);
  expect(code).toContain('"v":2');
  expect(code).toContain('"r":5');
  expect((code.match(/\[-?[\d.]+, -?[\d.]+\]/g) ?? []).length).toBeGreaterThan(8);

  // Riaperto: il raggio c'è; un raggio troppo grande si riduce e il campo lo dice
  await openEditor(page, id);
  await clickNode(page, '0:2');
  await expect(editor(page).getByLabel('Raggio')).toHaveValue('5');
  await editor(page).getByLabel('Raggio').fill('500');
  await editor(page).getByLabel('Raggio').press('Enter');
  await expect(editor(page).locator('[data-fillet-note]')).toContainText('Raggio ridotto a');
});

test('il raggio non vale su un estremo aperto: il campo è spento e dice perché', async ({ page }) => {
  const open = [{ closed: false, nodes: [{ id: 'n1', p: [0, 0], kind: 'corner' }, { id: 'n2', p: [40, 0], kind: 'corner' }, { id: 'n3', p: [40, 20], kind: 'corner' }] }];
  const id = await addProfile(page, [], open);
  await openEditor(page, id);
  await clickNode(page, '0:0');
  await expect(editor(page).getByLabel('Raggio')).toBeDisabled();
  await expect(editor(page).locator('[data-fillet-note]')).toContainText('un segmento prima e uno dopo');
  await clickNode(page, '0:1');
  await expect(editor(page).getByLabel('Raggio')).toBeEnabled();
});

/** Apre la modale su un Profilo nuovo (vuoto) e attende il disegno. */
async function openNewProfile(page: Page) {
  await page.evaluate(() => window.__construct!.profileEditor.getState().open({ new: true }));
  await expect(editor(page)).toBeVisible();
}

const svgCanvas = (page: Page) => editor(page).locator('.profile-editor__svg');
/** Centro dell'area di disegno in pixel di pagina. */
async function canvasCenter(page: Page) {
  const b = (await svgCanvas(page).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
const penTool = (page: Page) => editor(page).getByRole('button', { name: 'Penna', exact: true });
const lengthField = (page: Page) => editor(page).getByRole('textbox', { name: 'Lunghezza in mm' });
const angleField = (page: Page) => editor(page).getByRole('textbox', { name: 'Angolo in gradi' });

/** Penna: scrive lunghezza e angolo nei campi che si aprono con la prima cifra, Tab passa all'angolo, Invio conferma il nodo. */
async function typeSegment(page: Page, length: string, angle: string) {
  await page.keyboard.press(length[0]);
  await expect(lengthField(page)).toBeFocused();
  if (length.length > 1) await page.keyboard.type(length.slice(1));
  await page.keyboard.press('Tab');
  await expect(angleField(page)).toBeFocused();
  await page.keyboard.type(angle);
  await page.keyboard.press('Enter');
  await expect(lengthField(page)).toHaveCount(0);
  // Il fuoco torna al disegno: la cifra successiva apre i campi del segmento seguente
  await expect(editor(page).getByRole('group', { name: 'Disegno del profilo' })).toBeFocused();
}

test('Penna con lunghezza e angolo digitati: un rettangolo 60 x 40 con le quote, il quarto lato chiude il contorno con quote di riferimento', async ({ page }) => {
  await openNewProfile(page);
  await penTool(page).click();
  // Primo punto al centro, poi quattro segmenti digitati: 60 a 0°, 40 a 90°, 60 a 180°, 40 a 270° (torna al primo nodo e chiude)
  const c = await canvasCenter(page);
  await page.mouse.click(c.x, c.y);
  await typeSegment(page, '60', '0');
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(2);
  await typeSegment(page, '40', '90');
  await typeSegment(page, '60', '180');
  await typeSegment(page, '40', '270');
  await expect(editor(page).getByText('1 contorno, 4 nodi')).toBeVisible();
  // Tre lati con distanza e angolo, il quarto con le due quote di riferimento (tra parentesi): otto voci e otto etichette
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(8);
  await expect(labels(page)).toHaveCount(8);
  await expect(editor(page).locator('[data-quote-label]', { hasText: '(40)' })).toHaveCount(1);
  // Sottovincolato solo per la posizione: due gradi di libertà. Fissato il primo nodo, completamente vincolato
  await expect(editor(page).getByText('Sottovincolato: 2 gradi di libertà')).toBeVisible();
  await editor(page).getByRole('button', { name: 'Seleziona', exact: true }).click();
  await clickNode(page, '0:0');
  await editor(page).locator('[data-constraint-button="fixed"]').click();
  await expect(editor(page).getByText('Completamente vincolato: 0 gradi di libertà')).toBeVisible();

  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const nodes = Object.values((await sceneState(page)).nodes) as unknown as SavedNode[];
  const p = nodes[0].paths[0].nodes.map((n) => n.p);
  expect(p).toHaveLength(4);
  expect(p[1][0] - p[0][0]).toBeCloseTo(60, 3);
  expect(p[1][1] - p[0][1]).toBeCloseTo(0, 3);
  expect(p[2][1] - p[1][1]).toBeCloseTo(40, 3);
  expect(p[3][0] - p[2][0]).toBeCloseTo(-60, 3);
  expect(nodes[0].constraints!.filter((q) => q.t === 'dist' && q.v === 60)).toHaveLength(2);
});

test('Penna digitata: Esc chiude i campi senza toccare il disegno, un valore non valido dà un messaggio, un campo vuoto segue il cursore', async ({ page }) => {
  await openNewProfile(page);
  await penTool(page).click();
  const c = await canvasCenter(page);
  await page.mouse.click(c.x, c.y);
  // Esc: i campi si chiudono, il contorno (un nodo) resta e la Penna continua
  await page.keyboard.press('5');
  await expect(lengthField(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(lengthField(page)).toHaveCount(0);
  await expect(editor(page).getByText('0 contorni, 1 nodo')).toBeVisible();
  await expect(editor(page)).toBeVisible();
  // Lunghezza zero: il messaggio resta sotto i campi e nessun nodo nasce
  await page.keyboard.press('0');
  await page.keyboard.press('Tab');
  await page.keyboard.type('45');
  await page.keyboard.press('Enter');
  await expect(editor(page).getByRole('alert').filter({ hasText: 'maggiore di zero' })).toBeVisible();
  await expect(editor(page).getByText('0 contorni, 1 nodo')).toBeVisible();
  // Corretta la lunghezza: nasce il nodo con la sola quota... e l'angolo digitato (45)
  await lengthField(page).fill('10');
  await angleField(page).press('Enter');
  await expect(editor(page).getByText('1 contorno, 2 nodi')).toBeVisible();
  await expect(editor(page).locator('[data-constraint-type="angle"]')).toHaveCount(1);
  // Un solo angolo digitato (lunghezza vuota): una sola quota, la lunghezza segue il cursore
  await page.mouse.move(c.x + 120, c.y + 60);
  await page.keyboard.press('Tab');
  await expect(lengthField(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.type('0');
  await page.keyboard.press('Enter');
  await expect(editor(page).locator('[data-constraint-type="dist"]')).toHaveCount(1);
  await expect(editor(page).locator('[data-constraint-type="angle"]')).toHaveCount(2);
  // I tasti delle scorciatoie non scattano mentre si digita: una D nel campo non cambia strumento
  await page.keyboard.press('5');
  await page.keyboard.press('d');
  await expect(editor(page).getByRole('button', { name: 'Quota', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('vincoli dedotti: un segmento tracciato quasi orizzontale riceve l\'orizzontale; la casella Vincoli automatici lo disattiva', async ({ page }) => {
  await openNewProfile(page);
  const auto = editor(page).getByLabel('Vincoli automatici');
  // Nelle prove la casella parte spenta: si accende dal pannello e l'impostazione resta salvata
  await expect(auto).not.toBeChecked();
  await auto.check();
  expect(await page.evaluate(() => window.__construct!.ui.getState().profileAutoConstraints)).toBe(true);
  await penTool(page).click();
  const c = await canvasCenter(page);
  await page.mouse.click(c.x - 150, c.y);
  // Con Ctrl l'aggancio è sospeso: un punto 8 pixel sopra la retta, circa un grado e mezzo su 300 pixel
  await page.keyboard.down('Control');
  await page.mouse.click(c.x + 150, c.y - 8);
  await page.keyboard.up('Control');
  await expect(editor(page).locator('[data-constraint-type="horizontal"]')).toHaveCount(1);
  await expect(editor(page).locator('[data-constraint-glyph="horizontal"]')).toHaveCount(1);
  // Un terzo punto lontano da ogni angolo notevole non aggiunge vincoli
  await page.keyboard.down('Control');
  await page.mouse.click(c.x + 50, c.y + 150);
  await page.keyboard.up('Control');
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(1);
  await page.keyboard.press('Enter');
  // Con la casella spenta il segmento resta com'è
  await auto.uncheck();
  expect(await page.evaluate(() => window.__construct!.ui.getState().profileAutoConstraints)).toBe(false);
  await page.keyboard.down('Control');
  await page.mouse.click(c.x - 150, c.y + 110);
  await page.mouse.click(c.x + 100, c.y + 102);
  await page.keyboard.up('Control');
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(1);
  // Un OK dà il disegno con i primi due nodi alla stessa quota Y (il risolutore ha reso orizzontale il segmento)
  await page.keyboard.press('Enter');
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const nodes = Object.values((await sceneState(page)).nodes) as unknown as SavedNode[];
  const p = nodes[0].paths[0].nodes.map((n) => n.p);
  expect(p[0][1]).toBeCloseTo(p[1][1], 3);
  expect(nodes[0].constraints!.some((q) => q.t === 'horizontal')).toBe(true);
});

test('il rettangolo base nasce con lati orizzontali e verticali (con i vincoli automatici); con la casella spenta nasce libero', async ({ page }) => {
  await openNewProfile(page);
  const auto = editor(page).getByLabel('Vincoli automatici');
  await auto.check();
  await editor(page).getByRole('button', { name: 'Rettangolo', exact: true }).click();
  const c = await canvasCenter(page);
  await dragBy(page, { x: c.x - 80, y: c.y - 50 }, 160, 100);
  await expect(editor(page).locator('[data-constraint-type="horizontal"]')).toHaveCount(2);
  await expect(editor(page).locator('[data-constraint-type="vertical"]')).toHaveCount(2);
  // Spenta la casella, un secondo rettangolo non porta vincoli (restano i quattro del primo)
  await auto.uncheck();
  await dragBy(page, { x: c.x + 120, y: c.y + 20 }, 60, 40);
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(4);
  await expect(editor(page).getByText('2 contorni, 8 nodi')).toBeVisible();
});

test('più nodi scelti: un solo raggio di raccordo per tutti gli spigoli, un passo di Annulla', async ({ page }) => {
  const id = await addProfile(page, []);
  await openEditor(page, id);
  await clickNode(page, '0:1');
  await page.keyboard.down('Shift');
  await clickNode(page, '0:2');
  await page.keyboard.up('Shift');
  await expect(editor(page).getByText('2 nodi selezionati')).toBeVisible();
  const radius = editor(page).getByLabel('Raggio');
  await expect(radius).toHaveValue('0');
  await radius.fill('4');
  await radius.press('Enter');
  // Un solo Annulla toglie il raggio a tutti e due
  await expect(editor(page).locator('.profile-editor__curve').first()).toHaveAttribute('d', /C/);
  await editor(page).locator('.profile-editor').focus();
  await page.keyboard.press('Control+z');
  await expect(editor(page).locator('.profile-editor__curve').first()).not.toHaveAttribute('d', /C/);
  await page.keyboard.press('Control+Shift+z');
  await expect(editor(page).locator('.profile-editor__curve').first()).toHaveAttribute('d', /C/);
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const nodes = (await getNode(page, id)).paths[0].nodes as unknown as { r?: number }[];
  expect(nodes.map((n) => n.r)).toEqual([undefined, 4, 4, undefined]);
  // Riaperto con uno spigolo diverso: il raggio comune è «—»
  await openEditor(page, id);
  await clickNode(page, '0:0');
  await page.keyboard.down('Shift');
  await clickNode(page, '0:1');
  await page.keyboard.up('Shift');
  await expect(editor(page).getByLabel('Raggio')).toHaveAttribute('placeholder', '—');
});

test('più quote scelte nell\'elenco: un valore comune per tutte, in un solo passo', async ({ page }) => {
  const id = await addProfile(page, FULL);
  await openEditor(page, id);
  const name = (k: string) => editor(page).locator(`[data-constraint="${k}"] .profile-editor__constraint-name`);
  await name('k6').click();
  await name('k7').click({ modifiers: ['Shift'] });
  await expect(editor(page).locator('[data-quote-group]')).toContainText('2 quote scelte');
  const common = editor(page).getByLabel('Valore comune delle quote scelte');
  // Valori diversi (40 e 20): il campo è vuoto con «—»
  await expect(common).toHaveAttribute('placeholder', '—');
  await common.fill('30');
  await common.press('Enter');
  await expect(editor(page).getByText('Completamente vincolato: 0 gradi di libertà')).toBeVisible();
  await expect(editor(page).getByLabel('Valore di Distanza P1.1-P1.2')).toHaveValue('30');
  await expect(editor(page).getByLabel('Valore di Distanza P1.2-P1.3')).toHaveValue('30');
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const saved = await getNode(page, id);
  expect(saved.constraints!.filter((q) => q.t === 'dist').map((q) => q.v)).toEqual([30, 30]);
  expect(saved.paths[0].nodes[2].p[0]).toBeCloseTo(30, 3);
  expect(saved.paths[0].nodes[2].p[1]).toBeCloseTo(30, 3);
});

// --- Correzioni della revisione B5 ----------------------------------------------------------------------------------------

/** Quattro clic della Penna ai vertici di un rettangolo (distanze dal centro, in pixel) e un clic sul primo nodo per chiudere. */
async function drawClosedRect(page: Page) {
  const c = await canvasCenter(page);
  for (const [dx, dy] of [[-100, 80], [100, 80], [100, -80], [-100, -80]]) await page.mouse.click(c.x + dx, c.y + dy);
  await expect(editor(page).locator('[data-node]')).toHaveCount(4);
  await page.mouse.click(c.x - 100, c.y + 80);
  await expect(editor(page).locator('[data-path="0"]')).toContainText('Chiuso');
}

test('con i vincoli automatici accesi i flussi di disegno restano validi: Penna con chiusura, trascinamento di un nodo, OK e riapertura', async ({ page }) => {
  await openNewProfile(page);
  // Le prove partono con la casella spenta: qui si accende dalla casella, come farebbe l\'utente
  const auto = editor(page).getByLabel('Vincoli automatici');
  await auto.check();
  await penTool(page).click();
  await drawClosedRect(page);
  // Due orizzontali e due verticali, compreso il lato di chiusura (dal quarto nodo al primo)
  await expect(editor(page).locator('[data-constraint-type="horizontal"]')).toHaveCount(2);
  await expect(editor(page).locator('[data-constraint-type="vertical"]')).toHaveCount(2);
  // Trascinare un nodo con Seleziona: il rettangolo resta un rettangolo e il nodo segue il mouse
  await editor(page).getByRole('button', { name: 'Seleziona', exact: true }).click();
  const before = await center(node(page, '0:2'));
  await dragBy(page, before, 60, -40);
  const after = await center(node(page, '0:2'));
  expect(after.x).toBeGreaterThan(before.x + 40);
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(4);
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const [id] = Object.keys((await sceneState(page)).nodes);
  const saved = await getNode(page, id);
  const p = saved.paths[0].nodes.map((n) => n.p);
  expect(saved.constraints).toHaveLength(4);
  expect(p[0][1]).toBeCloseTo(p[1][1], 3);
  expect(p[1][0]).toBeCloseTo(p[2][0], 3);
  expect(p[2][1]).toBeCloseTo(p[3][1], 3);
  expect(p[3][0]).toBeCloseTo(p[0][0], 3);
  // Riaperto: stessi vincoli, nessun conflitto
  await openEditor(page, id);
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(4);
  await expect(editor(page).locator('[data-constraint-type="vertical"]')).toHaveCount(2);
});

test('il valore predefinito dei vincoli automatici è acceso: senza la chiave nelle preferenze la casella è spuntata e la Penna li deduce', async ({ page }) => {
  // Preferenze salvate senza la chiave dei vincoli automatici (come prima di questa funzione): vale il predefinito, acceso
  await page.evaluate(() => localStorage.setItem('construct:ui', JSON.stringify({ state: { welcomeAlways: false }, version: 0 })));
  await page.reload();
  await page.waitForFunction(() => !!window.__construct && !!window.__r3f);
  expect(await page.evaluate(() => window.__construct!.ui.getState().profileAutoConstraints)).toBe(true);
  await openNewProfile(page);
  await expect(editor(page).getByLabel('Vincoli automatici')).toBeChecked();
  await penTool(page).click();
  await drawClosedRect(page);
  await expect(editor(page).locator('[data-constraint-type="horizontal"]')).toHaveCount(2);
  await expect(editor(page).locator('[data-constraint-type="vertical"]')).toHaveCount(2);
});

test('Rendi uguali con quote pilotanti diverse: la prima resta, la seconda diventa di riferimento e il quadrato è 40 x 40', async ({ page }) => {
  const id = await addProfile(page, FULL);
  await openEditor(page, id);
  const name = (k: string) => editor(page).locator(`[data-constraint="${k}"] .profile-editor__constraint-name`);
  await name('k6').click();
  await name('k7').click({ modifiers: ['Shift'] });
  await expect(editor(page).locator('[data-quote-group]')).toContainText('2 quote scelte');
  // Le due righe scelte sono premute anche per i lettori di schermo
  await expect(name('k6')).toHaveAttribute('aria-pressed', 'true');
  await expect(name('k7')).toHaveAttribute('aria-pressed', 'true');
  await editor(page).locator('[data-equalize]').click();
  // La seconda quota è di riferimento (misura tra parentesi, nessun campo da modificare), la prima è ancora pilotante
  await expect(editor(page).locator('[data-constraint="k7"]')).toContainText('quota di riferimento');
  await expect(editor(page).getByLabel('Valore di Distanza P1.1-P1.2')).toHaveValue('40');
  await expect(editor(page).getByLabel('Valore di Distanza P1.2-P1.3')).toHaveCount(0);
  await expect(editor(page).locator('[data-constraint-type="equal"]')).toHaveCount(1);
  await expect(editor(page).getByText('Completamente vincolato: 0 gradi di libertà')).toBeVisible();
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const saved = await getNode(page, id);
  expect(saved.paths[0].nodes[2].p[0]).toBeCloseTo(40, 3);
  expect(saved.paths[0].nodes[2].p[1]).toBeCloseTo(40, 3);
  const k7 = (saved.constraints as unknown as { id: string; ref?: boolean }[]).find((q) => q.id === 'k7');
  expect(k7?.ref).toBe(true);
});

test('Annulla riporta in un solo passo i valori di prima dopo il valore comune di più quote', async ({ page }) => {
  const id = await addProfile(page, FULL);
  await openEditor(page, id);
  const name = (k: string) => editor(page).locator(`[data-constraint="${k}"] .profile-editor__constraint-name`);
  await name('k6').click();
  await name('k7').click({ modifiers: ['Shift'] });
  const common = editor(page).getByLabel('Valore comune delle quote scelte');
  await common.fill('30');
  await common.press('Enter');
  await expect(editor(page).getByLabel('Valore di Distanza P1.1-P1.2')).toHaveValue('30');
  await expect(editor(page).getByLabel('Valore di Distanza P1.2-P1.3')).toHaveValue('30');
  // Un solo Ctrl+Z (con il fuoco sulla modale) rimette 40 e 20; Ctrl+Maiusc+Z li porta di nuovo a 30
  await editor(page).locator('.profile-editor').focus();
  await page.keyboard.press('Control+z');
  await expect(editor(page).getByLabel('Valore di Distanza P1.1-P1.2')).toHaveValue('40');
  await expect(editor(page).getByLabel('Valore di Distanza P1.2-P1.3')).toHaveValue('20');
  await page.keyboard.press('Control+Shift+z');
  await expect(editor(page).getByLabel('Valore di Distanza P1.1-P1.2')).toHaveValue('30');
  await expect(editor(page).getByLabel('Valore di Distanza P1.2-P1.3')).toHaveValue('30');
});

test('Penna digitata: Backspace e R nei campi non toccano il disegno né cambiano strumento', async ({ page }) => {
  await openNewProfile(page);
  await penTool(page).click();
  const c = await canvasCenter(page);
  await page.mouse.click(c.x, c.y);
  await expect(editor(page).getByText('0 contorni, 1 nodo')).toBeVisible();
  await page.keyboard.press('5');
  await expect(lengthField(page)).toBeFocused();
  // R è una lettera del campo: lo strumento Rettangolo non si accende e la Penna resta quella scelta
  await page.keyboard.press('r');
  await expect(lengthField(page)).toHaveValue('5r');
  await expect(editor(page).getByRole('button', { name: 'Rettangolo', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(penTool(page)).toHaveAttribute('aria-pressed', 'true');
  // Backspace cancella i caratteri del campo (anche a campo vuoto) e non toglie il nodo al contorno
  await page.keyboard.press('Backspace');
  await expect(lengthField(page)).toHaveValue('5');
  await page.keyboard.press('Backspace');
  await expect(lengthField(page)).toHaveValue('');
  await page.keyboard.press('Backspace');
  await expect(editor(page).getByText('0 contorni, 1 nodo')).toBeVisible();
  // Dopo Esc i campi spariscono e il nodo c\'è ancora; riprendendo a digitare i campi ripartono vuoti
  await page.keyboard.press('Escape');
  await expect(lengthField(page)).toHaveCount(0);
  await page.keyboard.press('7');
  await expect(lengthField(page)).toHaveValue('7');
  await expect(angleField(page)).toHaveValue('');
});

// --- Tappa 5: cerchio parametrico, parametri ed espressioni -------------------------------------------------------------

/** Volume del solido calcolato dal kernel (somma delle mesh), dopo che il calcolo è finito. */
async function solidVolume(page: Page): Promise<number> {
  await settled(page);
  return page.evaluate(() => window.__construct!.results.getState().meshes.reduce((v, m) => v + (m.volume ?? 0), 0));
}
const circleTool = (page: Page) => editor(page).getByRole('button', { name: 'Cerchio', exact: true });
const selectTool = (page: Page) => editor(page).getByRole('button', { name: 'Seleziona', exact: true });

test('foro circolare quotato: il cerchio nasce con la sua quota Ø, si porta a 10, si sposta dal centro e il volume è quello della piastra forata', async ({ page }) => {
  // Piastra 40 x 20 alta 5: 4000 mm3 senza foro
  const id = await addProfile(page, []);
  expect(await solidVolume(page)).toBeCloseTo(4000, 0);
  await openEditor(page, id);
  // Il cerchio si disegna dal centro (a metà della piastra) trascinando: nasce con la quota Ø
  await circleTool(page).click();
  const [a, c] = [await center(node(page, '0:0')), await center(node(page, '0:2'))];
  const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
  await dragBy(page, mid, 40, 0);
  await expect(labels(page)).toHaveCount(1);
  await expect(labels(page)).toContainText('Ø');
  await expect(editor(page).locator('[data-node="1:4"]')).toHaveCount(1);
  // Del cerchio si vedono il centro e il nodo sul bordo (gli altri tre nodi sono derivati)
  await expect(editor(page).locator('[data-node="1:0"]')).toHaveCount(1);
  await expect(editor(page).locator('[data-node="1:1"]')).toHaveCount(0);
  // Con Seleziona un clic sull'etichetta apre il campo del diametro: 10 (con lo strumento Cerchio un clic sull'etichetta inizierebbe un altro cerchio)
  await selectTool(page).click();
  await labels(page).click();
  await typeValue(page, '10');
  await expect(labels(page)).toHaveText('Ø10');
  // Seleziona: il centro si trascina e il cerchio si sposta intero, con lo stesso diametro
  await selectTool(page).click();
  const [before, edgeBefore] = [await center(node(page, '1:4')), await center(node(page, '1:0'))];
  await dragBy(page, before, 30, -10);
  const [after, edgeAfter] = [await center(node(page, '1:4')), await center(node(page, '1:0'))];
  expect(after.x - before.x).toBeGreaterThan(20);
  expect(edgeAfter.x - edgeBefore.x).toBeCloseTo(after.x - before.x, 0);
  await expect(labels(page)).toHaveText('Ø10');
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  // Salvato: due contorni, il secondo con il cerchio parametrico e la quota Ø (raggio 5, diametro)
  const saved = (await getNode(page, id)) as unknown as { paths: { circ?: { id: string; p: number[] }; nodes: { id?: string }[] }[]; constraints?: { t: string; v?: number; dia?: boolean }[] };
  expect(saved.paths).toHaveLength(2);
  expect(saved.paths[1].circ).toBeTruthy();
  expect(saved.paths[1].nodes.map((n) => !!n.id)).toEqual([true, false, false, false]);
  expect(saved.constraints!.filter((q) => q.dia)).toHaveLength(1);
  expect(saved.constraints!.find((q) => q.dia)!.v).toBeCloseTo(5, 6);
  // Volume: (800 - π·5²) · 5 = 3607,3 mm3 (il foro è un poligono: pochi mm3 di scarto)
  const volume = await solidVolume(page);
  expect(volume).toBeGreaterThan(3590);
  expect(volume).toBeLessThan(3625);
  // Riaperto: il cerchio c'è ancora, con la quota Ø10
  await openEditor(page, id);
  await expect(labels(page)).toHaveText('Ø10');
  await expect(editor(page).locator('[data-node="1:4"]')).toHaveCount(1);
});

test('quota con espressione: ƒ e il valore calcolato, il cambio del parametro ricalcola il disegno in un solo passo di Annulla, un\'espressione non valida non cambia nulla', async ({ page }) => {
  const id = await addProfile(page, SQUARED);
  await openEditor(page, id);
  // Il parametro larghezza = 40
  await editor(page).getByLabel('Nome del nuovo parametro').fill('larghezza');
  await editor(page).getByLabel('Valore del nuovo parametro').fill('40');
  await editor(page).locator('[data-param-add]').click();
  await expect(editor(page).locator('[data-param="larghezza"]')).toHaveCount(1);
  await expect(editor(page).getByLabel('Valore del parametro larghezza')).toHaveValue('40');
  // Una quota di larghezza scritta con il parametro: l'etichetta mostra ƒ
  await quoteTool(page).click();
  await clickSegment(page, '0:0', '0:1');
  await typeValue(page, 'larghezza');
  await expect(labels(page)).toHaveText('40 ƒ');
  await expect(editor(page).getByLabel('Valore di Distanza P1.1-P1.2')).toHaveValue('larghezza');
  // Cambiare il parametro: la quota e il disegno seguono, in un solo passo
  const width = editor(page).getByLabel('Valore del parametro larghezza');
  await width.fill('80');
  await width.press('Enter');
  await expect(labels(page)).toHaveText('80 ƒ');
  await expect(editor(page).getByLabel('Valore di Distanza P1.1-P1.2')).toHaveValue('larghezza');
  await editor(page).locator('.profile-editor').focus();
  await page.keyboard.press('Control+z');
  await expect(labels(page)).toHaveText('40 ƒ');
  await expect(editor(page).getByLabel('Valore del parametro larghezza')).toHaveValue('40');
  await page.keyboard.press('Control+Shift+z');
  await expect(labels(page)).toHaveText('80 ƒ');
  // Un'espressione più complessa dall'etichetta: larghezza/2 + 3 = 43
  await selectTool(page).click();
  await labels(page).click();
  await typeValue(page, 'larghezza/2 + 3');
  await expect(labels(page)).toHaveText('43 ƒ');
  // Un'espressione non valida o con un parametro sconosciuto non cambia nulla
  await labels(page).click();
  await typeValue(page, 'sconosciuto * 2');
  await expect(labels(page)).toHaveText('43 ƒ');
  await labels(page).click();
  await typeValue(page, 'larghezza +* 2');
  await expect(labels(page)).toHaveText('43 ƒ');
  // Un parametro usato da una quota non si elimina
  await editor(page).getByRole('button', { name: 'Elimina il parametro larghezza' }).click();
  await expect(editor(page).locator('[data-param="larghezza"]')).toHaveCount(1);
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const saved = (await getNode(page, id)) as unknown as { paths: { nodes: { p: [number, number] }[] }[]; params?: Record<string, number | string>; constraints?: { expr?: string; v?: number }[] };
  expect(saved.params).toEqual({ larghezza: 80 });
  const quote = saved.constraints!.find((q) => q.expr);
  expect(quote).toMatchObject({ expr: 'larghezza/2 + 3', v: 43 });
  expect(saved.paths[0].nodes[1].p[0]).toBeCloseTo(43, 3);
  // Riaperto: parametro e quota con espressione ci sono ancora (e il disegno non si risolve da solo)
  await openEditor(page, id);
  await expect(editor(page).getByLabel('Valore del parametro larghezza')).toHaveValue('80');
  await expect(labels(page)).toHaveText('43 ƒ');
});

test('un nome di parametro non valido o doppio e un valore con un ciclo si rifiutano e dicono perché', async ({ page }) => {
  const id = await addProfile(page, SQUARED);
  await openEditor(page, id);
  const add = async (name: string, value: string) => {
    await editor(page).getByLabel('Nome del nuovo parametro').fill(name);
    await editor(page).getByLabel('Valore del nuovo parametro').fill(value);
    await editor(page).locator('[data-param-add]').click();
  };
  await add('1a', '5');
  await expect(editor(page).locator('[data-param]')).toHaveCount(0);
  await add('a', '5');
  await expect(editor(page).locator('[data-param="a"]')).toHaveCount(1);
  await add('a', '6');
  await expect(editor(page).locator('[data-param]')).toHaveCount(1);
  await add('b', 'a + 1');
  await expect(editor(page).locator('[data-param="b"]')).toHaveCount(1);
  // Un ciclo (a usa b, b usa a): il valore resta com'era
  const a = editor(page).getByLabel('Valore del parametro a');
  await a.fill('b + 1');
  await a.press('Enter');
  await expect(a).toHaveValue('5');
});

test('il Raggio di raccordo accetta un\'espressione con i parametri del profilo (si ricorda il numero), e rifiuta un valore negativo', async ({ page }) => {
  const id = await addProfile(page, []);
  await openEditor(page, id);
  await editor(page).getByLabel('Nome del nuovo parametro').fill('rcurva');
  await editor(page).getByLabel('Valore del nuovo parametro').fill('8');
  await editor(page).locator('[data-param-add]').click();
  await clickNode(page, '0:1');
  const radius = editor(page).getByLabel('Raggio');
  await expect(radius).toHaveValue('0');
  await radius.fill('rcurva / 2');
  await radius.press('Enter');
  await expect(radius).toHaveValue('4');
  // Un valore negativo non si applica: il raggio resta 4
  await radius.fill('-3');
  await radius.press('Enter');
  await expect(radius).toHaveValue('4');
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const nodes = (await getNode(page, id)).paths[0].nodes as unknown as { r?: number }[];
  expect(nodes.map((n) => n.r)).toEqual([undefined, 4, undefined, undefined]);
});

test('Rendi uguali: resta la prima quota scelta (nell\'ordine dei clic) e l\'avviso lo dice; «Rendi pilotante» riporta una quota di riferimento a comandare', async ({ page }) => {
  const id = await addProfile(page, FULL);
  await openEditor(page, id);
  const name = (k: string) => editor(page).locator(`[data-constraint="${k}"] .profile-editor__constraint-name`);
  // Scelta prima l'altezza (k7, 20): resta lei, la larghezza (k6) diventa di riferimento e il quadrato è 20 x 20
  await name('k7').click();
  await name('k6').click({ modifiers: ['Shift'] });
  await editor(page).locator('[data-equalize]').click();
  await expect(page.getByText(/Resta pilotante Distanza P1\.2-P1\.3/)).toBeVisible();
  await expect(editor(page).locator('[data-constraint="k6"]')).toContainText('quota di riferimento');
  await expect(editor(page).getByLabel('Valore di Distanza P1.2-P1.3')).toHaveValue('20');
  // Con l'Uguale ancora lì, rendere pilotante la larghezza renderebbe il disegno sovravincolato: si rifiuta e resta di riferimento
  await editor(page).locator('[data-constraint="k6"] [data-make-driving]').click();
  await expect(editor(page).locator('[data-constraint="k6"]')).toContainText('quota di riferimento');
  // Tolto l'Uguale, la quota di riferimento diventa pilotante con la misura di adesso (20)
  await editor(page).locator('[data-constraint-type="equal"] button[aria-label^="Elimina"]').click();
  await editor(page).locator('[data-constraint="k6"] [data-make-driving]').click();
  await expect(editor(page).getByLabel('Valore di Distanza P1.1-P1.2')).toHaveValue('20');
  await expect(editor(page).locator('[data-constraint="k6"] [data-make-driving]')).toHaveCount(0);
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const saved = await getNode(page, id);
  expect(saved.paths[0].nodes[2].p[0]).toBeCloseTo(20, 3);
  expect(saved.paths[0].nodes[2].p[1]).toBeCloseTo(20, 3);
});

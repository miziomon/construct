import { expect, test, type Page } from '@playwright/test';
import { openApp, sceneState, settled } from './helpers';

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

async function addProfile(page: Page, constraints: unknown[]): Promise<string> {
  const id = await page.evaluate(([paths, cons]) => window.__construct!.store.getState().addPath({ paths: paths as never, constraints: cons as never, height: 5 }), [RECT, constraints] as const);
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

test('Alt+clic su un segmento sceglie i suoi due nodi: Orizzontale si applica a quel lato con un clic', async ({ page }) => {
  const id = await addProfile(page, []);
  await openEditor(page, id);
  const horizontal = editor(page).locator('[data-constraint-button="horizontal"]');
  await expect(horizontal).toBeDisabled();
  // Un clic normale su un segmento sceglie tutto il contorno; con Alt solo i due nodi del segmento
  const [a, b] = [await center(node(page, '0:1')), await center(node(page, '0:2'))];
  await page.keyboard.down('Alt');
  await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
  await page.keyboard.up('Alt');
  await expect(editor(page).locator('.profile-editor__node--selected')).toHaveCount(2);
  await expect(node(page, '0:1')).toHaveClass(/profile-editor__node--selected/);
  await expect(node(page, '0:2')).toHaveClass(/profile-editor__node--selected/);
  await expect(horizontal).toBeEnabled();
  await editor(page).locator('[data-constraint-button="vertical"]').click();
  await expect(editor(page).locator('[data-constraint]')).toHaveCount(1);
  await ok(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  // B (40, 0) e C (40, 20) erano già sulla stessa verticale: il vincolo non muove nulla
  const saved = await getNode(page, id);
  expect(saved.constraints).toHaveLength(1);
  expect(saved.paths[0].nodes[1].p[0]).toBeCloseTo(saved.paths[0].nodes[2].p[0], 3);
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

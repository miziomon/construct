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

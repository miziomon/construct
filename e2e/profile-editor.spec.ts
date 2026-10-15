import { expect, test, type Page } from '@playwright/test';
import { openApp, sceneState, settled } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

/** Rettangolo con un lato curvo: A (0,0) e D (0,30) spigoli, B (40,0) e C (40,30) lisci con maniglie verso destra. Centro del riquadro: x = 23,75, y = 15. */
const PATHS = [
  {
    closed: true,
    nodes: [
      { p: [0, 0], kind: 'corner' },
      { p: [40, 0], out: [10, 8], kind: 'smooth' },
      { p: [40, 30], in: [10, -8], kind: 'smooth' },
      { p: [0, 30], kind: 'corner' },
    ],
  },
];

/** Rettangolo senza curve, per i casi che non ne hanno bisogno. */
const RECT = [
  {
    closed: true,
    nodes: [
      { p: [0, 0], kind: 'corner' },
      { p: [40, 0], kind: 'corner' },
      { p: [40, 20], kind: 'corner' },
      { p: [0, 20], kind: 'corner' },
    ],
  },
];

type Node = { paths: { nodes: { p: [number, number] }[] }[]; position: [number, number, number]; width: number; depth: number; extrusion?: string };

async function addPath(page: Page, paths: unknown = RECT, at?: [number, number]): Promise<string> {
  const id = await page.evaluate(([p, pos]) => window.__construct!.store.getState().addPath({ paths: p as never, height: 5, at: pos as [number, number] | undefined }), [paths, at] as const);
  await settled(page);
  return id;
}

/** Apre la modale su un nodo (il comando e la voce di libreria arrivano più avanti) e attende il disegno. */
async function openEditor(page: Page, id: string) {
  await page.evaluate((nodeId) => window.__construct!.profileEditor.getState().open({ nodeId }), id);
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).locator('[data-node]').first()).toBeVisible();
}

/** La modale del Profilo (le altre finestre sono <dialog> di conferma: i locator restano limitati a questa). */
const editor = (page: Page) => page.locator('dialog.modal[open]');
const confirmBox = (page: Page) => page.locator('dialog.dialog[open]');
const node = (page: Page, ref: string) => editor(page).locator(`[data-node="${ref}"]`);
const history = (page: Page) => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);
const volume = (page: Page) => page.evaluate(() => window.__construct!.results.getState().meshes.reduce((v, m) => v + (m.volume ?? 0), 0));
const getNode = async (page: Page, id: string) => (await sceneState(page)).nodes[id] as Node;

/** Centro di un elemento in pixel di pagina. */
async function center(locator: ReturnType<typeof node>) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Trascina dal punto a un altro con piccoli passi, come una persona. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await page.mouse.up();
}

/** Pixel per millimetro del disegno, dai nodi A (0,0) e B (40,0) del rettangolo. */
async function pixelsPerMm(page: Page) {
  const [a, b] = [await center(node(page, '0:0')), await center(node(page, '0:1'))];
  return (b.x - a.x) / 40;
}

test('apertura da un nodo Profilo: disegno, nodi, conteggi nel piede, la scena non cambia', async ({ page }) => {
  const id = await addPath(page);
  const before = await history(page);
  await openEditor(page, id);
  await expect(editor(page).locator('[data-node]')).toHaveCount(4);
  await expect(editor(page).getByText('1 contorno, 4 nodi')).toBeVisible();
  await expect(editor(page).getByText('Nessun avviso')).toBeVisible();
  // Forme diverse per tipo: lo spigolo è un quadrato
  await expect(node(page, '0:0').locator('rect')).toHaveCount(1);
  expect(await history(page)).toBe(before);
});

test('trascinare un nodo e premere OK: un solo passo "Profilo", posizione compensata, Ctrl+Z ripristina tutto', async ({ page }) => {
  const id = await addPath(page, RECT, [10, 20]);
  const start = await getNode(page, id);
  const steps = await history(page);
  await openEditor(page, id);
  const k = await pixelsPerMm(page);
  // Porta il nodo C (40,20) a circa (50,20)
  const c = await center(node(page, '0:2'));
  await drag(page, c, { x: c.x + 10 * k, y: c.y });
  // Con la modale aperta la cronologia della scena non cambia
  expect(await history(page)).toBe(steps);
  await editor(page).getByRole('button', { name: 'OK', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const after = await getNode(page, id);
  expect(await history(page)).toBe(steps + 1);
  expect(await page.evaluate(() => window.__construct!.store.getState().op)).toBe('Profilo');
  // Il nodo si è spostato (agganciato alla griglia di 1 mm)
  const moved = after.paths[0].nodes[2].p;
  expect(moved[0]).toBeGreaterThan(48);
  expect(moved[0]).toBeLessThan(52);
  expect(moved[1]).toBeCloseTo(20, 3);
  // Il centro del riquadro è passato da (20, 10) a (moved.x / 2, 10): il nodo compensa, le parti invariate restano ferme
  expect(after.position[0]).toBeCloseTo(start.position[0] + (moved[0] / 2 - 20), 3);
  expect(after.position[1]).toBeCloseTo(start.position[1], 3);
  expect(after.position[2]).toBeCloseTo(start.position[2], 3);
  // Ctrl+Z della scena: un solo passo riporta tutto com'era
  await page.keyboard.press('Control+z');
  expect(await history(page)).toBe(steps);
  const undone = await getNode(page, id);
  expect(undone.paths).toEqual(start.paths);
  expect(undone.position).toEqual(start.position);
});

test('OK senza modifiche e senza scala da incorporare non scrive nulla', async ({ page }) => {
  const id = await addPath(page);
  const steps = await history(page);
  await openEditor(page, id);
  await editor(page).getByRole('button', { name: 'OK', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  expect(await history(page)).toBe(steps);
});

test('profilo ingrandito col gizmo: la scala si incorpora e un OK senza modifiche lascia riquadro, posizione e larghezza', async ({ page }) => {
  const id = await addPath(page, RECT, [5, 5]);
  // Ingrandito al doppio (la scala sta in width e depth: i nodi sono quelli originali)
  await page.evaluate((nodeId) => window.__construct!.store.getState().updateNode(nodeId, { width: 80, depth: 40 }), id);
  await settled(page);
  const start = await getNode(page, id);
  const steps = await history(page);
  await openEditor(page, id);
  // Nel disegno il rettangolo misura 80 mm: lo si vede dalla distanza tra i nodi A e B
  const k = await pixelsPerMm(page);
  const [a, b] = [await center(node(page, '0:0')), await center(node(page, '0:1'))];
  expect((b.x - a.x) / k).toBeCloseTo(40, 3);
  await editor(page).getByRole('button', { name: 'OK', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const after = await getNode(page, id);
  expect(await history(page)).toBe(steps + 1);
  expect(after.width).toBeCloseTo(80, 3);
  expect(after.depth).toBeCloseTo(40, 3);
  expect(after.position).toEqual(start.position);
  // I nodi hanno ora la misura vera: Scala 100%
  const xs = after.paths[0].nodes.map((n) => n.p[0]);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(80, 3);
});

test('Esc con modifiche chiede conferma: Annulla lascia aperto, due Esc di fila non chiudono, confermando la scena resta invariata e la bozza sparisce', async ({ page }) => {
  const id = await addPath(page);
  const start = await getNode(page, id);
  const steps = await history(page);
  await openEditor(page, id);
  const k = await pixelsPerMm(page);
  const c = await center(node(page, '0:2'));
  await drag(page, c, { x: c.x + 5 * k, y: c.y });
  // Primo Esc: conferma
  await page.keyboard.press('Escape');
  await expect(confirmBox(page)).toBeVisible();
  await expect(confirmBox(page)).toContainText('Chiudere senza salvare il profilo?');
  // Secondo Esc di fila: annulla la conferma, la modale resta
  await page.keyboard.press('Escape');
  await expect(confirmBox(page)).toHaveCount(0);
  await expect(editor(page)).toBeVisible();
  // Il pulsante Annulla della conferma lascia aperto
  await page.keyboard.press('Escape');
  await confirmBox(page).getByRole('button', { name: 'Annulla' }).click();
  await expect(editor(page)).toBeVisible();
  // Confermando si chiude senza toccare la scena, e la bozza è eliminata
  await editor(page).getByRole('button', { name: 'Annulla', exact: true }).click();
  await confirmBox(page).getByRole('button', { name: 'Chiudi' }).click();
  await expect(editor(page)).toHaveCount(0);
  expect(await history(page)).toBe(steps);
  expect((await getNode(page, id)).paths).toEqual(start.paths);
  await page.waitForTimeout(700);
  expect(await page.evaluate((nodeId) => localStorage.getItem(`construct:profile-draft:${nodeId}`), id)).toBeNull();
});

test('Esc senza modifiche chiude subito', async ({ page }) => {
  const id = await addPath(page);
  await openEditor(page, id);
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  await expect(confirmBox(page)).toHaveCount(0);
});

test('l\'evento cancel del dialog (Esc con il focus fuori dal disegno) passa dalla stessa conferma', async ({ page }) => {
  const id = await addPath(page);
  await openEditor(page, id);
  const k = await pixelsPerMm(page);
  const c = await center(node(page, '0:2'));
  await drag(page, c, { x: c.x + 5 * k, y: c.y });
  await editor(page).evaluate((d) => d.dispatchEvent(new Event('cancel', { cancelable: true })));
  await expect(confirmBox(page)).toContainText('Chiudere senza salvare il profilo?');
  await confirmBox(page).getByRole('button', { name: 'Annulla' }).click();
  await expect(editor(page)).toBeVisible();
});

test('Backspace nel campo X modifica il testo e non elimina il nodo; fuori dal campo elimina il nodo selezionato', async ({ page }) => {
  const id = await addPath(page);
  await openEditor(page, id);
  await node(page, '0:1').click();
  const x = editor(page).locator('.number-field').filter({ hasText: 'X' }).locator('input');
  await expect(x).toHaveValue('40');
  await x.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await expect(x).toHaveValue('4');
  await expect(editor(page).locator('[data-node]')).toHaveCount(4);
  // Esc nel campo agisce solo sul campo: la modale non chiede di chiudersi (il campo esce dalla modifica)
  await page.keyboard.press('Escape');
  await expect(confirmBox(page)).toHaveCount(0);
  await expect(editor(page)).toBeVisible();
  // Fuori dal campo Canc elimina il nodo selezionato
  await editor(page).locator('.profile-editor__canvas').focus();
  await page.keyboard.press('Delete');
  await expect(editor(page).locator('[data-node]')).toHaveCount(3);
  // Ctrl+Z della modale lo riporta
  await page.keyboard.press('Control+z');
  await expect(editor(page).locator('[data-node]')).toHaveCount(4);
  await page.keyboard.press('Control+Shift+z');
  await expect(editor(page).locator('[data-node]')).toHaveCount(3);
});

test('il clic su un segmento curvo aggiunge un nodo senza cambiare la forma (volume entro 1e-3)', async ({ page }) => {
  const id = await addPath(page, PATHS);
  const volumeBefore = await volume(page);
  expect(volumeBefore).toBeGreaterThan(1000);
  await openEditor(page, id);
  // Punto a metà del segmento B -> C: la cubica (40,0) (50,8) (50,22) (40,30) passa per (47,5, 15)
  const [a, b] = [await center(node(page, '0:0')), await center(node(page, '0:1'))];
  const k = (b.x - a.x) / 40;
  await page.mouse.click(a.x + 47.5 * k, a.y - 15 * k);
  await expect(editor(page).locator('[data-node]')).toHaveCount(5);
  await expect(editor(page).getByText('1 contorno, 5 nodi')).toBeVisible();
  await editor(page).getByRole('button', { name: 'OK', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  expect(Math.abs((await volume(page)) - volumeBefore) / volumeBefore).toBeLessThan(1e-3);
  expect((await getNode(page, id)).paths[0].nodes).toHaveLength(5);
});

test('doppio clic su un nodo scorre il tipo; il cambio è un passo della cronologia locale', async ({ page }) => {
  const id = await addPath(page, PATHS);
  await openEditor(page, id);
  await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'corner');
  await node(page, '0:0').dblclick();
  await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'smooth');
  await node(page, '0:0').dblclick();
  await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'symmetric');
  await page.keyboard.press('Control+z');
  await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'smooth');
});

test('riquadro di selezione, Maiusc e frecce: i nodi selezionati si spostano di un passo di griglia', async ({ page }) => {
  const id = await addPath(page);
  await openEditor(page, id);
  const [a, c] = [await center(node(page, '0:0')), await center(node(page, '0:2'))];
  // Riquadro che prende tutti i nodi
  await drag(page, { x: a.x - 40, y: a.y + 40 }, { x: c.x + 40, y: c.y - 40 });
  await expect(editor(page).locator('.profile-editor__node--selected')).toHaveCount(4);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowUp');
  await editor(page).getByRole('button', { name: 'OK', exact: true }).click();
  await settled(page);
  const after = await getNode(page, id);
  // Spostando tutto insieme il disegno resta uguale: nessun cambio di misure, solo il centro (compensato)
  expect(after.paths[0].nodes[0].p).toEqual([1, 10]);
  expect(after.width).toBeCloseTo(40, 3);
});

test('rotazionale: compare l\'asse di rotazione, l\'OK scrive extrusion rotate', async ({ page }) => {
  const id = await addPath(page);
  await openEditor(page, id);
  await expect(editor(page).getByText('asse di rotazione')).toHaveCount(0);
  await editor(page).getByRole('button', { name: 'Rotazionale' }).click();
  await expect(editor(page).getByText('asse di rotazione')).toBeVisible();
  await editor(page).getByRole('button', { name: 'OK', exact: true }).click();
  await settled(page);
  expect((await getNode(page, id)).extrusion).toBe('rotate');
});

test('bozza: modifica, ricarica senza OK, riapertura con la proposta di ripristino', async ({ page }) => {
  const id = await addPath(page);
  // Lascia al salvataggio della scena il tempo di scrivere
  await page.waitForTimeout(800);
  await openEditor(page, id);
  const k = await pixelsPerMm(page);
  const c = await center(node(page, '0:2'));
  await drag(page, c, { x: c.x + 10 * k, y: c.y });
  // Ricarica subito: il salvataggio in attesa parte alla chiusura della pagina
  await page.reload();
  await page.waitForFunction(() => !!window.__construct && !!window.__r3f);
  await page.waitForFunction((nodeId) => !!window.__construct!.store.getState().scene.nodes[nodeId], id);
  await settled(page);
  await page.evaluate((nodeId) => window.__construct!.profileEditor.getState().open({ nodeId }), id);
  await expect(confirmBox(page)).toContainText('Ripristinare il disegno non salvato?');
  await confirmBox(page).getByRole('button', { name: 'Ripristina' }).click();
  await expect(editor(page)).toBeVisible();
  // Il disegno ripristinato ha il nodo spostato: l'OK lo scrive nella scena
  await editor(page).getByRole('button', { name: 'OK', exact: true }).click();
  await settled(page);
  const moved = (await getNode(page, id)).paths[0].nodes[2].p;
  expect(moved[0]).toBeGreaterThan(48);
  // Dopo l'OK la bozza non c'è più
  await page.waitForTimeout(700);
  expect(await page.evaluate((nodeId) => localStorage.getItem(`construct:profile-draft:${nodeId}`), id)).toBeNull();
});

test('rifiutare il ripristino elimina la bozza e apre il disegno della scena', async ({ page }) => {
  const id = await addPath(page);
  await page.waitForTimeout(800);
  await openEditor(page, id);
  const k = await pixelsPerMm(page);
  const c = await center(node(page, '0:2'));
  await drag(page, c, { x: c.x + 10 * k, y: c.y });
  await page.reload();
  await page.waitForFunction(() => !!window.__construct && !!window.__r3f);
  await page.waitForFunction((nodeId) => !!window.__construct!.store.getState().scene.nodes[nodeId], id);
  await page.evaluate((nodeId) => window.__construct!.profileEditor.getState().open({ nodeId }), id);
  await confirmBox(page).getByRole('button', { name: 'Annulla' }).click();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).locator('[data-node]').first()).toBeVisible();
  // Senza modifiche, Esc chiude subito: la bozza rifiutata non fa risultare il disegno modificato
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  expect(await page.evaluate((nodeId) => localStorage.getItem(`construct:profile-draft:${nodeId}`), id)).toBeNull();
});

test('un Profilo nuovo (senza contorni) si apre vuoto con OK disattivato; Annulla chiude senza lasciare nodi', async ({ page }) => {
  const steps = await history(page);
  await page.evaluate(() => window.__construct!.profileEditor.getState().open({ new: true }));
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).locator('[data-node]')).toHaveCount(0);
  await expect(editor(page).getByRole('button', { name: 'OK', exact: true })).toBeDisabled();
  await editor(page).getByRole('button', { name: 'Annulla', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  expect(await history(page)).toBe(steps);
  expect((await sceneState(page)).rootIds).toHaveLength(0);
});

test('con la modale aperta le scorciatoie dell\'app non agiscono sulla scena', async ({ page }) => {
  const id = await addPath(page);
  await openEditor(page, id);
  await node(page, '0:1').click();
  const nodes = () => page.evaluate(() => Object.keys(window.__construct!.store.getState().scene.nodes).length);
  expect(await nodes()).toBe(1);
  // Con il focus sul disegno: P (piano), L (blocco), Canc non toccano la scena
  await page.keyboard.press('l');
  await page.keyboard.press('Delete');
  expect(await nodes()).toBe(1);
  expect((await getNode(page, id) as unknown as { locked?: boolean }).locked).toBeFalsy();
  // E il Delete della modale ha tolto il nodo del disegno, non l'oggetto
  await expect(editor(page).locator('[data-node]')).toHaveCount(3);
});

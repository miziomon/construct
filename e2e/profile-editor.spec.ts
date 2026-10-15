import { expect, test, type Page } from '@playwright/test';
import { openApp, readCode, sceneState, settled } from './helpers';

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
  // Bug noto di NumberField (docs/da-fare.md): Esc conferma il testo modificato invece di annullarlo, quindi X resta 4 e il
  // nodo si è spostato. Se il bug viene corretto questa asserzione va cambiata in 40
  await expect(x).toHaveValue('4');
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

test('Penna: il clic su un segmento curvo aggiunge un nodo senza cambiare la forma (volume entro 1e-3)', async ({ page }) => {
  const id = await addPath(page, PATHS);
  const volumeBefore = await volume(page);
  expect(volumeBefore).toBeGreaterThan(1000);
  await openEditor(page, id);
  await editor(page).getByRole('button', { name: 'Penna' }).click();
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

const selectedNodes = (page: Page) => editor(page).locator('.profile-editor__node--selected');
const insertDot = (page: Page) => editor(page).locator('.profile-editor__insert');

/** Due contorni aperti diritti, uno sopra l'altro: A (0,0)-(20,0)-(40,0) e B (0,30)-(20,30)-(40,30). */
const TWO_OPEN = [
  { closed: false, nodes: [{ p: [0, 0], kind: 'corner' }, { p: [20, 0], kind: 'corner' }, { p: [40, 0], kind: 'corner' }] },
  { closed: false, nodes: [{ p: [0, 30], kind: 'corner' }, { p: [20, 30], kind: 'corner' }, { p: [40, 30], kind: 'corner' }] },
];

/** Apre l'editor su TWO_OPEN e restituisce i pixel per millimetro (tra A0 e A2, 40 mm). */
async function openTwoOpen(page: Page) {
  const id = await addPath(page, TWO_OPEN);
  await openEditor(page, id);
  return (((await center(node(page, '0:2'))).x - (await center(node(page, '0:0'))).x) / 40);
}

test('Seleziona: il clic su una curva seleziona tutto il contorno e non aggiunge nodi; Canc lo elimina in un solo passo', async ({ page }) => {
  const k = await openTwoOpen(page);
  const a = await center(node(page, '0:0'));
  await page.mouse.click(a.x + 10 * k, a.y);
  await expect(editor(page).locator('[data-node]')).toHaveCount(6);
  await expect(selectedNodes(page)).toHaveCount(3);
  await expect(editor(page).locator('[data-node="0:0"].profile-editor__node--selected')).toHaveCount(1);
  await page.keyboard.press('Delete');
  await expect(editor(page).locator('[data-node]')).toHaveCount(3);
  await expect(editor(page).locator('[data-node="0:0"]')).toHaveAttribute('data-kind', 'corner');
  // Un solo passo: Ctrl+Z riporta il contorno
  await page.keyboard.press('Control+z');
  await expect(editor(page).locator('[data-node]')).toHaveCount(6);
});

test('Seleziona: Maiusc+clic somma o toglie un contorno; il clic nel vuoto azzera', async ({ page }) => {
  const k = await openTwoOpen(page);
  const a = await center(node(page, '0:0'));
  await page.mouse.click(a.x + 10 * k, a.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(a.x + 10 * k, a.y - 30 * k);
  await page.keyboard.up('Shift');
  await expect(selectedNodes(page)).toHaveCount(6);
  await page.keyboard.down('Shift');
  await page.mouse.click(a.x + 10 * k, a.y);
  await page.keyboard.up('Shift');
  await expect(selectedNodes(page)).toHaveCount(3);
  await page.mouse.click(a.x + 10 * k, a.y - 15 * k);
  await expect(selectedNodes(page)).toHaveCount(0);
});

test('Seleziona: trascinare la curva sposta tutto il contorno in un solo passo', async ({ page }) => {
  const k = await openTwoOpen(page);
  const [a0, a2, b0] = [await center(node(page, '0:0')), await center(node(page, '0:2')), await center(node(page, '1:0'))];
  await drag(page, { x: a0.x + 10 * k, y: a0.y }, { x: a0.x + 10 * k, y: a0.y - 10 * k });
  const [m0, m2, n0] = [await center(node(page, '0:0')), await center(node(page, '0:2')), await center(node(page, '1:0'))];
  expect(Math.abs(m0.y - (a0.y - 10 * k))).toBeLessThan(2);
  expect(Math.abs(m2.y - (a2.y - 10 * k))).toBeLessThan(2);
  expect(Math.abs(m0.x - a0.x)).toBeLessThan(2);
  // L'altro contorno non si muove
  expect(Math.abs(n0.y - b0.y)).toBeLessThan(1);
  await page.keyboard.press('Control+z');
  const back = await center(node(page, '0:0'));
  expect(Math.abs(back.y - a0.y)).toBeLessThan(1);
});

test('Penna: il pallino compare sulla curva, sparisce lontano e con Ctrl premuto (anche a mouse fermo); con Ctrl il clic non inserisce', async ({ page }) => {
  const k = await openTwoOpen(page);
  await editor(page).getByRole('button', { name: 'Penna' }).click();
  const a = await center(node(page, '0:0'));
  await page.mouse.move(a.x + 10 * k, a.y + 2);
  await expect(insertDot(page)).toHaveCount(1);
  // Lontano dalle curve e vicino a un nodo non c'è
  await page.mouse.move(a.x + 10 * k, a.y - 15 * k);
  await expect(insertDot(page)).toHaveCount(0);
  await page.mouse.move(a.x + 4, a.y + 2);
  await expect(insertDot(page)).toHaveCount(0);
  // Ctrl lo toglie a mouse fermo e lo riporta al rilascio
  await page.mouse.move(a.x + 10 * k, a.y + 2);
  await expect(insertDot(page)).toHaveCount(1);
  await page.keyboard.down('Control');
  await expect(insertDot(page)).toHaveCount(0);
  await page.keyboard.up('Control');
  await expect(insertDot(page)).toHaveCount(1);
  // Il clic inserisce sulla curva, in un contorno già finito: 7 nodi, 2 contorni
  await page.mouse.click(a.x + 10 * k, a.y + 2);
  await expect(editor(page).locator('[data-node]')).toHaveCount(7);
  await expect(editor(page).locator('[data-path]')).toHaveCount(2);
});

test('Penna: con Ctrl premuto il clic su una curva non inserisce, inizia un nuovo contorno', async ({ page }) => {
  const k = await openTwoOpen(page);
  await editor(page).getByRole('button', { name: 'Penna' }).click();
  const a = await center(node(page, '0:0'));
  await page.keyboard.down('Control');
  await page.mouse.click(a.x + 10 * k, a.y + 2);
  await page.keyboard.up('Control');
  await expect(editor(page).locator('[data-path]')).toHaveCount(3);
});

test('Penna: con un contorno in corso le curve non inseriscono nodi, il clic prosegue il contorno', async ({ page }) => {
  const k = await openTwoOpen(page);
  await editor(page).getByRole('button', { name: 'Penna' }).click();
  const a = await center(node(page, '0:0'));
  // Nuovo contorno lontano, poi un clic sulla curva del contorno A: aggiunge un nodo al contorno in corso
  await page.mouse.click(a.x - 20, a.y - 15 * k);
  await expect(insertDot(page)).toHaveCount(0);
  await page.mouse.move(a.x + 10 * k, a.y + 2);
  await expect(insertDot(page)).toHaveCount(0);
  await page.mouse.click(a.x + 10 * k, a.y + 2);
  await expect(editor(page).locator('[data-path]')).toHaveCount(3);
  await expect(editor(page).locator('[data-node]')).toHaveCount(8);
});

test('Penna: il clic su un estremo aperto riprende il contorno, anche dal primo nodo', async ({ page }) => {
  const k = await openTwoOpen(page);
  await editor(page).getByRole('button', { name: 'Penna' }).click();
  const a0 = await center(node(page, '0:0'));
  // Dall'ultimo nodo
  const a2 = await center(node(page, '0:2'));
  await page.mouse.move(a2.x, a2.y);
  await expect(editor(page).locator('.profile-editor__node--resume')).toHaveCount(1);
  await page.mouse.click(a2.x, a2.y);
  await page.mouse.click(a2.x + 5 * k, a2.y - 8 * k);
  await expect(editor(page).locator('[data-node]')).toHaveCount(7);
  await expect(editor(page).locator('[data-path]')).toHaveCount(2);
  await expect(editor(page).locator('[data-node="0:3"]')).toHaveCount(1);
  await page.keyboard.press('Enter');
  // Dal primo nodo: il nuovo nodo si accoda a quel lato
  await page.mouse.click(a0.x, a0.y);
  await page.mouse.click(a0.x - 6 * k, a0.y - 4 * k);
  await page.keyboard.press('Enter');
  await expect(editor(page).locator('[data-node]')).toHaveCount(8);
  await expect(editor(page).locator('[data-path]')).toHaveCount(2);
  // Il contorno si è invertito: il nuovo nodo è l'ultimo e sta a sinistra del vecchio primo nodo
  const [oldFirst, added] = [await center(node(page, '0:3')), await center(node(page, '0:4'))];
  expect(added.x).toBeLessThan(oldFirst.x);
});

test('Penna: riprendere un contorno e terminarlo senza aggiungere nulla lascia il disegno com\'era', async ({ page }) => {
  await openTwoOpen(page);
  await editor(page).getByRole('button', { name: 'Penna' }).click();
  const a0 = await center(node(page, '0:0'));
  await page.mouse.click(a0.x, a0.y);
  await page.keyboard.press('Enter');
  // Il contorno ha l'ordine originale e Ctrl+Z non ha passi da annullare
  const after = await center(node(page, '0:0'));
  expect(Math.abs(after.x - a0.x)).toBeLessThan(1);
  await page.keyboard.press('Control+z');
  await expect(editor(page).locator('[data-node]')).toHaveCount(6);
  expect(Math.abs((await center(node(page, '0:0'))).x - a0.x)).toBeLessThan(1);
});

test('Penna: riprendere un estremo e trascinare ne disegna la maniglia in uscita, liscio (spigolo con Alt)', async ({ page }) => {
  const k = await openTwoOpen(page);
  await editor(page).getByRole('button', { name: 'Penna' }).click();
  const a2 = await center(node(page, '0:2'));
  await page.mouse.move(a2.x, a2.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(a2.x + 3 * k * (i / 6) + 5, a2.y - 3 * k * (i / 6) - 5);
  await expect(node(page, '0:2')).toHaveAttribute('data-kind', 'smooth');
  await expect(editor(page).locator('[data-handle="0:2:out"]')).toHaveCount(1);
  await page.keyboard.down('Alt');
  await expect(node(page, '0:2')).toHaveAttribute('data-kind', 'corner');
  await page.keyboard.up('Alt');
  await expect(node(page, '0:2')).toHaveAttribute('data-kind', 'smooth');
  await page.mouse.up();
});

test('Penna: con un contorno in corso, il clic sull\'estremo di un altro contorno aperto li unisce e il disegno prosegue', async ({ page }) => {
  await openTwoOpen(page);
  await editor(page).getByRole('button', { name: 'Penna' }).click();
  const [a2, b2] = [await center(node(page, '0:2')), await center(node(page, '1:2'))];
  await page.mouse.click(a2.x, a2.y);
  await page.mouse.click(b2.x, b2.y);
  await expect(editor(page).locator('[data-path]')).toHaveCount(1);
  await expect(editor(page).locator('[data-node]')).toHaveCount(6);
  // Il disegno prosegue dall'altro estremo di B
  const b0 = await center(node(page, '5:0').or(node(page, '0:5')));
  await page.mouse.click(b0.x - 30, b0.y - 30);
  await expect(editor(page).locator('[data-node]')).toHaveCount(7);
  await expect(editor(page).locator('[data-path]')).toHaveCount(1);
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

test('Seleziona: un contorno selezionato si trascina anche dal riempimento; se non è selezionato lo stesso gesto è un riquadro', async ({ page }) => {
  const id = await addPath(page);
  await openEditor(page, id);
  const [a, b] = [await center(node(page, '0:0')), await center(node(page, '0:1'))];
  const k = (b.x - a.x) / 40;
  const inside = { x: a.x + 20 * k, y: a.y - 10 * k };
  // Non selezionato: il trascinamento dall'interno fa un riquadro e non sposta nulla
  await drag(page, inside, { x: inside.x + 5 * k, y: inside.y - 3 * k });
  expect(Math.abs((await center(node(page, '0:0'))).x - a.x)).toBeLessThan(1);
  // Selezionato con un clic sulla curva: dall'interno lo si sposta, in un solo passo
  await page.mouse.click(a.x + 20 * k, a.y);
  await expect(selectedNodes(page)).toHaveCount(4);
  await drag(page, inside, { x: inside.x + 10 * k, y: inside.y - 5 * k });
  const moved = await center(node(page, '0:0'));
  expect(Math.abs(moved.x - (a.x + 10 * k))).toBeLessThan(3);
  expect(Math.abs(moved.y - (a.y - 5 * k))).toBeLessThan(3);
  expect(Math.abs((await center(node(page, '0:2'))).x - (b.x + 10 * k))).toBeLessThan(3);
  await page.keyboard.press('Control+z');
  expect(Math.abs((await center(node(page, '0:0'))).x - a.x)).toBeLessThan(1);
});

test('Sposta vista: il tasto H attiva la mano, il trascinamento sposta la vista senza selezionare né spostare nodi; V torna a Seleziona', async ({ page }) => {
  const id = await addPath(page);
  await openEditor(page, id);
  const a = await center(node(page, '0:0'));
  await page.keyboard.press('h');
  await expect(editor(page).getByRole('button', { name: 'Sposta vista' })).toHaveAttribute('aria-pressed', 'true');
  await drag(page, { x: a.x + 30, y: a.y + 30 }, { x: a.x + 80, y: a.y + 10 });
  const after = await center(node(page, '0:0'));
  expect(Math.abs(after.x - (a.x + 50))).toBeLessThan(2);
  expect(Math.abs(after.y - (a.y - 20))).toBeLessThan(2);
  // Anche partendo da un nodo: la vista si sposta, il nodo non si seleziona e non si muove rispetto al disegno
  await drag(page, after, { x: after.x - 40, y: after.y });
  await expect(selectedNodes(page)).toHaveCount(0);
  await page.keyboard.press('v');
  await expect(editor(page).getByRole('button', { name: 'Seleziona' })).toHaveAttribute('aria-pressed', 'true');
  // Con Sposta vista nulla è cambiato nei dati: il Profilo non ha passi nella scena
  expect((await getNode(page, id)).paths[0].nodes.map((n) => n.p)).toEqual([[0, 0], [40, 0], [40, 20], [0, 20]]);
});

test('tasto destro + trascina: sposta la vista in tutto il disegno, anche nella parte non ruotata, senza cambiare la selezione', async ({ page }) => {
  const id = await addPath(page);
  await openEditor(page, id);
  await node(page, '0:1').click();
  const a = await center(node(page, '0:0'));
  await page.mouse.move(a.x + 60, a.y + 60);
  await page.mouse.down({ button: 'right' });
  for (let i = 1; i <= 6; i++) await page.mouse.move(a.x + 60 + 10 * i, a.y + 60 - 5 * i);
  await page.mouse.up({ button: 'right' });
  const after = await center(node(page, '0:0'));
  expect(Math.abs(after.x - (a.x + 60))).toBeLessThan(2);
  expect(Math.abs(after.y - (a.y - 30))).toBeLessThan(2);
  await expect(selectedNodes(page)).toHaveCount(1);
  await expect(editor(page).locator('[data-node="0:1"].profile-editor__node--selected')).toHaveCount(1);
});

test('rotazione: la scritta sta al centro della parte non ruotata, "Inverti asse di simmetria" specchia solo la vista', async ({ page }) => {
  const id = await addPath(page);
  await openEditor(page, id);
  await editor(page).getByRole('button', { name: 'Rotazionale' }).click();
  const label = editor(page).getByText('Questa parte non viene ruotata');
  const flipButton = editor(page).getByRole('button', { name: 'Inverti asse di simmetria' });
  await expect(label).toBeVisible();
  await expect(flipButton).toBeVisible();
  const axis = async () => (await editor(page).locator('.profile-editor__axis--y').boundingBox())!.x;
  const zone = async () => (await editor(page).locator('.profile-editor__outside rect').boundingBox())!;
  const before = { node: await center(node(page, '0:1')), axis: await axis(), zone: await zone(), label: await center(label), button: await center(flipButton) };
  // La zona è a sinistra dell'asse, la scritta è al suo centro e il pulsante sta sotto la scritta
  expect(Math.abs(before.zone.x + before.zone.width - before.axis)).toBeLessThan(2);
  expect(Math.abs(before.label.x - (before.zone.x + before.zone.width / 2))).toBeLessThan(4);
  expect(before.button.y).toBeGreaterThan(before.label.y);
  expect(Math.abs(before.button.x - before.label.x)).toBeLessThan(4);
  expect(before.node.x).toBeGreaterThan(before.axis);
  await flipButton.click();
  // Specchiato: la zona passa a destra dell'asse e il disegno a sinistra, la scritta e il pulsante la seguono
  const flipped = { node: await center(node(page, '0:1')), axis: await axis(), zone: await zone(), label: await center(label), button: await center(flipButton) };
  expect(Math.abs(flipped.zone.x - flipped.axis)).toBeLessThan(2);
  expect(flipped.node.x).toBeLessThan(flipped.axis);
  expect(flipped.label.x).toBeGreaterThan(flipped.axis);
  expect(Math.abs(flipped.label.x - (flipped.zone.x + flipped.zone.width / 2))).toBeLessThan(4);
  expect(Math.abs(flipped.button.x - flipped.label.x)).toBeLessThan(4);
  // Con la vista specchiata il trascinamento segue il mouse e le frecce seguono lo schermo
  await node(page, '0:1').click();
  await page.keyboard.press('ArrowRight');
  expect((await center(node(page, '0:1'))).x).toBeGreaterThan(flipped.node.x);
  await page.keyboard.press('Control+z');
  await drag(page, flipped.node, { x: flipped.node.x - 40, y: flipped.node.y });
  expect((await center(node(page, '0:1'))).x).toBeLessThan(flipped.node.x - 20);
  await page.keyboard.press('Control+z');
  // I dati non sono cambiati e un secondo clic ripristina la vista
  await flipButton.click();
  expect(Math.abs((await center(node(page, '0:1'))).x - before.node.x)).toBeLessThan(2);
  await okButton(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  expect((await getNode(page, id)).paths[0].nodes.map((n) => n.p)).toEqual([[0, 0], [40, 0], [40, 20], [0, 20]]);
});

test('rotazione con il disegno vuoto: l\'asse resta al centro dell\'area (passando da Lineare a Rotazionale e con Adatta)', async ({ page }) => {
  await page.evaluate(() => window.__construct!.profileEditor.getState().open({ new: true }));
  await expect(editor(page)).toBeVisible();
  const mid = async () => {
    const box = (await canvas(page).boundingBox())!;
    return box.x + box.width / 2;
  };
  const axis = async () => {
    const box = (await editor(page).locator('.profile-editor__axis--y').boundingBox())!;
    return box.x + box.width / 2;
  };
  expect(Math.abs((await axis()) - (await mid()))).toBeLessThan(3);
  await editor(page).getByRole('button', { name: 'Rotazionale' }).click();
  await expect(editor(page).getByText('asse di rotazione')).toBeVisible();
  expect(Math.abs((await axis()) - (await mid()))).toBeLessThan(3);
  // Con lo spazio per disegnare: a destra dell'asse c'è metà area
  await editor(page).getByRole('button', { name: 'Adatta', exact: true }).click();
  expect(Math.abs((await axis()) - (await mid()))).toBeLessThan(3);
  await editor(page).getByRole('button', { name: 'Lineare' }).click();
  await editor(page).getByRole('button', { name: 'Rotazionale' }).click();
  expect(Math.abs((await axis()) - (await mid()))).toBeLessThan(3);
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

// --- Penna e sidebar completa -----------------------------------------------------------------------------------------

const canvas = (page: Page) => editor(page).locator('.profile-editor__canvas');
const okButton = (page: Page) => editor(page).getByRole('button', { name: 'OK', exact: true });
const nodes = (page: Page) => editor(page).locator('[data-node]');

/** Punto dell'area di disegno, in pixel di pagina, a una distanza dal suo centro. */
async function at(page: Page, dx: number, dy: number) {
  const box = (await canvas(page).boundingBox())!;
  return { x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy };
}

/** Clic della Penna nei punti dati (distanze dal centro dell'area). */
async function clicks(page: Page, points: [number, number][]) {
  for (const [dx, dy] of points) {
    const p = await at(page, dx, dy);
    await page.mouse.click(p.x, p.y);
  }
}

/** Apre la modale su un Profilo nuovo e sceglie la Penna. */
async function openNewWithPen(page: Page) {
  await page.evaluate(() => window.__construct!.profileEditor.getState().open({ new: true }));
  await expect(editor(page)).toBeVisible();
  await editor(page).getByRole('button', { name: 'Penna' }).click();
}

const SQUARE: [number, number][] = [[-100, 80], [100, 80], [100, -80], [-100, -80]];

test('Penna: quattro clic e un clic sul primo nodo chiudono il contorno, un solo passo locale; l\'OK crea il Profilo', async ({ page }) => {
  const steps = await history(page);
  await page.evaluate(() => window.__construct!.profileEditor.getState().open({ new: true }));
  await expect(editor(page)).toBeVisible();
  // Stato vuoto: suggerimento al centro
  await expect(editor(page).getByText('Scegli la Penna e fai clic per iniziare')).toBeVisible();
  await expect(okButton(page)).toBeDisabled();
  await editor(page).getByRole('button', { name: 'Penna' }).click();
  await clicks(page, SQUARE);
  await expect(nodes(page)).toHaveCount(4);
  await expect(editor(page).getByText('Scegli la Penna e fai clic per iniziare')).toHaveCount(0);
  // Il clic sul primo nodo chiude il contorno
  await clicks(page, [SQUARE[0]]);
  await expect(nodes(page)).toHaveCount(4);
  await expect(editor(page).locator('[data-path="0"]')).toContainText('Chiuso');
  await expect(editor(page).getByText('1 contorno, 4 nodi')).toBeVisible();
  // Un solo passo per tutto il contorno: un Ctrl+Z lo toglie, Ctrl+Maiusc+Z lo rimette
  await page.keyboard.press('Control+z');
  await expect(nodes(page)).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(nodes(page)).toHaveCount(4);
  await okButton(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  expect(await history(page)).toBe(steps + 1);
  expect(await page.evaluate(() => window.__construct!.store.getState().op)).toBe('Aggiungi Profilo');
  const scene = await sceneState(page);
  const created = Object.values(scene.nodes)[0] as unknown as { kind: string; paths: { closed: boolean; nodes: { kind: string }[] }[] };
  expect(created.kind).toBe('path');
  expect(created.paths).toHaveLength(1);
  expect(created.paths[0].closed).toBe(true);
  expect(created.paths[0].nodes).toHaveLength(4);
  expect(created.paths[0].nodes.every((n) => n.kind === 'corner')).toBe(true);
});

/** Tre clic e poi clic e trascina sul primo nodo (con eventuale Alt): chiude il contorno disegnando la maniglia del primo nodo. */
async function closeWithDrag(page: Page, alt: 'none' | 'during' | 'released') {
  await openNewWithPen(page);
  await clicks(page, [[-100, 80], [100, 80], [100, -80]]);
  const first = await center(node(page, '0:0'));
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(first.x + 6 * i, first.y - 10 * i);
  if (alt !== 'none') {
    await page.keyboard.down('Alt');
    await page.mouse.move(first.x + 40, first.y - 70);
    await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'corner');
  }
  if (alt === 'released') await page.keyboard.up('Alt');
  return first;
}

test('Penna: clic e trascina sul primo nodo chiude il contorno con la maniglia (liscio, in entrata opposta al mouse), un solo passo', async ({ page }) => {
  const first = await closeWithDrag(page, 'none');
  // Fino al rilascio il contorno è aperto
  await expect(editor(page).locator('[data-path="0"]')).toContainText('Aperto');
  await page.mouse.up();
  await expect(editor(page).locator('[data-path="0"]')).toContainText('Chiuso');
  await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'smooth');
  // Il mouse ha tirato verso l'alto a destra: l'entrata (segmento di chiusura) è dal lato opposto
  const inn = await handleVector(page, '0:0:in');
  expect(inn.x).toBeLessThan(0);
  expect(inn.y).toBeGreaterThan(0);
  expect(first.x).toBeGreaterThan(0);
  // Un solo passo locale: Ctrl+Z toglie tutto il contorno
  await page.keyboard.press('Control+z');
  await expect(nodes(page)).toHaveCount(0);
});

test('Penna: chiudendo con il trascinamento, Alt rende il primo nodo uno spigolo; rilasciato prima del mouse torna liscio', async ({ page }) => {
  await closeWithDrag(page, 'during');
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(editor(page).locator('[data-path="0"]')).toContainText('Chiuso');
  await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'corner');
});

test('Penna: chiudendo con il trascinamento, Alt rilasciato prima del mouse riporta il nodo liscio', async ({ page }) => {
  await closeWithDrag(page, 'released');
  await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'smooth');
  await page.mouse.up();
  await expect(editor(page).locator('[data-path="0"]')).toContainText('Chiuso');
  await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'smooth');
});

/** Clic e trascina della Penna dal punto dato (distanze dal centro dell'area) di un tratto verso destra e in alto. */
async function penDrag(page: Page, dx: number, dy: number) {
  const a = await at(page, dx, dy);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(a.x + 8 * i, a.y - 6 * i);
  await page.mouse.up();
}

const previewPath = (page: Page) => editor(page).locator('svg path.profile-editor__preview');

test('Penna: due punti con due curve si chiudono con un clic sul primo', async ({ page }) => {
  await openNewWithPen(page);
  await penDrag(page, -100, 0);
  await penDrag(page, 100, 0);
  await page.mouse.click((await center(node(page, '0:0'))).x, (await center(node(page, '0:0'))).y);
  await expect(editor(page).locator('[data-path="0"]')).toContainText('Chiuso');
  await expect(nodes(page)).toHaveCount(2);
});

test('Penna: due punti uniti da rette non si chiudono con un clic, si segnala un errore; trascinando dal primo la chiusura è una curva e si chiude', async ({ page }) => {
  await openNewWithPen(page);
  await clicks(page, [[-100, 0], [100, 0]]);
  const first = await center(node(page, '0:0'));
  await page.mouse.click(first.x, first.y);
  await expect(page.getByText('Due segmenti diritti non racchiudono')).toBeVisible();
  await expect(editor(page).locator('[data-path="0"]')).toContainText('Aperto');
  await expect(nodes(page)).toHaveCount(2);
  // Trascinando dal primo nodo la chiusura diventa una curva: ora si chiude (una retta e una curva)
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(first.x + 4 * i, first.y - 12 * i);
  await page.mouse.up();
  await expect(editor(page).locator('[data-path="0"]')).toContainText('Chiuso');
  await expect(nodes(page)).toHaveCount(2);
});

test('Penna: trascinando sul primo nodo per chiudere si vede sempre l\'anteprima della curva, con due punti e con più di due', async ({ page }) => {
  await openNewWithPen(page);
  await clicks(page, [[-100, 0], [100, 0]]);
  const first = await center(node(page, '0:0'));
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(first.x + 4 * i, first.y - 12 * i);
  await expect(previewPath(page)).toHaveCount(1);
  expect(await previewPath(page).getAttribute('d')).toContain('C');
  await page.mouse.up();
  await expect(editor(page).locator('[data-path="0"]')).toContainText('Chiuso');
  // Più di due punti: il contorno chiuso non è in corso, i clic iniziano un nuovo contorno
  await clicks(page, [[-100, 90], [100, 90], [100, 60]]);
  const f = await center(node(page, '1:0'));
  await page.mouse.move(f.x, f.y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(f.x - 12 * i, f.y - 4 * i);
  await expect(previewPath(page)).toHaveCount(1);
  expect(await previewPath(page).getAttribute('d')).toContain('C');
  await page.mouse.up();
  await expect(editor(page).locator('[data-path="1"]')).toContainText('Chiuso');
});

test('Penna: Invio termina il contorno aperto; "Chiudi il contorno" nel piede lo chiude', async ({ page }) => {
  await openNewWithPen(page);
  await canvas(page).focus();
  await clicks(page, [[-100, 60], [0, -60], [100, 60]]);
  await page.keyboard.press('Enter');
  await expect(nodes(page)).toHaveCount(3);
  await expect(editor(page).locator('[data-path="0"]')).toContainText('Aperto');
  await expect(editor(page).getByText('Contorno aperto: in estrusione lineare si chiude con un segmento retto')).toBeVisible();
  await editor(page).getByRole('button', { name: 'Chiudi il contorno' }).click();
  await expect(editor(page).locator('[data-path="0"]')).toContainText('Chiuso');
  await expect(editor(page).getByText('Contorno aperto')).toHaveCount(0);
  // Terminato il contorno, un nuovo clic ne inizia un altro; con un solo nodo non esiste
  await clicks(page, [[-150, -100]]);
  await page.keyboard.press('Enter');
  await expect(editor(page).locator('[data-path]')).toHaveCount(1);
  await okButton(page).click();
  await settled(page);
  const created = Object.values((await sceneState(page)).nodes)[0] as unknown as { paths: { closed: boolean }[] };
  expect(created.paths).toHaveLength(1);
  expect(created.paths[0].closed).toBe(true);
});

test('Penna: Backspace toglie l\'ultimo nodo, Esc termina il contorno senza chiedere conferma, il doppio clic termina', async ({ page }) => {
  await openNewWithPen(page);
  await canvas(page).focus();
  await clicks(page, [[-100, 60], [0, -60], [100, 60]]);
  await page.keyboard.press('Backspace');
  await expect(nodes(page)).toHaveCount(2);
  // Esc con la Penna a metà termina il contorno: nessuna conferma, la modale resta
  await page.keyboard.press('Escape');
  await expect(confirmBox(page)).toHaveCount(0);
  await expect(editor(page)).toBeVisible();
  await expect(nodes(page)).toHaveCount(2);
  // Il contorno è un passo solo: Ctrl+Z lo toglie tutto
  await page.keyboard.press('Control+z');
  await expect(nodes(page)).toHaveCount(0);
  // Doppio clic: termina e il nodo doppio sparisce
  const first = await at(page, -120, 0);
  await page.mouse.click(first.x, first.y);
  const second = await at(page, -50, 40);
  await page.mouse.dblclick(second.x, second.y);
  await expect(nodes(page)).toHaveCount(2);
  await expect(editor(page).locator('[data-path="0"]')).toContainText('Aperto');
});

test('Penna: clic e trascina crea un nodo simmetrico con le maniglie; Maiusc vincola a 45 gradi', async ({ page }) => {
  await openNewWithPen(page);
  const a = await at(page, -100, 0);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(a.x + 10 * i, a.y - 8 * i);
  await page.mouse.up();
  await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'symmetric');
  await expect(editor(page).locator('[data-handle]')).toHaveCount(2);
  // Secondo nodo con Maiusc: la direzione dal precedente (circa 38 gradi) diventa 45 gradi
  await page.keyboard.down('Shift');
  const b = await at(page, 80, -140);
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up('Shift');
  const [n0, n1] = [await center(node(page, '0:0')), await center(node(page, '0:1'))];
  expect(Math.abs(Math.abs(n1.x - n0.x) - Math.abs(n1.y - n0.y))).toBeLessThan(2);
});

/** Posizione in pixel del punto della maniglia `ref` (es. `0:1:out`) e del suo nodo, per leggerne il vettore relativo. */
async function handleVector(page: Page, ref: string) {
  const [pi, ni] = ref.split(':');
  const h = await center(editor(page).locator(`[data-handle="${ref}"] circle`));
  const n = await center(node(page, `${pi}:${ni}`));
  return { x: h.x - n.x, y: h.y - n.y };
}

test('Penna, Alt: premuto dopo il nodo congela la maniglia in entrata e il nodo diventa spigolo; resta spigolo se il mouse si rilascia con Alt', async ({ page }) => {
  await openNewWithPen(page);
  const steps = await history(page);
  const a = await at(page, -100, 0);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(a.x + 10 * i, a.y - 8 * i);
  await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'symmetric');
  const inBefore = await handleVector(page, '0:0:in');
  expect(inBefore.x).toBeLessThan(0);
  // Alt a mouse fermo: il nodo diventa subito spigolo e la maniglia in entrata resta dov'è
  await page.keyboard.down('Alt');
  await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'corner');
  await expect(editor(page).locator('.profile-editor__modifier')).toHaveText('Alt: spigolo');
  // L'uscita continua a seguire il mouse, l'entrata non si muove
  for (let i = 7; i <= 10; i++) await page.mouse.move(a.x + 10 * i, a.y + 15 * (i - 5));
  const inAlt = await handleVector(page, '0:0:in');
  expect(Math.abs(inAlt.x - inBefore.x)).toBeLessThan(1.5);
  expect(Math.abs(inAlt.y - inBefore.y)).toBeLessThan(1.5);
  const out = await handleVector(page, '0:0:out');
  expect(out.y).toBeGreaterThan(0);
  // Il mouse si rilascia con Alt premuto: il nodo resta spigolo
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'corner');
  await expect(editor(page).locator('.profile-editor__modifier')).toHaveCount(0);
  // Il contorno si termina con Invio: un solo passo locale e nessun passo nella scena
  await page.keyboard.press('Enter');
  expect(await history(page)).toBe(steps);
});

test('Penna, Alt: rilasciato prima del mouse il nodo torna simmetrico', async ({ page }) => {
  await openNewWithPen(page);
  const a = await at(page, -100, 0);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(a.x + 10 * i, a.y - 8 * i);
  await page.keyboard.down('Alt');
  await page.mouse.move(a.x + 90, a.y + 30);
  await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'corner');
  await page.keyboard.up('Alt');
  // Subito, senza muovere il mouse: simmetrico, con le maniglie opposte
  await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'symmetric');
  const [o, i] = [await handleVector(page, '0:0:out'), await handleVector(page, '0:0:in')];
  expect(Math.abs(o.x + i.x)).toBeLessThan(1.5);
  expect(Math.abs(o.y + i.y)).toBeLessThan(1.5);
  await page.mouse.up();
  await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'symmetric');
});

test('Penna, Alt premuto prima del nodo: spigolo con la sola maniglia in uscita; rilasciandolo il nodo diventa simmetrico', async ({ page }) => {
  await openNewWithPen(page);
  const a = await at(page, -100, 0);
  await page.keyboard.down('Alt');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(a.x + 10 * i, a.y - 8 * i);
  await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'corner');
  await expect(editor(page).locator('[data-handle]')).toHaveCount(1);
  await expect(editor(page).locator('[data-handle="0:0:out"]')).toHaveCount(1);
  await page.keyboard.up('Alt');
  await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'symmetric');
  await expect(editor(page).locator('[data-handle]')).toHaveCount(2);
  await page.mouse.up();
  await expect(node(page, '0:0')).toHaveAttribute('data-kind', 'symmetric');
});

test('Seleziona, Alt su una maniglia: finché è premuto il nodo è spigolo e l\'altra maniglia resta; rilasciato torna al tipo di prima', async ({ page }) => {
  const paths = [{ closed: false, nodes: [{ p: [0, 0], kind: 'corner' }, { p: [20, 0], in: [-6, 0], out: [6, 0], kind: 'symmetric' }, { p: [40, 0], kind: 'corner' }] }];
  const id = await addPath(page, paths);
  await openEditor(page, id);
  await node(page, '0:1').click();
  // Il primo e il secondo nodo distano 20 mm, non i 40 che pixelsPerMm suppone
  const k = (await pixelsPerMm(page)) * 2;
  const n = await center(node(page, '0:1'));
  const out = { x: n.x + 6 * k, y: n.y };
  await page.mouse.move(out.x, out.y);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) await page.mouse.move(out.x + 2 * i, out.y - 3 * i);
  // Prima di Alt il nodo è simmetrico e l'entrata ha seguito l'uscita
  await expect(node(page, '0:1')).toHaveAttribute('data-kind', 'symmetric');
  const before = await handleVector(page, '0:1:in');
  await page.keyboard.down('Alt');
  await expect(node(page, '0:1')).toHaveAttribute('data-kind', 'corner');
  for (let i = 5; i <= 8; i++) await page.mouse.move(out.x + 2 * i, out.y - 3 * 4 + 2 * (i - 4));
  const during = await handleVector(page, '0:1:in');
  expect(Math.abs(during.x - before.x)).toBeLessThan(1.5);
  expect(Math.abs(during.y - before.y)).toBeLessThan(1.5);
  // Alt rilasciato a mouse fermo: di nuovo simmetrico, l'entrata è opposta all'uscita
  await page.keyboard.up('Alt');
  await expect(node(page, '0:1')).toHaveAttribute('data-kind', 'symmetric');
  const [o, i] = [await handleVector(page, '0:1:out'), await handleVector(page, '0:1:in')];
  expect(Math.abs(o.x + i.x)).toBeLessThan(1.5);
  expect(Math.abs(o.y + i.y)).toBeLessThan(1.5);
  // Alt premuto di nuovo e il mouse rilasciato con Alt: il nodo resta spigolo, in un solo passo locale
  await page.keyboard.down('Alt');
  await page.mouse.move(out.x + 20, out.y + 10);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(node(page, '0:1')).toHaveAttribute('data-kind', 'corner');
  await page.keyboard.press('Control+z');
  await expect(node(page, '0:1')).toHaveAttribute('data-kind', 'symmetric');
});

test('rotazionale con un profilo aperto a destra dell\'asse: OK scrive extrusion rotate, niente Raggio né intersection()', async ({ page }) => {
  const open = [{ closed: false, nodes: [{ p: [10, 0], kind: 'corner' }, { p: [15, 10], out: [0, 3], kind: 'smooth' }, { p: [10, 20], kind: 'corner' }] }];
  const id = await addPath(page, open);
  await openEditor(page, id);
  await editor(page).getByRole('button', { name: 'Rotazionale' }).click();
  // Nella modale: Angolo e Segmenti, senza Raggio
  await expect(editor(page).getByRole('slider', { name: 'Angolo' })).toBeVisible();
  await expect(editor(page).getByRole('slider', { name: 'Segmenti' })).toBeVisible();
  await expect(editor(page).getByText('Raggio', { exact: true })).toHaveCount(0);
  // Un profilo a destra dell'asse non ha avvisi sulla parte oltre l'asse
  await expect(editor(page).getByText('oltre l\'asse')).toHaveCount(0);
  await okButton(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  expect((await getNode(page, id)).extrusion).toBe('rotate');
  const code = await readCode(page);
  expect(code).toContain('rotate_extrude');
  expect(code).not.toContain('intersection()');
  // Nelle Proprietà non c'è lo slider Raggio
  await expect(page.locator('.slider-field').filter({ has: page.getByText('Raggio', { exact: true }) })).toHaveCount(0);
});

test('slider di estrusione: un valore digitato è un passo locale annullabile e arriva alla scena con l\'OK', async ({ page }) => {
  const id = await addPath(page);
  await openEditor(page, id);
  const height = editor(page).locator('.slider-field').filter({ has: page.getByText('Altezza', { exact: true }) });
  await expect(height.locator('.number-field__input')).toHaveValue('5');
  await height.locator('.number-field__input').fill('12');
  await height.locator('.number-field__input').press('Enter');
  await expect(height.locator('.number-field__input')).toHaveValue('12');
  // Il campo lascia il focus: Ctrl+Z della modale torna a 5
  await page.keyboard.press('Control+z');
  await expect(height.locator('.number-field__input')).toHaveValue('5');
  await page.keyboard.press('Control+Shift+z');
  await expect(height.locator('.number-field__input')).toHaveValue('12');
  // Torsione: dallo slider
  const twist = editor(page).locator('.slider-field').filter({ has: page.getByText('Torsione', { exact: true }) });
  await twist.locator('input[type=range]').fill('45');
  await canvas(page).click({ position: { x: 5, y: 200 } });
  await okButton(page).click();
  await settled(page);
  expect(await getNode(page, id)).toMatchObject({ height: 12, twist: 45 });
});

test('percorsi: elenco, selezione, chiudi ed elimina', async ({ page }) => {
  const two = [
    { closed: false, nodes: [{ p: [0, 0], kind: 'corner' }, { p: [20, 0], kind: 'corner' }, { p: [20, 20], kind: 'corner' }] },
    { closed: true, nodes: [{ p: [40, 0], kind: 'corner' }, { p: [60, 0], kind: 'corner' }, { p: [60, 20], kind: 'corner' }] },
  ];
  const id = await addPath(page, two);
  await openEditor(page, id);
  const rows = editor(page).locator('[data-path]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Percorso 1');
  await expect(rows.nth(0)).toContainText('Aperto');
  await expect(rows.nth(1)).toContainText('Chiuso');
  // Il clic sul nome seleziona i nodi del percorso
  await rows.nth(1).getByRole('button', { name: 'Percorso 2', exact: true }).click();
  await expect(editor(page).locator('.profile-editor__node--selected')).toHaveCount(3);
  await expect(editor(page).getByText('3 nodi selezionati')).toBeVisible();
  // Chiudi: solo per i percorsi aperti
  await expect(rows.nth(1).getByRole('button', { name: 'Chiudi', exact: true })).toHaveCount(0);
  await rows.nth(0).getByRole('button', { name: 'Chiudi', exact: true }).click();
  await expect(rows.nth(0)).toContainText('Chiuso');
  // Elimina il primo percorso
  await rows.nth(0).getByRole('button', { name: 'Elimina il percorso 1' }).click();
  await expect(rows).toHaveCount(1);
  await expect(nodes(page)).toHaveCount(3);
});

test('punto selezionato: coordinate, tipo e maniglie di entrata e uscita', async ({ page }) => {
  const id = await addPath(page, PATHS);
  await openEditor(page, id);
  await node(page, '0:1').click();
  const out = editor(page).locator('[data-handle-row="out"]');
  // Il nodo B (40,0) ha la maniglia di uscita (10, 8): lunghezza 12,806 e angolo 38,66
  await expect(out.locator('input').nth(0)).toHaveValue('12.806');
  await expect(out.locator('input').nth(1)).toHaveValue('38.66');
  await out.locator('input').nth(0).fill('20');
  await out.locator('input').nth(0).press('Enter');
  await okButton(page).click();
  await settled(page);
  const b = (await getNode(page, id)).paths[0].nodes[1] as unknown as { out: [number, number]; kind: string };
  expect(Math.hypot(...b.out)).toBeCloseTo(20, 2);
  // L'angolo non è cambiato
  expect((Math.atan2(b.out[1], b.out[0]) * 180) / Math.PI).toBeCloseTo(38.66, 1);
  expect(b.kind).toBe('smooth');
});

test('griglia e snap: il passo cambia l\'aggancio, Mostra asse nasconde gli assi', async ({ page }) => {
  const id = await addPath(page);
  await openEditor(page, id);
  await editor(page).getByRole('button', { name: '5', exact: true }).click();
  await expect(editor(page).getByRole('button', { name: '5', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const k = await pixelsPerMm(page);
  const c = await center(node(page, '0:2'));
  await drag(page, c, { x: c.x + 12 * k, y: c.y });
  await okButton(page).click();
  await settled(page);
  const moved = (await getNode(page, id)).paths[0].nodes[2].p;
  expect(moved[0] % 5).toBe(0);
  expect(moved[1] % 5).toBe(0);
  // Mostra asse
  await openEditor(page, id);
  await expect(editor(page).locator('.profile-editor__axis--y')).toHaveCount(1);
  await editor(page).getByLabel('Mostra asse').uncheck();
  await expect(editor(page).locator('.profile-editor__axis--y')).toHaveCount(0);
});

test('qualità: la tolleranza cambia i punti campionati e arriva al nodo; con troppi punti c\'è l\'avviso con la tolleranza effettiva', async ({ page }) => {
  const id = await addPath(page, PATHS);
  await openEditor(page, id);
  await editor(page).locator('summary', { hasText: 'Qualità' }).click();
  const points = editor(page).locator('[data-points]');
  const before = Number(await points.getAttribute('data-points'));
  expect(before).toBeGreaterThan(5);
  const tolerance = editor(page).locator('.number-field').filter({ hasText: 'Tolleranza' }).locator('input');
  await tolerance.fill('0.5');
  await tolerance.press('Enter');
  await expect.poll(async () => Number(await points.getAttribute('data-points'))).toBeLessThan(before);
  await okButton(page).click();
  await settled(page);
  expect((await getNode(page, id)) as unknown as { tolerance: number }).toMatchObject({ tolerance: 0.5 });
  // Un cerchio enorme alla tolleranza minima supera i tetti di punti
  const R = 50000;
  const K = 0.5523 * R;
  const huge = [{ closed: true, nodes: [
    { p: [R, 0], out: [0, K], in: [0, -K], kind: 'symmetric' }, { p: [0, R], out: [-K, 0], in: [K, 0], kind: 'symmetric' },
    { p: [-R, 0], out: [0, -K], in: [0, K], kind: 'symmetric' }, { p: [0, -R], out: [K, 0], in: [-K, 0], kind: 'symmetric' },
  ] }];
  const hugeId = await page.evaluate((paths) => window.__construct!.store.getState().addPath({ paths: paths as never, tolerance: 0.001 }), huge);
  await settled(page);
  await openEditor(page, hugeId);
  await expect(editor(page).locator('.profile-editor__chip', { hasText: /Troppi punti: la tolleranza effettiva è/ })).toBeVisible();
  await editor(page).locator('summary', { hasText: 'Qualità' }).click();
  await expect(editor(page).getByText(/Troppi punti: la tolleranza effettiva è .* mm\. Alzala/)).toBeVisible();
});

test('una linea verticale in rotazione non ha area: il piede dice perché e cosa fare, OK è disattivato', async ({ page }) => {
  await openNewWithPen(page);
  await canvas(page).focus();
  await clicks(page, [[60, -60], [60, 60]]);
  await page.keyboard.press('Enter');
  await editor(page).getByRole('button', { name: 'Rotazionale' }).click();
  await expect(editor(page).getByText(/stessa verticale.*Aggiungi un punto non allineato/)).toBeVisible();
  await expect(okButton(page)).toBeDisabled();
});

test('Penna: raggiunto il limite di contorni compare l\'avviso (bozza con 100 contorni)', async ({ page }) => {
  // Cento contorni da due nodi, ripristinati da una bozza: il centunesimo non si può iniziare
  const contour = (i: number) => ({ closed: false, nodes: [{ p: [i, 0], kind: 'corner' }, { p: [i, 5], kind: 'corner' }] });
  const draft = { paths: Array.from({ length: 100 }, (_, i) => contour(i)), tolerance: 0.05, extrusion: 'linear', height: 5, twist: 0, scaleTop: 1, revolveAngle: 360, revolveSegments: 64 };
  await page.evaluate((d) => localStorage.setItem('construct:profile-draft:new', JSON.stringify({ v: 1, draft: d })), draft);
  await page.evaluate(() => window.__construct!.profileEditor.getState().open({ new: true }));
  await confirmBox(page).getByRole('button', { name: 'Ripristina' }).click();
  await expect(editor(page).locator('[data-path]')).toHaveCount(100);
  await editor(page).getByRole('button', { name: 'Penna' }).click();
  await page.mouse.click((await at(page, 0, 120)).x, (await at(page, 0, 120)).y);
  await expect(page.getByText('Limite raggiunto: al massimo 500 nodi per contorno e 100 contorni')).toBeVisible();
  await expect(editor(page).locator('[data-path]')).toHaveCount(100);
});

// --- Punti di ingresso, anteprima 3D e criteri della fase ------------------------------------------------------------------

/** Anteprima 3D della modale (il suo Canvas è il secondo della pagina). */
const preview = (page: Page) => editor(page).locator('section[aria-label="Anteprima 3D"]');
const previewReady = async (page: Page) => {
  await expect(preview(page)).toHaveAttribute('data-state', 'ready');
  return Number(await preview(page).getAttribute('data-triangles'));
};

test('libreria 2D: il pulsante Profilo apre la modale; quattro clic della Penna e un clic sul primo nodo, OK crea il Profilo, Ctrl+Z toglie tutto', async ({ page }) => {
  const steps = await history(page);
  await page.getByRole('tab', { name: 'Forme 2D' }).click();
  await page.locator('button[title^="Aggiungi: Profilo"]').click();
  await expect(editor(page)).toBeVisible();
  // Il nodo nasce solo con l'OK
  expect((await sceneState(page)).rootIds).toHaveLength(0);
  await editor(page).getByRole('button', { name: 'Penna' }).click();
  await clicks(page, SQUARE);
  await clicks(page, [SQUARE[0]]);
  await expect(editor(page).getByText('1 contorno, 4 nodi')).toBeVisible();
  // L'anteprima calcola il solido dal kernel
  expect(await previewReady(page)).toBe(12);
  await okButton(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  expect(await history(page)).toBe(steps + 1);
  expect(await page.evaluate(() => window.__construct!.store.getState().op)).toBe('Aggiungi Profilo');
  const created = Object.values((await sceneState(page)).nodes)[0] as unknown as { kind: string; paths: { closed: boolean; nodes: unknown[] }[] };
  expect(created.kind).toBe('path');
  expect(created.paths[0].closed).toBe(true);
  expect(created.paths[0].nodes).toHaveLength(4);
  // Ctrl+Z: scena vuota
  await page.keyboard.press('Control+z');
  expect((await sceneState(page)).rootIds).toHaveLength(0);
});

test('anteprima 3D: pronta con i triangoli del solido, cambia con il disegno e dopo l\'OK la mesh della scena ha gli stessi triangoli e lo stesso volume', async ({ page }) => {
  const id = await addPath(page, PATHS);
  await openEditor(page, id);
  const first = await previewReady(page);
  expect(first).toBeGreaterThan(12);
  // Selezionato il nodo B si trascina la sua maniglia di uscita molto più in là: la curva è più ampia e più campionata
  await node(page, '0:1').click();
  const k = await pixelsPerMm(page);
  const b = await center(node(page, '0:1'));
  await drag(page, { x: b.x + 10 * k, y: b.y - 8 * k }, { x: b.x + 45 * k, y: b.y - 8 * k });
  const second = await previewReady(page);
  expect(second).not.toBe(first);
  // Ultima anteprima: triangoli e volume
  const last = { triangles: Number(await preview(page).getAttribute('data-triangles')), volume: Number(await preview(page).getAttribute('data-volume')) };
  await okButton(page).click();
  await expect(editor(page)).toHaveCount(0);
  await settled(page);
  const mesh = await page.evaluate(() => {
    const m = window.__construct!.results.getState().meshes[0];
    return { triangles: m.indices.length / 3, volume: m.volume };
  });
  expect(mesh.triangles).toBe(last.triangles);
  expect(Math.abs(mesh.volume - last.volume) / mesh.volume).toBeLessThan(1e-6);
});

test('anteprima 3D: Comprimi la toglie e libera il contesto, Ingrandisci nasconde le opzioni, Adatta c\'è', async ({ page }) => {
  const id = await addPath(page);
  await openEditor(page, id);
  await previewReady(page);
  const view = preview(page).locator('.profile-editor__preview-view');
  await expect(view.locator('canvas')).toHaveCount(1);
  await expect(preview(page).getByRole('button', { name: 'Adatta l\'anteprima' })).toBeEnabled();
  await preview(page).getByRole('button', { name: 'Ingrandisci l\'anteprima' }).click();
  await expect(editor(page).locator('.profile-editor__sidebar')).toBeHidden();
  await preview(page).getByRole('button', { name: 'Riduci l\'anteprima' }).click();
  await expect(editor(page).locator('.profile-editor__sidebar')).toBeVisible();
  await preview(page).getByRole('button', { name: 'Comprimi l\'anteprima' }).click();
  await expect(view).toHaveCount(0);
  await expect(preview(page).getByRole('button', { name: 'Adatta l\'anteprima' })).toBeDisabled();
  await preview(page).getByRole('button', { name: 'Mostra l\'anteprima' }).click();
  await expect(view.locator('canvas')).toHaveCount(1);
});

test('dieci aperture e chiusure della modale non accumulano contesti WebGL', async ({ page }) => {
  // Registra i contesti WebGL dei canvas dentro una modale (quello dell'anteprima): quelli ancora vivi si contano alla fine.
  // Il contesto della vista principale e quello delle miniature non c'entrano e restano fuori dal conteggio
  await page.evaluate(() => {
    const w = window as unknown as { __ctx?: WebGLRenderingContext[] };
    w.__ctx = [];
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      const ctx = (original as (...a: unknown[]) => RenderingContext | null).call(this, type, ...args);
      if (ctx && /webgl/.test(type) && this.closest('dialog')) w.__ctx!.push(ctx as WebGLRenderingContext);
      return ctx;
    } as typeof original;
  });
  const alive = () => page.evaluate(() => (window as unknown as { __ctx: WebGLRenderingContext[] }).__ctx.filter((c) => !c.isContextLost()).length);
  const id = await addPath(page);
  for (let i = 0; i < 10; i++) {
    await openEditor(page, id);
    await previewReady(page);
    await page.keyboard.press('Escape');
    await expect(editor(page)).toHaveCount(0);
  }
  // Il Canvas dell'anteprima ha creato dieci contesti, ma alla chiusura li ha rilasciati tutti
  const created = await page.evaluate(() => (window as unknown as { __ctx: unknown[] }).__ctx.length);
  expect(created).toBeGreaterThanOrEqual(10);
  await expect.poll(alive).toBe(0);
});

test('Maiusc+P fuori dalla modale apre il disegno del Profilo selezionato; P nella modale sceglie la Penna e non accende il piano', async ({ page }) => {
  const id = await addPath(page);
  const bed = () => page.evaluate(() => window.__construct!.ui.getState().bedMode);
  const bedBefore = await bed();
  // Con il Profilo selezionato (lo è appena creato) e il fuoco sulla pagina
  await page.keyboard.press('Shift+P');
  await expect(editor(page)).toBeVisible();
  expect(await bed()).toBe(bedBefore);
  await canvas(page).focus();
  await page.keyboard.press('p');
  await expect(editor(page).getByRole('button', { name: 'Penna' })).toHaveAttribute('aria-pressed', 'true');
  expect(await bed()).toBe(bedBefore);
  await page.keyboard.press('v');
  await expect(editor(page).getByRole('button', { name: 'Seleziona' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  // Senza un Profilo selezionato Maiusc+P non fa nulla (e non accende il piano)
  await page.evaluate(() => window.__construct!.store.getState().select([]));
  await page.keyboard.press('Shift+P');
  await expect(editor(page)).toHaveCount(0);
  expect(await bed()).toBe(bedBefore);
  // Con un cubo selezionato nemmeno
  await addShapeBox(page);
  await page.keyboard.press('Shift+P');
  await expect(editor(page)).toHaveCount(0);
  expect(id).toBeTruthy();
});

/** Aggiunge un cubo dalla libreria 3D (tab predefinita). */
async function addShapeBox(page: Page) {
  await page.locator('button[title^="Aggiungi: Cubo"]').click();
  await settled(page);
}

test('Proprietà e menu contestuale: "Modifica profilo" apre la modale; con il Profilo bloccato è disattivato e il menu non lo offre', async ({ page }) => {
  const id = await addPath(page);
  const action = page.locator('.properties__action', { hasText: 'Modifica profilo' });
  await action.click();
  await expect(editor(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  // Menu contestuale sull'oggetto: clic destro nella vista, sul centro del Profilo
  const menu = page.getByRole('menu', { name: 'Comandi per la selezione' });
  const spot = await page.evaluate(() => {
    const s = window.__r3f!;
    const V = s.camera.position.constructor as new (x: number, y: number, z: number) => { project(c: unknown): { x: number; y: number } };
    const v = new V(0, 0, 2.5).project(s.camera);
    const r = s.gl.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  });
  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Modifica profilo' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Modifica profilo' }).click();
  await expect(editor(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  // Bloccato: il pulsante delle Proprietà è disattivato e Maiusc+P non apre
  await page.evaluate((nodeId) => window.__construct!.store.getState().updateNode(nodeId, { locked: true }), id);
  await expect(action).toBeDisabled();
  await page.keyboard.press('Shift+P');
  await expect(editor(page)).toHaveCount(0);
});

test('menu contestuale sul vuoto: Forme 2D > Profilo apre la modale e il Profilo nasce nel punto cliccato', async ({ page }) => {
  await addShapeBox(page);
  const menu = page.getByRole('menu', { name: 'Aggiungi una forma' });
  const spot = await page.evaluate(() => {
    const s = window.__r3f!;
    const V = s.camera.position.constructor as new (x: number, y: number, z: number) => { project(c: unknown): { x: number; y: number } };
    const v = new V(-80, 70, 0).project(s.camera);
    const r = s.gl.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  });
  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await menu.getByRole('menuitem', { name: 'Forme 2D', exact: true }).hover();
  await menu.getByRole('menu', { name: 'Forme 2D' }).getByRole('menuitem', { name: 'Profilo', exact: true }).click();
  await expect(editor(page)).toBeVisible();
  await editor(page).getByRole('button', { name: 'Penna' }).click();
  await clicks(page, SQUARE);
  await clicks(page, [SQUARE[0]]);
  await okButton(page).click();
  await settled(page);
  const scene = await sceneState(page);
  const created = scene.nodes[scene.rootIds[0]] as unknown as { kind: string; position: [number, number, number] };
  expect(created.kind).toBe('path');
  // Nel punto cliccato del piano (circa -80, 70)
  expect(Math.abs(created.position[0] + 80)).toBeLessThan(3);
  expect(Math.abs(created.position[1] - 70)).toBeLessThan(3);
});

test('una colonna sola sotto i 900 px: anteprima sopra il disegno e il disegno alto almeno 320 px', async ({ page }) => {
  const id = await addPath(page);
  await page.setViewportSize({ width: 820, height: 760 });
  await openEditor(page, id);
  const [view, drawing] = [(await preview(page).boundingBox())!, (await canvas(page).boundingBox())!];
  expect(view.y).toBeLessThan(drawing.y);
  expect(drawing.height).toBeGreaterThanOrEqual(320);
  // Il piede e le opzioni scorrono: i pulsanti si raggiungono
  await okButton(page).scrollIntoViewIfNeeded();
  await expect(okButton(page)).toBeVisible();
});

test('con uno strumento della scena aperto (Serie, Raccordo) la modale non tocca la scena: lo strumento si annulla e Invio ed Esc restano della modale', async ({ page }) => {
  await addShapeBox(page);
  const sceneSize = () => page.evaluate(() => ({ nodes: Object.keys(window.__construct!.store.getState().scene.nodes).length, steps: window.__construct!.store.temporal.getState().pastStates.length }));
  const before = await sceneSize();
  for (const [key, panel] of [['o', 'Serie'], ['f', 'Raccordo']] as const) {
    await page.keyboard.press(key);
    await expect(page.getByRole('region', { name: panel })).toBeVisible();
    await page.getByRole('tab', { name: 'Forme 2D' }).click();
    await page.locator('button[title^="Aggiungi: Profilo"]').click();
    await expect(editor(page)).toBeVisible();
    // Aprire la modale ha annullato lo strumento
    await expect(page.getByRole('region', { name: panel })).toHaveCount(0);
    await editor(page).getByRole('button', { name: 'Penna' }).click();
    await clicks(page, [[-100, 60], [0, -60], [100, 60]]);
    await page.keyboard.press('Enter');
    await expect(nodes(page)).toHaveCount(3);
    // Esc: il contorno è già terminato, quindi chiede di chiudere; si conferma e la scena non è cambiata
    await page.keyboard.press('Escape');
    await confirmBox(page).getByRole('button', { name: 'Chiudi' }).click();
    await expect(editor(page)).toHaveCount(0);
    expect(await sceneSize()).toEqual(before);
    await page.evaluate(() => localStorage.clear());
    // Il cubo resta selezionato: si ripete con l'altro strumento
    await page.evaluate(() => window.__construct!.store.getState().select([Object.keys(window.__construct!.store.getState().scene.nodes)[0]]));
  }
});

test('dopo aver trascinato uno slider con il mouse il focus resta nella modale: Ctrl+Z riporta il valore', async ({ page }) => {
  const id = await addPath(page);
  await openEditor(page, id);
  const height = editor(page).locator('.slider-field').filter({ has: page.getByText('Altezza', { exact: true }) });
  const value = height.locator('.number-field__input');
  await expect(value).toHaveValue('5');
  const range = (await height.locator('input[type=range]').boundingBox())!;
  await page.mouse.move(range.x + range.width * 0.1, range.y + range.height / 2);
  await page.mouse.down();
  await page.mouse.move(range.x + range.width * 0.7, range.y + range.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(value).not.toHaveValue('5');
  // Il rilascio dello slider toglie il focus all'elemento: la modale lo riprende e le scorciatoie funzionano
  await page.keyboard.press('Control+z');
  await expect(value).toHaveValue('5');
  await page.keyboard.press('p');
  await expect(editor(page).getByRole('button', { name: 'Penna' })).toHaveAttribute('aria-pressed', 'true');
});

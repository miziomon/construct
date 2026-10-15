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

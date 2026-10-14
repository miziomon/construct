import { expect, test, type Page } from '@playwright/test';
import { openApp, readCode, sceneState, settled } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

/** Contorno chiuso a destra dell'asse: da (25, 0) a (35, 20), con un lato curvo. Riquadro naturale 10 × 20, centro a x = 30. */
const PATHS = [
  {
    closed: true,
    nodes: [
      { p: [25, 0], kind: 'corner' },
      { p: [35, 0], out: [0, 6], kind: 'smooth' },
      { p: [35, 20], in: [0, -6], kind: 'smooth' },
      { p: [25, 20], kind: 'corner' },
    ],
  },
];

/** Aggiunge il Profilo dallo store (l'interfaccia di disegno non c'è ancora) e attende il calcolo. */
async function addPath(page: Page): Promise<string> {
  const id = await page.evaluate((paths) => window.__construct!.store.getState().addPath({ paths: paths as never, height: 5 }), PATHS);
  await settled(page);
  return id;
}

/** Campo numerico dello slider con l'etichetta indicata (il pannello Proprietà è l'unico con questi slider). */
const field = (page: Page, label: string) => page.locator('.slider-field').filter({ has: page.getByText(label, { exact: true }) }).locator('.number-field__input');

/** Toglie il focus dai campi di testo: i tasti rapidi (come C per il codice) non funzionano mentre si scrive. */
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

test('Profilo di Bézier: una mesh, il codice con construct:path e il pannello con Larghezza e Profondità', async ({ page }) => {
  const id = await addPath(page);
  expect((await sceneState(page)).nodes[id]).toMatchObject({ kind: 'path', name: 'Profilo', width: 10, depth: 20, lockRatio: true });
  // Una sola mesh, non vuota
  const meshes = await page.evaluate(() => window.__construct!.results.getState().meshes.map((m) => ({ volume: m.volume, empty: m.empty })));
  expect(meshes).toHaveLength(1);
  expect(meshes[0].empty).toBe(false);
  expect(meshes[0].volume).toBeGreaterThan(500);
  expect(await readCode(page)).toContain('construct:path');
  // Pannello: titolo Profilo, Larghezza e Profondità come per l'SVG
  await expect(page.locator('.properties__section-title', { hasText: /^Profilo$/ })).toBeVisible();
  await expect(field(page, 'Larghezza')).toHaveValue('10');
  await expect(field(page, 'Profondità')).toHaveValue('20');
  // Non esiste un pulsante Profilo nella libreria
  await expect(page.locator('button[title^="Aggiungi: Profilo"]')).toHaveCount(0);
});

test('Profilo di Bézier: con il lucchetto chiuso la Larghezza scala anche la Profondità, in un solo passo', async ({ page }) => {
  const id = await addPath(page);
  const history = () => page.evaluate(() => window.__construct!.store.temporal.getState().pastStates.length);
  const before = await history();
  await field(page, 'Larghezza').fill('20');
  await field(page, 'Larghezza').press('Enter');
  await settled(page);
  expect((await sceneState(page)).nodes[id]).toMatchObject({ width: 20, depth: 40 });
  expect(await history()).toBe(before + 1);
  await expect(page.getByRole('button', { name: /Bloccate|Libere/ })).toHaveAttribute('aria-pressed', 'true');
});

test('Profilo di Bézier: in rotazione non c\'è il Raggio e per un profilo a destra dell\'asse il codice non ha intersection()', async ({ page }) => {
  const id = await addPath(page);
  await page.getByRole('button', { name: 'Rotazionale' }).click();
  await settled(page);
  const node = (await sceneState(page)).nodes[id];
  expect(node).toMatchObject({ extrusion: 'rotate', revolveAngle: 360, revolveSegments: 64 });
  // Il raggio non si scrive nel nodo e lo slider non c'è
  expect(node).not.toHaveProperty('revolveRadius');
  await expect(page.locator('.slider-field').filter({ has: page.getByText('Raggio', { exact: true }) })).toHaveCount(0);
  await expect(field(page, 'Angolo')).toBeVisible();
  await blur(page);
  const code = await readCode(page);
  expect(code).toContain('rotate_extrude(angle = 360, $fn = 64)');
  expect(code).toContain('translate([30, 0])');
  expect(code).not.toContain('intersection()');
  // Il solido è un toro a sezione quasi rettangolare 10 × 20 attorno all'asse, a 30 mm dal centro
  const bbox = await page.evaluate(() => window.__construct!.results.getState().meshes[0].bbox);
  expect(bbox.max[0]).toBeCloseTo(35, 0);
  expect(bbox.max[2] - bbox.min[2]).toBeCloseTo(20, 0);
});

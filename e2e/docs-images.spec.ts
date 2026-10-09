import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import sharp from 'sharp';
import { addShape, openApp, openMenuItem, project, settled } from './helpers';

/**
 * Genera le immagini di esempio dei tooltip (public/help/*.webp), le anteprime dei modelli di esempio
 * (public/examples/*.webp) e quelle del README (docs/images/*.png).
 * Non fa parte della suite: si lancia a mano con `DOC_IMAGES=1 npx playwright test e2e/docs-images.spec.ts`.
 */
test.skip(!process.env.DOC_IMAGES, 'Solo con DOC_IMAGES=1');

type Page = import('@playwright/test').Page;
type Vec = [number, number, number];

mkdirSync('public/help', { recursive: true });
mkdirSync('public/examples', { recursive: true });
mkdirSync('docs/images', { recursive: true });

/** Inquadra la scena da un punto di vista a tre quarti, attorno a `target`, a `distance` mm di distanza. */
async function frame(page: Page, target: Vec, distance: number) {
  await page.evaluate(([t, d]) => {
    const s = window.__r3f! as unknown as {
      camera: { position: { set: (x: number, y: number, z: number) => void }; updateProjectionMatrix: () => void };
      controls?: { target: { set: (x: number, y: number, z: number) => void }; update: () => void };
      invalidate: () => void;
    };
    s.camera.position.set(t[0] + d * 0.55, t[1] - d * 0.7, t[2] + d * 0.5);
    s.controls?.target.set(t[0], t[1], t[2]);
    s.controls?.update();
    s.camera.updateProjectionMatrix();
    s.invalidate();
  }, [target, distance] as const);
  await page.waitForTimeout(250);
}

/** Salva l'area della vista 3D (con il pannello dello strumento aperto) come WebP piccolo per il tooltip. */
async function help(page: Page, name: string) {
  await page.waitForTimeout(300);
  const png = await page.locator('.viewport').screenshot();
  await sharp(png).resize({ width: 560 }).webp({ quality: 78 }).toFile(`public/help/${name}.webp`);
}

/** Aggiunge una primitiva con posizione e misure e restituisce il suo id. */
async function add(page: Page, kind: string, patch: Record<string, unknown>): Promise<string> {
  return page.evaluate(([k, p]) => {
    const store = window.__construct!.store;
    store.getState().addPrimitive(k as never);
    const id = store.getState().selection[0];
    store.getState().updateNode(id, p as never);
    return id;
  }, [kind, patch] as const);
}

const select = (page: Page, ids: string[]) => page.evaluate((i) => window.__construct!.store.getState().select(i), ids);
const click = async (page: Page, p: Vec) => {
  const at = await project(page, p);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
};

test.describe('immagini di esempio', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 800 });
    await openApp(page);
  });

  test('raccordo, smusso e smusso angolare', async ({ page }) => {
    for (const [key, name] of [['f', 'fillet'], ['s', 'chamfer']] as const) {
      await page.evaluate(() => window.__construct!.store.getState().clear());
      await addShape(page, 'Cubo');
      await frame(page, [0, 0, 10], 90);
      await page.keyboard.press(key);
      await click(page, [0, 0, 20]);
      await click(page, [0, -10, 10]);
      await settled(page);
      const radius = page.locator('.edge-panel .slider-field').first().locator('.number-field__input');
      await radius.fill('5');
      await radius.press('Enter');
      await settled(page);
      await help(page, name);
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => window.__construct!.store.getState().clear());
    await addShape(page, 'Cubo');
    await frame(page, [0, 0, 10], 90);
    await page.keyboard.press('a');
    await click(page, [9, -9, 20]);
    await settled(page);
    await help(page, 'corner');
  });

  test('guscio, serie e pattern', async ({ page }) => {
    await addShape(page, 'Cubo');
    await frame(page, [0, 0, 10], 90);
    await page.keyboard.press('g');
    await settled(page);
    await help(page, 'shell');
    await page.keyboard.press('Escape');

    await page.keyboard.press('o');
    await settled(page);
    await frame(page, [40, 0, 10], 190);
    await help(page, 'array');
    await page.keyboard.press('Escape');

    await page.evaluate(() => window.__construct!.store.getState().clear());
    await add(page, 'box', { size: [70, 50, 5], position: [0, 0, 2.5] });
    await frame(page, [28, 0, 2.5], 140);
    await page.keyboard.press('z');
    const seed = page.locator('.array-fields__row', { hasText: 'Seme' }).locator('input');
    await seed.fill('7');
    await seed.press('Enter');
    await settled(page);
    await frame(page, [28, 0, 2.5], 140);
    await help(page, 'pattern');
  });

  test('unisci, inviluppo, operandi, misura e appoggia', async ({ page }) => {
    const a = await add(page, 'box', { size: [24, 24, 24], position: [-10, 0, 12] });
    const b = await add(page, 'sphere', { position: [12, 0, 16] });
    await select(page, [a, b]);
    await frame(page, [0, 0, 12], 110);
    await page.keyboard.press('u');
    await settled(page);
    await help(page, 'union');
    await page.keyboard.press('Control+z');
    await select(page, [a, b]);
    await page.keyboard.press('j');
    await settled(page);
    await help(page, 'hull');
    await page.keyboard.press('Control+z');

    await select(page, [a, b]);
    await page.evaluate(() => window.__construct!.store.getState().combineSelected('difference'));
    await settled(page);
    await page.keyboard.press('x');
    await page.waitForTimeout(300);
    await help(page, 'ghost');
    await page.keyboard.press('x');

    await page.evaluate(() => window.__construct!.store.getState().clear());
    await add(page, 'box', { size: [20, 20, 20], position: [0, 0, 10] });
    await frame(page, [0, 0, 10], 90);
    await page.keyboard.press('i');
    await click(page, [9.7, -10, 19.7]);
    await click(page, [-9.7, -10, 19.7]);
    await help(page, 'measure');
    await page.keyboard.press('Escape');

    await page.evaluate(() => window.__construct!.store.getState().clear());
    await add(page, 'box', { size: [20, 20, 20], position: [0, 0, 20], rotation: [25, 20, 0] });
    await frame(page, [0, 0, 18], 100);
    await page.keyboard.press('v');
    await page.mouse.move(...(Object.values(await project(page, [0, -9, 18])) as [number, number]));
    await page.waitForTimeout(300);
    await help(page, 'layflat');

    // Minkowski: un cubo e una piccola sfera nello stesso centro, il cubo esce arrotondato
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__construct!.store.getState().clear());
    const box = await add(page, 'box', { size: [24, 24, 24], position: [0, 0, 15] });
    const ball = await add(page, 'sphere', { radius: 5, position: [0, 0, 15] });
    await select(page, [box, ball]);
    await frame(page, [0, 0, 15], 110);
    await page.keyboard.press('Shift+J');
    await settled(page);
    await help(page, 'minkowski');
  });

  test('anteprime dei modelli di esempio', async ({ page }) => {
    // Ogni esempio si apre dalla sua scheda, si inquadra (Home) e si fotografa la vista 3D in proporzione 8:5
    await page.setViewportSize({ width: 1400, height: 900 });
    for (const id of ['business-card', 'baby-toy', 'bauble']) {
      await openMenuItem(page, 'Modelli di esempio…');
      await page.locator(`.examples__card[data-example="${id}"]`).click();
      await settled(page);
      await page.keyboard.press('Home');
      // Il biglietto si legge dall'alto: dal punto di vista predefinito il testo si vedrebbe al rovescio
      if (id === 'business-card') await page.keyboard.press('7');
      await page.waitForTimeout(400);
      const png = await page.locator('.viewport').screenshot();
      const meta = await sharp(png).metadata();
      // Ritaglio centrale 8:5 e riduzione a 480 px di larghezza
      const width = meta.width!;
      const height = Math.min(meta.height!, Math.round((width * 5) / 8));
      await sharp(png).extract({ left: 0, top: Math.round((meta.height! - height) / 2), width, height }).resize({ width: 480 }).webp({ quality: 80 }).toFile(`public/examples/${id}.webp`);
    }
  });

  test('immagini del README', async ({ page }) => {
    await add(page, 'box', { size: [70, 50, 5], position: [0, 0, 2.5] });
    await frame(page, [28, 0, 2.5], 140);
    await page.keyboard.press('z');
    const seed = page.locator('.array-fields__row', { hasText: 'Seme' }).locator('input');
    await seed.fill('7');
    await seed.press('Enter');
    await settled(page);
    await frame(page, [28, 0, 2.5], 140);
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'docs/images/pattern.png' });
    await page.getByRole('region', { name: 'Pattern' }).getByRole('button', { name: 'OK' }).click();
    await settled(page);
    await page.keyboard.press('c');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'docs/images/codice-openscad.png' });
    await page.keyboard.press('c');

    await page.evaluate(() => window.__construct!.store.getState().clear());
    await add(page, 'box', { size: [20, 20, 20], position: [0, 0, 10] });
    await frame(page, [40, 0, 10], 190);
    await page.keyboard.press('o');
    await settled(page);
    await frame(page, [40, 0, 10], 190);
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'docs/images/serie.png' });
  });
});

import { expect, test } from '@playwright/test';
import { openApp, openMenuItem, sceneState, settled } from './helpers';

/** Importa un file .scad dal pannello Importa del menu. */
async function importScad(page: import('@playwright/test').Page, name: string, code: string) {
  await openApp(page);
  await openMenuItem(page, 'Importa');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('dialog', { name: 'Importa' }).getByRole('button', { name: 'OpenSCAD', exact: true }).click();
  const file = await chooser;
  await file.setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(code) });
  await settled(page);
}

test('Importa OpenSCAD con un errore di sintassi: la modale dice la riga e mostra il frammento di codice', async ({ page }) => {
  await importScad(page, 'rotto.scad', 'cube(10);\ncube(20);\ncube(;\ncube(30);\n');
  const report = page.getByRole('dialog', { name: 'Importazione di rotto.scad' });
  await expect(report).toBeVisible();
  await expect(report.getByText('Non è stato importato nessun oggetto.')).toBeVisible();
  await expect(report.getByText('riga 3', { exact: true })).toBeVisible();
  // Il frammento ha due righe prima e una dopo, con quella dell'errore evidenziata
  const code = report.getByLabel('Codice vicino alla riga 3');
  await expect(code).toContainText('cube(20);');
  await expect(code).toContainText('cube(;');
  await expect(code.locator('.scad-report__row--hit')).toContainText('cube(;');
  expect((await sceneState(page)).rootIds).toHaveLength(0);
  // La modale si chiude con Esc
  await page.keyboard.press('Escape');
  await expect(report).toBeHidden();
});

test('Importa OpenSCAD con comandi non gestiti: il resto si importa e ogni comando ha la sua riga', async ({ page }) => {
  await importScad(page, 'misto.scad', 'color("tomato") cube(5);\nprojection() cube(2);\nb = foo(1);\nsphere(3);\n');
  const report = page.getByRole('dialog', { name: 'Importazione di misto.scad' });
  await expect(report).toBeVisible();
  await expect(report.getByText('Importati 2 oggetti.')).toBeVisible();
  await expect(report.getByText(/projection\(\) non è supportato/)).toBeVisible();
  await expect(report.getByLabel('Codice vicino alla riga 2')).toContainText('projection() cube(2);');
  await expect(report.getByText(/Funzione non supportata: foo\(\)/)).toBeVisible();
  // Il colore con nome CSS è stato letto
  const scene = await sceneState(page);
  expect(scene.nodes[scene.rootIds[0]].color).toBe('#ff6347');
});

test('Importa OpenSCAD senza problemi: nessuna modale', async ({ page }) => {
  await importScad(page, 'pulito.scad', 'cube(5);\n');
  await expect(page.getByText(/pulito\.scad: importati 1 oggetto/)).toBeVisible();
  await expect(page.getByRole('dialog', { name: /Importazione di/ })).toHaveCount(0);
});

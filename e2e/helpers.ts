import { expect, type Page } from '@playwright/test';

/** Apre l'app con un database pulito e attende che il kernel sia pronto. */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  // Database pulito: la scena salvata da un test precedente non deve influenzare il successivo
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    await Promise.all(dbs.map((d) => new Promise((res) => { const r = indexedDB.deleteDatabase(d.name!); r.onsuccess = r.onerror = r.onblocked = () => res(null); })));
    localStorage.clear();
  });
  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => !!window.__webcad && !!window.__r3f);
}

/** Aspetta che il kernel abbia terminato il calcolo e che i risultati riflettano la scena. */
export async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window.__webcad!;
    const roots = w.store.getState().scene.rootIds.length;
    const { meshes, busy } = w.results.getState();
    return !busy && meshes.length === roots;
  });
}

export async function addShape(page: Page, label: string): Promise<void> {
  // Il nome accessibile dei pulsanti è il testo ("Scatola"): la descrizione "Aggiungi: …" sta nel title
  await page.locator(`button[title^="Aggiungi: ${label}"]`).click();
  await settled(page);
}

export const sceneState = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__webcad!.store.getState().scene)));

/** Punto dello schermo (in pixel di pagina) corrispondente a una posizione del mondo. */
export function project(page: Page, p: [number, number, number]) {
  return page.evaluate(([x, y, z]) => {
    const s = window.__r3f!;
    const V = s.camera.position.constructor as new (x: number, y: number, z: number) => { project(c: unknown): { x: number; y: number } };
    const v = new V(x, y, z).project(s.camera);
    const r = s.gl.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, p);
}

/** Asse del gizmo sotto il puntatore (null se il cursore non è su una maniglia o il gizmo non esiste). */
export function hoveredAxis(page: Page) {
  return page.evaluate(() => {
    let axis: string | null | undefined;
    window.__r3f!.scene.traverse((o) => {
      const c = o as unknown as { isTransformControls?: boolean; axis?: string | null };
      if (c.isTransformControls) axis = c.axis ?? null;
    });
    return axis;
  });
}

/**
 * Trascina la maniglia dell'asse X del gizmo, come farebbe una persona: prima si porta il puntatore sopra la maniglia
 * (il gizmo attiva l'asse solo con un movimento di hover), poi si preme, si trascina a piccoli passi e si rilascia.
 */
export async function dragGizmoAlongX(page: Page, center: [number, number, number], pixels = 90): Promise<void> {
  const origin = await project(page, center);
  const ahead = await project(page, [center[0] + 1, center[1], center[2]]);
  // Direzione dell'asse X sullo schermo, normalizzata
  const len = Math.hypot(ahead.x - origin.x, ahead.y - origin.y);
  const dir = { x: (ahead.x - origin.x) / len, y: (ahead.y - origin.y) / len };

  // Cerca lungo l'asse il punto in cui il gizmo riconosce la maniglia X
  let found: { x: number; y: number } | undefined;
  for (let d = 10; d <= 120 && !found; d += 6) {
    const pt = { x: origin.x + dir.x * d, y: origin.y + dir.y * d };
    await page.mouse.move(pt.x, pt.y);
    if ((await hoveredAxis(page)) === 'X') found = pt;
  }
  expect(found, 'la maniglia X del gizmo deve essere raggiungibile con il puntatore').toBeDefined();

  await page.mouse.down();
  const steps = 15;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(found!.x + (dir.x * pixels * i) / steps, found!.y + (dir.y * pixels * i) / steps);
  }
  await page.mouse.up();
}

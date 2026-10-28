import { expect, type Page, test } from '@playwright/test';

/** Read the active tree straight from storage – what the player would get back after a reload. */
async function savedActive(page: Page) {
  return page.evaluate(() => {
    const prof = JSON.parse(localStorage.getItem('bonsai.v1.profile') ?? 'null');
    const id = prof?.activeTreeId as string | undefined;
    if (!id) return null;
    const raw = localStorage.getItem(`bonsai.v1.tree.${id}`);
    if (!raw) return null;
    const rec = JSON.parse(raw).record;
    return {
      id,
      name: rec.name as string,
      branches: Object.keys(rec.work.tree.branches).length,
      day: rec.work.tree.day as number,
      cuts: rec.work.tree.stats.cuts as number,
      tree: rec.work.tree,
      pot: rec.work.pot,
    };
  });
}

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('[data-testid=viewport] canvas')).toBeVisible();
  // Let the first frames render.
  await page.waitForTimeout(600);
}

async function waitSaved(page: Page) {
  await expect(page.getByTestId('save-badge')).toHaveText(/Saved/);
}

test('first session: select, cut, undo, redo and survive a reload', async ({ page }) => {
  await open(page);
  await waitSaved(page);
  const before = await savedActive(page);
  expect(before).not.toBeNull();

  // Keyboard path to select a branch (accessible alternative to tapping).
  await page.keyboard.press(']');
  await expect(page.getByTestId('cut-button')).toBeEnabled();
  await page.getByTestId('cut-button').click();
  await page.waitForTimeout(700);
  await waitSaved(page);
  const afterCut = await savedActive(page);
  expect(afterCut!.branches).toBeLessThan(before!.branches);
  expect(afterCut!.cuts).toBe(1);

  await page.getByTestId('undo').click();
  await page.waitForTimeout(700);
  expect((await savedActive(page))!.branches).toBe(before!.branches);

  await page.getByTestId('redo').click();
  await page.waitForTimeout(700);
  expect((await savedActive(page))!.branches).toBe(afterCut!.branches);

  await page.reload();
  await expect(page.locator('[data-testid=viewport] canvas')).toBeVisible();
  const reloaded = await savedActive(page);
  expect(reloaded!.id).toBe(before!.id);
  expect(reloaded!.branches).toBe(afterCut!.branches);
  // Undo history is per session; the edit itself persisted.
  await expect(page.getByTestId('undo')).toBeDisabled();
});

test('tapping the tree selects a branch; dragging only turns the camera', async ({ page }) => {
  await open(page);
  const box = (await page.getByTestId('viewport').boundingBox())!;
  const before = await savedActive(page);

  // A drag across the tree must not select or cut anything.
  await page.mouse.move(box.x + 80, box.y + 260);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 80 + i * 18, box.y + 260 + i * 2);
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('cut-button')).toHaveCount(0);

  // Tap around the canopy until a branch is chosen.
  let selected = false;
  outer: for (let y = 120; y <= 420; y += 30) {
    for (let x = 60; x <= box.width - 60; x += 35) {
      await page.touchscreen.tap(box.x + x, box.y + y);
      if (await page.getByTestId('cut-button').count()) {
        selected = true;
        break outer;
      }
    }
  }
  expect(selected).toBe(true);
  await expect(page.getByTestId('panel-prune')).toContainText(/branch|Twig|Trunk/);
  expect((await savedActive(page))!.branches).toBe(before!.branches);
});

test('shaping with a handle changes real branch geometry', async ({ page }) => {
  await open(page);
  await page.getByTestId('tool-shape').click();
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  const tip = page.locator('.handle.tip');
  await expect(tip).toBeVisible();
  const sel = await page.evaluate(() => document.querySelector('.panel-title')?.textContent);
  expect(sel).toBeTruthy();
  const before = await savedActive(page);
  const b = (await tip.boundingBox())!;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 4, cy - i * 8);
  await page.mouse.up();
  await page.waitForTimeout(900);
  await waitSaved(page);
  const after = await savedActive(page);
  expect(after!.tree.stats.bends).toBe(before!.tree.stats.bends + 1);
  const changed = Object.keys(after!.tree.branches).some((id) => {
    const a = after!.tree.branches[id].shape;
    const p = before!.tree.branches[id]?.shape;
    return p && (Math.abs(a.divergence - p.divergence) > 1e-4 || Math.abs(a.roll - p.roll) > 1e-4);
  });
  expect(changed).toBe(true);
});

test('wire, growth and pot changes are real and saved', async ({ page }) => {
  await open(page);
  await page.getByTestId('tool-wire').click();
  // Step through branches until one is thin enough to take wire (trunk wood is refused).
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(']');
    if (await page.getByTestId('apply-wire').isEnabled()) break;
  }
  await page.getByTestId('apply-wire').click();
  await page.waitForTimeout(500);
  await waitSaved(page);
  let saved = await savedActive(page);
  expect(Object.values(saved!.tree.branches).some((b) => (b as { wire: unknown }).wire)).toBe(true);

  await page.getByTestId('tool-grow').click();
  const day = saved!.day;
  await page.getByTestId('grow-season').click();
  await page.waitForTimeout(800);
  await waitSaved(page);
  saved = await savedActive(page);
  expect(saved!.day).toBe(day + 90);

  await page.getByTestId('tool-pot').click();
  await page.getByRole('button', { name: 'Oval' }).click();
  await page.waitForTimeout(600);
  await waitSaved(page);
  expect((await savedActive(page))!.pot.shape).toBe('oval');
});

test('a challenge can be played from start to judging', async ({ page }) => {
  await open(page);
  await page.getByTestId('tab-challenges').click();
  await page.getByTestId('variant-windswept-juniper').click();
  await page.getByTestId('begin-challenge').click();
  await expect(page.getByTestId('challenge-hud')).toBeVisible();
  // Make a cut so the attempt has a move recorded.
  await page.keyboard.press(']');
  await page.getByTestId('cut-button').click();
  await page.waitForTimeout(600);
  await page.getByTestId('submit-challenge').click();
  await expect(page.getByTestId('sheet-challengeResult')).toBeVisible();
  const score = Number(await page.getByTestId('result-score').textContent());
  expect(score).toBeGreaterThanOrEqual(0);
  expect(score).toBeLessThanOrEqual(100);
  await page.getByRole('button', { name: 'All challenges' }).click();
  await expect(page.getByTestId('variant-windswept-juniper')).toContainText(/best \d+/);
});

test('portrait capture lands in the gallery', async ({ page }) => {
  await open(page);
  await page.getByTestId('tab-gallery').click();
  await page.getByRole('button', { name: 'Portrait' }).first().click();
  await expect(page.getByTestId('portrait')).toBeVisible();
  await page.waitForTimeout(800);
  await page.getByTestId('capture').click();
  await expect(page.getByText('Portrait saved to your Gallery.')).toBeVisible();
  await page.getByRole('button', { name: 'Close portrait mode' }).click();
  await expect(page.locator('.portrait-tile')).toHaveCount(1);
});

test('collection: new tree, rename and delete', async ({ page }) => {
  await open(page);
  await page.getByTestId('tab-collection').click();
  await page.getByTestId('new-tree').click();
  await page.getByTestId('species-pine').click();
  await page.getByTestId('plant').click();
  await expect(page.locator('.tree-title')).toContainText('Pine');
  await page.getByTestId('tab-collection').click();
  await expect(page.getByTestId('tree-card')).toHaveCount(2);
  await page.getByRole('button', { name: /Options for .*Pine/ }).click();
  await page.getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('Tree name').fill('Storm Pine');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByTestId('collection')).toContainText('Storm Pine');
  await page.getByRole('button', { name: 'Options for Storm Pine' }).click();
  await page.getByRole('button', { name: 'Delete tree' }).click();
  await page.getByTestId('confirm-delete').click();
  await expect(page.getByTestId('tree-card')).toHaveCount(1);
  await page.reload();
  await page.getByTestId('tab-collection').click();
  await expect(page.getByTestId('tree-card')).toHaveCount(1);
});

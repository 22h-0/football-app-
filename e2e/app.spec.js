import { expect, test } from '@playwright/test';

test('full match flow saves players, balances, copies and reshuffles teams', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Less planning. More playing.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /skill \d+$/ })).toHaveCount(16);
  await expect(page.getByRole('button', { name: /skill \d+$/, pressed: true })).toHaveCount(12);
  await page.screenshot({ path: `/tmp/sideline-${testInfo.project.name}-matchday.png`, fullPage: true });
  await page.getByRole('button', { name: 'Manage roster' }).click();
  await page.getByRole('button', { name: 'Add player', exact: true }).click();
  await page.getByLabel('Player name').fill('Alex Morgan');
  await page.getByLabel('Skill rating', { exact: true }).fill('92');
  await page.getByRole('button', { name: 'Add player', exact: true }).last().click();
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Alex Morgan' }).click();
  await page.getByLabel('Player name').fill('Alex Morgan Jr');
  await page.getByLabel('Skill rating', { exact: true }).fill('95');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.reload();
  await page.getByRole('button', { name: /Player roster/ }).click();
  await expect(page.getByText('Alex Morgan Jr', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set up a match' }).click();
  await expect(page.getByRole('button', { name: 'Alex Morgan Jr, skill 95' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generate teams' })).toBeDisabled();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByRole('button', { name: 'More teams' }).click();
  await page.getByRole('button', { name: 'Generate teams' }).click();
  await expect(page.getByRole('heading', { name: 'Team A', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Team C', exact: true })).toBeVisible();
  await expect(page.locator('.team-player-list li')).toHaveCount(17);
  const sizes = await page.locator('.team-player-list').evaluateAll((lists) => lists.map((list) => list.children.length));
  expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `/tmp/sideline-${testInfo.project.name}-teams.png`, fullPage: true });
  // A stub avoids OS clipboard permissions on mobile while checking the exact outgoing text.
  await page.evaluate(() => {
    window.__copied = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__copied = text; } } });
  });
  await page.getByRole('button', { name: 'Copy teams for WhatsApp' }).click();
  await expect(page.getByRole('button', { name: 'Copied to clipboard' })).toBeVisible();
  const text = await page.evaluate(() => window.__copied);
  expect(text).toContain('Alex Morgan Jr (95)');
  expect(text).toContain('Team C');
  await page.getByRole('button', { name: 'Shuffle again' }).click();
  await expect(page.locator('.team-player-list li')).toHaveCount(17);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('deleting, empty selection, persistence and denied clipboard work', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Player roster/ }).click();
  await page.getByRole('button', { name: 'Delete Jamie Cole' }).click();
  await page.getByRole('button', { name: 'Keep player' }).click();
  await expect(page.getByText('Jamie Cole', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Jamie Cole' }).click();
  await page.getByRole('button', { name: 'Remove player', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Jamie Cole, skill 88' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Generate teams' }).click();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Denied'); } } }));
  await page.getByRole('button', { name: 'Copy teams for WhatsApp' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Team lists to copy' })).toContainText('SIDELINE');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('empty saved roster stays empty and name validation is enforced', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sideline.roster.v1', JSON.stringify({ version: 1, players: [], selectedIds: [] })));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Every great game starts with a squad.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate teams' })).toBeDisabled();
  await page.getByRole('button', { name: 'Add your first player' }).click();
  await page.getByLabel('Player name').fill('   ');
  await page.getByRole('button', { name: 'Add player', exact: true }).last().click();
  await expect(page.getByRole('alert')).toContainText('Enter a player name');
  await page.getByLabel('Player name').fill('New Player');
  await page.getByRole('button', { name: 'Add player', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'New Player, skill 50' })).toBeVisible();
});

test('layouts fit small phones, tablets and desktops without horizontal scrolling', async ({ page }) => {
  await page.goto('/');
  for (const width of [320, 375, 520, 700, 768, 960, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Matchday fits ${width}px`).toBe(true);
  }
  await page.getByRole('button', { name: 'Generate teams' }).click();
  await expect(page.getByRole('heading', { name: 'Your teams. Your game.' })).toBeFocused();
  for (const width of [320, 520, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Results fit ${width}px`).toBe(true);
  }
});

import { expect, test } from '@playwright/test';

async function activeTournament(page) {
  return page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('sideline.tournaments.v1'));
    return saved.tournaments.find((tournament) => tournament.id === saved.activeId);
  });
}

function fixtureLabel(tournament, fixture) {
  const names = new Map(tournament.teams.map((team) => [team.id, team.name]));
  return `${names.get(fixture.homeId)} vs ${names.get(fixture.awayId)}`;
}

function fixtureRow(page, tournament, fixture) {
  return page.getByRole('article', { name: fixtureLabel(tournament, fixture), exact: true });
}

async function saveResult(page, tournament, fixture, home, away) {
  const label = fixtureLabel(tournament, fixture);
  const row = fixtureRow(page, tournament, fixture);
  await row.getByRole('spinbutton', { name: `Home score: ${label}`, exact: true }).fill(String(home));
  await row.getByRole('spinbutton', { name: `Away score: ${label}`, exact: true }).fill(String(away));
  await row.getByRole('button', { name: `Save result for ${label}`, exact: true }).click();
  await expect(row.getByText('FULL TIME', { exact: true })).toBeVisible();
}

async function createCustom(page, name, count = 3, doubleRoundRobin = false) {
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.getByRole('button', { name: 'New tournament', exact: true }).click();
  await page.getByLabel('Tournament name', { exact: true }).fill(name);
  await page.getByLabel('Number of teams', { exact: true }).selectOption(String(count));
  await page.getByLabel('Format', { exact: true }).selectOption(doubleRoundRobin ? 'double' : 'single');
  await page.getByLabel('First match date', { exact: true }).fill('2026-10-27');
  await page.getByLabel('First kickoff', { exact: true }).fill('19:00');
  await page.getByLabel('Match length (minutes)', { exact: true }).fill('20');
  await page.getByLabel('Break (minutes)', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Create tournament', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return activeTournament(page);
}

test('schedule, zero scores, standings, winners, corrections and kickoff times persist', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const tournament = await createCustom(page, 'Test Cup');
  await expect(page.getByRole('article')).toHaveCount(3);
  await expect(page.locator('.bye-note')).toHaveCount(3);
  expect(tournament.fixtures.map((fixture) => fixture.kickoff)).toEqual(['2026-10-27T19:00', '2026-10-27T19:25', '2026-10-27T19:50']);
  await expect(page.locator('.tournament-leader')).toContainText('ALL TO PLAY FOR');

  const first = tournament.fixtures[0];
  await saveResult(page, tournament, first, 0, 0);
  await expect(page.locator('.tournament-overview')).toContainText('1 of 3 matches played');
  await page.reload();
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await expect(fixtureRow(page, tournament, first).getByRole('spinbutton').first()).toHaveValue('0');
  await expect(fixtureRow(page, tournament, first).getByRole('spinbutton').last()).toHaveValue('0');

  for (const fixture of tournament.fixtures.slice(1)) await saveResult(page, tournament, fixture, 0, 0);
  await expect(page.locator('.tournament-overview')).toContainText('Tournament complete');
  await expect(page.locator('.tournament-leader')).toContainText('JOINT WINNERS');
  await expect(page.locator('.standings-table tbody tr')).toHaveCount(3);
  for (const row of await page.locator('.standings-table tbody tr').all()) await expect(row.locator('td').first()).toHaveText('1');

  await saveResult(page, tournament, first, 1, 0);
  const champion = tournament.teams.find((team) => team.id === first.homeId).name;
  await expect(page.locator('.champion-banner')).toContainText('YOUR CHAMPIONS');
  await expect(page.locator('.champion-banner h3')).toHaveText(champion);
  await fixtureRow(page, tournament, first).getByRole('button', { name: `Clear result for ${fixtureLabel(tournament, first)}`, exact: true }).click();
  await expect(page.locator('.tournament-overview')).toContainText('2 of 3 matches played');
  await expect(page.locator('.champion-banner')).toHaveCount(0);
  await expect(fixtureRow(page, tournament, first).getByRole('spinbutton').first()).toHaveValue('');
  await saveResult(page, tournament, first, 2, 1);
  const firstRow = fixtureRow(page, tournament, first);
  await firstRow.locator('summary').click();
  await firstRow.getByLabel(`Kickoff for ${fixtureLabel(tournament, first)}`, { exact: true }).fill('2026-10-28T20:00');
  await firstRow.getByRole('button', { name: `Save kickoff for ${fixtureLabel(tournament, first)}`, exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  expect((await activeTournament(page)).fixtures[0]).toMatchObject({ kickoff: '2026-10-28T20:00', homeScore: 2, awayScore: 1 });
  await expect(page.locator('.champion-banner h3')).toHaveText(champion);
  await page.screenshot({ path: `/tmp/sideline-${testInfo.project.name}-tournament.png`, fullPage: true });

  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Denied'); } } }));
  await page.getByRole('button', { name: 'Copy schedule & table', exact: true }).click();
  const share = page.getByRole('textbox', { name: 'Tournament schedule and standings to copy' });
  await expect(share).toContainText('Test Cup');
  await expect(share).toContainText(`Winner: ${champion}`);
  await expect(share).toContainText('3/3 matches played');
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Sharing dialog fits a 320px phone').toBe(true);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  for (const width of [320, 375, 700, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Tournament fits ${width}px`).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('balanced team snapshots survive later roster changes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'More teams', exact: true }).click();
  await page.getByRole('button', { name: 'Generate teams', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Team C', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create tournament', exact: true }).click();
  await expect(page.getByRole('radio', { name: /Use balanced teams/ })).toBeChecked();
  await page.getByLabel('Tournament name', { exact: true }).fill('Balanced Cup');
  await page.getByRole('button', { name: 'Create tournament', exact: true }).click();
  const before = await activeTournament(page);
  expect(before.teams).toHaveLength(3);
  expect(before.teams.flatMap((team) => team.players)).toHaveLength(12);
  expect(before.teams.flatMap((team) => team.players).some((player) => player.name === 'Jamie Cole')).toBe(true);
  await page.getByRole('button', { name: /Player roster/ }).click();
  await page.getByRole('button', { name: 'Edit Jamie Cole', exact: true }).click();
  await page.getByLabel('Player name', { exact: true }).fill('Jamie Changed');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.locator('.tournament-squads > summary').click();
  await expect(page.locator('.tournament-squads')).toContainText('Jamie Cole');
  await expect(page.locator('.tournament-squads')).not.toContainText('Jamie Changed');
  expect((await activeTournament(page)).teams).toEqual(before.teams);
});

test('multiple cups can be switched, double fixtures created, and deletion requires confirmation', async ({ page }) => {
  await page.goto('/');
  const first = await createCustom(page, 'First Cup', 2);
  const second = await createCustom(page, 'Return Cup', 2, true);
  await expect(page.getByRole('article')).toHaveCount(2);
  expect(second.fixtures[0].homeId).toBe(second.fixtures[1].awayId);
  expect(second.fixtures[0].awayId).toBe(second.fixtures[1].homeId);
  await saveResult(page, second, second.fixtures[0], 2, 0);
  await page.getByRole('combobox', { name: 'Saved tournament', exact: true }).selectOption(first.id);
  await expect(page.getByRole('heading', { name: 'First Cup', exact: true })).toBeVisible();
  await expect(page.locator('.tournament-overview')).toContainText('0 of 1 matches played');
  await page.getByRole('combobox', { name: 'Saved tournament', exact: true }).selectOption(second.id);
  await expect(page.locator('.tournament-overview')).toContainText('1 of 2 matches played');
  await page.getByRole('button', { name: 'Delete tournament', exact: true }).click();
  await page.getByRole('button', { name: 'Keep tournament', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Return Cup', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete tournament', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete tournament', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'First Cup', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'First Cup', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Saved tournament', exact: true }).locator('option')).toHaveCount(1);
});

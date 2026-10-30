import { expect, test } from '@playwright/test';

const PASSWORD = 'Sideline.Matchday.2026';
const unique = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

async function api(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, {
      method, credentials: 'same-origin', headers: { 'X-Sideline-Client': 'web', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  }, { path, method, body });
}

async function register(dialog, username) {
  await dialog.getByLabel('Username', { exact: true }).fill(username);
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Create account', exact: true }).last().click();
  await expect(dialog).toHaveCount(0);
}

async function newCup(page, owner, name) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.getByRole('button', { name: 'New tournament', exact: true }).click();
  await register(page.getByRole('dialog', { name: 'Your club. Your call.' }), owner);
  const setup = page.getByRole('dialog', { name: 'A new cup. A new story.' });
  await setup.getByLabel('Tournament name', { exact: true }).fill(name);
  await setup.getByLabel('Number of teams', { exact: true }).selectOption('2');
  await setup.getByRole('checkbox', { name: 'Schedule kickoff times' }).uncheck();
  await setup.getByRole('button', { name: 'Create tournament', exact: true }).click();
  await expect(setup).toHaveCount(0);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return (await api(page, '/api/tournaments')).data.tournaments[0];
}

async function score(page, home, away) {
  const row = page.locator('.fixture-row').first();
  await row.getByRole('spinbutton').first().fill(String(home));
  await row.getByRole('spinbutton').last().fill(String(away));
  const saved = page.waitForResponse((response) => /\/api\/tournaments\/[^/]+\/fixtures\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'PATCH');
  await row.getByRole('button', { name: /Save result for/ }).click();
  expect((await saved).status()).toBe(200);
  await expect(row.getByText('FULL TIME', { exact: true })).toBeVisible();
}

async function share(page) {
  await page.getByRole('button', { name: 'Share viewer link', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Your group. Front-row seats.' });
  await dialog.getByRole('button', { name: 'Create / renew viewer link', exact: true }).click();
  const field = dialog.getByLabel('Read-only tournament link', { exact: true });
  await expect(field).toHaveValue(/\/watch\/[A-Za-z0-9_-]+$/);
  const url = await field.inputValue();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  return url;
}

async function signIn(page, username, password = PASSWORD) {
  await page.getByRole('button', { name: 'Sign in / Create account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Sign in', exact: true }).click();
  await dialog.getByLabel('Username', { exact: true }).fill(username);
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  return dialog;
}

test('only the creator can edit live results; anonymous viewers and other accounts cannot write', async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(90_000);
  const owner = unique('owner');
  const name = `Live cup ${owner}`;
  const viewerContext = await browser.newContext({ baseURL });
  const strangerContext = await browser.newContext({ baseURL });
  try {
    const tournament = await newCup(page, owner, name);
    const fixture = tournament.fixtures[0];
    const homeName = tournament.teams.find((team) => team.id === fixture.homeId).name;
    const ownerId = (await api(page, '/api/session')).data.user.id;
    await score(page, 2, 1);
    await page.locator('.fixture-row').first().getByRole('button', { name: /Goalscorers for/ }).click();
    const scorers = page.getByRole('dialog', { name: 'Who found the net?' });
    await scorers.getByRole('button', { name: `Add scorer for ${homeName}`, exact: true }).click();
    await scorers.getByLabel(`Goalscorer 1 for ${homeName}`, { exact: true }).fill('Alex Morgan');
    await scorers.getByRole('spinbutton', { name: `Goals by scorer 1 for ${homeName}`, exact: true }).fill('2');
    await scorers.getByRole('button', { name: 'Save goalscorers', exact: true }).click();
    await expect(scorers).toHaveCount(0);
    const url = await share(page);
    const viewer = await viewerContext.newPage();
    await viewer.goto(url);
    await expect(viewer.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(viewer.getByText('Spectator view', { exact: true })).toBeVisible();
    const publicHome = viewer.locator('.fixture-row').first().locator('.readonly-scores strong').first();
    await expect(publicHome).toHaveText('2');
    await expect(viewer.getByRole('spinbutton')).toHaveCount(0);
    await expect(viewer.locator('.scorers-table')).toContainText('Alex Morgan');
    await expect(viewer.locator('.standings-table')).toBeVisible();
    for (const label of [/Save result for/, /Goalscorers for/, /^New tournament$/, /^Delete tournament$/, /Clear result for/]) await expect(viewer.getByRole('button', { name: label })).toHaveCount(0);
    await score(page, 3, 1);
    await viewer.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(publicHome).toHaveText('3');
    const latest = (await api(page, '/api/tournaments')).data.tournaments[0];
    const token = new URL(url).pathname.split('/').at(-1);
    const endpoint = `/api/tournaments/${tournament.id}`;
    const forged = { expectedRevision: latest.revision, ownerId, userId: ownerId, shareToken: token, kind: 'score', homeScore: 99, awayScore: 0 };
    expect((await api(viewer, `${endpoint}/fixtures/${fixture.id}`, 'PATCH', forged)).status).toBe(401);
    expect((await api(viewer, endpoint, 'DELETE', forged)).status).toBe(401);
    expect((await api(viewer, `/api/shared/${token}`)).data.tournament.fixtures[0].homeScore).toBe(3);
    const stranger = await strangerContext.newPage();
    await stranger.goto('/');
    await stranger.getByRole('button', { name: 'Sign in / Create account', exact: true }).click();
    await register(stranger.getByRole('dialog'), unique('stranger'));
    await stranger.getByRole('button', { name: 'Tournaments', exact: true }).click();
    await expect(stranger.getByRole('heading', { name, exact: true })).toHaveCount(0);
    expect((await api(stranger, '/api/tournaments')).data.tournaments).toEqual([]);
    expect((await api(stranger, `${endpoint}/fixtures/${fixture.id}`, 'PATCH', forged)).status).toBe(404);
    expect((await api(stranger, endpoint, 'DELETE', forged)).status).toBe(404);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
    await expect(await signIn(page, owner)).toHaveCount(0);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.locator('.fixture-row').first().getByRole('spinbutton').first()).toHaveValue('3');
    await viewer.setViewportSize({ width: testInfo.project.name === 'mobile' ? 320 : 1440, height: 950 });
    expect(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await viewer.evaluate(() => window.scrollTo(0, 0));
    await viewer.screenshot({ path: `/tmp/sideline-public-viewer-${testInfo.project.name}.png`, fullPage: true });
  } finally { await viewerContext.close(); await strangerContext.close(); }
});

test('accounts persist across reloads, invalid passwords fail and rotating a link revokes the old view', async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  const owner = unique('captain');
  const name = `Shared cup ${owner}`;
  const viewerContext = await browser.newContext({ baseURL });
  try {
    await newCup(page, owner, name);
    await score(page, 1, 0);
    const old = await share(page);
    const viewer = await viewerContext.newPage();
    await viewer.goto(old);
    await expect(viewer.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(`Signed in as ${owner}`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    const replacement = await share(page);
    expect(replacement).not.toBe(old);
    await viewer.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(viewer.getByRole('heading', { name: 'Tournament unavailable', exact: true })).toBeVisible();
    await expect(viewer.locator('.fixture-row')).toHaveCount(0);
    await viewer.goto(replacement);
    await expect(viewer.getByRole('heading', { name, exact: true })).toBeVisible();
    await score(page, 2, 0);
    await expect(viewer.locator('.fixture-row').first().locator('.readonly-scores strong').first()).toHaveText('2', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    const dialog = await signIn(page, owner, 'incorrect-password');
    await expect(dialog.getByRole('alert')).toContainText(/password|credentials|sign.in/i);
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
    expect((await api(page, '/api/tournaments')).status).toBe(401);
    await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).last().click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.fixture-row').first().getByRole('spinbutton').first()).toHaveValue('2');
  } finally { await viewerContext.close(); }
});

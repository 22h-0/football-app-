import { expect, test } from '@playwright/test';

const unique = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

async function api(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-Sideline-Client': 'web', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json(), cacheControl: response.headers.get('cache-control') };
  }, { path, method, body });
}

async function virtualPasskey(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    // Inspect only public test metadata. Never print/export virtual private keys.
    async state() {
      const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
      return credentials.map(({ signCount, isResidentCredential, rpId }) => ({ signCount, isResidentCredential, rpId }));
    },
    async close() { await cdp.detach().catch(() => {}); },
  };
}

async function register(page, username) {
  const dialog = page.getByRole('dialog', { name: 'Your club. Your call.' });
  await expect(dialog.getByLabel('Username', { exact: true })).toBeEnabled();
  await expect(dialog.getByLabel('Password', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Username', { exact: true }).fill(username);
  const verification = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/passkeys/register/verify' && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
  expect((await verification).status()).toBe(201);
  await expect(dialog).toHaveCount(0);
}

async function newCup(page, username, name) {
  await page.goto('/');
  const session = await api(page, '/api/session');
  expect(session.status).toBe(200);
  expect(session.data.authMode).toBe('passkey');
  expect(session.data.user).toBeNull();
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.getByRole('button', { name: 'New tournament', exact: true }).click();
  await register(page, username);
  const setup = page.getByRole('dialog', { name: 'A new cup. A new story.' });
  await setup.getByLabel('Tournament name', { exact: true }).fill(name);
  await setup.getByLabel('Number of teams', { exact: true }).selectOption('2');
  await setup.getByRole('checkbox', { name: 'Schedule kickoff times' }).uncheck();
  await setup.getByRole('button', { name: 'Create tournament', exact: true }).click();
  await expect(setup).toHaveCount(0);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const saved = await api(page, '/api/tournaments');
  expect(saved.status).toBe(200);
  return saved.data.tournaments.find((tournament) => tournament.name === name);
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

async function viewerLink(page) {
  await page.getByRole('button', { name: 'Share viewer link', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Your group. Front-row seats.' });
  await dialog.getByRole('button', { name: 'Create / renew viewer link', exact: true }).click();
  const field = dialog.getByLabel('Read-only tournament link', { exact: true });
  await expect(field).toHaveValue(/^http:\/\/localhost:8787\/watch\/[A-Za-z0-9_-]+$/);
  const url = await field.inputValue();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  return url;
}

async function signIn(page, username) {
  await page.getByRole('button', { name: 'Sign in / Create account', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Your club. Your call.' });
  await dialog.getByRole('tab', { name: 'Sign in', exact: true }).click();
  await expect(dialog.getByLabel('Password', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Username', { exact: true }).fill(username);
  const verified = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/passkeys/login/verify' && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await verified).status()).toBe(200);
  await expect(dialog).toHaveCount(0);
}

async function expectNoPrivateCaches(page, tournamentName) {
  const session = await api(page, '/api/session');
  const cups = await api(page, '/api/tournaments');
  expect(session.cacheControl).toContain('no-store');
  expect(cups.cacheControl).toContain('no-store');
  const leaks = await page.evaluate(async (name) => {
    const storedTournament = Object.values(localStorage).some((value) => value.includes(name));
    const cachedPrivateURLs = [];
    if ('caches' in window) {
      for (const key of await caches.keys()) {
        for (const request of await (await caches.open(key)).keys()) {
          const path = new URL(request.url).pathname;
          if (path === '/api' || path.startsWith('/api/') || path.startsWith('/watch/')) cachedPrivateURLs.push(path);
        }
      }
    }
    return { storedTournament, cachedPrivateURLs };
  }, tournamentName);
  expect(leaks.storedTournament).toBe(false);
  expect(leaks.cachedPrivateURLs).toEqual([]);
}

test('real passkeys create an owner; D1 scores and goalscorers stay read-only for everyone else', async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const owner = unique('owner');
  const name = `Cloudflare cup ${owner}`;
  const authenticator = await virtualPasskey(page);
  const viewerContext = await browser.newContext({ baseURL });
  const strangerContext = await browser.newContext({ baseURL });
  let strangerAuthenticator;
  try {
    const tournament = await newCup(page, owner, name);
    expect(tournament).toBeTruthy();
    const credentials = await authenticator.state();
    expect(credentials.length).toBe(1);
    expect(credentials[0].rpId).toBe('localhost');
    expect(credentials[0].isResidentCredential).toBe(true);
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
    await expect(page.locator('.scorers-table')).toContainText('Alex Morgan');
    await expect(page.locator('.standings-table tbody tr').first()).toContainText(homeName);
    await expect(page.locator('.standings-table tbody tr').first().locator('.table-points')).toHaveText('3');

    const link = await viewerLink(page);
    const token = new URL(link).pathname.split('/').at(-1);
    const viewer = await viewerContext.newPage();
    await viewer.goto(link);
    await expect(viewer.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(viewer.getByText('Spectator view', { exact: true })).toBeVisible();
    await expect(viewer.locator('.scorers-table')).toContainText('Alex Morgan');
    const publicHome = viewer.locator('.fixture-row').first().locator('.readonly-scores strong').first();
    await expect(publicHome).toHaveText('2');
    await expect(viewer.getByRole('spinbutton')).toHaveCount(0);
    for (const label of [/Save result for/, /Goalscorers for/, /^New tournament$/, /^Delete tournament$/, /Clear result for/]) {
      await expect(viewer.getByRole('button', { name: label })).toHaveCount(0);
    }
    await score(page, 3, 1);
    await viewer.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(publicHome).toHaveText('3');
    const latest = (await api(page, '/api/tournaments')).data.tournaments.find((cup) => cup.id === tournament.id);
    const forged = { expectedRevision: latest.revision, ownerId, userId: ownerId, shareToken: token, kind: 'score', homeScore: 99, awayScore: 0 };
    const endpoint = `/api/tournaments/${tournament.id}`;
    expect((await api(viewer, `${endpoint}/fixtures/${fixture.id}`, 'PATCH', forged)).status).toBe(401);
    expect((await api(viewer, endpoint, 'DELETE', forged)).status).toBe(401);
    expect((await api(viewer, `/api/shared/${token}`)).data.tournament.fixtures[0].homeScore).toBe(3);

    const stranger = await strangerContext.newPage();
    strangerAuthenticator = await virtualPasskey(stranger);
    await stranger.goto('/');
    await stranger.getByRole('button', { name: 'Sign in / Create account', exact: true }).click();
    await register(stranger, unique('stranger'));
    expect((await api(stranger, '/api/tournaments')).data.tournaments).toEqual([]);
    expect((await api(stranger, endpoint)).status).toBe(404);
    expect((await api(stranger, `${endpoint}/fixtures/${fixture.id}`, 'PATCH', forged)).status).toBe(404);
    expect((await api(stranger, endpoint, 'DELETE', forged)).status).toBe(404);
    await expectNoPrivateCaches(page, name);
    await viewer.setViewportSize({ width: testInfo.project.name === 'mobile' ? 320 : 1440, height: 950 });
    expect(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await viewer.screenshot({ path: `/tmp/sideline-cloudflare-${testInfo.project.name}.png`, fullPage: true });
  } finally {
    await authenticator.close();
    await strangerAuthenticator?.close();
    await viewerContext.close();
    await strangerContext.close();
  }
});

test('passkeys sign in again, sessions survive reload, and replacing a viewer link revokes the old view', async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  const owner = unique('captain');
  const name = `Persistent cup ${owner}`;
  const authenticator = await virtualPasskey(page);
  const viewerContext = await browser.newContext({ baseURL });
  const attackerContext = await browser.newContext({ baseURL });
  try {
    await newCup(page, owner, name);
    const initialCredentials = await authenticator.state();
    await score(page, 1, 0);
    const oldLink = await viewerLink(page);
    const viewer = await viewerContext.newPage();
    await viewer.goto(oldLink);
    await expect(viewer.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(`Signed in as ${owner}`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    expect((await api(page, '/api/session')).data.user).toBeNull();
    await signIn(page, owner);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.locator('.fixture-row').first().getByRole('spinbutton').first()).toHaveValue('1');
    const signedCredentials = await authenticator.state();
    expect(signedCredentials[0].signCount).toBeGreaterThan(initialCredentials[0].signCount);

    // This is a new in-memory owner view after reload/sign-in. Create a fresh
    // link, then exercise explicit confirmation when replacing that known link.
    const intermediate = await viewerLink(page);
    await page.getByRole('button', { name: 'Share viewer link', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Your group. Front-row seats.' });
    await dialog.getByRole('button', { name: 'Replace viewer link', exact: true }).click();
    await expect(dialog.getByText('Replace this viewer link?', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Replace link', exact: true }).click();
    const field = dialog.getByLabel('Read-only tournament link', { exact: true });
    await expect(field).not.toHaveValue(intermediate);
    const replacement = await field.inputValue();
    expect(replacement).toMatch(/^http:\/\/localhost:8787\/watch\/[A-Za-z0-9_-]+$/);
    expect(replacement).not.toBe(oldLink);
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await viewer.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(viewer.getByRole('heading', { name: 'Tournament unavailable', exact: true })).toBeVisible();
    await expect(viewer.locator('.fixture-row')).toHaveCount(0);
    await viewer.goto(replacement);
    await expect(viewer.getByRole('heading', { name, exact: true })).toBeVisible();
    await score(page, 2, 0);
    await expect(viewer.locator('.fixture-row').first().locator('.readonly-scores strong').first()).toHaveText('2', { timeout: 15_000 });

    const attacker = await attackerContext.newPage();
    await attacker.goto('/');
    const fake = await api(attacker, '/api/passkeys/login/verify', 'POST', {
      challengeId: 'not-a-valid-challenge',
      response: { id: 'forged', rawId: 'forged', type: 'public-key', response: { authenticatorData: 'AA', clientDataJSON: 'AA', signature: 'AA', userHandle: null }, clientExtensionResults: {} },
    });
    expect([400, 401, 403, 404, 422]).toContain(fake.status);
    expect((await api(attacker, '/api/session')).data.user).toBeNull();
    await expectNoPrivateCaches(page, name);
  } finally {
    await authenticator.close();
    await viewerContext.close();
    await attackerContext.close();
  }
});

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createApp } from './app.js';
import { createTournament, getStandings } from '../src/lib/tournament.js';
import { getTopScorers } from '../src/lib/goalscorers.js';

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'Correct-horse-42!';
const options = (name = 'Shared Cup') => ({
  name,
  teams: [
    { id: 'blue', name: 'Blue', players: [{ id: 'alex', name: 'Alex Morgan', skill: 82 }] },
    { id: 'red', name: 'Red', players: [{ id: 'sam', name: 'Sam Reed', skill: 75 }] },
  ],
  matchMinutes: 20,
  breakMinutes: 5,
});

async function start(databasePath, extra = {}) {
  const instance = createApp({ databasePath, appOrigin: ORIGIN, isProduction: false, ...extra });
  const server = await new Promise((resolve, reject) => {
    const listener = instance.app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.on('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  return {
    ...instance,
    base,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await instance.close();
    },
    async request(url, { method = 'GET', body, cookie, csrf = true, origin, headers = {}, raw } = {}) {
      const requestHeaders = { ...headers };
      if (csrf) requestHeaders['X-Sideline-Client'] = 'web';
      if (body !== undefined || raw !== undefined) requestHeaders['Content-Type'] = 'application/json';
      if (cookie) requestHeaders.Cookie = cookie;
      if (origin) requestHeaders.Origin = origin;
      const response = await fetch(`${base}${url}`, { method, headers: requestHeaders, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), redirect: 'manual' });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      return { status: response.status, data, headers: response.headers, cookie: response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ') };
    },
  };
}

async function fixture(t, extra = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sideline-security-'));
  const databasePath = path.join(directory, 'app.sqlite');
  const harness = await start(databasePath, extra);
  t.after(async () => { await harness.close(); await rm(directory, { recursive: true, force: true }); });
  return { ...harness, directory, databasePath };
}

async function register(harness, username = 'organizer') {
  const response = await harness.request('/api/register', { method: 'POST', body: { username, password: PASSWORD } });
  assert.equal(response.status, 201);
  assert.equal(response.data.user.username.toLowerCase(), username.toLowerCase());
  assert.ok(response.data.user.id);
  assert.ok(response.cookie);
  return { cookie: response.cookie, user: response.data.user };
}

async function create(harness, cookie, config = options()) {
  const response = await harness.request('/api/tournaments', { method: 'POST', cookie, body: config });
  assert.equal(response.status, 201);
  assert.equal(response.data.tournament.revision, 1);
  return response.data.tournament;
}

test('accounts validate input, compare names case-insensitively, and use private cookie sessions', async (t) => {
  const h = await fixture(t);
  assert.deepEqual((await h.request('/api/session')).data, { user: null });
  for (const invalid of [{ username: 'ab', password: PASSWORD }, { username: 'unsafe username', password: PASSWORD }, { username: 'a'.repeat(31), password: PASSWORD }, { username: 'valid_name', password: 'short' }, { username: 'valid_name', password: 'a'.repeat(129) }]) {
    assert.equal((await h.request('/api/register', { method: 'POST', body: invalid })).status, 400);
  }
  const response = await h.request('/api/register', { method: 'POST', body: { username: 'Captain.Blue', password: PASSWORD } });
  assert.equal(response.status, 201);
  const setCookie = response.headers.getSetCookie()[0];
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\//i);
  const maxAge = setCookie.match(/Max-Age=(\d+)/i);
  const expires = setCookie.match(/Expires=([^;]+)/i);
  assert.ok(maxAge || expires, 'Sessions must have an explicit seven-day expiry.');
  if (maxAge) assert.equal(Number(maxAge[1]), 7 * 24 * 60 * 60);
  else assert.ok(Math.abs(Date.parse(expires[1]) - Date.now() - 7 * 24 * 60 * 60 * 1000) < 60_000);
  assert.ok(response.cookie.split('=')[1].length >= 43);
  assert.deepEqual(Object.keys(response.data.user).sort(), ['id', 'username']);
  assert.equal((await h.request('/api/register', { method: 'POST', body: { username: 'captain.blue', password: PASSWORD } })).status, 409);
  assert.deepEqual((await h.request('/api/session', { cookie: response.cookie })).data.user, response.data.user);
  assert.equal((await h.request('/api/login', { method: 'POST', body: { username: 'CAPTAIN.BLUE', password: PASSWORD } })).status, 200);
  assert.equal((await h.request('/api/login', { method: 'POST', body: { username: 'captain.blue', password: 'Not-the-right-password' } })).status, 401);
  const logout = await h.request('/api/logout', { method: 'POST', cookie: response.cookie });
  assert.equal(logout.status, 200);
  assert.deepEqual(logout.data, { user: null });
  assert.deepEqual((await h.request('/api/session', { cookie: response.cookie })).data, { user: null });
  assert.equal((await h.request('/api/tournaments', { cookie: response.cookie })).status, 401);
});

test('sessions and password material are not stored as plaintext, and production cookies are secure', async (t) => {
  const h = await fixture(t, { isProduction: true, appOrigin: 'https://sideline.example' });
  const response = await h.request('/api/register', { method: 'POST', origin: 'https://sideline.example', body: { username: 'secure_captain', password: PASSWORD } });
  assert.equal(response.status, 201);
  assert.match(response.headers.getSetCookie()[0], /Secure/i);
  assert.match(response.headers.getSetCookie()[0], /__Host-sideline_session=/);
  assert.doesNotMatch(response.headers.getSetCookie()[0], /Domain=/i);
  const sessionValue = response.cookie.split('=')[1];
  for (const filename of await readdir(h.directory)) {
    const bytes = await readFile(path.join(h.directory, filename));
    assert.equal(bytes.includes(Buffer.from(PASSWORD)), false, 'The database must never retain the account password.');
    assert.equal(bytes.includes(Buffer.from(sessionValue)), false, 'The database must store a hash of the session token.');
  }
});

test('unsafe requests require a client header and an allowed Origin', async (t) => {
  const h = await fixture(t);
  assert.equal((await h.request('/api/register', { method: 'POST', csrf: false, body: { username: 'csrf_user', password: PASSWORD } })).status, 403);
  assert.equal((await h.request('/api/register', { method: 'POST', origin: 'https://attacker.example', body: { username: 'csrf_user', password: PASSWORD } })).status, 403);
  const owner = await register(h);
  assert.equal((await h.request('/api/tournaments', { method: 'POST', cookie: owner.cookie, csrf: false, body: options() })).status, 403);
  assert.equal((await h.request('/api/tournaments', { method: 'POST', cookie: owner.cookie, origin: 'null', body: options() })).status, 403);
  assert.equal((await h.request('/api/tournaments', { method: 'POST', cookie: owner.cookie, origin: ORIGIN, body: options() })).status, 201);
});

test('only the creator can mutate scores, scorers, kickoff, sharing, or delete, even with forged ownership', async (t) => {
  const h = await fixture(t);
  const owner = await register(h, 'creator');
  const stranger = await register(h, 'stranger');
  const tournament = await create(h, owner.cookie);
  const first = tournament.fixtures[0];
  const endpoint = `/api/tournaments/${tournament.id}`;
  const share = await h.request(`${endpoint}/share`, { method: 'POST', cookie: owner.cookie, body: { expectedRevision: 1 } });
  assert.equal(share.status, 200);
  const token = share.data.sharePath.split('/').at(-1);
  assert.match(token, /^[A-Za-z0-9_-]{43,}$/);
  const publicResponse = await h.request(`/api/shared/${token}`);
  assert.equal(publicResponse.status, 200);
  assert.equal(publicResponse.data.readOnly, true);
  assert.equal(publicResponse.data.tournament.id, tournament.id);
  const attempts = [
    { url: `${endpoint}/fixtures/${first.id}`, method: 'PATCH', body: { kind: 'score', homeScore: 9, awayScore: 0, expectedRevision: 1 } },
    { url: `${endpoint}/fixtures/${first.id}`, method: 'PATCH', body: { kind: 'score', homeScore: null, awayScore: null, expectedRevision: 1 } },
    { url: `${endpoint}/fixtures/${first.id}`, method: 'PATCH', body: { kind: 'scorers', entries: [], expectedRevision: 1 } },
    { url: `${endpoint}/fixtures/${first.id}`, method: 'PATCH', body: { kind: 'kickoff', kickoff: '2026-10-27T20:00', expectedRevision: 1 } },
    { url: endpoint, method: 'DELETE', body: { expectedRevision: 1 } },
    { url: `${endpoint}/share`, method: 'POST', body: { expectedRevision: 1 } },
  ];
  for (const attempt of attempts) {
    const body = { ...attempt.body, ownerId: owner.user.id, userId: owner.user.id, shareToken: token };
    assert.equal((await h.request(attempt.url, { ...attempt, body })).status, 401);
    assert.equal((await h.request(attempt.url, { ...attempt, body, cookie: stranger.cookie })).status, 404);
    assert.equal((await h.request(attempt.url, { ...attempt, body, cookie: `sideline_session=${owner.user.id}` })).status, 401);
  }
  assert.equal((await h.request(`/api/shared/${token}`, { method: 'PATCH', body: { kind: 'score', homeScore: 99, awayScore: 0, expectedRevision: 1 } })).status, 404);
  const owners = await h.request('/api/tournaments', { cookie: owner.cookie });
  assert.equal(owners.data.tournaments.length, 1);
  assert.equal(owners.data.tournaments[0].revision, 1);
  assert.equal(owners.data.tournaments[0].fixtures[0].homeScore, null);
  assert.deepEqual((await h.request('/api/tournaments', { cookie: stranger.cookie })).data, { tournaments: [] });
});

test('creator edits are canonical, validated, revisioned, and visible through the read-only link', async (t) => {
  const h = await fixture(t);
  const owner = await register(h);
  let tournament = await create(h, owner.cookie);
  const fixtureId = tournament.fixtures[0].id;
  const endpoint = `/api/tournaments/${tournament.id}`;
  const share = await h.request(`${endpoint}/share`, { method: 'POST', cookie: owner.cookie, body: { expectedRevision: tournament.revision } });
  const publicPath = `/api/shared/${share.data.sharePath.split('/').at(-1)}`;
  async function patch(data, expectedStatus = 200) {
    const response = await h.request(`${endpoint}/fixtures/${fixtureId}`, { method: 'PATCH', cookie: owner.cookie, body: { expectedRevision: tournament.revision, ...data } });
    assert.equal(response.status, expectedStatus);
    if (response.status === 200) {
      assert.equal(response.data.tournament.revision, tournament.revision + 1);
      tournament = response.data.tournament;
    }
    return response;
  }
  for (const invalid of [{ kind: 'score', homeScore: 1, awayScore: null }, { kind: 'score', homeScore: 1.5, awayScore: 0 }, { kind: 'score', homeScore: -1, awayScore: 0 }, { kind: 'score', homeScore: 100, awayScore: 0 }, { kind: 'kickoff', kickoff: '2026-02-30T12:00' }, { kind: 'arbitrary', ownerId: 'other' }]) await patch(invalid, 400);
  await patch({ kind: 'score', homeScore: 2, awayScore: 1 });
  const saved = tournament.fixtures[0];
  const home = tournament.teams.find((team) => team.id === saved.homeId);
  const away = tournament.teams.find((team) => team.id === saved.awayId);
  await patch({ kind: 'scorers', entries: [
    { teamId: home.id, playerId: home.players[0].id, name: 'Client-forged name', goals: 2 },
    { teamId: away.id, playerId: away.players[0].id, name: 'Another fake name', goals: 1 },
  ] });
  assert.deepEqual(tournament.fixtures[0].scorers.map((entry) => entry.name), [home.players[0].name, away.players[0].name]);
  await patch({ kind: 'score', homeScore: 1, awayScore: 1 }, 400);
  await patch({ kind: 'scorers', entries: [{ teamId: home.id, playerId: away.players[0].id, name: 'Wrong squad', goals: 1 }] }, 400);
  const visible = await h.request(publicPath);
  assert.equal(visible.status, 200);
  assert.equal(visible.data.readOnly, true);
  assert.equal(getTopScorers(visible.data.tournament)[0].goals, 2);
  assert.equal(getStandings(visible.data.tournament)[0].points, 3);
  await patch({ kind: 'kickoff', kickoff: '2026-10-28T20:15' });
  assert.equal(tournament.fixtures[0].kickoff, '2026-10-28T20:15');
  await patch({ kind: 'score', homeScore: null, awayScore: null });
  assert.deepEqual(tournament.fixtures[0].scorers, []);
  assert.deepEqual(getTopScorers(tournament), []);
  assert.equal((await h.request(`${endpoint}/fixtures/missing`, { method: 'PATCH', cookie: owner.cookie, body: { kind: 'score', homeScore: 1, awayScore: 0, expectedRevision: tournament.revision } })).status, 404);
  assert.equal((await h.request(endpoint, { method: 'DELETE', cookie: owner.cookie, body: { expectedRevision: tournament.revision } })).status, 200);
  assert.equal((await h.request(publicPath)).status, 404);
});

test('missing or stale revisions conflict and concurrent requests cannot overwrite each other', async (t) => {
  const h = await fixture(t);
  const owner = await register(h);
  const tournament = await create(h, owner.cookie);
  const endpoint = `/api/tournaments/${tournament.id}`;
  const fixtureEndpoint = `${endpoint}/fixtures/${tournament.fixtures[0].id}`;
  const patch = { kind: 'score', homeScore: 1, awayScore: 0 };
  assert.equal((await h.request(fixtureEndpoint, { method: 'PATCH', cookie: owner.cookie, body: patch })).status, 409);
  assert.equal((await h.request(endpoint, { method: 'DELETE', cookie: owner.cookie, body: {} })).status, 409);
  assert.equal((await h.request(`${endpoint}/share`, { method: 'POST', cookie: owner.cookie, body: { expectedRevision: 0 } })).status, 409);
  const responses = await Promise.all([1, 2].map((goals) => h.request(fixtureEndpoint, { method: 'PATCH', cookie: owner.cookie, body: { ...patch, homeScore: goals, expectedRevision: 1 } })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const updated = (await h.request('/api/tournaments', { cookie: owner.cookie })).data.tournaments[0];
  assert.equal(updated.revision, 2);
  assert.equal((await h.request(fixtureEndpoint, { method: 'PATCH', cookie: owner.cookie, body: { ...patch, expectedRevision: 1 } })).status, 409);
});

test('renewing a viewer link invalidates the old link without changing tournament data', async (t) => {
  const h = await fixture(t);
  const owner = await register(h);
  const tournament = await create(h, owner.cookie);
  const endpoint = `/api/tournaments/${tournament.id}/share`;
  const first = await h.request(endpoint, { method: 'POST', cookie: owner.cookie, body: { expectedRevision: 1 } });
  const second = await h.request(endpoint, { method: 'POST', cookie: owner.cookie, body: { expectedRevision: 1 } });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.notEqual(first.data.sharePath, second.data.sharePath);
  assert.equal((await h.request(`/api/shared/${first.data.sharePath.split('/').at(-1)}`)).status, 404);
  assert.equal((await h.request(`/api/shared/${second.data.sharePath.split('/').at(-1)}`)).status, 200);
  assert.deepEqual((await h.request('/api/tournaments', { cookie: owner.cookie })).data.tournaments[0], tournament);
});

test('imports validate complete snapshots and assign server identity and ownership', async (t) => {
  const h = await fixture(t);
  const owner = await register(h, 'creator');
  const stranger = await register(h, 'stranger');
  const original = createTournament(options('Offline cup'));
  original.fixtures[0].homeScore = 1;
  original.fixtures[0].awayScore = 0;
  original.ownerId = stranger.user.id;
  original.revision = 999;
  const imported = await h.request('/api/tournaments/import', { method: 'POST', cookie: owner.cookie, body: { tournament: original } });
  assert.equal(imported.status, 201);
  assert.notEqual(imported.data.tournament.id, original.id);
  assert.equal(imported.data.tournament.revision, 1);
  assert.equal(imported.data.tournament.fixtures[0].homeScore, 1);
  assert.deepEqual(imported.data.tournament.fixtures[0].scorers, []);
  assert.equal((await h.request('/api/tournaments', { cookie: owner.cookie })).data.tournaments.length, 1);
  assert.equal((await h.request('/api/tournaments', { cookie: stranger.cookie })).data.tournaments.length, 0);
  for (const mutate of [
    (copy) => { copy.fixtures[0].awayId = copy.fixtures[0].homeId; },
    (copy) => { copy.fixtures[0].homeScore = 2.5; },
    (copy) => { copy.fixtures[0].scorers = [{ teamId: copy.fixtures[0].homeId, playerId: 'nonexistent', name: 'Not a squad player', goals: 1 }]; },
    (copy) => { copy.teams[0].players[0].skill = '100'; },
  ]) {
    const copy = structuredClone(original);
    mutate(copy);
    assert.equal((await h.request('/api/tournaments/import', { method: 'POST', cookie: owner.cookie, body: { tournament: copy } })).status, 400);
  }
});

test('JSON parsing, body limits and authentication failures are handled without server errors', async (t) => {
  const h = await fixture(t);
  assert.equal((await h.request('/api/register', { method: 'POST', raw: '{"username":' })).status, 400);
  assert.equal((await h.request('/api/register', { method: 'POST', body: { username: 'body_limit', password: 'x'.repeat(300_000) } })).status, 413);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await h.request('/api/login', { method: 'POST', body: { username: 'unknown_user', password: PASSWORD } });
    assert.equal(response.status, 401);
  }
  const limited = await h.request('/api/login', { method: 'POST', body: { username: 'unknown_user', password: PASSWORD } });
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
});

test('tournament data and hashed sessions survive an application restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sideline-persistence-'));
  const databasePath = path.join(directory, 'app.sqlite');
  let h;
  try {
    h = await start(databasePath);
    const owner = await register(h);
    const tournament = await create(h, owner.cookie);
    const response = await h.request(`/api/tournaments/${tournament.id}/fixtures/${tournament.fixtures[0].id}`, { method: 'PATCH', cookie: owner.cookie, body: { kind: 'score', homeScore: 0, awayScore: 0, expectedRevision: 1 } });
    assert.equal(response.status, 200);
    await h.close();
    h = await start(databasePath);
    assert.deepEqual((await h.request('/api/session', { cookie: owner.cookie })).data.user, owner.user);
    const loaded = await h.request('/api/tournaments', { cookie: owner.cookie });
    assert.equal(loaded.data.tournaments[0].revision, 2);
    assert.equal(loaded.data.tournaments[0].fixtures[0].homeScore, 0);
    assert.equal(loaded.data.tournaments[0].fixtures[0].awayScore, 0);
  } finally {
    if (h) await h.close();
    await rm(directory, { recursive: true, force: true });
  }
});

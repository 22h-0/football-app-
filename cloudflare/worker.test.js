import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { credential } from './webauthn-fixture.js';
import { getTopScorers } from '../src/lib/goalscorers.js';

const ORIGIN = 'https://sideline.test';
const fixtureOptions = () => ({ name: 'Cloud Cup', teams: [{ id: 'blue', name: 'Blue' }, { id: 'red', name: 'Red' }], matchMinutes: 20, breakMinutes: 5 });
const workerCode = build({ entryPoints: [new URL('./worker.js', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:*'], logLevel: 'silent' }).then((result) => result.outputFiles[0].text);

async function harness(t, { bootstrapOnly = false } = {}) {
  const mf = new Miniflare({
    modules: true,
    script: await workerCode,
    compatibilityDate: '2026-07-30',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'sideline-test' },
    bindings: { APP_ORIGIN: ORIGIN },
    serviceBindings: { ASSETS: async () => new Response('Static test asset') },
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  // D1.exec treats individual lines as statements; preserve multiline DDL by
  // executing each complete statement through a prepared statement instead.
  if (!bootstrapOnly) {
    const migration = await readFile(new URL('./migrations/0001.sql', import.meta.url), 'utf8');
    for (const statement of migration.split(';').map((value) => value.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  const request = async (path, { method = 'GET', body, cookie, csrf = true, origin = ORIGIN, headers = {} } = {}) => {
    const suppliedHeaders = new Headers(headers);
    if (csrf) suppliedHeaders.set('X-Sideline-Client', 'web');
    if (origin) suppliedHeaders.set('Origin', origin);
    if (body !== undefined) suppliedHeaders.set('Content-Type', 'application/json');
    if (cookie) suppliedHeaders.set('Cookie', cookie);
    const response = await mf.dispatchFetch(`${ORIGIN}${path}`, { method, headers: suppliedHeaders, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, headers: response.headers, cookies: response.headers.getSetCookie() };
  };
  function client() {
    const cookies = new Map();
    return {
      cookie() { return [...cookies].map(([name, value]) => `${name}=${value}`).join('; '); },
      async request(path, options = {}) {
        const response = await request(path, { cookie: this.cookie(), ...options });
        for (const header of response.cookies) {
          const first = header.split(';')[0];
          const split = first.indexOf('=');
          const name = first.slice(0, split);
          const value = first.slice(split + 1);
          if (!value || /Max-Age=0(?:;|$)/i.test(header)) cookies.delete(name); else cookies.set(name, value);
        }
        return response;
      },
    };
  }
  return { mf, db, request, client };
}

async function register(h, username = 'organizer', device = credential()) {
  const client = h.client();
  const requested = await client.request('/api/passkeys/register/options', { method: 'POST', body: { username } });
  assert.equal(requested.status, 200, requested.data.error);
  const response = await client.request('/api/passkeys/register/verify', { method: 'POST', body: { challengeId: requested.data.challengeId, response: device.registration(requested.data.options) } });
  assert.ok(response.status === 200 || response.status === 201, response.data.error);
  assert.equal(response.data.user.username, username);
  return { client, user: response.data.user, device, registration: requested };
}

async function create(owner, options = fixtureOptions()) {
  const response = await owner.client.request('/api/tournaments', { method: 'POST', body: options });
  assert.equal(response.status, 201, response.data.error);
  assert.equal(response.data.tournament.revision, 1);
  return response.data.tournament;
}

function denied(response, expected = [400, 401]) {
  assert.ok(expected.includes(response.status), `Expected a rejected request, received ${response.status}.`);
}

test('automatic bootstrap SQL matches the canonical checked-in migration', async () => {
  const { INITIAL_SCHEMA_SQL } = await import('./schema.js');
  const migration = await readFile(new URL('./migrations/0001.sql', import.meta.url), 'utf8');
  const canonical = (sql) => sql.replace(/--[^\n]*/g, '').split(';').map((statement) => statement.replace(/\s+/g, '')).filter(Boolean).sort();
  assert.deepEqual(canonical(INITIAL_SCHEMA_SQL), canonical(migration), 'The automatic bootstrap and checked-in migration must create the same schema.');
});

test('a fresh D1 binding bootstraps the canonical schema without a separate migration command', async (t) => {
  const h = await harness(t, { bootstrapOnly: true });
  for (const response of await Promise.all([h.request('/api/session'), h.request('/api/session')])) {
    assert.equal(response.status, 200, response.data.error);
    assert.deepEqual(response.data, { user: null, authMode: 'passkey' });
  }
  const { results } = await h.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  for (const name of ['users', 'passkeys', 'sessions', 'challenges', 'tournaments', 'auth_limits']) assert.ok(results.some((table) => table.name === name));
  const owner = await register(h, 'first_captain');
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM passkeys').first()).n, 1);
  const duplicate = await h.client().request('/api/passkeys/register/options', { method: 'POST', body: { username: 'FIRST_CAPTAIN' } });
  assert.equal(duplicate.status, 409);
  assert.equal((await create(owner)).name, 'Cloud Cup');
});

test('WebAuthn options bind RP and verification, and forged registration cannot create an account', async (t) => {
  const h = await harness(t);
  const initial = await h.request('/api/session');
  assert.deepEqual(initial.data, { user: null, authMode: 'passkey' });
  const client = h.client();
  const begin = await client.request('/api/passkeys/register/options', { method: 'POST', body: { username: 'captain' } });
  assert.equal(begin.status, 200, begin.data.error);
  assert.equal(begin.data.options.rp.id, 'sideline.test');
  assert.equal(begin.data.options.authenticatorSelection.userVerification, 'required');
  assert.deepEqual(begin.data.options.pubKeyCredParams.map((item) => item.alg), [-7]);
  assert.match(begin.data.challengeId, /^[A-Za-z0-9_-]{43}$/);
  denied(await client.request('/api/passkeys/register/verify', { method: 'POST', body: { challengeId: begin.data.challengeId, response: { id: 'forged', type: 'public-key', response: {} } } }));
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM users').first()).n, 0);
  assert.equal((await client.request('/api/session')).data.user, null);
  denied(await client.request('/api/passkeys/register/verify', { method: 'POST', body: { challengeId: begin.data.challengeId, response: credential().registration(begin.data.options) } }));
});

test('genuine ES256 passkeys register and authenticate, with private hashed seven-day sessions', async (t) => {
  const h = await harness(t);
  const owner = await register(h, 'Captain.Blue');
  const session = await owner.client.request('/api/session');
  assert.deepEqual(session.data.user, owner.user);
  assert.equal(session.data.authMode, 'passkey');
  const token = owner.client.cookie().split('; ').find((value) => value.startsWith('__Host-sideline_session='));
  assert.ok(token);
  const stored = await h.db.prepare('SELECT token_hash, expires_at FROM sessions').first();
  assert.ok(stored.token_hash !== token.split('=')[1], 'D1 stores only a hash of the session token.');
  assert.ok(stored.expires_at > Date.now() + 6 * 24 * 60 * 60 * 1000);
  const passkey = await h.db.prepare('SELECT credential_id, counter FROM passkeys').first();
  assert.equal(passkey.credential_id, owner.device.id);
  assert.equal(passkey.counter, 0);
  const logout = await owner.client.request('/api/logout', { method: 'POST' });
  assert.equal(logout.status, 200, logout.data.error);
  assert.equal((await owner.client.request('/api/session')).data.user, null);
  const options = await owner.client.request('/api/passkeys/login/options', { method: 'POST', body: { username: 'captain.blue' } });
  assert.equal(options.status, 200, options.data.error);
  assert.equal(options.data.options.userVerification, 'required');
  const verify = await owner.client.request('/api/passkeys/login/verify', { method: 'POST', body: { challengeId: options.data.challengeId, response: owner.device.authentication(options.data.options) } });
  assert.equal(verify.status, 200, verify.data.error);
  assert.equal(verify.data.user.id, owner.user.id);
  const cookieHeader = verify.cookies.find((value) => value.startsWith('__Host-sideline_session='));
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /Secure/i);
  assert.match(cookieHeader, /SameSite=Lax/i);
  assert.match(cookieHeader, /Path=\//i);
  assert.match(cookieHeader, /Max-Age=604800/i);
  assert.doesNotMatch(cookieHeader, /Domain=/i);
  assert.equal((await h.db.prepare('SELECT counter FROM passkeys').first()).counter, 1);
  const authenticated = owner.client.cookie();
  const finalLogout = await owner.client.request('/api/logout', { method: 'POST' });
  assert.equal(finalLogout.status, 200, finalLogout.data.error);
  assert.equal((await h.request('/api/session', { cookie: authenticated })).data.user, null);
});

test('challenge cookies, origin, UV, expiry, and one-use semantics are enforced', async (t) => {
  const h = await harness(t);
  const client = h.client();
  const device = credential();
  let begin = await client.request('/api/passkeys/register/options', { method: 'POST', body: { username: 'bound_cookie' } });
  const response = device.registration(begin.data.options);
  denied(await h.request('/api/passkeys/register/verify', { method: 'POST', body: { challengeId: begin.data.challengeId, response } }));
  const success = await client.request('/api/passkeys/register/verify', { method: 'POST', body: { challengeId: begin.data.challengeId, response } });
  assert.ok([200, 201].includes(success.status), success.data.error);
  denied(await client.request('/api/passkeys/register/verify', { method: 'POST', body: { challengeId: begin.data.challengeId, response } }));
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM users').first()).n, 1);
  const invalidCases = [
    { username: 'no_verification', change: { verified: false } },
    { username: 'wrong_origin', change: { origin: 'https://attacker.example' } },
    { username: 'wrong_rp', change: { rpId: 'attacker.example' } },
    { username: 'wrong_challenge', change: { challenge: 'unrelatedchallenge' } },
  ];
  for (const item of invalidCases) {
    const user = h.client();
    begin = await user.request('/api/passkeys/register/options', { method: 'POST', body: { username: item.username } });
    assert.equal(begin.status, 200, begin.data.error);
    denied(await user.request('/api/passkeys/register/verify', { method: 'POST', body: { challengeId: begin.data.challengeId, response: credential().registration(begin.data.options, item.change) } }));
  }
  const expired = h.client();
  begin = await expired.request('/api/passkeys/register/options', { method: 'POST', body: { username: 'expired_user' } });
  await h.db.prepare('UPDATE challenges SET expires_at = 0').run();
  denied(await expired.request('/api/passkeys/register/verify', { method: 'POST', body: { challengeId: begin.data.challengeId, response: credential().registration(begin.data.options) } }));
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM users').first()).n, 1);
});

test('signed login assertions reject replay, a missing UV flag, and another account credential', async (t) => {
  const h = await harness(t);
  const owner = await register(h, 'creator');
  const other = await register(h, 'stranger');
  const logout = await owner.client.request('/api/logout', { method: 'POST' });
  assert.equal(logout.status, 200, logout.data.error);
  let begin = await owner.client.request('/api/passkeys/login/options', { method: 'POST', body: { username: 'creator' } });
  let response = owner.device.authentication(begin.data.options);
  assert.equal((await owner.client.request('/api/passkeys/login/verify', { method: 'POST', body: { challengeId: begin.data.challengeId, response } })).status, 200);
  denied(await owner.client.request('/api/passkeys/login/verify', { method: 'POST', body: { challengeId: begin.data.challengeId, response } }));
  const finalLogout = await owner.client.request('/api/logout', { method: 'POST' });
  assert.equal(finalLogout.status, 200, finalLogout.data.error);
  begin = await owner.client.request('/api/passkeys/login/options', { method: 'POST', body: { username: 'creator' } });
  response = owner.device.authentication(begin.data.options, { counter: 2, verified: false });
  denied(await owner.client.request('/api/passkeys/login/verify', { method: 'POST', body: { challengeId: begin.data.challengeId, response } }));
  assert.equal((await owner.client.request('/api/session')).data.user, null);
  begin = await owner.client.request('/api/passkeys/login/options', { method: 'POST', body: { username: 'creator' } });
  response = other.device.authentication(begin.data.options, { counter: 2 });
  denied(await owner.client.request('/api/passkeys/login/verify', { method: 'POST', body: { challengeId: begin.data.challengeId, response } }));
  assert.equal((await owner.client.request('/api/session')).data.user, null);
  begin = await owner.client.request('/api/passkeys/login/options', { method: 'POST', body: { username: 'creator' } });
  response = owner.device.authentication(begin.data.options, { counter: 1 });
  denied(await owner.client.request('/api/passkeys/login/verify', { method: 'POST', body: { challengeId: begin.data.challengeId, response } }));
  assert.equal((await owner.client.request('/api/session')).data.user, null);
});

test('CSRF and JSON/body guards reject browser-origin attacks before authentication', async (t) => {
  const h = await harness(t);
  assert.equal((await h.request('/api/passkeys/register/options', { method: 'POST', csrf: false, body: { username: 'csrf_owner' } })).status, 403);
  assert.equal((await h.request('/api/passkeys/register/options', { method: 'POST', origin: 'https://attacker.example', body: { username: 'csrf_owner' } })).status, 403);
  assert.equal((await h.request('/api/passkeys/register/options', { method: 'POST', origin: 'null', body: { username: 'csrf_owner' } })).status, 403);
  const owner = await register(h);
  assert.equal((await owner.client.request('/api/tournaments', { method: 'POST', csrf: false, body: fixtureOptions() })).status, 403);
  assert.equal((await owner.client.request('/api/tournaments', { method: 'POST', origin: 'https://attacker.example', body: fixtureOptions() })).status, 403);
  assert.equal((await h.request('/api/register', { method: 'POST', body: { username: 'no_password_api', password: 'irrelevant-test-password' } })).status, 404);
  const oversized = await owner.client.request('/api/tournaments', { method: 'POST', body: { name: 'x'.repeat(300_000) } });
  assert.equal(oversized.status, 413);
});

test('public links expose only read-only snapshots and never allow a viewer to mutate', async (t) => {
  const h = await harness(t);
  const owner = await register(h, 'creator');
  const other = await register(h, 'stranger');
  const tournament = await create(owner);
  const endpoint = `/api/tournaments/${tournament.id}`;
  const fixture = tournament.fixtures[0];
  const shared = await owner.client.request(`${endpoint}/share`, { method: 'POST', body: { expectedRevision: 1 } });
  assert.equal(shared.status, 200, shared.data.error);
  const token = shared.data.sharePath.split('/').at(-1);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const visible = await h.request(`/api/shared/${token}`);
  assert.equal(visible.status, 200);
  assert.equal(visible.data.readOnly, true);
  assert.equal(visible.data.tournament.id, tournament.id);
  assert.equal(visible.headers.get('cache-control'), 'no-store');
  const attempts = [
    { path: `${endpoint}/fixtures/${fixture.id}`, method: 'PATCH', body: { kind: 'score', homeScore: 9, awayScore: 0 } },
    { path: `${endpoint}/fixtures/${fixture.id}`, method: 'PATCH', body: { kind: 'score', homeScore: null, awayScore: null } },
    { path: `${endpoint}/fixtures/${fixture.id}`, method: 'PATCH', body: { kind: 'scorers', entries: [] } },
    { path: `${endpoint}/fixtures/${fixture.id}`, method: 'PATCH', body: { kind: 'kickoff', kickoff: '2026-11-10T20:00' } },
    { path: endpoint, method: 'DELETE', body: {} },
    { path: `${endpoint}/share`, method: 'POST', body: {} },
  ];
  for (const attempt of attempts) {
    const body = { ...attempt.body, expectedRevision: 1, ownerId: owner.user.id, userId: owner.user.id, shareToken: token };
    assert.equal((await h.request(attempt.path, { method: attempt.method, body })).status, 401);
    assert.equal((await h.request(attempt.path, { method: attempt.method, body, cookie: `__Host-sideline_session=${token}` })).status, 401, 'A read-only viewing token must never work as an account session.');
    assert.equal((await other.client.request(attempt.path, { method: attempt.method, body })).status, 404);
  }
  assert.equal((await h.request(`/api/shared/${token}`, { method: 'PATCH', body: { kind: 'score', homeScore: 99, awayScore: 0 } })).status, 404);
  assert.deepEqual((await other.client.request('/api/tournaments')).data, { tournaments: [] });
  const unchanged = (await owner.client.request('/api/tournaments')).data.tournaments[0];
  assert.equal(unchanged.revision, 1);
  assert.equal(unchanged.fixtures[0].homeScore, null);
});

test('creator updates use D1 optimistic revisions and retain valid scorers in public results', async (t) => {
  const h = await harness(t);
  const owner = await register(h);
  let tournament = await create(owner);
  const endpoint = `/api/tournaments/${tournament.id}`;
  const fixtureId = tournament.fixtures[0].id;
  const patchPath = `${endpoint}/fixtures/${fixtureId}`;
  const shared = await owner.client.request(`${endpoint}/share`, { method: 'POST', body: { expectedRevision: 1 } });
  const publicPath = `/api/shared/${shared.data.sharePath.split('/').at(-1)}`;
  async function patch(data, expected = 200) {
    const response = await owner.client.request(patchPath, { method: 'PATCH', body: { expectedRevision: tournament.revision, ...data } });
    assert.equal(response.status, expected, response.data.error);
    if (response.status === 200) { assert.equal(response.data.tournament.revision, tournament.revision + 1); tournament = response.data.tournament; }
    return response;
  }
  assert.equal((await owner.client.request(patchPath, { method: 'PATCH', body: { kind: 'score', homeScore: 1, awayScore: 0 } })).status, 409);
  await patch({ kind: 'score', homeScore: 2, awayScore: 1 });
  await patch({ kind: 'scorers', entries: [{ teamId: tournament.fixtures[0].homeId, playerId: null, name: 'Alex', goals: 2 }, { teamId: tournament.fixtures[0].awayId, playerId: null, name: 'Sam', goals: 1 }] });
  await patch({ kind: 'score', homeScore: 1, awayScore: 1 }, 400);
  const readOnly = await h.request(publicPath);
  assert.equal(readOnly.data.tournament.revision, 3);
  assert.equal(getTopScorers(readOnly.data.tournament)[0].goals, 2);
  await patch({ kind: 'kickoff', kickoff: '2026-11-10T20:15' });
  assert.equal(tournament.fixtures[0].kickoff, '2026-11-10T20:15');
  const revision = tournament.revision;
  const competing = await Promise.all([3, 4].map((goals) => owner.client.request(patchPath, { method: 'PATCH', body: { kind: 'score', homeScore: goals, awayScore: 1, expectedRevision: revision } })));
  assert.deepEqual(competing.map((response) => response.status).sort(), [200, 409]);
  tournament = competing.find((response) => response.status === 200).data.tournament;
  await patch({ kind: 'score', homeScore: null, awayScore: null });
  assert.deepEqual(tournament.fixtures[0].scorers, []);
  assert.equal((await owner.client.request(endpoint, { method: 'DELETE', body: { expectedRevision: tournament.revision } })).status, 200);
  assert.equal((await h.request(publicPath)).status, 404);
});

test('renewing a viewer link revokes the old token and expired sessions cannot edit', async (t) => {
  const h = await harness(t);
  const owner = await register(h);
  const tournament = await create(owner);
  const path = `/api/tournaments/${tournament.id}/share`;
  const first = await owner.client.request(path, { method: 'POST', body: { expectedRevision: 1 } });
  const second = await owner.client.request(path, { method: 'POST', body: { expectedRevision: 1 } });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.notEqual(first.data.sharePath, second.data.sharePath);
  assert.equal((await h.request(`/api/shared/${first.data.sharePath.split('/').at(-1)}`)).status, 404);
  assert.equal((await h.request(`/api/shared/${second.data.sharePath.split('/').at(-1)}`)).status, 200);
  await h.db.prepare('UPDATE sessions SET expires_at = 0').run();
  assert.equal((await owner.client.request('/api/session')).data.user, null);
  assert.equal((await owner.client.request(path, { method: 'POST', body: { expectedRevision: 1 } })).status, 401);
});

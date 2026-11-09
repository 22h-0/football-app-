import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createApp } from './app.js';
import { resolveAppOrigin } from './origin.js';

async function productionServer(t, environment) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sideline-origin-'));
  const instance = createApp({
    databasePath: path.join(directory, 'app.sqlite'),
    appOrigin: resolveAppOrigin(environment),
    isProduction: true,
  });
  const server = await new Promise((resolve, reject) => {
    const listener = instance.app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    instance.close();
    await rm(directory, { recursive: true, force: true });
  });
  return async (origin, username) => fetch(`http://127.0.0.1:${server.address().port}/api/register`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Sideline-Client': 'web' },
    body: JSON.stringify({ username, password: 'Origin-test-password-42!' }),
  });
}

test('Render external HTTPS URL enables production registration with secure cookies and rejects unrelated origins', async (t) => {
  const provider = 'https://sideline-example.onrender.com';
  const register = await productionServer(t, { RENDER_EXTERNAL_URL: provider });
  const accepted = await register(provider, 'render_captain');
  assert.equal(accepted.status, 201);
  assert.equal((await accepted.json()).user.username, 'render_captain');
  const cookie = accepted.headers.getSetCookie()[0];
  assert.match(cookie, /^__Host-sideline_session=/);
  assert.match(cookie, /;\s*Secure(?:;|$)/i);
  assert.match(cookie, /;\s*HttpOnly(?:;|$)/i);
  assert.doesNotMatch(cookie, /;\s*Domain=/i);
  const rejected = await register('https://unrelated.example', 'untrusted_captain');
  assert.equal(rejected.status, 403);
  assert.match((await rejected.json()).error, /origin/i);
});

test('explicit app origin overrides Render and invalid production fallbacks remain rejected', async (t) => {
  const custom = 'https://football.example';
  const provider = 'https://sideline-example.onrender.com';
  const register = await productionServer(t, { APP_ORIGIN: custom, RENDER_EXTERNAL_URL: provider });
  const rejected = await register(provider, 'custom_captain');
  assert.equal(rejected.status, 403);
  await rejected.json();
  const accepted = await register(custom, 'custom_captain');
  assert.equal(accepted.status, 201);
  assert.equal((await accepted.json()).user.username, 'custom_captain');

  for (const environment of [{}, { RENDER_EXTERNAL_URL: 'http://sideline-example.onrender.com' }]) {
    assert.throws(() => createApp({
      databasePath: ':memory:',
      appOrigin: resolveAppOrigin(environment),
      isProduction: true,
    }), /HTTPS/i);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseAccount, chooseDatabase, prepareAndDeploy } from './deploy-cloudflare.mjs';

const accountId = '0123456789abcdef0123456789abcdef';
const otherAccount = 'abcdef0123456789abcdef0123456789';
const database = { name: 'sideline', uuid: '12345678-1234-1234-1234-123456789abc' };
const newConfig = () => ({ name: 'sideline-football', d1_databases: [{ binding: 'DB', database_name: 'sideline' }] });

test('account selection reuses explicit settings and rejects conflicting accounts', () => {
  assert.equal(chooseAccount({}, {}, { accounts: [{ id: accountId }] }), accountId);
  assert.equal(chooseAccount({}, { CLOUDFLARE_ACCOUNT_ID: accountId }), accountId);
  assert.throws(() => chooseAccount({ account_id: accountId }, { CLOUDFLARE_ACCOUNT_ID: otherAccount }), /conflicts/);
  assert.throws(() => chooseAccount({}, {}, { accounts: [{ id: accountId }, { id: otherAccount }] }), /Choose the target/);
});

test('an existing binding cannot silently switch databases or accounts', () => {
  assert.deepEqual(chooseDatabase({ database_name: 'sideline' }, [database]), database);
  assert.throws(() => chooseDatabase({ database_name: 'sideline', database_id: database.uuid }, []), /preserved/);
  assert.throws(() => chooseDatabase({ database_name: 'other-project', database_id: database.uuid }, [database]), /preserved/);
});

test('reuse persists real IDs and migrates before publishing without creating another database', () => {
  const calls = [];
  let saved;
  const environment = { CLOUDFLARE_ACCOUNT_ID: accountId };
  prepareAndDeploy({
    config: newConfig(), environment, log() {},
    run(args) { calls.push(args); if (args[1] === 'list') return [database]; },
    saveConfig(config) { saved = structuredClone(config); },
  });
  assert.deepEqual(calls, [['d1', 'list', '--json'], ['d1', 'migrations', 'apply', 'DB', '--remote'], ['deploy']]);
  assert.equal(saved.account_id, accountId);
  assert.equal(saved.d1_databases[0].database_id, database.uuid);
});

test('first deployment discovers one account and creates only the missing database', () => {
  const calls = [];
  let lists = 0;
  const environment = {};
  prepareAndDeploy({
    config: newConfig(), environment, log() {}, saveConfig() {},
    run(args) {
      calls.push(args);
      if (args[0] === 'whoami') return { accounts: [{ id: accountId }] };
      if (args[1] === 'list') return lists++ === 0 ? [] : [database];
    },
  });
  assert.equal(environment.CLOUDFLARE_ACCOUNT_ID, accountId);
  assert.equal(calls.filter((args) => args[1] === 'create').length, 1);
  assert.equal(calls.at(-2)[1], 'migrations');
  assert.equal(calls.at(-1)[0], 'deploy');
});

test('a failed migration prevents publishing a broken application', () => {
  const calls = [];
  assert.throws(() => prepareAndDeploy({
    config: newConfig(), environment: { CLOUDFLARE_ACCOUNT_ID: accountId }, log() {}, saveConfig() {},
    run(args) {
      calls.push(args);
      if (args[1] === 'list') return [database];
      if (args[1] === 'migrations') throw new Error('SQL migration failed');
    },
  }), /SQL migration failed/);
  assert.equal(calls.some((args) => args[0] === 'deploy'), false);
});

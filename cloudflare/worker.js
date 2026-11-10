import { changeFixture, importTournament, newTournament } from '../server/validation.js';
import { authRoute } from './auth.js';
import { ensureSchema } from './schema.js';
import {
  HttpError, TOKEN_PATTERN, csrf, database, hash, json, readBody, requireUser,
  trustedScope, token,
} from './helpers.js';

function revision(body, row) {
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1 || body.expectedRevision !== row.revision) throw new HttpError(409, 'This tournament has changed. Refresh it before saving again.');
  return body.expectedRevision;
}
function fromRow(row) { return { ...JSON.parse(row.data), revision: row.revision }; }
async function owned(db, tournamentId, user) {
  const row = await db.prepare('SELECT * FROM tournaments WHERE id = ? AND owner_id = ?').bind(tournamentId, user.id).first();
  if (!row) throw new HttpError(404, 'This tournament was not found.');
  return row;
}
async function create(db, user, tournament) {
  // One atomic conditional insert prevents concurrent requests exceeding the cap.
  const inserted = await db.prepare('INSERT INTO tournaments (id, owner_id, revision, data, created_at) SELECT ?, ?, 1, ?, ? WHERE (SELECT COUNT(*) FROM tournaments WHERE owner_id = ?) < 20')
    .bind(tournament.id, user.id, JSON.stringify(tournament), Date.now(), user.id).run();
  if (inserted.meta.changes !== 1) throw new HttpError(400, 'You can save up to 20 tournaments. Remove an old tournament first.');
  return json({ tournament: { ...tournament, revision: 1 } }, 201);
}

async function api(request, env) {
  const scope = trustedScope(request, env);
  csrf(request, scope);
  const db = database(env);
  await ensureSchema(env.DB);
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? await readBody(request) : {};
  const authentication = await authRoute(path, request, db, scope, body);
  if (authentication) return authentication;

  const publicRoute = /^\/api\/shared\/([^/]+)$/.exec(path);
  if (publicRoute && method === 'GET') {
    if (!TOKEN_PATTERN.test(publicRoute[1])) throw new HttpError(404, 'This viewing link was not found or has been renewed.');
    const row = await db.prepare('SELECT * FROM tournaments WHERE share_hash = ?').bind(hash(publicRoute[1])).first();
    if (!row) throw new HttpError(404, 'This viewing link was not found or has been renewed.');
    return json({ tournament: fromRow(row), readOnly: true });
  }

  if (path === '/api/tournaments') {
    const user = await requireUser(db, request, scope);
    if (method === 'GET') {
      const { results } = await db.prepare('SELECT * FROM tournaments WHERE owner_id = ? ORDER BY created_at DESC, id DESC').bind(user.id).all();
      return json({ tournaments: results.map(fromRow) });
    }
    if (method === 'POST') return create(db, user, newTournament(body));
  }
  if (path === '/api/tournaments/import' && method === 'POST') {
    const user = await requireUser(db, request, scope);
    return create(db, user, importTournament(body.tournament));
  }

  const fixtureRoute = /^\/api\/tournaments\/([^/]+)\/fixtures\/([^/]+)$/.exec(path);
  if (fixtureRoute && method === 'PATCH') {
    const user = await requireUser(db, request, scope);
    const row = await owned(db, decodeURIComponent(fixtureRoute[1]), user);
    const expected = revision(body, row);
    const tournament = changeFixture(JSON.parse(row.data), decodeURIComponent(fixtureRoute[2]), body);
    if (!tournament) throw new HttpError(404, 'This match was not found.');
    const changed = await db.prepare('UPDATE tournaments SET data = ?, revision = revision + 1 WHERE id = ? AND owner_id = ? AND revision = ?')
      .bind(JSON.stringify(tournament), row.id, user.id, expected).run();
    if (changed.meta.changes !== 1) throw new HttpError(409, 'This tournament has changed. Refresh it before saving again.');
    return json({ tournament: fromRow(await owned(db, row.id, user)) });
  }
  const shareRoute = /^\/api\/tournaments\/([^/]+)\/share$/.exec(path);
  if (shareRoute && method === 'POST') {
    const user = await requireUser(db, request, scope);
    const row = await owned(db, decodeURIComponent(shareRoute[1]), user);
    const expected = revision(body, row);
    const value = token();
    const changed = await db.prepare('UPDATE tournaments SET share_hash = ? WHERE id = ? AND owner_id = ? AND revision = ?').bind(hash(value), row.id, user.id, expected).run();
    if (changed.meta.changes !== 1) throw new HttpError(409, 'This tournament has changed. Refresh it before sharing again.');
    return json({ sharePath: `/watch/${value}` });
  }
  const tournamentRoute = /^\/api\/tournaments\/([^/]+)$/.exec(path);
  if (tournamentRoute && method === 'DELETE') {
    const user = await requireUser(db, request, scope);
    const row = await owned(db, decodeURIComponent(tournamentRoute[1]), user);
    const expected = revision(body, row);
    const changed = await db.prepare('DELETE FROM tournaments WHERE id = ? AND owner_id = ? AND revision = ?').bind(row.id, user.id, expected).run();
    if (changed.meta.changes !== 1) throw new HttpError(409, 'This tournament has changed. Refresh it before deleting it.');
    return json({ ok: true });
  }
  throw new HttpError(404, 'This API route was not found.');
}

export default {
  async fetch(request, env, ctx) {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/api' || path.startsWith('/api/')) return await api(request, env);
      if (env.ASSETS?.fetch) return await env.ASSETS.fetch(request);
      return new Response('Sideline assets have not been built.', { status: 404 });
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      if (error instanceof RangeError) return json({ error: error.message }, 400);
      if (error instanceof URIError) return json({ error: 'This request URL is invalid.' }, 400);
      // Never return SQL details, auth assertions, cookies, or tokens in errors.
      return json({ error: 'The server could not complete this request. Please try again.' }, 500);
    }
  },
  async scheduled(controller, env) {
    const now = Date.now();
    const db = database(env);
    await ensureSchema(env.DB);
    await db.batch([
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
      db.prepare('DELETE FROM challenges WHERE expires_at <= ?').bind(now),
      db.prepare('DELETE FROM auth_limits WHERE expires_at <= ?').bind(now),
    ]);
  },
};

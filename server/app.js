import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, openSync, closeSync, chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { changeFixture, importTournament, newTournament, requireObject } from './validation.js';

const deriveKey = promisify(scrypt);
const SESSION_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
const RATE_WINDOW = 15 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const hashToken = (value) => createHash('sha256').update(value).digest('hex');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function configurationOrigin(value, isProduction) {
  if (!value) {
    if (isProduction) throw new Error('APP_ORIGIN is required in production and must be an HTTPS origin.');
    return null;
  }
  let url;
  try { url = new URL(value); } catch { throw new Error('APP_ORIGIN must be a valid HTTP or HTTPS origin.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== value || (isProduction && url.protocol !== 'https:')) throw new Error('APP_ORIGIN must be an origin without a path, credentials, or trailing slash; HTTPS is required in production.');
  return url.origin;
}

function readCookie(request, name) {
  for (const cookie of request.headers.cookie?.split(';') ?? []) {
    const separator = cookie.indexOf('=');
    if (separator >= 0 && cookie.slice(0, separator).trim() === name) return cookie.slice(separator + 1).trim();
  }
  return null;
}
const validUsername = (value) => typeof value === 'string' && /^[A-Za-z0-9._-]{3,30}$/.test(value);
const validPassword = (value) => typeof value === 'string' && value.length >= 10 && value.length <= 128;

/** Authorization is always checked from the database, never a browser flag. */
export function createApp({ databasePath, appOrigin = null, isProduction = false } = {}) {
  const configuredOrigin = configurationOrigin(appOrigin, isProduction);
  if (typeof databasePath !== 'string' || !databasePath) throw new Error('A SQLite database path is required.');
  if (databasePath !== ':memory:') {
    mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true, mode: 0o700 });
    closeSync(openSync(databasePath, 'a', 0o600));
    chmodSync(databasePath, 0o600);
  }
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS tournaments (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL, share_hash TEXT UNIQUE, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tournaments_owner ON tournaments(owner_id, created_at DESC);
  `);
  const sql = {
    userByName: database.prepare('SELECT * FROM users WHERE username_key = ?'),
    insertUser: database.prepare('INSERT INTO users (id, username, username_key, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    insertSession: database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    deleteSession: database.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteExpired: database.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    findSession: database.prepare('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'),
    list: database.prepare('SELECT * FROM tournaments WHERE owner_id = ? ORDER BY created_at DESC, id DESC'),
    count: database.prepare('SELECT COUNT(*) AS total FROM tournaments WHERE owner_id = ?'),
    findOwned: database.prepare('SELECT * FROM tournaments WHERE id = ? AND owner_id = ?'),
    findShared: database.prepare('SELECT * FROM tournaments WHERE share_hash = ?'),
    insertTournament: database.prepare('INSERT INTO tournaments (id, owner_id, revision, data, created_at) VALUES (?, ?, 1, ?, ?)'),
    updateTournament: database.prepare('UPDATE tournaments SET data = ?, revision = revision + 1 WHERE id = ? AND owner_id = ? AND revision = ?'),
    deleteTournament: database.prepare('DELETE FROM tournaments WHERE id = ? AND owner_id = ? AND revision = ?'),
    updateShare: database.prepare('UPDATE tournaments SET share_hash = ? WHERE id = ? AND owner_id = ? AND revision = ?'),
  };
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  const cookieName = isProduction ? '__Host-sideline_session' : 'sideline_session';
  const cookieOptions = { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/', maxAge: SESSION_MILLISECONDS };
  const rateLimits = new Map();
  const dummySalt = randomBytes(16).toString('hex');
  const dummyHash = randomBytes(64);

  app.use((request, response, next) => {
    response.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
    if (isProduction) {
      response.set('Strict-Transport-Security', 'max-age=31536000');
      response.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none'");
    }
    next();
  });
  app.use('/api', (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
      if (request.get('X-Sideline-Client') !== 'web') return next(new HttpError(403, 'This request is missing the required application header.'));
      const origin = request.get('Origin');
      const ownOrigin = `${request.protocol}://${request.get('Host')}`;
      const allowed = configuredOrigin ? [configuredOrigin] : ['http://localhost:5173', 'http://127.0.0.1:5173', ownOrigin];
      if ((origin && !allowed.includes(origin)) || request.get('Sec-Fetch-Site') === 'cross-site') return next(new HttpError(403, 'This request came from an untrusted origin.'));
    }
    next();
  });
  app.use('/api', express.json({ limit: '256kb', strict: true }));

  function session(request) {
    const token = readCookie(request, cookieName);
    if (!token || !TOKEN_PATTERN.test(token)) return null;
    const user = sql.findSession.get(hashToken(token), Date.now());
    return user ? { id: user.id, username: user.username } : null;
  }
  function signedIn(request, response, next) {
    request.user = session(request);
    if (!request.user) return next(new HttpError(401, 'Sign in to manage your tournaments.'));
    next();
  }
  function issueSession(request, response, user) {
    const oldToken = readCookie(request, cookieName);
    if (oldToken && TOKEN_PATTERN.test(oldToken)) sql.deleteSession.run(hashToken(oldToken));
    sql.deleteExpired.run(Date.now());
    const token = randomBytes(32).toString('base64url');
    sql.insertSession.run(hashToken(token), user.id, Date.now() + SESSION_MILLISECONDS);
    response.cookie(cookieName, token, cookieOptions);
  }
  function authBudget(request, response, next) {
    const now = Date.now();
    let entry = rateLimits.get(request.ip);
    if (!entry || now - entry.start >= RATE_WINDOW) {
      entry = { start: now, failures: 0, attempts: 0, inFlight: 0 };
      rateLimits.set(request.ip, entry);
    }
    if (rateLimits.size > 10_000) {
      for (const [ip, record] of rateLimits) if (now - record.start >= RATE_WINDOW) rateLimits.delete(ip);
      if (rateLimits.size > 10_000) rateLimits.delete(rateLimits.keys().next().value);
    }
    if (entry.failures + entry.inFlight >= 10 || entry.attempts >= 30) {
      response.set('Retry-After', String(Math.max(1, Math.ceil((entry.start + RATE_WINDOW - now) / 1000))));
      return next(new HttpError(429, 'Too many sign-in attempts. Please try again in 15 minutes.'));
    }
    entry.attempts += 1;
    entry.inFlight += 1;
    let released = false;
    const release = () => { if (!released) { released = true; entry.inFlight -= 1; } };
    response.once('finish', release); response.once('close', release);
    request.authBudget = entry;
    next();
  }
  function credentials(request) {
    try {
      const body = requireObject(request.body);
      if (!validUsername(body.username)) throw new RangeError('Use a username of 3–30 letters, numbers, dots, underscores, or hyphens.');
      if (!validPassword(body.password)) throw new RangeError('Use a password between 10 and 128 characters.');
      return { username: body.username, password: body.password };
    } catch (error) { request.authBudget.failures += 1; throw error; }
  }
  function owned(request) {
    const row = sql.findOwned.get(request.params.id, request.user.id);
    if (!row) throw new HttpError(404, 'This tournament was not found.');
    return row;
  }
  function expectedRevision(request, row) {
    const revision = request.body?.expectedRevision;
    if (!Number.isSafeInteger(revision) || revision < 1 || revision !== row.revision) throw new HttpError(409, 'This tournament has changed. Refresh it before saving again.');
    return revision;
  }
  function tournamentFromRow(row) { return { ...JSON.parse(row.data), revision: row.revision }; }
  function insertTournament(userId, tournament) {
    database.exec('BEGIN IMMEDIATE');
    try {
      if (sql.count.get(userId).total >= 20) throw new HttpError(400, 'You can save up to 20 tournaments. Remove an old tournament first.');
      sql.insertTournament.run(tournament.id, userId, JSON.stringify(tournament), Date.now());
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
    return { ...tournament, revision: 1 };
  }

  app.get('/api/session', (request, response) => response.json({ user: session(request) }));
  app.post('/api/register', authBudget, async (request, response) => {
    const { username, password } = credentials(request);
    const usernameKey = username.toLowerCase();
    if (sql.userByName.get(usernameKey)) { request.authBudget.failures += 1; throw new HttpError(409, 'That username is already taken.'); }
    const salt = randomBytes(16).toString('hex');
    const derived = await deriveKey(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const user = { id: randomUUID(), username };
    try { sql.insertUser.run(user.id, username, usernameKey, salt, derived.toString('hex'), Date.now()); }
    catch (error) {
      if (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/u.test(error.message)) { request.authBudget.failures += 1; throw new HttpError(409, 'That username is already taken.'); }
      throw error;
    }
    issueSession(request, response, user);
    response.status(201).json({ user });
  });
  app.post('/api/login', authBudget, async (request, response) => {
    const { username, password } = credentials(request);
    const account = sql.userByName.get(username.toLowerCase());
    const derived = await deriveKey(password, account?.password_salt ?? dummySalt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const expected = account ? Buffer.from(account.password_hash, 'hex') : dummyHash;
    const correct = expected.length === derived.length && timingSafeEqual(expected, derived);
    if (!account || !correct) { request.authBudget.failures += 1; throw new HttpError(401, 'The username or password is incorrect.'); }
    const user = { id: account.id, username: account.username };
    issueSession(request, response, user);
    response.json({ user });
  });
  app.post('/api/logout', (request, response) => {
    const token = readCookie(request, cookieName);
    if (token && TOKEN_PATTERN.test(token)) sql.deleteSession.run(hashToken(token));
    response.clearCookie(cookieName, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' });
    response.json({ user: null });
  });
  app.get('/api/tournaments', signedIn, (request, response) => response.json({ tournaments: sql.list.all(request.user.id).map(tournamentFromRow) }));
  app.post('/api/tournaments', signedIn, (request, response) => response.status(201).json({ tournament: insertTournament(request.user.id, newTournament(request.body)) }));
  app.post('/api/tournaments/import', signedIn, (request, response) => {
    const body = requireObject(request.body);
    response.status(201).json({ tournament: insertTournament(request.user.id, importTournament(body.tournament)) });
  });
  app.patch('/api/tournaments/:id/fixtures/:fixtureId', signedIn, (request, response) => {
    const row = owned(request);
    const revision = expectedRevision(request, row);
    const tournament = changeFixture(JSON.parse(row.data), request.params.fixtureId, request.body);
    if (!tournament) throw new HttpError(404, 'This match was not found.');
    const changed = sql.updateTournament.run(JSON.stringify(tournament), row.id, request.user.id, revision);
    if (changed.changes !== 1) throw new HttpError(409, 'This tournament has changed. Refresh it before saving again.');
    response.json({ tournament: tournamentFromRow(sql.findOwned.get(row.id, request.user.id)) });
  });
  app.delete('/api/tournaments/:id', signedIn, (request, response) => {
    const row = owned(request);
    const revision = expectedRevision(request, row);
    if (sql.deleteTournament.run(row.id, request.user.id, revision).changes !== 1) throw new HttpError(409, 'This tournament has changed. Refresh it before deleting it.');
    response.json({ ok: true });
  });
  app.post('/api/tournaments/:id/share', signedIn, (request, response) => {
    const row = owned(request);
    const revision = expectedRevision(request, row);
    const token = randomBytes(32).toString('base64url');
    if (sql.updateShare.run(hashToken(token), row.id, request.user.id, revision).changes !== 1) throw new HttpError(409, 'This tournament has changed. Refresh it before sharing again.');
    response.json({ sharePath: `/watch/${token}` });
  });
  app.get('/api/shared/:token', (request, response) => {
    if (!TOKEN_PATTERN.test(request.params.token)) throw new HttpError(404, 'This viewing link was not found or has been renewed.');
    const row = sql.findShared.get(hashToken(request.params.token));
    if (!row) throw new HttpError(404, 'This viewing link was not found or has been renewed.');
    response.json({ tournament: tournamentFromRow(row), readOnly: true });
  });
  app.use('/api', (request, response) => response.status(404).json({ error: 'This API route was not found.' }));

  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  if (existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api(?:\/|$)).*/u, (request, response) => { response.set('Cache-Control', 'no-cache'); response.sendFile(path.join(dist, 'index.html')); });
  }
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    if (error instanceof HttpError) return response.status(error.status).json({ error: error.message });
    if (error instanceof RangeError) return response.status(400).json({ error: error.message });
    if (error.type === 'entity.too.large') return response.status(413).json({ error: 'This request is too large. Send less than 256 KB.' });
    if (error.type === 'entity.parse.failed' || error instanceof SyntaxError) return response.status(400).json({ error: 'Send a valid JSON request.' });
    if (error instanceof URIError) return response.status(400).json({ error: 'This request URL is invalid.' });
    // Do not log or return credential material, request bodies, or DB errors.
    response.status(500).json({ error: 'The server could not complete this request. Please try again.' });
  });
  let closed = false;
  return { app, close() { if (!closed) { closed = true; database.close(); } } };
}

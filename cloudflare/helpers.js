import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const CHALLENGE_SECONDS = 5 * 60;
export const token = () => randomBytes(32).toString('base64url');
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const toBase64 = (value) => Buffer.from(value).toString('base64url');
export const fromBase64 = (value) => new Uint8Array(Buffer.from(value, 'base64url'));

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function sameSecret(first, second) {
  if (typeof first !== 'string' || typeof second !== 'string') return false;
  const a = Buffer.from(first); const b = Buffer.from(second);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function trustedScope(request, env) {
  let origin;
  try {
    const url = new URL(env.APP_ORIGIN || request.url);
    if (env.APP_ORIGIN && url.origin !== env.APP_ORIGIN) throw new Error();
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error();
    if (url.username || url.password) throw new Error();
    origin = url.origin;
    return {
      origin, rpID: url.hostname, secure: url.protocol === 'https:',
      sessionCookie: url.protocol === 'https:' ? '__Host-sideline_session' : 'sideline_session',
      challengeCookie: url.protocol === 'https:' ? '__Host-sideline_challenge' : 'sideline_challenge',
    };
  } catch { throw new HttpError(503, 'This website needs a valid HTTPS origin before account access can be enabled.'); }
}

export function cookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator >= 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

export function setCookie(name, value, maxAge, secure) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function securityHeaders(api = true) {
  const headers = new Headers({
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (api) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
  }
  return headers;
}

export function json(value, status = 200, cookies = []) {
  const headers = securityHeaders();
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(JSON.stringify(value), { status, headers });
}

export function csrf(request, scope) {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) return;
  if (request.headers.get('X-Sideline-Client') !== 'web') throw new HttpError(403, 'This request is missing the required application header.');
  const origin = request.headers.get('Origin');
  if ((origin && origin !== scope.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new HttpError(403, 'This request came from an untrusted origin.');
}

export async function readBody(request) {
  const maximum = 256 * 1024;
  if (Number(request.headers.get('Content-Length')) > maximum) throw new HttpError(413, 'This request is too large. Send less than 256 KB.');
  if (!request.body) return {};
  const chunks = [];
  let total = 0;
  const reader = request.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) { await reader.cancel(); throw new HttpError(413, 'This request is too large. Send less than 256 KB.'); }
    chunks.push(value);
  }
  if (total === 0) return {};
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw new HttpError(400, 'Send a valid JSON request.');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new HttpError(400, 'Send a valid JSON object.'); }
}

/** One D1 session keeps reads consistent after this request's own writes. */
export function database(env) {
  if (!env.DB) throw new HttpError(503, 'The tournament database has not been connected.');
  return typeof env.DB.withSession === 'function' ? env.DB.withSession('first-primary') : env.DB;
}

export async function currentUser(db, request, scope) {
  const value = cookie(request, scope.sessionCookie);
  if (!value || !TOKEN_PATTERN.test(value)) return null;
  const account = await db.prepare('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(hash(value), Date.now()).first();
  return account ? { id: account.id, username: account.username } : null;
}

export async function requireUser(db, request, scope) {
  const user = await currentUser(db, request, scope);
  if (!user) throw new HttpError(401, 'Sign in to manage your tournaments.');
  return user;
}

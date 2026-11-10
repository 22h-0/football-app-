import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { decodeAttestationObject } from '@simplewebauthn/server/helpers';
import { randomUUID } from 'node:crypto';
import {
  CHALLENGE_SECONDS, SESSION_SECONDS, TOKEN_PATTERN, HttpError,
  cookie, currentUser, fromBase64, hash, json, sameSecret, setCookie, toBase64, token,
} from './helpers.js';

function username(body) {
  if (typeof body.username !== 'string' || !/^[A-Za-z0-9._-]{3,30}$/.test(body.username)) throw new HttpError(400, 'Use a username of 3–30 letters, numbers, dots, underscores, or hyphens.');
  return body.username;
}

async function budget(db, request, verify) {
  const window = 15 * 60 * 1000;
  const now = Date.now();
  const bucket = Math.floor(now / window);
  // Cloudflare supplies the connecting IP at its edge. No forwarding or client
  // identity header is ever used to establish account ownership.
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const key = hash(`${verify ? 'verify' : 'options'}:${ip}:${bucket}`);
  const limit = verify ? 10 : 30;
  const record = await db.prepare('INSERT INTO auth_limits (key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = auth_limits.attempts + 1 WHERE auth_limits.attempts < ? RETURNING attempts')
    .bind(key, (bucket + 1) * window, limit).first();
  if (!record) throw new HttpError(429, 'Too many account attempts. Please try again in 15 minutes.');
}

async function challenge(db, scope, ceremony, options, user) {
  const challengeId = token();
  await db.prepare('INSERT INTO challenges (id_hash, ceremony, challenge, origin, rp_id, user_id, username, user_handle, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(hash(challengeId), ceremony, options.challenge, scope.origin, scope.rpID, user.id, user.username, user.user_handle, Date.now() + CHALLENGE_SECONDS * 1000).run();
  return json({ options, challengeId }, 200, [setCookie(scope.challengeCookie, challengeId, CHALLENGE_SECONDS, scope.secure)]);
}

async function consume(db, request, scope, body, ceremony) {
  if (!TOKEN_PATTERN.test(body.challengeId || '') || !sameSecret(cookie(request, scope.challengeCookie), body.challengeId)) throw new HttpError(401, 'Start a new passkey request in this browser before continuing.');
  const record = await db.prepare('DELETE FROM challenges WHERE id_hash = ? RETURNING *').bind(hash(body.challengeId)).first();
  if (!record || record.ceremony !== ceremony || record.expires_at <= Date.now() || record.origin !== scope.origin || record.rp_id !== scope.rpID) throw new HttpError(401, 'This passkey request has expired or was already used. Please try again.');
  if (!body.response || typeof body.response !== 'object' || Array.isArray(body.response)) throw new HttpError(400, 'Complete the passkey prompt before continuing.');
  return record;
}

function newSession(db, request, scope, user) {
  const session = token();
  const statements = [];
  const previous = cookie(request, scope.sessionCookie);
  if (previous && TOKEN_PATTERN.test(previous)) statements.push(db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash(previous)));
  statements.push(db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(hash(session), user.id, Date.now() + SESSION_SECONDS * 1000));
  return {
    statements,
    cookies: [setCookie(scope.sessionCookie, session, SESSION_SECONDS, scope.secure), setCookie(scope.challengeCookie, '', 0, scope.secure)],
  };
}

/** Passwordless authentication avoids unsafe low-cost password hashes on Free. */
export async function authRoute(path, request, db, scope, body) {
  if (path === '/api/session' && request.method === 'GET') return json({ user: await currentUser(db, request, scope), authMode: 'passkey' });
  if (path === '/api/logout' && request.method === 'POST') {
    const session = cookie(request, scope.sessionCookie);
    if (session && TOKEN_PATTERN.test(session)) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash(session)).run();
    return json({ user: null }, 200, [setCookie(scope.sessionCookie, '', 0, scope.secure), setCookie(scope.challengeCookie, '', 0, scope.secure)]);
  }
  const match = /^\/api\/passkeys\/(register|login)\/(options|verify)$/.exec(path);
  if (!match || request.method !== 'POST') return null;
  const [, ceremony, step] = match;
  await budget(db, request, step === 'verify');

  if (step === 'options') {
    const name = username(body);
    const existing = await db.prepare('SELECT * FROM users WHERE username_key = ?').bind(name.toLowerCase()).first();
    if (ceremony === 'register') {
      if (existing) throw new HttpError(409, 'That username is already taken. Sign in with its passkey instead.');
      const handle = fromBase64(token());
      const user = { id: randomUUID(), username: name, user_handle: toBase64(handle) };
      const options = await generateRegistrationOptions({
        rpName: 'Sideline', rpID: scope.rpID, userName: name, userDisplayName: name, userID: handle,
        supportedAlgorithmIDs: [-7], attestationType: 'none', timeout: 60_000,
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      });
      return challenge(db, scope, ceremony, options, user);
    }
    if (!existing) throw new HttpError(401, 'That username has no registered passkey on this website.');
    const { results: credentials } = await db.prepare('SELECT credential_id, transports FROM passkeys WHERE user_id = ?').bind(existing.id).all();
    const options = await generateAuthenticationOptions({
      rpID: scope.rpID, timeout: 60_000, userVerification: 'required',
      allowCredentials: credentials.map((credential) => ({ id: credential.credential_id, transports: JSON.parse(credential.transports) })),
    });
    return challenge(db, scope, ceremony, options, existing);
  }

  const pending = await consume(db, request, scope, body, ceremony);
  if (ceremony === 'register') {
    let verified;
    try {
      const attestation = body.response.response?.attestationObject;
      if (typeof attestation !== 'string' || attestation.length > 16_384
        || decodeAttestationObject(fromBase64(attestation)).get('fmt') !== 'none') {
        throw new Error('Only standard passkeys without device attestation are supported.');
      }
      verified = await verifyRegistrationResponse({
        response: body.response, expectedChallenge: pending.challenge,
        expectedOrigin: pending.origin, expectedRPID: pending.rp_id,
        requireUserPresence: true, requireUserVerification: true, supportedAlgorithmIDs: [-7],
      });
    } catch { throw new HttpError(401, 'The passkey could not be verified. Start again and complete the device verification prompt.'); }
    if (!verified.verified || !verified.registrationInfo?.userVerified) throw new HttpError(401, 'User verification is required to create an account.');
    const info = verified.registrationInfo;
    // The browser requests no attestation. Other formats are not needed for
    // this application and may contain certificate chains or external metadata.
    if (info.fmt !== 'none') throw new HttpError(400, 'Please register a standard passkey without device attestation.');
    const user = { id: pending.user_id, username: pending.username };
    const session = newSession(db, request, scope, user);
    try {
      await db.batch([
        db.prepare('INSERT INTO users (id, username, username_key, user_handle, created_at) VALUES (?, ?, ?, ?, ?)').bind(user.id, user.username, user.username.toLowerCase(), pending.user_handle, Date.now()),
        db.prepare('INSERT INTO passkeys (credential_id, user_id, public_key, counter, transports, device_type, backed_up) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(info.credential.id, user.id, toBase64(info.credential.publicKey), info.credential.counter, JSON.stringify(info.credential.transports ?? []), info.credentialDeviceType, info.credentialBackedUp ? 1 : 0),
        ...session.statements,
      ]);
    } catch (error) {
      if (/UNIQUE constraint failed/.test(String(error.message))) throw new HttpError(409, 'That username or passkey was already registered. Start again with a different username.');
      throw error;
    }
    return json({ user }, 201, session.cookies);
  }

  if (typeof body.response.id !== 'string' || body.response.id.length > 2048) throw new HttpError(401, 'This passkey could not be verified.');
  const credential = await db.prepare('SELECT * FROM passkeys WHERE credential_id = ? AND user_id = ?').bind(body.response.id, pending.user_id).first();
  if (!credential) throw new HttpError(401, 'Use a passkey belonging to this account.');
  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response: body.response, expectedChallenge: pending.challenge,
      expectedOrigin: pending.origin, expectedRPID: pending.rp_id, requireUserVerification: true,
      credential: { id: credential.credential_id, publicKey: fromBase64(credential.public_key), counter: credential.counter, transports: JSON.parse(credential.transports) },
    });
  } catch { throw new HttpError(401, 'The passkey could not be verified. Start a new sign-in request and try again.'); }
  if (!verified.verified || !verified.authenticationInfo.userVerified) throw new HttpError(401, 'User verification is required to sign in.');
  const info = verified.authenticationInfo;
  const changed = await db.prepare('UPDATE passkeys SET counter = ?, device_type = ?, backed_up = ? WHERE credential_id = ? AND user_id = ? AND counter = ?')
    .bind(info.newCounter, info.credentialDeviceType, info.credentialBackedUp ? 1 : 0, credential.credential_id, pending.user_id, credential.counter).run();
  if (changed.meta.changes !== 1) throw new HttpError(401, 'The passkey was used by another sign-in request. Please try again.');
  const user = { id: pending.user_id, username: pending.username };
  const session = newSession(db, request, scope, user);
  await db.batch(session.statements);
  return json({ user }, 200, session.cookies);
}

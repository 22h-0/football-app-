import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const bytes = (value) => Buffer.from(value, 'base64url');
const b64 = (value) => Buffer.from(value).toString('base64url');
const sha256 = (value) => createHash('sha256').update(value).digest();

function length(major, value) {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value <= 0xff) return Buffer.from([(major << 5) | 24, value]);
  const encoded = Buffer.alloc(value <= 0xffff ? 3 : 5);
  encoded[0] = (major << 5) | (value <= 0xffff ? 25 : 26);
  if (value <= 0xffff) encoded.writeUInt16BE(value, 1); else encoded.writeUInt32BE(value, 1);
  return encoded;
}

/** Minimal test-only CBOR for WebAuthn's fmt:none attestation and COSE key. */
function cbor(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.concat([length(2, value.length), Buffer.from(value)]);
  if (typeof value === 'string') { const encoded = Buffer.from(value); return Buffer.concat([length(3, encoded.length), encoded]); }
  if (Number.isInteger(value)) return length(value < 0 ? 1 : 0, value < 0 ? -value - 1 : value);
  if (value instanceof Map) return Buffer.concat([length(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)])]);
  if (Array.isArray(value)) return Buffer.concat([length(4, value.length), ...value.map(cbor)]);
  throw new TypeError('Unsupported CBOR test value.');
}

function authData(rpId, flags, counter, trailing = Buffer.alloc(0)) {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(counter);
  return Buffer.concat([sha256(rpId), Buffer.from([flags]), count, trailing]);
}

/** Genuine ES256 credential: its private key never leaves this test fixture. */
export function credential({ id = randomBytes(32) } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const coseKey = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, bytes(jwk.x)], [-3, bytes(jwk.y)]]));
  let userHandle;
  return {
    id: b64(id),
    registration(options, { origin = 'https://sideline.test', rpId = options.rp.id, verified = true, challenge = options.challenge } = {}) {
      userHandle = options.user.id;
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }));
      const idLength = Buffer.alloc(2);
      idLength.writeUInt16BE(id.length);
      const authenticatorData = authData(rpId, verified ? 0x45 : 0x41, 0, Buffer.concat([Buffer.alloc(16), idLength, id, coseKey]));
      const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authenticatorData]]));
      return {
        id: b64(id), rawId: b64(id), type: 'public-key', authenticatorAttachment: 'platform',
        clientExtensionResults: { credProps: { rk: true } },
        response: { clientDataJSON: b64(clientDataJSON), attestationObject: b64(attestationObject), transports: ['internal'] },
      };
    },
    authentication(options, { origin = 'https://sideline.test', rpId = 'sideline.test', verified = true, counter = 1, challenge = options.challenge } = {}) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
      const authenticatorData = authData(rpId, verified ? 0x05 : 0x01, counter);
      const signature = sign('sha256', Buffer.concat([authenticatorData, sha256(clientDataJSON)]), privateKey);
      return {
        id: b64(id), rawId: b64(id), type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
        response: { clientDataJSON: b64(clientDataJSON), authenticatorData: b64(authenticatorData), signature: b64(signature), ...(userHandle ? { userHandle } : {}) },
      };
    },
  };
}

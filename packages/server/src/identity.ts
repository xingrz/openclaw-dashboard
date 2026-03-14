import crypto from 'crypto';
import fs from 'fs';
import { config } from './config.js';

export interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '');
}

/** Extract the raw 32-byte public key from a PEM-encoded Ed25519 public key. */
export function derivePublicKeyRaw(pem: string): Buffer {
  const spki = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' });
  const hasStandardPrefix =
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX);
  return hasStandardPrefix ? spki.subarray(ED25519_SPKI_PREFIX.length) : spki;
}

export function fingerprintPublicKey(pem: string): string {
  return crypto.createHash('sha256').update(derivePublicKeyRaw(pem)).digest('hex');
}

export function signPayload(privateKeyPem: string, payload: string): string {
  const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), crypto.createPrivateKey(privateKeyPem));
  return base64UrlEncode(sig);
}

export function normalizeMetadata(value: string): string {
  return value.trim() ? value.trim().toLowerCase() : '';
}

/** Load existing device identity or generate a new Ed25519 keypair. */
export function loadOrCreateIdentity(): DeviceIdentity {
  if (fs.existsSync(config.identityFile)) {
    const data = JSON.parse(fs.readFileSync(config.identityFile, 'utf8'));
    data.deviceId = fingerprintPublicKey(data.publicKeyPem);
    return data as DeviceIdentity;
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const identity: DeviceIdentity = {
    deviceId: '',
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
  identity.deviceId = fingerprintPublicKey(identity.publicKeyPem);
  fs.writeFileSync(config.identityFile, JSON.stringify(identity, null, 2) + '\n', { mode: 0o600 });
  return identity;
}

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPENCLAW_HOME = path.join(process.env.HOME!, '.openclaw');

export const config = {
  port: Number(process.env.PORT) || 3210,
  gwPort: Number(process.env.GW_PORT || process.env.OPENCLAW_GATEWAY_PORT) || 18789,
  identityFile: path.join(__dirname, '..', '.device-identity.json'),
  sessionsDir: path.join(OPENCLAW_HOME, 'agents/main/sessions'),
  gwToken: resolveGatewayToken(),
} as const;

/** Resolve gateway auth token from env vars or the OpenClaw config file. */
function resolveGatewayToken(): string {
  if (process.env.OPENCLAW_GATEWAY_TOKEN) return process.env.OPENCLAW_GATEWAY_TOKEN;
  if (process.env.GW_TOKEN) return process.env.GW_TOKEN;
  try {
    const raw = fs.readFileSync(path.join(OPENCLAW_HOME, 'openclaw.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    const token: unknown = parsed?.gateway?.auth?.token;
    if (typeof token === 'string' && token && !token.startsWith('__OPENCLAW')) return token;
  } catch {
    // Config file may not exist; fall through to empty token.
  }
  return '';
}

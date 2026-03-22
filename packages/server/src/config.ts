import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME || process.env.USERPROFILE || '/root';
const OPENCLAW_HOME = path.join(HOME, '.openclaw');

const AGENTS_HOME = path.join(OPENCLAW_HOME, 'agents');

const VALID_AGENT_NAME = /^[a-zA-Z0-9_-]+$/;

function isValidAgentName(name: string): boolean {
  return VALID_AGENT_NAME.test(name) && name !== '.' && name !== '..';
}

const configuredAgents = resolveDashboardAgents().filter((name) => {
  if (!isValidAgentName(name)) {
    console.warn(`[config] Skipping invalid agent name: ${JSON.stringify(name)}`);
    return false;
  }
  return true;
});

const sessionsDirs = configuredAgents
  .map((agent) => ({ agent, dir: path.join(AGENTS_HOME, agent, 'sessions') }))
  .filter(({ dir, agent }) => {
    if (!fs.existsSync(dir)) {
      console.warn(`[config] Agent "${agent}" sessions dir not found: ${dir} (will be picked up if created later)`);
      return false;
    }
    return true;
  });

if (sessionsDirs.length === 0 && configuredAgents.length > 0) {
  console.warn('[config] No session directories found for any configured agent');
}

export const config = {
  port: Number(process.env.PORT) || 3210,
  gwPort: Number(process.env.GW_PORT || process.env.OPENCLAW_GATEWAY_PORT) || 18789,
  identityFile: path.join(process.cwd(), '.device-identity.json'),
  agentsHome: AGENTS_HOME,
  allAgents: configuredAgents,
  dashboardAgents: sessionsDirs.map(({ agent }) => agent),
  sessionsDirs: sessionsDirs.map(({ dir }) => dir),
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

function resolveDashboardAgents(): string[] {
  const configured = (process.env.DASHBOARD_AGENTS || '*').trim();

  if (configured === '*') {
    try {
      const dirs = fs
        .readdirSync(AGENTS_HOME, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      if (dirs.length === 0) {
        console.warn(`[config] No agent directories found under ${AGENTS_HOME}, falling back to "main"`);
        return ['main'];
      }
      return dirs;
    } catch {
      return ['main'];
    }
  }

  const agents = configured
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return agents.length ? [...new Set(agents)] : ['main'];
}

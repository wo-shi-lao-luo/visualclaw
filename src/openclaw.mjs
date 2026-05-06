import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

let _useWsl = false;
let _configured = false;

export function configureRunner(envType) {
  if (_configured) return;
  _configured = true;
  _useWsl = envType === 'WINDOWS';
}

function errorMessage(error) {
  return String(error?.message || error || 'Unknown error');
}

async function runLocal(args, { timeoutMs = 12000 } = {}) {
  const { stdout, stderr } = await execFileAsync('openclaw', args, {
    timeout: timeoutMs,
    maxBuffer: 5 * 1024 * 1024,
    windowsHide: true,
    env: process.env,
  });
  return { stdout: stdout ?? '', stderr: stderr ?? '' };
}

async function runViaWsl(args, { timeoutMs = 12000 } = {}) {
  const shellCmd = ['openclaw', ...args]
    .map((a) => `'${String(a).replace(/'/g, "'\\''")}'`)
    .join(' ');
  const { stdout, stderr } = await execFileAsync('wsl.exe', ['--', 'bash', '-lc', shellCmd], {
    timeout: timeoutMs,
    maxBuffer: 5 * 1024 * 1024,
    windowsHide: true,
    env: process.env,
  });
  return { stdout: stdout ?? '', stderr: stderr ?? '' };
}

export async function runOpenClaw(args, options) {
  return _useWsl ? runViaWsl(args, options) : runLocal(args, options);
}

async function safeRunOpenClaw(args, options) {
  try {
    return await runOpenClaw(args, options);
  } catch (error) {
    return { stdout: '', stderr: errorMessage(error), error: errorMessage(error) };
  }
}

export function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function parseJsonLines(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const value = parseJson(trimmed, null);
    if (value) rows.push(value);
  }
  return rows;
}

export async function getStatus() {
  const { stdout, error } = await safeRunOpenClaw(['status', '--json']);
  return { ...parseJson(stdout, {}), error };
}

export async function getGatewayStatus() {
  const { stdout, error } = await safeRunOpenClaw(['gateway', 'status', '--json']);
  return { ...parseJson(stdout, {}), error };
}

export async function getDiscovery() {
  const { stdout, error } = await safeRunOpenClaw(['gateway', 'discover', '--json']);
  const value = parseJson(stdout, { beacons: [], count: 0, timeoutMs: 0, domains: [] });
  return {
    beacons: Array.isArray(value?.beacons) ? value.beacons : [],
    count: Number(value?.count ?? 0),
    timeoutMs: Number(value?.timeoutMs ?? 0),
    domains: Array.isArray(value?.domains) ? value.domains : [],
    error,
  };
}

export async function getSessions() {
  const { stdout, error } = await safeRunOpenClaw(['sessions', '--json', '--all-agents']);
  const value = parseJson(stdout, { sessions: [], stores: [], count: 0, allAgents: true });
  const sessions = Array.isArray(value?.sessions) ? value.sessions : Array.isArray(value?.recent) ? value.recent : [];
  return {
    ...value,
    sessions,
    stores: Array.isArray(value?.stores) ? value.stores : [],
    count: Number(value?.count ?? sessions.length ?? 0),
    allAgents: value?.allAgents ?? true,
    error,
  };
}

export async function getTasks() {
  const { stdout, error } = await safeRunOpenClaw(['tasks', '--json']);
  const value = parseJson(stdout, { tasks: [], count: 0 });
  const tasks = Array.isArray(value?.tasks) ? value.tasks : [];
  return {
    ...value,
    tasks,
    count: Number(value?.count ?? tasks.length ?? 0),
    error,
  };
}

export async function getLogs(limit = 80) {
  const { stdout, error } = await safeRunOpenClaw(['logs', '--json', '--limit', String(limit), '--timeout', '7000']);
  const rows = parseJsonLines(stdout);
  return { logs: rows.filter((row) => row.type === 'log'), error };
}

export async function getConfig() {
  const readPath = async (path) => {
    const { stdout } = await safeRunOpenClaw(['config', 'get', path, '--json']);
    return parseJson(stdout, null);
  };

  const [gatewayPort, gatewayBind, authMode, insecureAuth] = await Promise.all([
    readPath('gateway.port'),
    readPath('gateway.bind'),
    readPath('gateway.auth.mode'),
    readPath('controlUi.allowInsecureAuth'),
  ]);

  return {
    gatewayPort,
    gatewayBind,
    authMode,
    allowInsecureAuth: insecureAuth,
  };
}

export async function getGatewayPort() {
  const { stdout } = await runOpenClaw(['config', 'get', 'gateway.port', '--json']);
  const value = parseJson(stdout, null);
  return typeof value === 'number' ? value : Number(value ?? 18789);
}

export async function gatewayStart() {
  return runOpenClaw(['gateway', 'start'], { timeoutMs: 30000 });
}

export async function gatewayStop() {
  return runOpenClaw(['gateway', 'stop'], { timeoutMs: 30000 });
}

export async function gatewayRestart() {
  return runOpenClaw(['gateway', 'restart'], { timeoutMs: 30000 });
}

export async function setConfig(configPath, value) {
  try {
    const result = await runOpenClaw(['config', 'set', configPath, String(value)]);
    return { stdout: result.stdout, stderr: result.stderr, error: null };
  } catch (error) {
    return { stdout: '', stderr: errorMessage(error), error: errorMessage(error) };
  }
}

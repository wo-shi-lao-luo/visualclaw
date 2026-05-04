import http from 'node:http';
import os from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  gatewayRestart,
  gatewayStart,
  gatewayStop,
  getConfig,
  getDiscovery,
  getGatewayStatus,
  getLogs,
  getSessions,
  getStatus,
  getTasks,
} from './openclaw.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const settingsPath = path.join(dataDir, 'visualclaw.json');
const port = Number(process.env.PORT || 4173);

let envType = 'UNKNOWN';

async function detectEnv() {
  if (os.platform() === 'win32') return 'WINDOWS';
  try {
    const procVersion = await readFile('/proc/version', 'utf8');
    if (/microsoft/i.test(procVersion)) return 'WSL';
  } catch {
    // not Linux or no /proc/version — fall through
  }
  return 'UNKNOWN';
}

const staticFiles = {
  '/': path.join(__dirname, 'index.html'),
  '/app.js': path.join(__dirname, 'app.js'),
  '/styles.css': path.join(__dirname, 'styles.css'),
};

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

async function readSettings() {
  try {
    return JSON.parse(await readFile(settingsPath, 'utf8'));
  } catch {
    return { manualTarget: '' };
  }
}

async function saveSettings(next) {
  await ensureDataDir();
  await writeFile(settingsPath, JSON.stringify(next, null, 2));
}

async function collectBootstrap() {
  const [status, gatewayStatus, sessions, tasks, logs, discovery, config, settings] = await Promise.all([
    getStatus().catch((error) => ({ error: String(error?.message || error) })),
    getGatewayStatus().catch((error) => ({ error: String(error?.message || error) })),
    getSessions().catch((error) => ({ sessions: [], stores: [], count: 0, error: String(error?.message || error) })),
    getTasks().catch((error) => ({ tasks: [], count: 0, error: String(error?.message || error) })),
    getLogs().catch((error) => ({ error: String(error?.message || error), logs: [] })),
    getDiscovery().catch((error) => ({ beacons: [], count: 0, error: String(error?.message || error) })),
    getConfig().catch((error) => ({ error: String(error?.message || error) })),
    readSettings(),
  ]);

  return {
    timestamp: Date.now(),
    envType,
    status,
    gatewayStatus,
    sessions,
    tasks,
    logs,
    discovery,
    config,
    settings,
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function send(res, statusCode, contentType, body) {
  res.writeHead(statusCode, { 'content-type': contentType });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    if (req.method === 'GET' && staticFiles[url.pathname]) {
      const file = await readFile(staticFiles[url.pathname], 'utf8');
      const type = url.pathname === '/app.js' ? 'text/javascript; charset=utf-8' : url.pathname === '/styles.css' ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
      send(res, 200, type, file);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
      send(res, 200, 'application/json; charset=utf-8', JSON.stringify(await collectBootstrap()));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/action') {
      const body = await readBody(req);
      const action = body?.action;

      if (action === 'save-target') {
        const settings = await readSettings();
        const next = { ...settings, manualTarget: String(body.target || '').trim() };
        await saveSettings(next);
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, settings: next }));
        return;
      }

      if (action === 'discover') {
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, discovery: await getDiscovery() }));
        return;
      }

      if (action === 'refresh') {
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true }));
        return;
      }

      const ops = { start: gatewayStart, stop: gatewayStop, restart: gatewayRestart };
      if (!ops[action]) {
        send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: `Unknown action: ${action}` }));
        return;
      }

      const result = await ops[action]();
      send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, stdout: result.stdout, stderr: result.stderr }));
      return;
    }

    send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'Not found' }));
  } catch (error) {
    send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: error?.message || String(error) }));
  }
});

server.listen(port, async () => {
  envType = await detectEnv();
  console.log(`VisualClaw running at http://localhost:${port} [env: ${envType}]`);
});

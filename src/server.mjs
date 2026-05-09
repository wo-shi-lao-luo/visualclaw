import http from 'node:http';
import os from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  configureRunner,
  gatewayRestart,
  gatewayStart,
  gatewayStop,
  getAgentBindings,
  getAgents,
  getConfig,
  getDiscovery,
  getGatewayStatus,
  getLogs,
  getSessions,
  getSkills,
  getStatus,
  getTasks,
  runAgent,
  setConfig,
  skillsInstall,
  skillsUpdateAll,
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

function isSafeProbeHost(hostname) {
  if (hostname === '169.254.169.254') return false; // cloud metadata
  return (
    hostname === 'localhost' ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

function probeManualTarget(target) {
  return new Promise((resolve) => {
    if (!target) return resolve(null);
    let url, parsed;
    try {
      url = target.startsWith('http') ? target : `http://${target}`;
      parsed = new URL(url);
    } catch {
      return resolve(null);
    }
    if (!isSafeProbeHost(parsed.hostname)) return resolve(null);

    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => { req.destroy(); finish(null); }, 3000);
    const req = http.get(
      { hostname: parsed.hostname, port: parsed.port || 80, path: '/' },
      (res) => { res.resume(); finish(url); },
    );
    req.on('error', () => finish(null));
  });
}

async function collectBootstrap() {
  const settings = await readSettings();

  const [status, gatewayStatus, sessions, tasks, logs, discovery, config, agents, manualProbeUrl] = await Promise.all([
    getStatus().catch((error) => ({ error: String(error?.message || error) })),
    getGatewayStatus().catch((error) => ({ error: String(error?.message || error) })),
    getSessions().catch((error) => ({ sessions: [], stores: [], count: 0, error: String(error?.message || error) })),
    getTasks().catch((error) => ({ tasks: [], count: 0, error: String(error?.message || error) })),
    getLogs().catch((error) => ({ error: String(error?.message || error), logs: [] })),
    getDiscovery().catch((error) => ({ beacons: [], count: 0, error: String(error?.message || error) })),
    getConfig().catch((error) => ({ error: String(error?.message || error) })),
    getAgents().catch((error) => ({ agents: [], error: String(error?.message || error) })),
    probeManualTarget(settings.manualTarget),
  ]);

  const existingBeacons = Array.isArray(discovery.beacons) ? discovery.beacons : [];
  const finalBeacons = manualProbeUrl && !existingBeacons.some((b) => (b.url || b.address) === manualProbeUrl)
    ? [{ name: '手动目标', url: manualProbeUrl, manual: true }, ...existingBeacons]
    : existingBeacons;

  return {
    timestamp: Date.now(),
    envType,
    status,
    gatewayStatus,
    sessions,
    tasks,
    logs,
    discovery: { ...discovery, beacons: finalBeacons },
    config,
    agents,
    settings,
  };
}

function buildChatSystemPrompt(ctx) {
  const gw = ctx?.gatewayStatus || {};
  const connected = Boolean(gw?.rpc?.ok || ctx?.status?.gateway?.reachable);
  const tasks = ctx?.tasks?.tasks || [];
  const agents = ctx?.agents?.agents || [];
  const logs = ctx?.logs?.logs || [];
  const errorLogs = logs.filter((l) => /error|fatal/i.test(l.level || '')).slice(0, 5);
  const failedTasks = tasks.filter((t) => /fail|error/i.test(t.status || ''));
  const runningTasks = tasks.filter((t) => /run|active/i.test(t.status || ''));

  return `你是 VisualClaw 的 AI 助手，帮助用户理解和操作 OpenClaw 控制台。请用中文回答，简洁清晰。

## 当前系统状态
- 连接状态：${connected ? '在线' : '未连接'}
- Gateway：${gw?.rpc?.url || ctx?.status?.gateway?.probeUrl || '未知'}
- Agent：${agents.length} 个（${agents.map((a) => a.identityName || a.id).join('、') || '无'}）
- 任务：共 ${tasks.length} 个，运行中 ${runningTasks.length} 个，失败 ${failedTasks.length} 个
${errorLogs.length ? `\n## 最近错误\n${errorLogs.map((l) => `- [${l.time || ''}] ${l.message}`).join('\n')}` : ''}
${failedTasks.length ? `\n## 失败任务\n${failedTasks.map((t) => `- ${t.name || t.id}: ${t.message || t.status}`).join('\n')}` : ''}

## 可建议的操作（白名单）
若需建议操作，在回复末尾以此格式附加，其他情况不要附加：
<actions>[{"label":"查看日志","type":"navigate","tab":"logs"}]</actions>

可用 type：navigate（tab: dashboard/sessions/tasks/logs/config/agents/skills/connections）、refresh（刷新数据）、restart（重启 Gateway，危险）。
危险操作必须在回复中提醒用户确认。`;
}

function parseChatResponse(text) {
  const match = text.match(/<actions>([\s\S]*?)<\/actions>/);
  let actions = [];
  if (match) {
    try { actions = JSON.parse(match[1]); } catch {}
  }
  return { content: text.replace(/<actions>[\s\S]*?<\/actions>/g, '').trim(), actions };
}

async function callOpenClaw(systemPrompt, messages, agentId = 'main', model = undefined) {
  const history = messages.slice(0, -1).slice(-6);
  const lastUser = messages[messages.length - 1];
  const userText = String(lastUser?.content || '');

  let fullMessage = systemPrompt + '\n\n';
  if (history.length) {
    fullMessage += '对话历史：\n' + history.map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`).join('\n') + '\n\n';
  }
  fullMessage += `用户：${userText}`;

  const result = await runAgent(agentId, fullMessage, model);
  if (result.error && !result.text) throw new Error(result.error);
  return parseChatResponse(result.text || '抱歉，无法获取回复。');
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

      if (action === 'config-set') {
        const cfgPath = String(body.path || '').trim();
        const cfgValue = String(body.value ?? '').trim();
        const allowed = ['gateway.port', 'gateway.bind', 'gateway.auth.mode', 'controlUi.allowInsecureAuth'];
        if (!allowed.includes(cfgPath)) {
          send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: `Not allowed: ${cfgPath}` }));
          return;
        }
        const result = await setConfig(cfgPath, cfgValue);
        if (result.error) {
          send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: result.error, stderr: result.stderr }));
          return;
        }
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, stdout: result.stdout }));
        return;
      }

      if (action === 'agent-bindings') {
        const agentId = String(body.agentId || '').trim();
        if (!agentId) {
          send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'agentId required' }));
          return;
        }
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify(await getAgentBindings(agentId)));
        return;
      }

      if (action === 'skills-update') {
        const agentId = String(body.agentId || '').trim() || undefined;
        const result = await skillsUpdateAll(agentId);
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, stdout: result.stdout, stderr: result.stderr, error: result.error }));
        return;
      }

      if (action === 'skills-install') {
        const slug = String(body.slug || '').trim();
        if (!slug) {
          send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'slug required' }));
          return;
        }
        const agentId = String(body.agentId || '').trim() || undefined;
        const result = await skillsInstall(slug, agentId);
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: !result.error, stdout: result.stdout, stderr: result.stderr, error: result.error }));
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

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = await readBody(req);
      const { message, history = [], context, agentId, model } = body;
      if (!message) { send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'message required' })); return; }
      try {
        const systemPrompt = buildChatSystemPrompt(context);
        const messages = [...history.slice(-10), { role: 'user', content: String(message) }];
        const result = await callOpenClaw(systemPrompt, messages, agentId || 'main', model || undefined);
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify(result));
      } catch (error) {
        send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ content: `调用失败：${error?.message || error}`, actions: [] }));
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/skills') {
      const agentId = url.searchParams.get('agent') || undefined;
      send(res, 200, 'application/json; charset=utf-8', JSON.stringify(await getSkills(agentId)));
      return;
    }

    send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'Not found' }));
  } catch (error) {
    send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: error?.message || String(error) }));
  }
});

envType = await detectEnv();
configureRunner(envType);
server.listen(port, () => {
  console.log(`VisualClaw running at http://localhost:${port} [env: ${envType}]`);
});

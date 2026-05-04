const state = {
  activeTab: 'dashboard',
  query: '',
  loading: true,
  error: '',
  data: null,
  manualTarget: '',
  actionNote: '',
};

const tabs = [
  ['dashboard', '首页'],
  ['sessions', '会话'],
  ['tasks', '任务'],
  ['logs', '日志'],
  ['config', '配置'],
  ['connections', '连接管理'],
];

const el = (id) => document.getElementById(id);
const fmtMs = (ms) => ms == null ? '-' : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}m`;
const esc = (s) => String(s ?? '').replace(/[&<>"]+/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const listOf = (value) => Array.isArray(value) ? value : Array.isArray(value?.sessions) ? value.sessions : Array.isArray(value?.tasks) ? value.tasks : Array.isArray(value?.logs) ? value.logs : [];
const countOf = (value, fallback = 0) => Number(value?.count ?? listOf(value).length ?? fallback ?? 0);
const textOr = (...values) => values.find((value) => value != null && value !== '') ?? '-';

function setTab(name) {
  state.activeTab = name;
  render();
}

function filtered(items, text) {
  if (!text) return items;
  const q = text.toLowerCase();
  return items.filter((item) => JSON.stringify(item).toLowerCase().includes(q));
}

function renderNav() {
  el('nav').innerHTML = tabs.map(([key, label]) => `<button class="${state.activeTab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`).join('');
  el('nav').querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
}

function renderTop() {
  const data = state.data || {};
  const gw = data.gatewayStatus || {};
  const connected = Boolean(gw?.rpc?.ok || data?.status?.gateway?.reachable);
  const manualTargetEl = el('manualTarget');
  el('connDot').className = `dot ${connected ? 'ok' : state.error ? 'bad' : ''}`;
  el('connText').textContent = state.error ? `错误：${state.error}` : connected ? '已连接本机 OpenClaw' : '未确认连接';
  el('gwUrl').textContent = textOr(gw?.rpc?.url, data?.status?.gateway?.probeUrl);
  el('sessionCount').textContent = countOf(data?.sessions);
  el('taskCount').textContent = countOf(data?.tasks);
  if (manualTargetEl && document.activeElement !== manualTargetEl && manualTargetEl.value !== state.manualTarget) {
    manualTargetEl.value = state.manualTarget || '';
  }
  el('footer').textContent = state.loading
    ? '正在加载数据…'
    : state.actionNote || `最后刷新：${new Date(data?.timestamp || Date.now()).toLocaleString()}`;
}

function renderHero() {
  const data = state.data || {};
  const gw = data.gatewayStatus || {};
  const status = data.status || {};
  const sessions = listOf(data.sessions);
  const tasks = listOf(data.tasks);
  const logs = listOf(data.logs);
  const discovery = data.discovery || {};
  const cards = [
    ['连接', gw?.rpc?.ok ? '在线' : '未确认', gw?.port?.status || status?.gatewayService?.runtimeShort || '未知'],
    ['实例', String(status?.agents?.totalSessions ?? sessions.length), '会话总数'],
    ['任务', String(tasks.length), '当前任务'],
    ['日志', String(logs.length), `发现 ${discovery?.count ?? 0} 个 beacon`],
  ];
  const errorCard = state.error || data.status?.error || data.gatewayStatus?.error ? [`错误`, state.error || data.status?.error || data.gatewayStatus?.error || 'CLI 调用失败', '请先刷新或检查 OpenClaw'] : [];
  el('hero').innerHTML = [...cards, errorCard.length ? errorCard : null].filter(Boolean).map(([title, value, hint]) => `
    <div class="card">
      <div class="small">${esc(title)}</div>
      <div class="stat"><strong>${esc(value)}</strong><span class="small">${esc(hint)}</span></div>
    </div>
  `).join('');
}

function renderSessionItem(s) {
  return `<div class="item"><div><strong class="mono">${esc(s.key)}</strong></div><div class="small">${esc(s.model || '-')} · ${fmtMs(s.ageMs)} · tokens ${esc(s.totalTokens ?? s.inputTokens ?? 0)}</div></div>`;
}
function renderTaskItem(t) {
  return `<div class="item"><div><strong>${esc(t.name || t.id || 'task')}</strong></div><div class="small">${esc(t.status || '-')} · ${esc(t.runtime || '')} · ${esc(t.message || t.title || '')}</div></div>`;
}
function renderLogItem(l) {
  return `<div class="item"><div class="small mono">${esc(l.time || '')} · ${esc(l.level || '')} · ${esc(l.subsystem || '')}</div><div>${esc(l.message || '')}</div></div>`;
}

function renderDashboard() {
  const data = state.data || {};
  const gw = data.gatewayStatus || {};
  const status = data.status || {};
  const settings = data.settings || {};
  const discovery = data.discovery || {};
  const envType = data.envType || 'UNKNOWN';
  const envHint = envType === 'WSL' ? 'WSL 本机回环' : envType === 'WINDOWS' ? 'Windows 本机' : '本机';
  const sessions = listOf(data.sessions).slice(0, 6);
  const tasks = listOf(data.tasks).slice(0, 6);
  const logs = listOf(data.logs).slice(0, 6);
  el('section-dashboard').innerHTML = `
    <div class="grid-2">
      <div class="card">
        <h2>总览</h2>
        <table class="table">
          <tr><th>Gateway</th><td class="mono">${esc(gw?.rpc?.url || status?.gateway?.probeUrl || '-')}</td></tr>
          <tr><th>服务状态</th><td>${esc(gw?.service?.runtime?.status || status?.gatewayService?.runtimeShort || '-')}</td></tr>
          <tr><th>端口</th><td>${esc(gw?.gateway?.port || status?.gateway?.port || '-')}</td></tr>
          <tr><th>绑定</th><td>${esc(gw?.gateway?.bindMode || status?.gateway?.bindMode || '-')}</td></tr>
          <tr><th>认证</th><td>${esc(gw?.rpc?.capability || status?.gateway?.error || '-')}</td></tr>
          <tr><th>本地设置</th><td class="mono">${esc(settings.manualTarget || '-')}</td></tr>
        </table>
      </div>
      <div class="card">
        <h2>发现</h2>
        <div class="small">Bonjour / 本机候选端口 · ${esc(envHint)}</div>
        <div style="height:12px"></div>
        <div class="list">
          ${(discovery?.beacons || []).length ? discovery.beacons.map((b) => `
            <div class="item">
              <div><strong>${esc(b.name || b.host || 'beacon')}</strong></div>
              <div class="small mono">${esc(b.url || b.address || '')}</div>
            </div>`).join('') : '<div class="empty">暂无 beacon，当前以本机状态为准。</div>'}
        </div>
      </div>
    </div>
    <div style="height:16px"></div>
    <div class="cols">
      <div class="card"><h3>最近会话</h3>${sessions.length ? sessions.map(renderSessionItem).join('') : '<div class="empty">没有会话</div>'}</div>
      <div class="card"><h3>最近任务</h3>${tasks.length ? tasks.map(renderTaskItem).join('') : '<div class="empty">没有任务</div>'}</div>
      <div class="card"><h3>最近日志</h3>${logs.length ? logs.map(renderLogItem).join('') : '<div class="empty">没有日志</div>'}</div>
    </div>
  `;
}

function renderSessions() {
  const sessions = filtered(listOf(state.data?.sessions), state.query);
  el('section-sessions').innerHTML = `
    <div class="card">
      <div class="toolbar"><h2 style="margin:0">会话</h2><span class="small">${sessions.length} 条</span></div>
      <div style="height:12px"></div>
      ${sessions.length ? `<table class="table"><thead><tr><th>Key</th><th>Model</th><th>Age</th><th>Tokens</th><th>Agent</th></tr></thead><tbody>${sessions.map((s) => `<tr><td class="mono">${esc(s.key)}</td><td>${esc(s.model || '-')}</td><td>${fmtMs(s.ageMs)}</td><td>${esc(s.totalTokens ?? s.inputTokens ?? 0)}</td><td>${esc(s.agentId || '-')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">没有匹配的会话</div>'}
    </div>
  `;
}

function renderTasks() {
  const tasks = filtered(listOf(state.data?.tasks), state.query);
  el('section-tasks').innerHTML = `
    <div class="card">
      <div class="toolbar"><h2 style="margin:0">任务</h2><span class="small">${tasks.length} 条</span></div>
      <div style="height:12px"></div>
      ${tasks.length ? `<table class="table"><thead><tr><th>ID</th><th>Status</th><th>Runtime</th><th>Updated</th></tr></thead><tbody>${tasks.map((t) => `<tr><td class="mono">${esc(t.id || t.taskId || '')}</td><td>${esc(t.status || '-')}</td><td>${esc(t.runtime || '-')}</td><td>${esc(t.updatedAt || t.createdAt || '-')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">当前没有任务</div>'}
    </div>
  `;
}

function renderLogs() {
  const logsSource = state.data?.logs || {};
  const logs = filtered(listOf(logsSource), state.query);
  el('section-logs').innerHTML = `
    <div class="card">
      <div class="toolbar"><h2 style="margin:0">日志</h2><span class="small">${logs.length} 行</span></div>
      <div style="height:12px"></div>
      ${logsSource?.error ? `<div class="empty">日志读取失败：${esc(logsSource.error)}</div><div style="height:12px"></div>` : ''}
      <div class="list">${logs.length ? logs.map(renderLogItem).join('') : '<div class="empty">没有匹配日志</div>'}</div>
    </div>
  `;
}

function renderConfig() {
  const cfg = state.data?.config || {};
  const status = state.data?.status || {};
  el('section-config').innerHTML = `
    <div class="card">
      <h2>配置</h2>
      <table class="table">
        <tr><th>gateway.port</th><td class="mono">${esc(cfg.gatewayPort ?? '-')}</td></tr>
        <tr><th>gateway.bind</th><td class="mono">${esc(cfg.gatewayBind ?? '-')}</td></tr>
        <tr><th>gateway.auth.mode</th><td class="mono">${esc(cfg.authMode ?? '-')}</td></tr>
        <tr><th>controlUi.allowInsecureAuth</th><td class="mono">${esc(cfg.allowInsecureAuth ?? '-')}</td></tr>
        <tr><th>gateway.url</th><td class="mono">${esc(status?.gateway?.probeUrl ?? status?.gateway?.url ?? '-')}</td></tr>
        <tr><th>gateway.service</th><td>${esc(status?.gatewayService?.runtimeShort ?? status?.gatewayService?.runtime?.status ?? '-')}</td></tr>
      </table>
      ${cfg.error ? `<div style="height:12px"></div><div class="empty">配置读取失败：${esc(cfg.error)}</div>` : ''}
    </div>
  `;
}

function renderConnections() {
  const status = state.data?.gatewayStatus || {};
  const discovery = state.data?.discovery || {};
  const envType = state.data?.envType || 'UNKNOWN';
  const envLabel = { WINDOWS: 'Windows 原生', WSL: 'WSL (Linux)', UNKNOWN: '未知环境' }[envType] || envType;
  const envHint = envType === 'WSL'
    ? '扫描范围：WSL 本机回环（127.x）'
    : envType === 'WINDOWS'
    ? '扫描范围：Windows 本机（127.x / localhost）'
    : '扫描范围：本机（通用策略）';
  const candidates = [
    status?.gateway?.probeUrl,
    status?.gateway?.url,
    ...(Array.isArray(discovery?.beacons) ? discovery.beacons : []).map((b) => b.url || b.address).filter(Boolean),
  ].filter(Boolean);
  el('section-connections').innerHTML = `
    <div class="grid-2">
      <div class="card">
        <h2>连接管理</h2>
        <div style="margin-bottom:12px;display:flex;align-items:center;gap:8px">
          <span class="chip">${esc(envLabel)}</span>
          <span class="small">${esc(envHint)}</span>
        </div>
        <table class="table">
          <tr><th>RPC</th><td>${esc(status?.rpc?.ok ? 'ok' : 'unknown')}</td></tr>
          <tr><th>Capability</th><td class="mono">${esc(status?.rpc?.capability || '-')}</td></tr>
          <tr><th>Port</th><td class="mono">${esc(status?.port?.port || '-')}</td></tr>
          <tr><th>Listeners</th><td>${esc((status?.port?.listeners || []).length)}</td></tr>
        </table>
      </div>
      <div class="card">
        <h2>候选目标</h2>
        <div class="list">${candidates.length ? candidates.map((c) => `<div class="item mono">${esc(c)}</div>`).join('') : '<div class="empty">暂无候选目标</div>'}</div>
      </div>
    </div>
  `;
}

function render() {
  renderNav();
  renderTop();
  renderHero();
  document.querySelectorAll('.section').forEach((sec) => sec.classList.remove('active'));
  el(`section-${state.activeTab}`).classList.add('active');
  renderDashboard();
  renderSessions();
  renderTasks();
  renderLogs();
  renderConfig();
  renderConnections();
}

async function loadData() {
  state.loading = true;
  renderTop();
  try {
    const res = await fetch('/api/bootstrap');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    state.manualTarget = state.data?.settings?.manualTarget || '';
    state.error = '';
  } catch (err) {
    state.error = err?.message || String(err);
  } finally {
    state.loading = false;
    render();
  }
}

async function runAction(action, body = {}) {
  const res = await fetch('/api/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

el('searchBox').addEventListener('input', (e) => {
  state.query = e.target.value;
  render();
});

el('saveTargetBtn').addEventListener('click', async () => {
  try {
    state.actionNote = '已保存连接目标';
    await runAction('save-target', { target: el('manualTarget').value.trim() });
    await loadData();
  } catch (err) {
    state.actionNote = `保存失败：${err.message || String(err)}`;
    render();
  }
});

document.querySelectorAll('[data-action]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const action = btn.dataset.action;
    try {
      state.actionNote = '';
      if (action === 'refresh') return loadData();
      if (action === 'discover') {
        await runAction('discover');
        state.actionNote = '已刷新发现结果';
        return loadData();
      }
      if (!confirm(`确认执行：${action} ?`)) return;
      const result = await runAction(action);
      state.actionNote = result?.stderr || result?.stdout || `${action} 已执行`;
      setTimeout(loadData, 1200);
    } catch (err) {
      state.actionNote = `${action} 失败：${err.message || String(err)}`;
      render();
    }
  });
});

actionInit();
async function actionInit() {
  tabs.forEach(([key, label]) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.dataset.tab = key;
    btn.addEventListener('click', () => setTab(key));
    el('tabs').appendChild(btn);
  });
  await loadData();
  setInterval(loadData, 15000);
}

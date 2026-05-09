const state = {
  activeTab: 'dashboard',
  query: '',
  loading: true,
  error: '',
  data: null,
  manualTarget: '',
  actionNote: '',
  selectedAgent: null,
  selectedTask: null,
  skillsAgent: '',
  skills: null,
  skillsLoading: false,
  agentBindings: null,
  agentBindingsLoading: false,
  logLevel: 'all',
  taskFilter: 'all',
  sessionChatMessages: [],
  sessionChatLoading: false,
  chatAgentId: 'main',
  chatModel: '',
  selectedSessionKey: null,
};

const tabs = [
  ['dashboard', '首页'],
  ['sessions', '会话'],
  ['tasks', '任务'],
  ['logs', '日志'],
  ['config', '配置'],
  ['agents', 'Agent'],
  ['skills', 'Skills'],
  ['connections', '连接管理'],
];

const el = (id) => document.getElementById(id);
const fmtMs = (ms) => ms == null ? '-' : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}m`;
const esc = (s) => String(s ?? '').replace(/[&<>"]+/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const listOf = (value) => Array.isArray(value) ? value : Array.isArray(value?.sessions) ? value.sessions : Array.isArray(value?.tasks) ? value.tasks : Array.isArray(value?.logs) ? value.logs : [];
const countOf = (value, fallback = 0) => Number(value?.count ?? listOf(value).length ?? fallback ?? 0);
const textOr = (...values) => values.find((value) => value != null && value !== '') ?? '-';
const STATUS_MAP = { connected: '在线', connecting: '连接中', read_only: '只读', busy: '忙碌中', failed: '失败', paused: '已暂停', running: '运行中', pending: '等待中', blocked: '已卡住', done: '已完成', error: '错误', active: '活跃', ok: '正常' };
const humanStatus = (s) => STATUS_MAP[String(s || '').toLowerCase()] || String(s || '-');

function setTab(name) {
  state.activeTab = name;
  if (name === 'skills' && state.skills === null && !state.skillsLoading) loadSkills();
  render();
}

function navigateTo(tab, query) {
  state.activeTab = tab;
  state.query = query;
  el('searchBox').value = query;
  if (tab === 'skills' && state.skills === null && !state.skillsLoading) loadSkills();
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
  const lvl = String(l.level || '').toLowerCase();
  const isErr = /error|fatal/.test(lvl);
  const isWarn = /warn/.test(lvl);
  const levelClass = isErr ? 'log-level-bad' : isWarn ? 'log-level-warn' : 'muted';
  const rowClass = isErr ? ' log-error' : isWarn ? ' log-warn' : '';
  return `<div class="item${rowClass}"><div class="small mono"><span class="${levelClass}">${esc(l.level || 'info')}</span> · ${esc(l.time || '')} · ${esc(l.subsystem || '')}</div><div>${esc(l.message || '')}</div></div>`;
}

function renderDashboard() {
  const data = state.data || {};
  const gw = data.gatewayStatus || {};
  const status = data.status || {};
  const tasks = listOf(data.tasks);
  const logs = listOf(data.logs);
  const agents = Array.isArray(data.agents?.agents) ? data.agents.agents : [];
  const connected = Boolean(gw?.rpc?.ok || status?.gateway?.reachable);
  const connLabel = connected ? '在线' : '未连接';
  const connClass = connected ? 'ok' : '';

  const failedTasks = tasks.filter((t) => /fail|error|block/i.test(t.status || ''));
  const runningTasks = tasks.filter((t) => /run|active/i.test(t.status || ''));
  const errorLogs = logs.filter((l) => /error|fatal/i.test(l.level || '')).slice(0, 3);
  const hasRisk = failedTasks.length > 0 || errorLogs.length > 0;

  const overviewCards = [
    { label: '连接状态', value: connLabel, hint: humanStatus(gw?.service?.runtime?.status || status?.gatewayService?.runtimeShort || ''), cls: connClass },
    { label: 'Agent', value: String(agents.length), hint: agents.map((a) => a.identityName || a.id).join('、') || '暂无', cls: '' },
    { label: '任务', value: String(tasks.length), hint: `运行中 ${runningTasks.length} · 失败 ${failedTasks.length}`, cls: failedTasks.length ? 'bad' : '' },
    { label: '日志', value: String(logs.length), hint: `错误 ${errorLogs.length} 条`, cls: errorLogs.length ? 'bad' : '' },
  ];

  el('section-dashboard').innerHTML = `
    <div class="card" style="margin-bottom:0">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="btn primary" data-dash-action="reconnect">${connected ? '重连' : '连接'}</button>
        <button class="btn" data-dash-action="agents">Agent</button>
        <button class="btn" data-dash-action="tasks">任务</button>
        <button class="btn" data-dash-action="logs">日志</button>
        <button class="btn" data-dash-action="config">配置</button>
        <button class="btn" data-dash-action="connections">连接管理</button>
      </div>
    </div>
    <div class="hero">
      ${overviewCards.map(({ label, value, hint, cls }) => `
        <div class="card">
          <div class="small">${esc(label)}</div>
          <div class="stat"><strong style="${cls === 'bad' ? 'color:var(--bad)' : cls === 'ok' ? 'color:var(--ok)' : ''}">${esc(value)}</strong></div>
          <div class="small" style="margin-top:4px">${esc(hint)}</div>
        </div>`).join('')}
    </div>
    ${hasRisk ? `
    <div class="card risk-card">
      <h3 style="margin:0 0 10px;color:var(--bad)">⚠ 风险提示</h3>
      ${failedTasks.slice(0, 3).map((t) => `<div class="small" style="margin-bottom:4px">任务失败：<strong>${esc(t.name || t.id || 'task')}</strong> — ${esc(humanStatus(t.status))} ${t.message ? '· ' + esc(t.message) : ''}</div>`).join('')}
      ${errorLogs.map((l) => `<div class="small" style="margin-bottom:4px;color:var(--bad)">错误日志：${esc(l.message)}</div>`).join('')}
      <div style="margin-top:8px;display:flex;gap:8px">
        ${failedTasks.length ? `<button class="btn ghost" style="font-size:12px" data-dash-action="tasks">查看任务</button>` : ''}
        ${errorLogs.length ? `<button class="btn ghost" style="font-size:12px" data-dash-action="logs">查看日志</button>` : ''}
      </div>
    </div>` : ''}
    ${runningTasks.length ? `
    <div class="card">
      <h3 style="margin:0 0 10px">运行中任务 (${runningTasks.length})</h3>
      <div class="list">${runningTasks.slice(0, 5).map(renderTaskItem).join('')}</div>
      ${runningTasks.length > 5 ? `<div class="small" style="margin-top:8px;color:var(--muted)">还有 ${runningTasks.length - 5} 个任务</div>` : ''}
    </div>` : `
    <div class="card">
      <h3 style="margin:0 0 8px">当前任务</h3>
      <div class="empty">暂无运行中任务</div>
    </div>`}
  `;
}

function renderSessions() {
  const allSessions = listOf(state.data?.sessions);
  const agents = Array.isArray(state.data?.agents?.agents) ? state.data.agents.agents : [];
  const sessions = allSessions.filter((s) => !s.agentId || s.agentId === state.chatAgentId);
  const sel = sessions.find((s) => s.key === state.selectedSessionKey);
  const selStyle = 'background:#0f172a;color:var(--text);border:1px solid var(--line);border-radius:10px;padding:8px 10px;font:inherit';
  const agentOpts = agents.length
    ? agents.map((a) => `<option value="${esc(a.id)}" ${state.chatAgentId === a.id ? 'selected' : ''}>${esc(a.identityEmoji || '')} ${esc(a.identityName || a.id)}</option>`).join('')
    : `<option value="main" selected>main</option>`;
  const uniqueModels = [...new Set(agents.map((a) => a.model).filter(Boolean))];
  const modelOpts = `<option value="">默认（Agent 配置）</option>` + uniqueModels.map((m) => `<option value="${esc(m)}" ${state.chatModel === m ? 'selected' : ''}>${esc(m)}</option>`).join('');
  const sessionOpts = sessions.map((s) => `<option value="${esc(s.key)}" ${state.selectedSessionKey === s.key ? 'selected' : ''}>${esc(s.key.slice(0, 24))} · ${esc(s.model || '-')} · ${fmtMs(s.ageMs)}</option>`).join('');
  const chatMsgs = state.sessionChatMessages.map((m) => {
    const isUser = m.role === 'user';
    const acts = (m.actions || []).map((a) => `<button class="chat-action" data-action-type="${esc(a.type)}" data-action-tab="${esc(a.tab || '')}">${esc(a.label)}</button>`).join('');
    return `<div class="chat-msg ${isUser ? 'chat-user' : 'chat-assistant'}"><div class="chat-bubble">${esc(m.content)}</div>${acts ? `<div class="chat-actions">${acts}</div>` : ''}</div>`;
  }).join('') + (state.sessionChatLoading ? '<div class="chat-msg chat-assistant"><div class="chat-bubble chat-loading">思考中…</div></div>' : '');
  el('section-sessions').innerHTML = `
    <div class="card">
      <div class="toolbar" style="flex-wrap:wrap;gap:12px;align-items:center">
        <div style="display:flex;flex-direction:column;gap:4px">
          <span class="small" style="color:var(--muted)">对话 Agent</span>
          <select id="chatAgentSelect" style="${selStyle}">${agentOpts}</select>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <span class="small" style="color:var(--muted)">模型</span>
          <select id="chatModelSelect" style="${selStyle}">${modelOpts}</select>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:200px">
          <span class="small" style="color:var(--muted)">关联会话（可选）</span>
          <select id="sessionSelect" style="${selStyle};width:100%"><option value="">— 不关联会话 —</option>${sessionOpts}</select>
        </div>
      </div>
    </div>
    <div class="card" style="display:flex;flex-direction:column">
      <div id="sessionChatMessages" class="chat-messages" style="min-height:300px;max-height:500px">${chatMsgs || '<div class="empty" style="font-size:13px">发送消息开始对话</div>'}</div>
      <div style="display:flex;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">
        <input id="sessionChatInput" type="text" placeholder="问点什么…" style="flex:1;min-width:0" autocomplete="off" />
        <button class="btn primary" id="sessionChatSend">发送</button>
      </div>
    </div>
    ${sel ? `<div class="card"><h3 style="margin:0 0 8px">会话详情</h3><table class="table"><tr><th>Key</th><td class="mono small">${esc(sel.key)}</td></tr><tr><th>Model</th><td>${esc(sel.model||'-')}</td></tr><tr><th>Age</th><td>${fmtMs(sel.ageMs)}</td></tr><tr><th>Tokens</th><td>${esc(sel.totalTokens??sel.inputTokens??0)}</td></tr><tr><th>Agent</th><td>${esc(sel.agentId||'-')}</td></tr></table></div>` : ''}
  `;
  const msgEl = document.getElementById('sessionChatMessages');
  if (msgEl) msgEl.scrollTop = msgEl.scrollHeight;
}

function renderTaskFlow(t) {
  const steps = t.steps || t.phases || t.history || [];
  const stepsHtml = steps.length
    ? steps.map((s, i) => {
        const st = String(s.status || s.state || '');
        const isFail = /fail|error|block/i.test(st);
        const isRun = /run|active|progress/i.test(st);
        return `<div class="flow-item${isFail ? ' flow-fail' : isRun ? ' flow-active' : ''}"><div class="flow-dot"></div><div class="flow-body"><strong>${esc(s.name || s.title || `步骤 ${i + 1}`)}</strong>${st ? ` <span class="tag">${esc(st)}</span>` : ''}${s.message ? `<div class="small">${esc(s.message)}</div>` : ''}</div></div>`;
      }).join('')
    : '<div class="empty">暂无详细阶段数据</div>';
  const statusClass = /fail|error/i.test(t.status || '') ? ' red' : /run|active/i.test(t.status || '') ? ' green' : '';
  return `
    <div class="card">
      <button class="btn ghost" data-task-back style="margin-bottom:12px">← 返回</button>
      <h2 style="margin:0 0 8px">${esc(t.name || t.id || 'task')}</h2>
      <div style="margin-bottom:12px"><span class="tag${statusClass}">${esc(t.status || '未知')}</span>${t.runtime ? `<span class="small"> · ${esc(t.runtime)}</span>` : ''}</div>
      <table class="table" style="margin-bottom:12px">
        <tr><th>ID</th><td class="mono small">${esc(t.id || t.taskId || '-')}</td></tr>
        ${t.message ? `<tr><th>消息</th><td>${esc(t.message)}</td></tr>` : ''}
        ${t.updatedAt ? `<tr><th>更新时间</th><td>${esc(t.updatedAt)}</td></tr>` : ''}
      </table>
      <button class="btn ghost" data-link-tab="logs" data-link-query="${esc(t.id || t.taskId || '')}">查看相关日志</button>
      <h3 style="margin:16px 0 4px">任务流</h3>
      ${stepsHtml}
    </div>
  `;
}

function renderTasks() {
  if (state.selectedTask) {
    const task = listOf(state.data?.tasks).find((t) => (t.id || t.taskId) === state.selectedTask) || { id: state.selectedTask };
    el('section-tasks').innerHTML = renderTaskFlow(task);
    return;
  }
  let tasks = filtered(listOf(state.data?.tasks), state.query);
  if (state.taskFilter === 'running') tasks = tasks.filter((t) => /run|active/i.test(t.status || ''));
  else if (state.taskFilter === 'failed') tasks = tasks.filter((t) => /fail|error|block/i.test(t.status || ''));
  else if (state.taskFilter === 'pending') tasks = tasks.filter((t) => /pend|wait/i.test(t.status || ''));
  else {
    const failed = tasks.filter((t) => /fail|error|block/i.test(t.status || ''));
    const rest = tasks.filter((t) => !/fail|error|block/i.test(t.status || ''));
    tasks = [...failed, ...rest];
  }

  const filterBtns = [['all','全部'], ['running','运行中'], ['failed','失败/卡住'], ['pending','等待中']].map(([k, label]) =>
    `<button class="tabs-btn${state.taskFilter === k ? ' active' : ''}" data-task-filter="${k}">${label}</button>`
  ).join('');

  el('section-tasks').innerHTML = `
    <div class="card">
      <div class="toolbar"><h2 style="margin:0">任务</h2><span class="small">${tasks.length} 条</span></div>
      <div style="height:10px"></div>
      <div class="tabs" style="margin-bottom:10px">${filterBtns}</div>
      ${tasks.length ? `<table class="table"><thead><tr><th>名称 / ID</th><th>状态</th><th>运行时长</th><th>更新时间</th><th></th></tr></thead><tbody>${tasks.map((t) => {
        const isFail = /fail|error|block/i.test(t.status || '');
        return `<tr style="${isFail ? 'color:var(--bad)' : ''}"><td class="mono small">${esc(t.name || t.id || t.taskId || '')}</td><td>${esc(humanStatus(t.status) || '-')}</td><td>${esc(t.runtime || '-')}</td><td>${esc(t.updatedAt || t.createdAt || '-')}</td><td><button class="btn ghost" style="padding:4px 8px;font-size:12px" data-task-flow="${esc(t.id || t.taskId || '')}">任务流</button></td></tr>`;
      }).join('')}</tbody></table>` : '<div class="empty">没有匹配任务</div>'}
    </div>
  `;
}

function renderLogs() {
  const logsSource = state.data?.logs || {};
  let logs = filtered(listOf(logsSource), state.query);
  if (state.logLevel === 'error') logs = logs.filter((l) => /error|fatal/i.test(l.level || ''));
  else if (state.logLevel === 'warn') logs = logs.filter((l) => /warn|error|fatal/i.test(l.level || ''));
  else if (state.logLevel === 'info') logs = logs.filter((l) => /info|debug/i.test(l.level || ''));

  const errors = logs.filter((l) => /error|fatal/i.test(l.level || ''));
  const rest = logs.filter((l) => !/error|fatal/i.test(l.level || ''));
  const ordered = [...errors, ...rest];

  const lvlBtns = [['all','全部'], ['error','仅错误'], ['warn','错误+警告'], ['info','信息']].map(([k, label]) =>
    `<button class="tabs-btn${state.logLevel === k ? ' active' : ''}" data-log-level="${k}">${label}</button>`
  ).join('');

  el('section-logs').innerHTML = `
    <div class="card">
      <div class="toolbar"><h2 style="margin:0">日志</h2><span class="small">${ordered.length} 行${errors.length ? ` · <span style="color:var(--bad)">${errors.length} 错误</span>` : ''}</span></div>
      <div style="height:10px"></div>
      <div class="tabs" style="margin-bottom:10px">${lvlBtns}</div>
      ${logsSource?.error ? `<div class="empty">日志读取失败：${esc(logsSource.error)}</div><div style="height:12px"></div>` : ''}
      <div class="list">${ordered.length ? ordered.map(renderLogItem).join('') : '<div class="empty">没有匹配日志</div>'}</div>
    </div>
  `;
}

function cfgRow(label, path, value) {
  const isDanger = path === 'controlUi.allowInsecureAuth';
  return `<tr>
    <th>${esc(label)}${isDanger ? ' <span class="error" title="修改此项存在安全风险">⚠</span>' : ''}</th>
    <td><input type="text" class="mono" data-cfg-path="${esc(path)}" value="${esc(value ?? '')}" style="min-width:120px;width:100%"></td>
    <td><button class="btn ghost" data-cfg-save="${esc(path)}" style="padding:6px 10px">保存</button></td>
  </tr>`;
}

function renderConfig() {
  const cfg = state.data?.config || {};
  const status = state.data?.status || {};
  el('section-config').innerHTML = `
    <div class="card">
      <h2>配置</h2>
      <div class="small" style="margin-bottom:12px">部分配置保存后需重启 Gateway 生效。</div>
      <table class="table">
        ${cfgRow('gateway.port', 'gateway.port', cfg.gatewayPort)}
        ${cfgRow('gateway.bind', 'gateway.bind', cfg.gatewayBind)}
        ${cfgRow('gateway.auth.mode', 'gateway.auth.mode', cfg.authMode)}
        ${cfgRow('controlUi.allowInsecureAuth', 'controlUi.allowInsecureAuth', cfg.allowInsecureAuth)}
        <tr><th>gateway.url</th><td class="mono" colspan="2">${esc(status?.gateway?.probeUrl ?? status?.gateway?.url ?? '-')}</td></tr>
        <tr><th>gateway.service</th><td colspan="2">${esc(status?.gatewayService?.runtimeShort ?? status?.gatewayService?.runtime?.status ?? '-')}</td></tr>
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

function renderAgents() {
  const agentData = state.data?.agents || {};
  const agents = Array.isArray(agentData.agents) ? agentData.agents : Array.isArray(agentData) ? agentData : [];

  if (state.selectedAgent) {
    const agent = agents.find((a) => a.id === state.selectedAgent) || { id: state.selectedAgent };
    const sessions = listOf(state.data?.sessions).filter((s) => s.agentId === state.selectedAgent).slice(0, 5);
    el('section-agents').innerHTML = `
      <div class="card">
        <button class="btn ghost" data-agent-back style="margin-bottom:12px">← 返回</button>
        <h2 style="margin:0 0 8px">${esc(agent.identityEmoji || '🤖')} ${esc(agent.identityName || agent.id)}</h2>
        <table class="table" style="margin-bottom:12px">
          <tr><th>ID</th><td class="mono">${esc(agent.id)}</td></tr>
          <tr><th>Model</th><td>${esc(agent.model || '-')}</td></tr>
          <tr><th>默认</th><td>${agent.isDefault ? '是' : '否'}</td></tr>
          <tr><th>Workspace</th><td class="mono small">${esc(agent.workspace || '-')}</td></tr>
        </table>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
          <button class="btn ghost" data-link-tab="sessions" data-link-query="${esc(agent.id)}">相关会话</button>
          <button class="btn ghost" data-link-tab="logs" data-link-query="${esc(agent.id)}">相关日志</button>
          <button class="btn ghost" data-link-skills="${esc(agent.id)}">查看 Skills</button>
        </div>
        <h3 style="margin:0 0 8px">Bindings</h3>
        ${state.agentBindingsLoading
          ? '<div class="empty">加载中…</div>'
          : state.agentBindings === null
            ? `<button class="btn ghost" data-load-bindings="${esc(agent.id)}">查看 Bindings</button>`
            : state.agentBindings.length
              ? `<div class="list">${state.agentBindings.map((b) => `<div class="item"><div class="mono small">${esc(b.channel || '')} → ${esc(b.target || b.agentId || JSON.stringify(b))}</div></div>`).join('')}</div>`
              : '<div class="empty">该 Agent 暂无 Bindings</div>'}
      </div>
      ${sessions.length ? `<div class="card"><h3>最近会话</h3>${sessions.map(renderSessionItem).join('')}</div>` : ''}
    `;
    return;
  }

  el('section-agents').innerHTML = `
    <div class="card">
      <div class="toolbar"><h2 style="margin:0">Agent 控制台</h2><span class="small">${agents.length} 个</span></div>
      <div style="height:12px"></div>
      ${agents.length ? `<div class="list">${agents.map((a) => `
        <div class="item clickable" data-agent-select="${esc(a.id)}">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:1.5em;line-height:1">${esc(a.identityEmoji || '🤖')}</span>
            <div style="flex:1">
              <strong>${esc(a.identityName || a.id)}</strong>${a.isDefault ? ' <span class="tag green">默认</span>' : ''}
              <div class="small mono">${esc(a.id)} · ${esc(a.model || '-')}</div>
            </div>
            <span class="small">${esc(a.bindings || 0)} bindings</span>
          </div>
        </div>`).join('')}</div>` : '<div class="empty">没有 Agent</div>'}
      ${agentData.error ? `<div class="empty" style="margin-top:8px">错误：${esc(agentData.error)}</div>` : ''}
    </div>
  `;
}

function renderSkills() {
  const agentData = state.data?.agents || {};
  const agents = Array.isArray(agentData.agents) ? agentData.agents : Array.isArray(agentData) ? agentData : [];
  const agentFilter = state.skillsAgent;

  const agentSelector = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn${!agentFilter ? '' : ' ghost'}" data-skills-agent="">全局</button>
      ${agents.map((a) => `<button class="btn${agentFilter === a.id ? '' : ' ghost'}" data-skills-agent="${esc(a.id)}">${esc(a.identityEmoji || '')} ${esc(a.identityName || a.id)}</button>`).join('')}
    </div>
  `;

  if (state.skillsLoading) {
    el('section-skills').innerHTML = `<div class="card">${agentSelector}<div class="empty">加载 Skills 中…</div></div>`;
    return;
  }

  if (!state.skills) {
    el('section-skills').innerHTML = `<div class="card"><div class="toolbar"><h2 style="margin:0">Skills 管理中心</h2></div><div style="height:12px"></div>${agentSelector}<div class="empty">选择范围后自动加载</div></div>`;
    return;
  }

  const all = state.skills;
  const eligible = all.filter((s) => s.eligible && !s.disabled);
  const disabled = all.filter((s) => s.disabled);
  const unavailable = all.filter((s) => !s.eligible && !s.disabled);

  const isInstalled = (s) => s.source === 'openclaw-workspace';
  const skillCard = (s) => `
    <div class="item">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <span style="font-size:1.3em;line-height:1.3">${esc(s.emoji || '🔧')}</span>
        <div style="flex:1">
          <strong>${esc(s.name)}</strong>${s.bundled ? ' <span class="tag">内置</span>' : ''}${isInstalled(s) ? ' <span class="tag purple">已安装</span>' : ''}
          <div class="small" style="margin-top:2px">${esc(s.description || '')}</div>
        </div>
        ${isInstalled(s) ? `<button class="btn ghost" style="padding:4px 8px;font-size:12px;flex-shrink:0" data-skill-update="${esc(s.name)}">更新</button>` : ''}
      </div>
    </div>
  `;

  const installedCount = all.filter(isInstalled).length;
  el('section-skills').innerHTML = `
    <div class="card">
      <div class="toolbar"><h2 style="margin:0">Skills 管理中心</h2><span class="small">${all.length} 个 · ${installedCount} 个已安装</span></div>
      <div style="height:12px"></div>
      ${agentSelector}
      ${installedCount > 0 ? `<button class="btn ghost" data-skills-update>更新全部已安装 (${installedCount})</button>` : ''}
    </div>
    ${eligible.length ? `<div class="card"><h3>可用 (${eligible.length})</h3><div class="list">${eligible.map(skillCard).join('')}</div></div>` : ''}
    ${disabled.length ? `<div class="card"><h3>已禁用 (${disabled.length})</h3><div class="list">${disabled.map(skillCard).join('')}</div></div>` : ''}
    ${unavailable.length ? `<div class="card"><h3>不可用 (${unavailable.length})</h3><div class="small" style="margin-bottom:8px">缺少依赖或条件未满足</div><div class="list">${unavailable.map(skillCard).join('')}</div></div>` : ''}
  `;
}

async function loadAgentBindings(agentId) {
  state.agentBindingsLoading = true;
  renderAgents();
  try {
    const data = await runAction('agent-bindings', { agentId });
    state.agentBindings = data.bindings || [];
  } catch (err) {
    state.agentBindings = [];
    state.actionNote = `Bindings 加载失败：${err.message || String(err)}`;
  } finally {
    state.agentBindingsLoading = false;
    renderAgents();
  }
}

async function loadSkills() {
  state.skillsLoading = true;
  renderSkills();
  try {
    const url = state.skillsAgent ? `/api/skills?agent=${encodeURIComponent(state.skillsAgent)}` : '/api/skills';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.skills = Array.isArray(data.skills) ? data.skills : [];
  } catch (err) {
    state.skills = [];
    state.actionNote = `Skills 加载失败：${err.message || String(err)}`;
  } finally {
    state.skillsLoading = false;
    render();
  }
}

async function sendSessionChat(text) {
  if (!text || state.sessionChatLoading) return;
  state.sessionChatMessages = [...state.sessionChatMessages, { role: 'user', content: text, actions: [] }];
  state.sessionChatLoading = true;
  renderSessions();
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text, history: state.sessionChatMessages.slice(-11, -1).map((m) => ({ role: m.role, content: m.content })), context: state.data, agentId: state.chatAgentId, model: state.chatModel || undefined }),
    });
    const data = await res.json();
    state.sessionChatMessages = [...state.sessionChatMessages, { role: 'assistant', content: data.content || '抱歉，无法获取回复。', actions: data.actions || [] }];
  } catch (err) {
    state.sessionChatMessages = [...state.sessionChatMessages, { role: 'assistant', content: `失败：${err.message || String(err)}`, actions: [] }];
  } finally {
    state.sessionChatLoading = false;
    renderSessions();
  }
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
  renderAgents();
  renderSkills();
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
  const target = el('manualTarget').value.trim();
  if (target) {
    try {
      new URL(target.startsWith('http') ? target : `http://${target}`);
    } catch {
      state.actionNote = '连接目标格式无效，请输入有效地址（例如 127.0.0.1:18789）';
      render();
      return;
    }
  }
  try {
    state.actionNote = '已保存连接目标';
    await runAction('save-target', { target });
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
      state.actionNote = `${action} 执行中…`;
      render();
      const result = await runAction(action);
      state.actionNote = result?.stderr || result?.stdout || `${action} 已执行`;
      render();
      setTimeout(loadData, 1200);
    } catch (err) {
      state.actionNote = `${action} 失败：${err.message || String(err)}`;
      render();
    }
  });
});

actionInit();
async function actionInit() {
  el('section-config').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-cfg-save]');
    if (!btn) return;
    const cfgPath = btn.dataset.cfgSave;
    const input = el('section-config').querySelector(`[data-cfg-path="${cfgPath}"]`);
    if (!input) return;
    try {
      await runAction('config-set', { path: cfgPath, value: input.value.trim() });
      state.actionNote = `${cfgPath} 已保存（部分配置需重启 Gateway 生效）`;
      loadData();
    } catch (err) {
      state.actionNote = `保存失败：${err.message || String(err)}`;
      render();
    }
  });

  el('section-dashboard').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-dash-action]');
    if (!btn) return;
    const action = btn.dataset.dashAction;
    if (action === 'reconnect') {
      try {
        state.actionNote = '正在重连…';
        render();
        await runAction('discover');
        await loadData();
      } catch (err) {
        state.actionNote = `重连失败：${err.message || String(err)}`;
        render();
      }
    } else {
      setTab(action);
    }
  });

  el('section-agents').addEventListener('click', (e) => {
    const selectBtn = e.target.closest('[data-agent-select]');
    if (selectBtn) {
      state.selectedAgent = selectBtn.dataset.agentSelect;
      state.agentBindings = null;
      state.agentBindingsLoading = false;
      render();
      return;
    }
    const backBtn = e.target.closest('[data-agent-back]');
    if (backBtn) {
      state.selectedAgent = null;
      state.agentBindings = null;
      render();
      return;
    }
    const bindingsBtn = e.target.closest('[data-load-bindings]');
    if (bindingsBtn) { loadAgentBindings(bindingsBtn.dataset.loadBindings); return; }
    const skillsBtn = e.target.closest('[data-link-skills]');
    if (skillsBtn) {
      state.skillsAgent = skillsBtn.dataset.linkSkills;
      state.skills = null;
      state.activeTab = 'skills';
      loadSkills();
      return;
    }
    const linkBtn = e.target.closest('[data-link-tab]');
    if (linkBtn) navigateTo(linkBtn.dataset.linkTab, linkBtn.dataset.linkQuery || '');
  });

  el('section-tasks').addEventListener('click', (e) => {
    const filterBtn = e.target.closest('[data-task-filter]');
    if (filterBtn) { state.taskFilter = filterBtn.dataset.taskFilter; render(); return; }
    const flowBtn = e.target.closest('[data-task-flow]');
    if (flowBtn) { state.selectedTask = flowBtn.dataset.taskFlow; render(); return; }
    const backBtn = e.target.closest('[data-task-back]');
    if (backBtn) { state.selectedTask = null; render(); return; }
    const linkBtn = e.target.closest('[data-link-tab]');
    if (linkBtn) navigateTo(linkBtn.dataset.linkTab, linkBtn.dataset.linkQuery || '');
  });

  el('section-logs').addEventListener('click', (e) => {
    const lvlBtn = e.target.closest('[data-log-level]');
    if (lvlBtn) { state.logLevel = lvlBtn.dataset.logLevel; render(); }
  });

  el('section-sessions').addEventListener('click', (e) => {
    if (e.target.id === 'sessionChatSend' || e.target.closest('#sessionChatSend')) {
      const input = document.getElementById('sessionChatInput');
      const text = (input?.value || '').trim();
      if (text) { input.value = ''; sendSessionChat(text); }
      return;
    }
    const act = e.target.closest('.chat-action');
    if (act) {
      const type = act.dataset.actionType;
      const tab = act.dataset.actionTab;
      if (type === 'navigate' && tab) setTab(tab);
      else if (type === 'refresh') loadData();
      else if (type === 'restart') document.querySelector('[data-action="restart"]')?.click();
    }
  });

  el('section-sessions').addEventListener('change', (e) => {
    if (e.target.id === 'chatAgentSelect') {
      state.chatAgentId = e.target.value || 'main';
      state.chatModel = '';
      state.sessionChatMessages = [];
      renderSessions();
    }
    if (e.target.id === 'chatModelSelect') {
      state.chatModel = e.target.value;
    }
    if (e.target.id === 'sessionSelect') {
      state.selectedSessionKey = e.target.value || null;
      renderSessions();
    }
  });

  el('section-sessions').addEventListener('keydown', (e) => {
    if (e.target.id === 'sessionChatInput' && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = e.target.value.trim();
      if (text) { e.target.value = ''; sendSessionChat(text); }
    }
  });

  el('section-skills').addEventListener('click', async (e) => {
    const agentBtn = e.target.closest('[data-skills-agent]');
    if (agentBtn) {
      const newAgent = agentBtn.dataset.skillsAgent;
      if (newAgent !== state.skillsAgent) {
        state.skillsAgent = newAgent;
        state.skills = null;
        await loadSkills();
      }
      return;
    }
    const updateAllBtn = e.target.closest('[data-skills-update]');
    if (updateAllBtn) {
      state.actionNote = '正在更新全部已安装 Skills，请稍候…';
      render();
      try {
        await runAction('skills-update', { agentId: state.skillsAgent || undefined });
        state.actionNote = 'Skills 更新完成';
        state.skills = null;
        await loadSkills();
      } catch (err) {
        state.actionNote = `更新失败：${err.message || String(err)}`;
        render();
      }
      return;
    }
    const updateOneBtn = e.target.closest('[data-skill-update]');
    if (updateOneBtn) {
      const slug = updateOneBtn.dataset.skillUpdate;
      state.actionNote = `正在更新 ${slug}…`;
      render();
      try {
        await runAction('skills-install', { slug, agentId: state.skillsAgent || undefined });
        state.actionNote = `${slug} 更新完成`;
        state.skills = null;
        await loadSkills();
      } catch (err) {
        state.actionNote = `更新失败：${err.message || String(err)}`;
        render();
      }
    }
  });

  await loadData();
  setInterval(loadData, 15000);
}

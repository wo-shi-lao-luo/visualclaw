const chatState = { open: false, messages: [], loading: false };

const escChat = (s) => String(s ?? '').replace(/[&<>"]+/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderMessages() {
  const el = document.getElementById('chatMessages');
  if (!el) return;
  el.innerHTML = chatState.messages.map((m) => {
    const isUser = m.role === 'user';
    const actionsHtml = (m.actions || []).map((a) =>
      `<button class="chat-action" data-action-type="${escChat(a.type)}" data-action-tab="${escChat(a.tab || '')}">${escChat(a.label)}</button>`
    ).join('');
    return `<div class="chat-msg ${isUser ? 'chat-user' : 'chat-assistant'}">
      <div class="chat-bubble">${escChat(m.content)}</div>
      ${actionsHtml ? `<div class="chat-actions">${actionsHtml}</div>` : ''}
    </div>`;
  }).join('') + (chatState.loading ? '<div class="chat-msg chat-assistant"><div class="chat-bubble chat-loading">思考中…</div></div>' : '');
  el.scrollTop = el.scrollHeight;
}

async function sendMessage(text) {
  if (!text || chatState.loading) return;
  chatState.messages.push({ role: 'user', content: text, actions: [] });
  chatState.loading = true;
  renderMessages();
  try {
    const ctxRes = await fetch('/api/bootstrap');
    const context = ctxRes.ok ? await ctxRes.json() : null;
    const history = chatState.messages.slice(-11, -1).map((m) => ({ role: m.role, content: m.content }));
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text, history, context }),
    });
    const data = await res.json();
    chatState.messages.push({ role: 'assistant', content: data.content || '抱歉，无法获取回复。', actions: data.actions || [] });
  } catch (err) {
    chatState.messages.push({ role: 'assistant', content: `请求失败：${err.message || String(err)}`, actions: [] });
  } finally {
    chatState.loading = false;
    renderMessages();
  }
}

function executeAction(type, tab) {
  if (type === 'navigate' && tab) {
    const btn = document.querySelector(`.nav button[data-tab="${tab}"]`);
    if (btn) { btn.click(); toggleChat(false); }
  } else if (type === 'refresh') {
    document.querySelector('[data-action="refresh"]')?.click();
  } else if (type === 'restart') {
    document.querySelector('[data-action="restart"]')?.click();
  } else if (type === 'discover') {
    document.querySelector('[data-action="discover"]')?.click();
  }
}

function toggleChat(open) {
  chatState.open = open;
  const panel = document.getElementById('chatPanel');
  const fab = document.getElementById('chatFab');
  if (panel) panel.classList.toggle('chat-open', open);
  if (fab) fab.classList.toggle('chat-fab-hidden', open);
  if (open) setTimeout(() => document.getElementById('chatInput')?.focus(), 200);
}

function submit() {
  const input = document.getElementById('chatInput');
  const text = (input?.value || '').trim();
  if (text) { input.value = ''; sendMessage(text); }
}

function initChat() {
  const fab = document.createElement('button');
  fab.id = 'chatFab';
  fab.className = 'chat-fab';
  fab.title = '打开 AI 助手';
  fab.textContent = '💬';

  const panel = document.createElement('div');
  panel.id = 'chatPanel';
  panel.className = 'chat-panel';
  panel.innerHTML = `
    <div class="chat-header">
      <span>🤖 AI 助手</span>
      <button id="chatClose" class="chat-close" title="关闭">✕</button>
    </div>
    <div id="chatMessages" class="chat-messages"></div>
    <div class="chat-footer">
      <input id="chatInput" type="text" placeholder="问点什么，或让助手帮你操作…" autocomplete="off" />
      <button id="chatSend" class="chat-send">发送</button>
    </div>
  `;

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  fab.addEventListener('click', () => toggleChat(true));
  document.getElementById('chatClose').addEventListener('click', () => toggleChat(false));
  document.getElementById('chatSend').addEventListener('click', submit);
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  document.getElementById('chatMessages').addEventListener('click', (e) => {
    const btn = e.target.closest('.chat-action');
    if (btn) executeAction(btn.dataset.actionType, btn.dataset.actionTab);
  });
}

initChat();

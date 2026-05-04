import http from 'node:http';

const port = process.env.PORT || 4173;
const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VisualClaw</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #0b1020; color: #e8eefc; }
    .wrap { max-width: 960px; margin: 0 auto; padding: 32px; }
    .card { background: #141a2e; border: 1px solid #263152; border-radius: 16px; padding: 20px; margin: 16px 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #263152; font-size: 12px; }
    h1 { margin: 0 0 8px; }
    ul { margin: 8px 0 0 20px; }
  </style>
</head>
<body>
  <div class="wrap">
    <span class="pill">VisualClaw · bootstrap</span>
    <h1>OpenClaw Desktop Client</h1>
    <p>项目骨架已启动，下一步会接入真实发现、连接与页面导航。</p>
    <div class="grid">
      <div class="card"><strong>首页</strong><ul><li>连接状态</li><li>实例信息</li></ul></div>
      <div class="card"><strong>会话</strong><ul><li>列表</li><li>详情</li></ul></div>
      <div class="card"><strong>任务</strong><ul><li>进度</li><li>历史</li></ul></div>
      <div class="card"><strong>日志</strong><ul><li>搜索</li><li>跳转</li></ul></div>
    </div>
  </div>
</body>
</html>`;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(port, () => {
  console.log(`VisualClaw dev server running at http://localhost:${port}`);
});

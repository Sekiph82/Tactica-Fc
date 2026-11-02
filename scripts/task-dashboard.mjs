import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(root, 'tools/task-dashboard/index.html');
const statusPath = resolve(root, 'docs/active-goal-dashboard.json');
const trackerPath = resolve(root, 'TASKS.md');
const port = Number(process.env.TACTICA_DASHBOARD_PORT || 11000);

function parseTasks(markdown) {
  const result = [];
  let section = '';
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)/);
    if (heading) { section = heading[1]; result.push({ heading: true, text: section }); continue; }
    const task = line.match(/^\s*-\s+\[([ xX])\]\s+(.+)/);
    if (task) result.push({ done: task[1].toLowerCase() === 'x', text: task[2], section });
  }
  return result;
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  try {
    if (pathname === '/api/status') {
      const [statusText, tracker] = await Promise.all([readFile(statusPath, 'utf8'), readFile(trackerPath, 'utf8')]);
      const data = JSON.parse(statusText);
      data.tasks = parseTasks(tracker);
      data.checkedAt = new Date().toISOString();
      data.source = 'docs/active-goal-dashboard.json + TASKS.md';
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(data));
      return;
    }
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(await readFile(htmlPath));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Dashboard error: ${error.message}`);
  }
});

server.listen(port, '127.0.0.1', () => console.log(`TACTICA task dashboard: http://localhost:${port}`));

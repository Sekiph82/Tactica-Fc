import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(root, 'tools/task-dashboard/index.html');
const statusPath = resolve(root, 'docs/active-goal-dashboard.json');
const trackerPath = resolve(root, 'TASKS.md');
const port = Number(process.env.TACTICA_DASHBOARD_PORT || 11000);

function parseTracker(markdown) {
  const milestones = [];
  const tasks = [];
  let milestone = null;
  let sprint = null;
  for (const line of markdown.split(/\r?\n/)) {
    const milestoneHeading = line.match(/^#\s+Milestone\s+(M\d+)\s+—\s+(.+)/i);
    if (milestoneHeading) {
      milestone = { id: milestoneHeading[1], title: milestoneHeading[2], sprints: [] };
      milestones.push(milestone);
      sprint = null;
      continue;
    }
    const sprintHeading = line.match(/^##\s+Sprint\s+(M\d+-S\d+)\s+—\s+(.+)/i);
    if (sprintHeading) {
      sprint = { id: sprintHeading[1], title: sprintHeading[2], tasks: [] };
      if (milestone) milestone.sprints.push(sprint);
      continue;
    }
    const task = line.match(/^\s*-\s+\[([ xX])\]\s+((?:M\d+-S\d+-T\d+\s+)?)(.+)/);
    if (!task) continue;
    const item = { done: task[1].toLowerCase() === 'x', id: task[2].trim(), text: task[3].trim() };
    tasks.push(item);
    if (sprint) sprint.tasks.push(item);
  }
  return { milestones, tasks };
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  try {
    if (pathname === '/api/status') {
      const [statusText, trackerText] = await Promise.all([readFile(statusPath, 'utf8'), readFile(trackerPath, 'utf8')]);
      const data = JSON.parse(statusText);
      Object.assign(data, parseTracker(trackerText));
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

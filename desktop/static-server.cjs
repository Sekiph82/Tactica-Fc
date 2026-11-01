const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

function createStaticServer(root) {
  const resolvedRoot = path.resolve(root);
  const indexPath = path.join(resolvedRoot, 'index.html');
  return http.createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
    catch { response.writeHead(400).end(); return; }

    const file = path.resolve(resolvedRoot, `.${pathname}`);
    const relative = path.relative(resolvedRoot, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { response.writeHead(403).end(); return; }

    const serve = (target) => {
      fs.stat(target, (statError, stat) => {
        if (statError || !stat.isFile()) {
          // Client-side routes have no file extension; serve the TACTICA shell.
          if (!path.extname(pathname) && target !== indexPath) return serve(indexPath);
          response.writeHead(target === indexPath ? 500 : 404).end();
          return;
        }
        response.writeHead(200, {
          'Content-Type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
          'Cache-Control': path.basename(target) === 'index.html' || path.basename(target) === 'sw.js'
            ? 'no-cache'
            : 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
        });
        if (request.method === 'HEAD') response.end();
        else fs.createReadStream(target).pipe(response);
      });
    };
    serve(file);
  });
}

module.exports = { createStaticServer };

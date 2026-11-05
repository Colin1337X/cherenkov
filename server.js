const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = __dirname;
const userFile = path.join(root, 'user.json');
const port = Number(process.env.PORT) || 4173;
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.ttf': 'font/ttf' };

http.createServer(async (request, response) => {
  try {
    if (request.url === '/api/user' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end(await fs.readFile(userFile));
    }
    if (request.url === '/api/user' && request.method === 'PUT') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 25_000_000) throw new Error('User data is too large.');
      }
      const data = JSON.parse(body);
      if (!Array.isArray(data.records) || typeof data.config !== 'object') throw new Error('Invalid user data.');
      await fs.writeFile(userFile, JSON.stringify(data, null, 2));
      response.writeHead(204);
      return response.end();
    }
    const pathname = request.url === '/' ? '/index.html' : decodeURIComponent(request.url.split('?')[0]);
    if (pathname === '/user.json') {
      response.writeHead(404);
      return response.end('Not found');
    }
    const filename = path.resolve(root, `.${pathname}`);
    if (!filename.startsWith(root + path.sep)) throw new Error('Invalid path.');
    const content = await fs.readFile(filename);
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filename)] || 'application/octet-stream' });
    response.end(content);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error.message);
  }
}).listen(port, () => console.log(`Cherenkov listening on http://localhost:${port}`));

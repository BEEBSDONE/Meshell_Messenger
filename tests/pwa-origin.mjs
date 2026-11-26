import { createServer } from 'node:http';

// A disposable production origin whose service worker can be exercised with every app tab closed.
export async function servePwa(baseURL, intercept) {
  const server = createServer(async (request, response) => {
    try {
      if (intercept && await intercept(request, response)) return;
      const upstream = await fetch(new URL(request.url, baseURL));
      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch { response.writeHead(502).end(); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    async disconnect() {
      if (!server.listening) return;
      const closed = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await closed;
    },
  };
}

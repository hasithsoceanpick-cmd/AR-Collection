// Service worker: makes the app installable and shows a friendly page when
// there is no connection. It never caches data: collections, bank lines and
// photos always come live from the server.
const OFFLINE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Collections: offline</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#F6F7F4;color:#1E2A5E}
div{max-width:340px;padding:24px;text-align:center}b{display:block;font-size:20px;margin-bottom:8px}button{margin-top:16px;font:inherit;font-weight:700;padding:10px 18px;border-radius:6px;border:0;background:#2E3A87;color:#fff}</style></head>
<body><div><b>No connection</b>Collections needs the internet to show live data. Check your connection and try again.<br><button onclick="location.reload()">Try again</button></div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // everything else goes straight to the network
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});

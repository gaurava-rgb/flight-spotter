#!/usr/bin/env node
// Tiny zero-dependency proxy for the flight-spotter page.
// Needed because api.adsb.lol rejects browser User-Agents (which browsers
// cannot change) and api.planespotters.net requires an identifying UA.
//
//   node proxy.mjs            → serves ./index.html on :8787 and proxies /api/*
//
// The page auto-detects the proxy when served this way. If you open
// index.html directly from the file system, direct API calls are used
// instead (photos may be unavailable — the page falls back to silhouettes).

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8787;
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const UA = 'FlightSpotterWebpage/1.0 (contact: g.arora.tx@gmail.com)';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const ALLOWED = new Map([
  ['/api/photohex', 'https://api.planespotters.net/pub/photos/hex/'],
  ['/api/adsblol', 'https://api.adsb.lol/v2/'],
  ['/api/adsbfi', 'https://api.adsb.fi/v1/'],
]);

// Only planespotters image hosts may be proxied as images.
const IMG_HOST = /(^|\.)plnspttrs\.net$/;

function proxy(req, res, upstreamBase, rest) {
  const url = upstreamBase + rest;
  fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } })
    .then(async up => {
      const body = Buffer.from(await up.arrayBuffer());
      res.writeHead(up.status, {
        'Content-Type': up.headers.get('content-type') || 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    })
    .catch(e => {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'upstream failed', detail: String(e) }));
    });
}

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/api/img') {
    let u = null;
    try { u = new URL(new URL(req.url, 'http://x').searchParams.get('u') || ''); } catch {}
    if (!u || !IMG_HOST.test(u.hostname)) { res.writeHead(403).end(); return; }
    fetch(u, { headers: { 'User-Agent': UA } })
      .then(async up => {
        res.writeHead(up.status, {
          'Content-Type': up.headers.get('content-type') || 'image/jpeg',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400',
        });
        res.end(Buffer.from(await up.arrayBuffer()));
      })
      .catch(() => { res.writeHead(502).end(); });
    return;
  }
  if (path.startsWith('/api/')) {
    const m = path.match(/^\/api\/(photohex|adsblol)\//);
    if (!m) { res.writeHead(404).end('unknown api'); return; }
    const upstream = ALLOWED.get('/api/' + m[1]);
    const rest = path.slice(m[0].length) + new URL(req.url, 'http://x').search;
    proxy(req, res, upstream, rest);
    return;
  }
  // static files
  let file = path === '/' ? '/index.html' : path;
  const full = normalize(join(ROOT, file));
  if (!full.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.listen(PORT, () => console.log(`flight-spotter → http://localhost:${PORT}`));

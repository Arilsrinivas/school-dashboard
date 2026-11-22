import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { createServer } from 'node:http';
import { configureProxyTrust } from './proxy.js';

test('trusts only the Vercel edge hop and rejects forwarded IP trust outside Vercel', async () => {
  const local = express();
  configureProxyTrust(local, false);
  assert.equal(local.get('trust proxy'), false);

  const app = express();
  configureProxyTrust(app, true);
  assert.equal(app.get('trust proxy'), 1);
  app.use(rateLimit({ windowMs: 60_000, limit: 1, standardHeaders: false, legacyHeaders: false }));
  app.get('/api/auth/refresh', (req, res) => res.json({ ip: req.ip }));
  const apiServer = app.listen(0);
  await new Promise<void>(resolve => apiServer.once('listening', resolve));
  const apiAddress = apiServer.address();
  assert.ok(apiAddress && typeof apiAddress === 'object');
  // Model the Vercel edge: discard the caller's XFF and set one observed client IP.
  const edge = createServer(async (req, res) => {
    const clientIp = req.socket.remoteAddress || '127.0.0.1';
    const upstream = await fetch(`http://127.0.0.1:${apiAddress.port}${req.url}`, {
      method: req.method,
      headers: { 'x-forwarded-for': clientIp, ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}) }
    });
    res.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
    res.end(Buffer.from(await upstream.arrayBuffer()));
  });
  edge.listen(0);
  await new Promise<void>(resolve => edge.once('listening', resolve));
  const address = edge.address();
  assert.ok(address && typeof address === 'object');
  try {
    const spoofedIp = '203.0.113.77';
    const first = await fetch(`http://127.0.0.1:${address.port}/api/auth/refresh`, {
      headers: { 'x-forwarded-for': spoofedIp, cookie: 'educonnect_refresh=invalid' }
    });
    assert.equal(first.status, 200);
    assert.notEqual((await first.json() as { ip: string }).ip, spoofedIp, 'caller-supplied XFF is discarded at the trusted edge');
    const second = await fetch(`http://127.0.0.1:${address.port}/api/auth/refresh`, {
      headers: { 'x-forwarded-for': spoofedIp, cookie: 'educonnect_refresh=invalid' }
    });
    assert.equal(second.status, 429, 'rate limit uses the edge-observed client address, not spoofed XFF');
  } finally {
    await Promise.all([apiServer, edge].map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
  }
});

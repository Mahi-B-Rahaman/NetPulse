import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Pre-allocate 1 MB of incompressible random bytes once so download streams
// saturate high-speed WiFi links without CPU bottlenecks or proxy compression.
const RANDOM_POOL_SIZE = 1024 * 1024;
const CHUNK_SIZE = 64 * 1024;
const RANDOM_POOL = crypto.randomBytes(RANDOM_POOL_SIZE);

const app = express();
app.disable('x-powered-by');

app.get('/api/network-info', (req: Request, res: Response) => {
  const forwardedFor = req.headers['x-forwarded-for'];
  const rawIp =
    (typeof req.headers['cf-connecting-ip'] === 'string' && req.headers['cf-connecting-ip']) ||
    (typeof forwardedFor === 'string' && forwardedFor.split(',')[0]?.trim()) ||
    req.socket.remoteAddress ||
    '';

  const cleanIp = rawIp.replace(/^::ffff:/, '');
  const country =
    (typeof req.headers['cf-ipcountry'] === 'string' && req.headers['cf-ipcountry']) ||
    (typeof req.headers['x-appengine-country'] === 'string' && req.headers['x-appengine-country']) ||
    null;

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({
    clientIp: cleanIp || null,
    country,
    protocol: req.protocol,
    httpVersion: req.httpVersion,
    serverRegion: process.env.GOOGLE_CLOUD_REGION || 'app-edge',
    timestamp: Date.now(),
  });
});

app.get('/api/speed/ping', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, no-transform');
  res.status(204).end();
});

app.get('/api/speed/down', (req: Request, res: Response) => {
  const requested = Number(req.query.bytes);
  const totalBytes = Number.isFinite(requested)
    ? Math.max(1024, Math.min(50 * 1024 * 1024, Math.floor(requested)))
    : 10 * 1024 * 1024;

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(totalBytes));
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, no-transform');
  res.setHeader('Timing-Allow-Origin', '*');

  let sent = 0;
  let aborted = false;

  req.on('close', () => {
    aborted = true;
  });

  const pump = () => {
    while (sent < totalBytes && !aborted) {
      const remaining = totalBytes - sent;
      const toSend = Math.min(CHUNK_SIZE, remaining);
      const offset = sent % (RANDOM_POOL_SIZE - CHUNK_SIZE);
      const slice = RANDOM_POOL.subarray(offset, offset + toSend);
      sent += toSend;

      const ok = res.write(slice);
      if (!ok) {
        res.once('drain', pump);
        return;
      }
    }
    if (!aborted && sent >= totalBytes) {
      res.end();
    }
  };

  pump();
});

app.post('/api/speed/up', (req: Request, res: Response) => {
  const start = performance.now();
  let receivedBytes = 0;

  req.on('data', (chunk: Buffer) => {
    receivedBytes += chunk.length;
  });

  req.on('end', () => {
    const serverDurationMs = Math.max(1, performance.now() - start);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({
      receivedBytes,
      serverDurationMs: Number(serverDurationMs.toFixed(2)),
    });
  });

  req.on('error', () => {
    if (!res.headersSent) {
      res.status(400).json({ error: 'Upload stream interrupted' });
    }
  });
});

async function startServer() {
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      const indexHtml = path.join(distPath, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NetPulse server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

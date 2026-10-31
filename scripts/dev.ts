import { spawn } from 'node:child_process';
import net from 'node:net';
import { resolve } from 'node:path';

function checkPort(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise(resolve => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function waitForPort(port: number, maxWaitMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await checkPort(port)) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

async function main() {
  console.log('[Dev] Checking for local PostgreSQL on port 5432...');
  const isRunning = await checkPort(5432);

  let dbProc: any = null;
  if (!isRunning) {
    console.log('[Dev] No external PostgreSQL detected. Booting PGlite socket server...');
    dbProc = spawn('npx', ['tsx', 'scripts/dev-db.ts'], {
      stdio: 'inherit',
      shell: true,
    });
    const ready = await waitForPort(5432);
    if (!ready) {
      console.error('[Dev] Failed to connect to local database server on port 5432');
      process.exit(1);
    }
  } else {
    console.log('[Dev] Existing PostgreSQL server detected on port 5432.');
  }

  console.log('[Dev] Database ready. Starting EduConnect API (port 4000) and Web App (port 5173)...');
  const appProc = spawn('npx', ['concurrently', '-k', '-n', 'api,web', '-c', 'blue,green', '"npm:dev:api"', '"npm:dev:web"'], {
    stdio: 'inherit',
    shell: true,
  });

  const cleanup = () => {
    if (dbProc) dbProc.kill();
    if (appProc) appProc.kill();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  appProc.on('exit', (code) => {
    if (dbProc) dbProc.kill();
    process.exit(code ?? 0);
  });
}

main().catch(console.error);

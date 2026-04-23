import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { resolveLanServerUrl } from '../config/mobileShellConfig.mjs';
import { buildPortOccupiedMessage } from '../config/mobileShellCommands.mjs';

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobileServerUrl = resolveLanServerUrl();
const mobilePort = new URL(mobileServerUrl).port || '3000';
const nextBin = path.join(frontendDir, 'node_modules', 'next', 'dist', 'bin', 'next');

async function isPortOccupied(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: '127.0.0.1',
      port: Number(port),
    });

    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

process.stdout.write(
  [
    '',
    'Alcheme mobile LAN dev server',
    `  frontend: ${mobileServerUrl}`,
    `  shell env: ALCHEME_MOBILE_SERVER_URL=${mobileServerUrl}`,
    '',
  ].join('\n'),
);

if (await isPortOccupied(mobilePort)) {
  process.stderr.write(
    buildPortOccupiedMessage({
      mobileServerUrl,
      port: mobilePort,
    }),
  );
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [nextBin, 'dev', '--hostname', '0.0.0.0', '--port', mobilePort],
  {
    cwd: frontendDir,
    env: {
      ...process.env,
      ALCHEME_MOBILE_SERVER_URL: mobileServerUrl,
      PORT: mobilePort,
    },
    stdio: 'inherit',
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { resolveLanServerUrl } from '../config/mobileShellConfig.mjs';
import {
  buildMobileShellNpmArgs,
  getAndroidUsbReversePorts,
} from '../config/mobileShellCommands.mjs';
import {
  needsLegacyXcodeCompatibility,
  patchCapAppSwiftPackageForLegacyXcode,
  patchPbxprojForLegacyXcode,
} from '../config/xcodeCompat.mjs';

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobileShellDir = path.resolve(frontendDir, '..', 'mobile-shell');
const commandName = process.argv[2];
const iosProjectPath = path.join(mobileShellDir, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
const iosCapAppPackagePath = path.join(mobileShellDir, 'ios', 'App', 'CapApp-SPM', 'Package.swift');

if (!commandName) {
  process.stderr.write('Usage: node ./scripts/mobile-shell.mjs <sync|open:android|open:ios|run:android|run:ios>\n');
  process.exit(1);
}

const mobileServerUrl = resolveLanServerUrl();
const mobilePort = new URL(mobileServerUrl).port || '3000';

async function ensureFrontendReachable(port) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: '127.0.0.1',
      port: Number(port),
    });

    socket.once('connect', () => {
      socket.end();
      resolve();
    });
    socket.once('error', (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

async function runChildCommand(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: mobileShellDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code}`));
    });
  });
}

async function ensureAndroidUsbReversePorts() {
  const ports = getAndroidUsbReversePorts({ mobilePort });

  for (const port of ports) {
    try {
      await runChildCommand('adb', ['reverse', `tcp:${port}`, `tcp:${port}`]);
    } catch (error) {
      process.stderr.write(
        `Warning: could not configure adb reverse for tcp:${port} (${error instanceof Error ? error.message : String(error)}).\n`,
      );
      return;
    }
  }
}

async function readXcodeVersion() {
  return await new Promise((resolve) => {
    const child = spawn('xcodebuild', ['-version'], {
      cwd: mobileShellDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let output = '';

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.on('error', () => resolve(''));
    child.on('exit', () => resolve(output));
  });
}

async function patchLegacyIosArtifactsIfNeeded() {
  const xcodeVersion = await readXcodeVersion();

  if (!needsLegacyXcodeCompatibility(xcodeVersion)) {
    return;
  }

  const [pbxprojContents, packageContents] = await Promise.all([
    fs.readFile(iosProjectPath, 'utf8'),
    fs.readFile(iosCapAppPackagePath, 'utf8'),
  ]);

  await Promise.all([
    fs.writeFile(iosProjectPath, patchPbxprojForLegacyXcode(pbxprojContents)),
    fs.writeFile(
      iosCapAppPackagePath,
      patchCapAppSwiftPackageForLegacyXcode(packageContents),
    ),
  ]);
}

try {
  await ensureFrontendReachable(mobilePort);
} catch {
  process.stderr.write(
    [
      '',
      `No frontend server is listening on port ${mobilePort}.`,
      'Start your app first, for example:',
      '  npm run dev',
      'or',
      '  npm run dev:lan',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

if (commandName === 'open:android' || commandName === 'run:android') {
  await ensureAndroidUsbReversePorts();
}

if (commandName === 'open:ios' || commandName === 'run:ios') {
  await patchLegacyIosArtifactsIfNeeded();
}

const child = spawn('npm', buildMobileShellNpmArgs(commandName), {
  cwd: mobileShellDir,
  env: {
    ...process.env,
    ALCHEME_MOBILE_SERVER_URL: mobileServerUrl,
  },
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  if (code === 0 && commandName === 'sync') {
    patchLegacyIosArtifactsIfNeeded()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
    return;
  }

  process.exit(code ?? 0);
});

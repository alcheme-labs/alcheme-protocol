export function buildMobileShellNpmArgs(commandName) {
  switch (commandName) {
    case 'sync':
      return ['run', 'sync'];
    case 'open:android':
      return ['run', 'open:android'];
    case 'open:ios':
      return ['run', 'open:ios'];
    case 'run:android':
      return ['run', 'run:android'];
    case 'run:ios':
      return ['run', 'run:ios'];
    default:
      throw new Error(`Unsupported mobile shell command: ${commandName}`);
  }
}

export function getAndroidUsbReversePorts({ mobilePort }) {
  return Array.from(new Set([
    String(mobilePort),
    '4000',
    '8899',
    '8900',
  ]));
}

export function buildPortOccupiedMessage({ mobileServerUrl, port }) {
  return [
    '',
    `Port ${port} is already in use.`,
    `If your frontend is already running at ${mobileServerUrl}, skip "npm run dev:lan".`,
    'Open the shell directly from frontend instead:',
    '  npm run mobile:open:android',
    '  npm run mobile:open:ios',
    '',
  ].join('\n');
}

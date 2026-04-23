import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMobileShellNpmArgs,
  buildPortOccupiedMessage,
  getAndroidUsbReversePorts,
} from '../config/mobileShellCommands.mjs';

test('maps frontend mobile command names to mobile-shell npm args', () => {
  assert.deepEqual(buildMobileShellNpmArgs('sync'), ['run', 'sync']);
  assert.deepEqual(buildMobileShellNpmArgs('open:android'), ['run', 'open:android']);
  assert.deepEqual(buildMobileShellNpmArgs('open:ios'), ['run', 'open:ios']);
});

test('explains what to do when the frontend port is already occupied', () => {
  const message = buildPortOccupiedMessage({
    mobileServerUrl: 'http://10.0.0.158:3000',
    port: '3000',
  });

  assert.match(message, /3000/);
  assert.match(message, /npm run mobile:open:android/);
  assert.match(message, /http:\/\/10\.0\.0\.158:3000/);
});

test('includes frontend, query api, and local rpc ports for Android USB reverse', () => {
  assert.deepEqual(
    getAndroidUsbReversePorts({ mobilePort: '3000' }),
    ['3000', '4000', '8899', '8900'],
  );
});

test('deduplicates overlapping Android USB reverse ports', () => {
  assert.deepEqual(
    getAndroidUsbReversePorts({ mobilePort: '4000' }),
    ['4000', '8899', '8900'],
  );
});

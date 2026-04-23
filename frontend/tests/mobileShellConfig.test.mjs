import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ALLOWED_DEV_ORIGINS,
  getAllowedDevOrigins,
  getCapacitorServerConfig,
  normalizeMobileServerUrl,
  pickLanIpv4,
  resolveLanServerUrl,
} from '../config/mobileShellConfig.mjs';

test('normalizes a valid mobile server url down to its origin', () => {
  assert.equal(
    normalizeMobileServerUrl('http://192.168.50.23:3000/home?tab=1'),
    'http://192.168.50.23:3000',
  );
});

test('keeps default dev origins and adds the LAN host when present', () => {
  assert.deepEqual(
    getAllowedDevOrigins('http://192.168.50.23:3000').sort(),
    [...DEFAULT_ALLOWED_DEV_ORIGINS, '192.168.50.23'].sort(),
  );
});

test('ignores malformed mobile urls when deriving dev origins', () => {
  assert.deepEqual(
    getAllowedDevOrigins('not-a-url'),
    DEFAULT_ALLOWED_DEV_ORIGINS,
  );
});

test('builds Capacitor server config from a valid LAN url', () => {
  assert.deepEqual(getCapacitorServerConfig('http://192.168.50.23:3000'), {
    url: 'http://192.168.50.23:3000',
    cleartext: true,
  });
});

test('throws when Capacitor shell url is missing or malformed', () => {
  assert.throws(
    () => getCapacitorServerConfig(undefined),
    /ALCHEME_MOBILE_SERVER_URL/i,
  );
  assert.throws(
    () => getCapacitorServerConfig('ftp://192.168.50.23/app'),
    /ALCHEME_MOBILE_SERVER_URL/i,
  );
});

test('prefers a private LAN IPv4 address from network interfaces', () => {
  assert.equal(
    pickLanIpv4({
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      utun4: [{ address: '10.10.10.5', family: 'IPv4', internal: false }],
      en0: [{ address: '192.168.50.23', family: 'IPv4', internal: false }],
    }),
    '192.168.50.23',
  );
});

test('resolves the LAN server url from env before falling back to auto-detect', () => {
  assert.equal(
    resolveLanServerUrl({
      env: {
        ALCHEME_MOBILE_SERVER_URL: 'http://192.168.50.44:3000/home',
      },
      networkInterfaces: () => ({
        en0: [{ address: '192.168.50.23', family: 'IPv4', internal: false }],
      }),
    }),
    'http://192.168.50.44:3000',
  );
});

test('resolves the LAN server url from detected Wi-Fi address when env is absent', () => {
  assert.equal(
    resolveLanServerUrl({
      env: {},
      networkInterfaces: () => ({
        lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
        en0: [{ address: '192.168.50.23', family: 'IPv4', internal: false }],
      }),
      defaultPort: 3000,
    }),
    'http://192.168.50.23:3000',
  );
});

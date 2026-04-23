import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = '/Users/taiyi/Desktop/Project/Future/web3/alcheme-protocol';
const bridgeConfigUrl = new URL('../config/nativeWalletBridge.mjs', import.meta.url);
const bridgeHelperPath = path.join(repoRoot, 'frontend', 'src', 'lib', 'mobile', 'nativeWalletBridge.ts');
const androidManifestPath = path.join(
  repoRoot,
  'mobile-shell',
  'android',
  'app',
  'src',
  'main',
  'AndroidManifest.xml',
);
const androidActivityPath = path.join(
  repoRoot,
  'mobile-shell',
  'android',
  'app',
  'src',
  'main',
  'java',
  'xyz',
  'alcheme',
  'mobile',
  'MainActivity.java',
);
const iosInfoPlistPath = path.join(repoRoot, 'mobile-shell', 'ios', 'App', 'App', 'Info.plist');
const iosAppDelegatePath = path.join(repoRoot, 'mobile-shell', 'ios', 'App', 'App', 'AppDelegate.swift');

test('native wallet bridge exposes stable callback contract constants', async () => {
  const {
    NATIVE_WALLET_BRIDGE_NAME,
    NATIVE_WALLET_CALLBACK_EVENT_NAME,
    NATIVE_WALLET_CALLBACK_HOST,
    NATIVE_WALLET_CALLBACK_PATH,
    NATIVE_WALLET_CALLBACK_URL,
    NATIVE_WALLET_IOS_MESSAGE_HANDLER,
    NATIVE_WALLET_URL_SCHEME,
  } = await import(bridgeConfigUrl);

  assert.equal(NATIVE_WALLET_BRIDGE_NAME, 'AlchemeNativeBridge');
  assert.equal(NATIVE_WALLET_IOS_MESSAGE_HANDLER, 'alchemeNativeBridge');
  assert.equal(NATIVE_WALLET_CALLBACK_EVENT_NAME, 'alcheme:native-wallet-callback');
  assert.equal(NATIVE_WALLET_URL_SCHEME, 'alcheme');
  assert.equal(NATIVE_WALLET_CALLBACK_HOST, 'wallet');
  assert.equal(NATIVE_WALLET_CALLBACK_PATH, '/callback');
  assert.equal(NATIVE_WALLET_CALLBACK_URL, 'alcheme://wallet/callback');
});

test('frontend helper defines native bridge message and callback helpers', () => {
  const helperSource = fs.readFileSync(bridgeHelperPath, 'utf8');

  assert.match(helperSource, /export function isNativeWalletBridgeAvailable/);
  assert.match(helperSource, /export function requestNativeOpenExternalUrl/);
  assert.match(helperSource, /export function onNativeWalletCallback/);
  assert.match(helperSource, /CustomEvent\(NATIVE_WALLET_CALLBACK_EVENT_NAME/);
  assert.match(helperSource, /window\.webkit\?\.messageHandlers\?\.alchemeNativeBridge/);
});

test('android shell registers callback url scheme and forwards wallet callback events into the webview', () => {
  const manifestSource = fs.readFileSync(androidManifestPath, 'utf8');
  const activitySource = fs.readFileSync(androidActivityPath, 'utf8');

  assert.match(manifestSource, /android:scheme="alcheme"/);
  assert.match(manifestSource, /android:host="wallet"/);
  assert.match(manifestSource, /android:pathPrefix="\/callback"/);
  assert.match(activitySource, /alcheme:native-wallet-callback/);
  assert.match(activitySource, /openExternalUrl/);
  assert.match(activitySource, /onNewIntent/);
});

test('ios shell registers callback url scheme and forwards wallet callback events into the webview', () => {
  const infoPlistSource = fs.readFileSync(iosInfoPlistPath, 'utf8');
  const appDelegateSource = fs.readFileSync(iosAppDelegatePath, 'utf8');

  assert.match(infoPlistSource, /CFBundleURLTypes/);
  assert.match(infoPlistSource, /<string>alcheme<\/string>/);
  assert.match(appDelegateSource, /alcheme:native-wallet-callback/);
  assert.match(appDelegateSource, /application\(_ application: UIApplication, open url: URL/);
  assert.match(appDelegateSource, /openExternalUrl/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = '/Users/taiyi/Desktop/Project/Future/web3/alcheme-protocol';
const iosRoot = path.join(repoRoot, 'mobile-shell', 'ios', 'App', 'App');
const projectFile = path.join(repoRoot, 'mobile-shell', 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');

test('ios shell no longer depends on Capacitor runtime types', () => {
  const appDelegate = fs.readFileSync(path.join(iosRoot, 'AppDelegate.swift'), 'utf8');
  const storyboard = fs.readFileSync(path.join(iosRoot, 'Base.lproj', 'Main.storyboard'), 'utf8');
  const pbxproj = fs.readFileSync(projectFile, 'utf8');

  assert.doesNotMatch(appDelegate, /\bimport Capacitor\b/);
  assert.doesNotMatch(appDelegate, /ApplicationDelegateProxy/);
  assert.match(storyboard, /customClass="ShellViewController"/);
  assert.doesNotMatch(storyboard, /CAPBridgeViewController/);
  assert.doesNotMatch(pbxproj, /CapApp-SPM/);
});

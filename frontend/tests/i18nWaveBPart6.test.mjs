import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const crystalDemoSource = readFileSync(
  new URL('../src/app/(main)/crystal-demo/page.tsx', import.meta.url),
  'utf8'
);

test('Wave B part 6 localizes the crystal demo page shell copy', () => {
  assert.match(crystalDemoSource, /useI18n|useTranslations/);
  assert.doesNotMatch(
    crystalDemoSource,
    /Crystal Visual Prototype|Each crystal is driven by 8 parameters from knowledge data|Loading 3D\.\.\.|Visual Parameters|All Variants|新生晶体|成熟晶体|古老经典|讨论中|区块链哲学|DeFi 研究|密码学原理|Solana 生态系统/
  );
});

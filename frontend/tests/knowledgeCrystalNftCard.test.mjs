import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pageSource = readFileSync(
  new URL('../src/app/(main)/knowledge/[id]/page.tsx', import.meta.url),
  'utf8',
);
const stylesSource = readFileSync(
  new URL('../src/app/(main)/knowledge/[id]/page.module.css', import.meta.url),
  'utf8',
);
const queriesSource = readFileSync(
  new URL('../src/lib/apollo/queries.ts', import.meta.url),
  'utf8',
);
const typesSource = readFileSync(
  new URL('../src/lib/apollo/types.ts', import.meta.url),
  'utf8',
);
const zhMessages = readFileSync(
  new URL('../src/i18n/messages/zh.json', import.meta.url),
  'utf8',
);
const enMessages = readFileSync(
  new URL('../src/i18n/messages/en.json', import.meta.url),
  'utf8',
);

test('knowledge detail query requests master NFT and receipt fields', () => {
  assert.match(queriesSource, /crystalAsset\s*\{/);
  assert.match(queriesSource, /masterAssetAddress/);
  assert.match(queriesSource, /crystalReceiptStats\s*\{/);
  assert.match(queriesSource, /totalCount/);
  assert.match(queriesSource, /mintedCount/);
  assert.match(queriesSource, /crystalReceipts\(limit:\s*12\)\s*\{/);
  assert.match(queriesSource, /receiptAssetAddress/);
});

test('Apollo knowledge types expose the crystal NFT read model', () => {
  assert.match(typesSource, /export interface GQLCrystalAsset/);
  assert.match(typesSource, /masterAssetAddress: string \| null/);
  assert.match(typesSource, /export interface GQLCrystalReceipt/);
  assert.match(typesSource, /receiptAssetAddress: string \| null/);
  assert.match(typesSource, /export interface GQLCrystalReceiptStats/);
  assert.match(typesSource, /totalCount: number/);
  assert.match(typesSource, /crystalAsset: GQLCrystalAsset \| null/);
  assert.match(typesSource, /crystalReceiptStats: GQLCrystalReceiptStats/);
  assert.match(typesSource, /crystalReceipts: GQLCrystalReceipt\[\]/);
});

test('KnowledgeDetailPage renders a mobile-safe Crystal NFT card', () => {
  assert.match(pageSource, /assetCard/);
  assert.match(pageSource, /asset\.master\.title/);
  assert.match(pageSource, /asset\.receipts\.title/);
  assert.match(pageSource, /knowledge\?\.crystalAsset/);
  assert.match(pageSource, /knowledge\?\.crystalReceiptStats/);
  assert.match(pageSource, /knowledge\?\.crystalReceipts/);
  assert.match(pageSource, /receiptStats\.totalCount/);
  assert.match(stylesSource, /\.assetAddress/);
  assert.match(stylesSource, /overflow-wrap:\s*anywhere/);
});

test('Crystal NFT card labels mock chain assets as demo receipts', () => {
  assert.match(pageSource, /isMockCrystalAsset/);
  assert.match(pageSource, /mock_chain/);
  assert.match(pageSource, /crystalAssetDisplayStatus/);
  assert.match(pageSource, /data-status={crystalAssetDisplayStatus}/);
  assert.match(pageSource, /asset\.master\.demoAddress/);
});

test('Crystal NFT card copy is localized in Chinese and English', () => {
  assert.match(zhMessages, /主 NFT/);
  assert.match(zhMessages, /演示凭证/);
  assert.match(zhMessages, /贡献凭证/);
  assert.match(enMessages, /Master NFT/);
  assert.match(enMessages, /Demo receipt/);
  assert.match(enMessages, /contributor receipts/i);
});

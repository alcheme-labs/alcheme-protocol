import { hashCanonicalGovernanceValue } from './canonicalCodec';

const DOMAIN = 'alcheme.governance.crystal-asset-readback';
const FORBIDDEN_AUTHORITY_PREFIX = /^(?:knowledge_author|global_override|platform_default):/;

export interface CrystalAssetAuthorityBundle {
  governanceHomeRef: string;
  authorityPolicyDigest: string;
  tokenOwnerRef: string;
  issuerRef: string;
  vaultOwnerRef: string;
  mintAuthorityRef: string | null;
  freezeAuthorityRef: string | null;
  metadataUpdateAuthorityRef: string | null;
  collectionAuthorityRef: string | null;
  burnAuthorityRef: string;
  revokeAuthorityRef: string;
}

export interface CrystalAssetChainReadback {
  finality: 'finalized' | 'confirmed' | 'ambiguous' | 'not_found';
  supply: number | null;
  tokenOwnerRef: string | null;
  vaultOwnerRef: string | null;
  vaultAta: string | null;
  vaultBalance: number | null;
  vaultOwnerOffCurve: boolean | null;
  mintAuthorityRef: string | null;
  freezeAuthorityRef: string | null;
  metadataUpdateAuthorityRef: string | null;
  collectionAuthorityRef: string | null;
  metadataDigest: string | null;
  provenanceDigest: string | null;
}

export async function persistCrystalAssetGovernanceReadback(
  dependencies: { prisma: any },
  input: {
    network: 'solana:localnet';
    assetKind: 'master' | 'receipt';
    assetRef: string;
    legacyIssued: boolean;
    legacyClaimed: boolean;
    authority: CrystalAssetAuthorityBundle;
    expectedVaultAta: string;
    expectedMetadataDigest: string;
    expectedProvenanceDigest: string;
    readback: CrystalAssetChainReadback;
    now: Date;
  },
) {
  if (input.network !== 'solana:localnet') throw new Error('crystal_asset_devnet_not_enabled');
  if (!['master', 'receipt'].includes(input.assetKind)) throw new Error('crystal_asset_kind_invalid');
  const assetRef = text(input.assetRef, 'crystal_asset_ref_invalid');
  const expectedVaultAta = text(input.expectedVaultAta, 'crystal_asset_vault_ata_invalid');
  const now = date(input.now);
  const authority = normalizeAuthority(input.authority);
  const expectedMetadataDigest = hex(input.expectedMetadataDigest, 'crystal_asset_metadata_digest_invalid');
  const expectedProvenanceDigest = hex(input.expectedProvenanceDigest, 'crystal_asset_provenance_digest_invalid');
  if (input.legacyClaimed && !input.legacyIssued) throw new Error('crystal_asset_legacy_claim_without_issue');
  const legacyDisposition = input.legacyIssued
    ? input.legacyClaimed ? 'legacy_claimed' : 'legacy_auto_issued'
    : null;
  const readback = normalizeReadback(input.readback);
  const blockers: string[] = [];
  if (readback.finality !== 'finalized') blockers.push(`finality:${readback.finality}`);
  if (readback.supply !== 1) blockers.push('supply_mismatch');
  if (readback.tokenOwnerRef !== authority.tokenOwnerRef) blockers.push('token_owner_mismatch');
  if (readback.vaultOwnerRef !== authority.vaultOwnerRef) blockers.push('vault_owner_mismatch');
  if (readback.vaultAta !== expectedVaultAta) blockers.push('vault_ata_mismatch');
  if (readback.vaultBalance !== 1) blockers.push('vault_balance_mismatch');
  if (readback.vaultOwnerOffCurve !== true) blockers.push('vault_owner_not_off_curve');
  if (readback.mintAuthorityRef !== authority.mintAuthorityRef) blockers.push('mint_authority_mismatch');
  if (readback.freezeAuthorityRef !== authority.freezeAuthorityRef) blockers.push('freeze_authority_mismatch');
  if (readback.metadataUpdateAuthorityRef !== authority.metadataUpdateAuthorityRef) blockers.push('metadata_update_authority_mismatch');
  if (readback.collectionAuthorityRef !== authority.collectionAuthorityRef) blockers.push('collection_authority_mismatch');
  if (readback.metadataDigest !== expectedMetadataDigest) blockers.push('metadata_digest_mismatch');
  if (readback.provenanceDigest !== expectedProvenanceDigest) blockers.push('provenance_digest_mismatch');
  const facts = {
    schemaVersion: 1,
    network: input.network,
    assetKind: input.assetKind,
    assetRef,
    legacyDisposition,
    authority,
    expectedVaultAta,
    expectedMetadataDigest,
    expectedProvenanceDigest,
    readback,
    blockers,
  };
  const readbackDigest = hashCanonicalGovernanceValue(DOMAIN, facts);
  const record = {
    id: `crystal-asset-readback:${readbackDigest}`,
    assetKind: input.assetKind,
    assetRef,
    network: input.network,
    governanceHomeRef: authority.governanceHomeRef,
    authorityPolicyDigest: authority.authorityPolicyDigest,
    tokenOwnerRef: authority.tokenOwnerRef,
    issuerRef: authority.issuerRef,
    vaultOwnerRef: authority.vaultOwnerRef,
    vaultAta: expectedVaultAta,
    vaultBalance: readback.vaultBalance,
    mintAuthorityRef: authority.mintAuthorityRef,
    freezeAuthorityRef: authority.freezeAuthorityRef,
    metadataUpdateAuthorityRef: authority.metadataUpdateAuthorityRef,
    collectionAuthorityRef: authority.collectionAuthorityRef,
    burnAuthorityRef: authority.burnAuthorityRef,
    revokeAuthorityRef: authority.revokeAuthorityRef,
    legacyDisposition,
    metadataDigest: readback.metadataDigest,
    provenanceDigest: readback.provenanceDigest,
    readbackJson: facts,
    readbackDigest,
    status: blockers.length === 0 ? 'verified' : 'blocked',
    verifiedAt: now,
    createdAt: now,
  };
  const where = { assetKind_assetRef_readbackDigest: { assetKind: input.assetKind, assetRef, readbackDigest } };
  const existing = await dependencies.prisma.crystalAssetGovernanceReadback.findUnique({ where });
  if (existing) assertExistingAttempt(existing, record);
  let persisted = existing;
  if (!persisted) {
    try {
      persisted = await dependencies.prisma.crystalAssetGovernanceReadback.create({ data: record });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      persisted = await dependencies.prisma.crystalAssetGovernanceReadback.findUnique({ where });
      if (!persisted) throw new Error('crystal_asset_readback_retry_missing');
      assertExistingAttempt(persisted, record);
    }
  }
  return { ...persisted, blockers };
}

function assertExistingAttempt(existing: Record<string, unknown>, expected: Record<string, unknown>) {
  const immutableFields = [
    'id', 'assetKind', 'assetRef', 'network', 'governanceHomeRef', 'authorityPolicyDigest',
    'tokenOwnerRef', 'issuerRef', 'vaultOwnerRef', 'vaultAta', 'vaultBalance', 'mintAuthorityRef',
    'freezeAuthorityRef', 'metadataUpdateAuthorityRef', 'collectionAuthorityRef',
    'burnAuthorityRef', 'revokeAuthorityRef', 'legacyDisposition', 'metadataDigest',
    'provenanceDigest', 'readbackDigest', 'status',
  ];
  const storedFactsDigest = hashCanonicalGovernanceValue(DOMAIN, existing.readbackJson);
  if (storedFactsDigest !== expected.readbackDigest) throw new Error('crystal_asset_readback_existing_corrupt');
  for (const field of immutableFields) {
    if (existing[field] !== expected[field]) throw new Error('crystal_asset_readback_existing_corrupt');
  }
}

function normalizeAuthority(value: CrystalAssetAuthorityBundle): CrystalAssetAuthorityBundle {
  const result = {
    governanceHomeRef: text(value.governanceHomeRef, 'crystal_asset_governance_home_required'),
    authorityPolicyDigest: hex(value.authorityPolicyDigest, 'crystal_asset_authority_policy_digest_invalid'),
    tokenOwnerRef: authorityText(value.tokenOwnerRef),
    issuerRef: authorityText(value.issuerRef),
    vaultOwnerRef: authorityText(value.vaultOwnerRef),
    mintAuthorityRef: optionalAuthority(value.mintAuthorityRef),
    freezeAuthorityRef: optionalAuthority(value.freezeAuthorityRef),
    metadataUpdateAuthorityRef: optionalAuthority(value.metadataUpdateAuthorityRef),
    collectionAuthorityRef: optionalAuthority(value.collectionAuthorityRef),
    burnAuthorityRef: authorityText(value.burnAuthorityRef),
    revokeAuthorityRef: authorityText(value.revokeAuthorityRef),
  };
  return result;
}

function normalizeReadback(value: CrystalAssetChainReadback): CrystalAssetChainReadback {
  if (!['finalized', 'confirmed', 'ambiguous', 'not_found'].includes(value.finality)) throw new Error('crystal_asset_finality_invalid');
  return {
    finality: value.finality,
    supply: optionalCount(value.supply),
    tokenOwnerRef: optionalText(value.tokenOwnerRef), vaultOwnerRef: optionalText(value.vaultOwnerRef),
    vaultAta: optionalText(value.vaultAta), vaultBalance: optionalCount(value.vaultBalance), vaultOwnerOffCurve: value.vaultOwnerOffCurve,
    mintAuthorityRef: optionalText(value.mintAuthorityRef), freezeAuthorityRef: optionalText(value.freezeAuthorityRef),
    metadataUpdateAuthorityRef: optionalText(value.metadataUpdateAuthorityRef), collectionAuthorityRef: optionalText(value.collectionAuthorityRef),
    metadataDigest: value.metadataDigest == null ? null : hex(value.metadataDigest, 'crystal_asset_metadata_readback_invalid'),
    provenanceDigest: value.provenanceDigest == null ? null : hex(value.provenanceDigest, 'crystal_asset_provenance_readback_invalid'),
  };
}

function isUniqueConflict(value: unknown) { return typeof value === 'object' && value !== null && (value as { code?: unknown }).code === 'P2002'; }
function optionalCount(value: unknown) { if (value == null) return null; if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('crystal_asset_readback_count_invalid'); return Number(value); }

function authorityText(value: unknown) { const result = text(value, 'crystal_asset_authority_required'); if (FORBIDDEN_AUTHORITY_PREFIX.test(result)) throw new Error('crystal_asset_legacy_authority_forbidden'); return result; }
function optionalAuthority(value: unknown) { return value == null ? null : authorityText(value); }
function optionalText(value: unknown) { return value == null ? null : text(value, 'crystal_asset_readback_value_invalid'); }
function text(value: unknown, code: string) { if (typeof value !== 'string' || !value || value !== value.trim()) throw new Error(code); return value; }
function hex(value: unknown, code: string) { const result = text(value, code).toLowerCase(); if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(code); return result; }
function date(value: unknown) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('crystal_asset_readback_time_invalid'); return new Date(value); }

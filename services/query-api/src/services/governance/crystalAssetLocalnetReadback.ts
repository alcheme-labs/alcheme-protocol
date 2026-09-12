import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getTokenMetadata,
} from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';

import { hashCanonicalGovernanceValue } from './canonicalCodec';
import type { CrystalAssetChainReadback } from './crystalAssetGovernanceReadbackStore';

const METADATA_DOMAIN = 'alcheme.governance.crystal-asset-metadata';

export interface CrystalAssetMetadataFacts {
  updateAuthorityRef: string | null;
  mintRef: string;
  name: string;
  symbol: string;
  uri: string;
  additionalMetadata: Array<readonly [string, string]>;
}

export function computeCrystalAssetMetadataDigest(facts: CrystalAssetMetadataFacts): string {
  return hashCanonicalGovernanceValue(METADATA_DOMAIN, {
    ...facts,
    additionalMetadata: [...facts.additionalMetadata].sort(([left], [right]) => left.localeCompare(right)),
  });
}

export async function readCrystalAssetFromLocalnet(input: {
  rpcUrl: string;
  mintAddress: string;
  vaultAta: string;
}): Promise<CrystalAssetChainReadback> {
  assertLoopbackLocalnetRpc(input.rpcUrl);
  const connection = new Connection(input.rpcUrl, 'finalized');
  const mintAddress = new PublicKey(input.mintAddress);
  const vaultAta = new PublicKey(input.vaultAta);

  try {
    const [mint, tokenAccount, metadata] = await Promise.all([
      getMint(connection, mintAddress, 'finalized', TOKEN_2022_PROGRAM_ID),
      getAccount(connection, vaultAta, 'finalized', TOKEN_2022_PROGRAM_ID),
      getTokenMetadata(connection, mintAddress, 'finalized', TOKEN_2022_PROGRAM_ID),
    ]);
    const canonicalVaultAta = getAssociatedTokenAddressSync(
      mintAddress, tokenAccount.owner, true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    if (!metadata || !tokenAccount.mint.equals(mintAddress) || !metadata.mint.equals(mintAddress)
      || !canonicalVaultAta.equals(vaultAta)) return missing('ambiguous');
    const additionalMetadata = [...metadata.additionalMetadata];
    const metadataMap = new Map(additionalMetadata);
    const vaultOwnerRef = tokenAccount.owner.toBase58();
    const metadataFacts: CrystalAssetMetadataFacts = {
      updateAuthorityRef: metadata.updateAuthority?.toBase58() ?? null,
      mintRef: metadata.mint.toBase58(),
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
      additionalMetadata,
    };
    return {
      finality: 'finalized',
      supply: Number(mint.supply),
      tokenOwnerRef: vaultOwnerRef,
      vaultOwnerRef,
      vaultAta: vaultAta.toBase58(),
      vaultBalance: Number(tokenAccount.amount),
      vaultOwnerOffCurve: !PublicKey.isOnCurve(tokenAccount.owner.toBytes()),
      mintAuthorityRef: mint.mintAuthority?.toBase58() ?? null,
      freezeAuthorityRef: mint.freezeAuthority?.toBase58() ?? null,
      metadataUpdateAuthorityRef: metadataFacts.updateAuthorityRef,
      collectionAuthorityRef: metadataMap.get('collection_authority') ?? null,
      metadataDigest: computeCrystalAssetMetadataDigest(metadataFacts),
      provenanceDigest: metadataMap.get('provenance_digest') ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/could not find account|Failed to find account|Invalid account/i.test(message)) return missing('not_found');
    return missing('ambiguous');
  }
}

function assertLoopbackLocalnetRpc(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('crystal_asset_localnet_rpc_invalid');
  }
  if (parsed.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('crystal_asset_localnet_rpc_invalid');
  }
}

function missing(finality: 'ambiguous' | 'not_found'): CrystalAssetChainReadback {
  return {
    finality, supply: null, tokenOwnerRef: null, vaultOwnerRef: null, vaultAta: null, vaultBalance: null,
    vaultOwnerOffCurve: null, mintAuthorityRef: null, freezeAuthorityRef: null,
    metadataUpdateAuthorityRef: null, collectionAuthorityRef: null,
    metadataDigest: null, provenanceDigest: null,
  };
}

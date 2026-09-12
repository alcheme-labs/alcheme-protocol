export type ChainFamily = 'svm';
export type SettlementCheckpointSource =
    | 'sync_checkpoint_plus_runtime_state'
    | 'adapter_checkpoint_table'
    | 'external_adapter';

export type SettlementCommitment = 'processed' | 'confirmed' | 'finalized';

export interface FinalityStatus {
    status:
        | 'pending'
        | 'submitted'
        | 'confirmed'
        | 'indexed'
        | 'finalized'
        | 'failed'
        | 'skipped';
    commitment?: SettlementCommitment;
    indexed: boolean;
    final: boolean;
    reason?: string;
}

export interface AdapterEvidence {
    solana?: {
        signature?: string;
        slot?: string;
        commitment?: SettlementCommitment;
        programId?: string;
        memoProgramId?: string;
        pda?: string;
        cluster?: 'localnet' | 'devnet' | 'mainnet-beta' | string;
    };
    rollup?: {
        chainId: string;
        settlementLayer: string;
        daLayer?: string;
        settlementTxId?: string;
        rollupBlock?: string;
        stateRoot?: string;
        daCommitment?: string;
        bridgeReceipt?: string;
        challengeWindow?: string;
    };
    asset?: {
        assetAddress: string;
        assetStandard: string;
        mintSignature?: string;
        mintSlot?: string;
    };
}

export interface AnchorPayload {
    version: number;
    anchorType: string;
    sourceId: string;
    sourceScope?: string;
    payloadHash: string;
    summaryHash?: string;
    messagesDigest?: string;
    contributorsRoot?: string;
    generatedAt: string;
    canonicalJson: string;
}

export interface ProofPackage {
    version: number;
    packageType: string;
    packageHash: string;
    createdAt: string;
    issuer: {
        keyId: string;
        signature?: string;
    };
    anchorPayload: AnchorPayload;
    contributorRoot?: ContributorRoot;
    references?: Array<{
        type: string;
        id: string;
        hash?: string;
    }>;
}

export interface AnchorSubmission {
    adapterId: string;
    chainFamily: ChainFamily;
    settlementTxId: string | null;
    slotOrHeight: string | null;
    finality: FinalityStatus;
    submittedAt: string;
    adapterEvidence: AdapterEvidence;
}

export interface AnchorVerification {
    adapterId: string;
    verified: boolean;
    status:
        | 'verified'
        | 'pending'
        | 'not_found'
        | 'payload_mismatch'
        | 'finality_pending'
        | 'failed';
    checkedAt: string;
    payloadHashMatches: boolean;
    adapterEvidence: AdapterEvidence;
}

export interface ContributorRoot {
    algorithm: 'sha256-merkle-v1';
    rootHex: string;
    count: number;
    leafEncoding: string;
}

export interface SettlementKnowledgeBinding {
    knowledgeId: string;
    sourceAnchorId: string;
    proofPackageHash: string;
    contributorsRoot: string;
    contributorsCount: number;
    bindingVersion: number;
    boundAt: string;
}

export interface SettlementCheckpoint {
    adapterId: string;
    chainFamily: ChainFamily;
    settlementLayer: string;
    chainId: string;
    readCommitment: string;
    indexedSlot: string;
    headSlot: string | null;
    slotLag: number | null;
    finality: FinalityStatus;
    stale: boolean;
    generatedAt: string;
    source: SettlementCheckpointSource;
}

export interface AuthoritySnapshot {
    adapterId: string;
    chainFamily: ChainFamily;
    authorityId: string;
    slotOrHeight: string | null;
    finality: FinalityStatus;
    adapterEvidence: AdapterEvidence;
}

export interface ReadCheckpointInput {
    readCommitment: string;
    indexedSlot: number | string;
    headSlot: number | string | null;
    slotLag: number | null;
    stale: boolean;
    generatedAt?: string;
}

export interface VerifyAnchorInput {
    anchorPayload: AnchorPayload;
    memoText?: string;
    adapterEvidence?: AdapterEvidence;
}

export interface SettlementAdapter {
    readonly adapterId: string;
    readonly chainFamily: ChainFamily;
    submitAnchor(input: unknown): Promise<AnchorSubmission>;
    verifyAnchor(input: VerifyAnchorInput): Promise<AnchorVerification>;
    resolveAuthority(input: { authorityId: string }): Promise<AuthoritySnapshot>;
    readCheckpoint(input: ReadCheckpointInput): Promise<SettlementCheckpoint>;
}

export interface DraftAnchorMessagePayload {
    envelopeId: string;
    payloadHash: string;
    lamport: string;
    senderPubkey: string;
    createdAt: string;
    semanticScore: number;
    relevanceMethod: string;
}

export interface DraftAnchorCanonicalPayload {
    version: 1;
    anchorType: 'discussion_draft_trigger';
    roomKey: string;
    circleId: number;
    draftPostId: number;
    triggerReason: string;
    summaryMethod: string;
    summaryHash: string;
    messagesDigest: string;
    messageCount: number;
    fromLamport: string;
    toLamport: string;
    generatedAt: string;
    messages: DraftAnchorMessagePayload[];
}

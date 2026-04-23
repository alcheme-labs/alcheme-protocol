import bs58 from 'bs58';

const ENTER_DRAFT_CRYSTALLIZATION_DISCRIMINATOR = Buffer.from([92, 212, 147, 210, 46, 24, 57, 164]);
const ARCHIVE_DRAFT_LIFECYCLE_DISCRIMINATOR = Buffer.from([144, 73, 185, 174, 105, 18, 156, 186]);
const RESTORE_DRAFT_LIFECYCLE_DISCRIMINATOR = Buffer.from([230, 49, 121, 211, 206, 153, 97, 103]);

type DraftLifecycleMilestoneAction = 'entered_crystallization' | 'archived' | 'restored';
type AnchorVerificationResult = { ok: boolean; reason?: string };

function parseNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function parsePolicyProfileDigest(value: unknown): string | null {
    const normalized = parseNonEmptyString(value)?.toLowerCase() || null;
    if (!normalized || !/^[a-f0-9]{64}$/.test(normalized)) {
        return null;
    }
    return normalized;
}

function getConfiguredContentProgramId(): string | null {
    const configured = String(
        process.env.CONTENT_PROGRAM_ID
        || process.env.NEXT_PUBLIC_CONTENT_PROGRAM_ID
        || '',
    ).trim();
    return configured || null;
}

function extractSignerPubkeys(tx: any): Set<string> {
    const signers = new Set<string>();
    const accountKeys = tx?.transaction?.message?.accountKeys;
    if (Array.isArray(accountKeys)) {
        for (const key of accountKeys) {
            if (typeof key === 'object' && key && key.signer && typeof key.pubkey === 'string') {
                signers.add(key.pubkey);
            }
        }
    }
    if (signers.size === 0 && Array.isArray(accountKeys)) {
        const signatures = tx?.transaction?.signatures;
        if (Array.isArray(signatures)) {
            const signerCount = Math.min(signatures.length, accountKeys.length);
            for (let i = 0; i < signerCount; i += 1) {
                const key = accountKeys[i];
                if (typeof key === 'string') {
                    signers.add(key);
                } else if (typeof key?.pubkey === 'string') {
                    signers.add(key.pubkey);
                }
            }
        }
    }
    return signers;
}

function normalizeAccountKeys(tx: any): string[] {
    const accountKeysRaw = tx?.transaction?.message?.accountKeys;
    if (!Array.isArray(accountKeysRaw)) return [];
    return accountKeysRaw.map((item: any) => (
        typeof item === 'string'
            ? item
            : String(item?.pubkey || '')
    ));
}

function normalizeInstructionProgramId(ix: any, accountKeys: string[]): string | null {
    if (typeof ix?.programId === 'string' && ix.programId.trim().length > 0) {
        return ix.programId.trim();
    }
    if (typeof ix?.programIdIndex === 'number') {
        return accountKeys[ix.programIdIndex] || null;
    }
    return null;
}

function normalizeInstructionAccounts(ix: any, accountKeys: string[]): string[] {
    if (!Array.isArray(ix?.accounts)) return [];
    return ix.accounts.map((item: any) => {
        if (typeof item === 'string') return item;
        if (typeof item === 'number') return accountKeys[item] || '';
        return String(item?.pubkey || '');
    }).filter((value: string) => value.length > 0);
}

function decodeInstructionData(data: unknown): Buffer | null {
    if (typeof data !== 'string' || data.trim().length === 0) return null;
    try {
        return Buffer.from(bs58.decode(data.trim()));
    } catch {
        return null;
    }
}

async function fetchTransactionFromRpc(signature: string): Promise<any | null> {
    const rpcUrl = process.env.SOLANA_RPC_URL || process.env.RPC_URL;
    if (!rpcUrl) return null;
    const timeoutMs = Math.max(1000, Number(process.env.GHOST_SETTINGS_RPC_TIMEOUT_MS || '5000'));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getTransaction',
                params: [
                    signature,
                    {
                        encoding: 'jsonParsed',
                        maxSupportedTransactionVersion: 0,
                        commitment: 'finalized',
                    },
                ],
            }),
            signal: controller.signal,
        });
        if (!response.ok) return null;
        const payload = await response.json();
        return payload?.result || null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function getLifecycleDiscriminator(action: DraftLifecycleMilestoneAction): Buffer {
    if (action === 'archived') return ARCHIVE_DRAFT_LIFECYCLE_DISCRIMINATOR;
    if (action === 'restored') return RESTORE_DRAFT_LIFECYCLE_DISCRIMINATOR;
    return ENTER_DRAFT_CRYSTALLIZATION_DISCRIMINATOR;
}

function parseMinimumAcceptedAt(value: unknown): number | null {
    const normalized = parseNonEmptyString(value);
    if (!normalized) return null;
    const parsed = Date.parse(normalized);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
}

async function verifyDraftLifecycleMilestoneAnchor(input: {
    action: DraftLifecycleMilestoneAction;
    actorPubkey: string;
    anchorSignature: string;
    draftPostId: number;
    policyProfileDigest: string;
    minimumAcceptedAt?: string | null;
    reusedAnchorSignature?: string | null;
}): Promise<AnchorVerificationResult> {
    const actorPubkey = parseNonEmptyString(input.actorPubkey);
    const anchorSignature = parseNonEmptyString(input.anchorSignature);
    const policyProfileDigest = parsePolicyProfileDigest(input.policyProfileDigest);
    const reusedAnchorSignature = parseNonEmptyString(input.reusedAnchorSignature);
    const minimumAcceptedAt = parseMinimumAcceptedAt(input.minimumAcceptedAt);
    if (!actorPubkey) return { ok: false, reason: 'actor_pubkey_required' };
    if (!anchorSignature) return { ok: false, reason: 'anchor_signature_required' };
    if (!policyProfileDigest) return { ok: false, reason: 'policy_profile_digest_required' };
    if (reusedAnchorSignature && reusedAnchorSignature === anchorSignature) {
        return { ok: false, reason: 'anchor_signature_reused' };
    }

    try {
        bs58.decode(anchorSignature);
    } catch {
        return { ok: false, reason: 'invalid_signature_format' };
    }

    const tx = await fetchTransactionFromRpc(anchorSignature);
    if (!tx) return { ok: false, reason: 'anchor_tx_not_found' };
    if (tx?.meta?.err) return { ok: false, reason: 'anchor_tx_failed' };
    if (minimumAcceptedAt !== null) {
        if (!Number.isFinite(tx?.blockTime)) {
            return { ok: false, reason: 'anchor_tx_missing_blocktime' };
        }
        // Solana getTransaction blockTime is second-granular, while workflow transitions are stored
        // with millisecond precision. Treating "same second" as stale causes fresh milestone anchors
        // to fail spuriously on local/dev chains, so only strictly older seconds are rejected.
        const minimumAcceptedAtSec = Math.floor(minimumAcceptedAt / 1000);
        if (Number(tx.blockTime) < minimumAcceptedAtSec) {
            return { ok: false, reason: 'anchor_tx_stale' };
        }
    }

    const signers = extractSignerPubkeys(tx);
    if (!signers.has(actorPubkey)) {
        return { ok: false, reason: 'anchor_tx_signer_mismatch' };
    }

    const configuredProgramId = getConfiguredContentProgramId();
    if (!configuredProgramId) {
        return { ok: false, reason: 'content_program_id_unconfigured' };
    }
    const accountKeys = normalizeAccountKeys(tx);
    const instructions = tx?.transaction?.message?.instructions;
    if (!Array.isArray(instructions)) {
        return { ok: false, reason: 'anchor_instruction_missing' };
    }

    const expectedDigest = Buffer.from(policyProfileDigest, 'hex');
    const expectedDiscriminator = getLifecycleDiscriminator(input.action);
    let sawLifecycleInstruction = false;

    for (const ix of instructions) {
        const programId = normalizeInstructionProgramId(ix, accountKeys);
        if (configuredProgramId && programId !== configuredProgramId) {
            continue;
        }

        const data = decodeInstructionData(ix?.data);
        if (!data || data.length < 48) {
            continue;
        }
        if (!data.subarray(0, 8).equals(expectedDiscriminator)) {
            continue;
        }

        sawLifecycleInstruction = true;

        const accounts = normalizeInstructionAccounts(ix, accountKeys);
        if (accounts[0] && accounts[0] !== actorPubkey) {
            return { ok: false, reason: 'anchor_actor_mismatch' };
        }

        const draftPostId = Number(data.readBigUInt64LE(8));
        if (draftPostId !== input.draftPostId) {
            return { ok: false, reason: 'anchor_draft_post_mismatch' };
        }

        const digest = data.subarray(16, 48);
        if (!digest.equals(expectedDigest)) {
            return { ok: false, reason: 'anchor_digest_mismatch' };
        }

        return { ok: true };
    }

    return {
        ok: false,
        reason: sawLifecycleInstruction ? 'anchor_program_mismatch' : 'anchor_instruction_missing',
    };
}

export async function verifyEnterDraftLifecycleCrystallizationAnchor(input: {
    actorPubkey: string;
    anchorSignature: string;
    draftPostId: number;
    policyProfileDigest: string;
    minimumAcceptedAt?: string | null;
    reusedAnchorSignature?: string | null;
}): Promise<AnchorVerificationResult> {
    return verifyDraftLifecycleMilestoneAnchor({
        ...input,
        action: 'entered_crystallization',
    });
}

export async function verifyArchiveDraftLifecycleAnchor(input: {
    actorPubkey: string;
    anchorSignature: string;
    draftPostId: number;
    policyProfileDigest: string;
    minimumAcceptedAt?: string | null;
}): Promise<AnchorVerificationResult> {
    return verifyDraftLifecycleMilestoneAnchor({
        ...input,
        action: 'archived',
    });
}

export async function verifyRestoreDraftLifecycleAnchor(input: {
    actorPubkey: string;
    anchorSignature: string;
    draftPostId: number;
    policyProfileDigest: string;
    minimumAcceptedAt?: string | null;
}): Promise<AnchorVerificationResult> {
    return verifyDraftLifecycleMilestoneAnchor({
        ...input,
        action: 'restored',
    });
}

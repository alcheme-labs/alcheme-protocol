import fs from 'fs';
import {
    Commitment,
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';

export type AnchorSignerMode = 'local' | 'external';

export interface AnchorSignerConfig {
    mode: AnchorSignerMode;
    rpcUrl: string;
    commitment: Commitment;
    keypairPath: string;
    externalUrl?: string | null;
    externalAuthToken?: string | null;
    externalTimeoutMs?: number;
    signerLabel?: string;
}

export interface AnchorSubmissionResult {
    signature: string;
    slot: bigint | null;
}

function loadSigner(pathToKeypair: string): Keypair {
    const content = fs.readFileSync(pathToKeypair, 'utf8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed) || parsed.length < 64) {
        throw new Error(`invalid keypair file: ${pathToKeypair}`);
    }
    return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

function normalizeSlot(value: unknown): bigint | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
        const n = Math.floor(value);
        if (n < 0) return null;
        return BigInt(n);
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        try {
            const parsed = BigInt(trimmed);
            return parsed >= 0n ? parsed : null;
        } catch {
            return null;
        }
    }
    return null;
}

function normalizeSignature(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.trim();
}

function truncate(text: string, maxLen = 240): string {
    const value = String(text || '');
    if (value.length <= maxLen) return value;
    return `${value.slice(0, maxLen)}...`;
}

async function submitViaLocal(input: {
    config: AnchorSignerConfig;
    memoText: string;
    memoProgramId: PublicKey;
}): Promise<AnchorSubmissionResult> {
    const signer = loadSigner(input.config.keypairPath);
    const connection = new Connection(input.config.rpcUrl, input.config.commitment);

    const instruction = new TransactionInstruction({
        programId: input.memoProgramId,
        keys: [],
        data: Buffer.from(input.memoText, 'utf8'),
    });
    const tx = new Transaction().add(instruction);
    tx.feePayer = signer.publicKey;

    const latest = await connection.getLatestBlockhash(input.config.commitment);
    tx.recentBlockhash = latest.blockhash;
    tx.sign(signer);

    const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: input.config.commitment,
        maxRetries: 3,
    });

    const confirmation = await connection.confirmTransaction(
        {
            signature,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        input.config.commitment,
    );
    if (confirmation.value.err) {
        throw new Error(`memo anchor transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    const txReadCommitment: 'confirmed' | 'finalized' =
        input.config.commitment === 'finalized' ? 'finalized' : 'confirmed';
    const txInfo = await connection.getTransaction(signature, {
        commitment: txReadCommitment,
        maxSupportedTransactionVersion: 0,
    });

    return {
        signature,
        slot: txInfo?.slot ? BigInt(txInfo.slot) : null,
    };
}

async function submitViaExternal(input: {
    config: AnchorSignerConfig;
    memoText: string;
    memoProgramId: PublicKey;
}): Promise<AnchorSubmissionResult> {
    const endpoint = String(input.config.externalUrl || '').trim();
    if (!endpoint) {
        throw new Error('external signer url is not configured');
    }
    const timeoutMs = Math.max(1000, Math.min(input.config.externalTimeoutMs || 10000, 120000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const label = input.config.signerLabel || 'anchor';

    try {
        const headers: Record<string, string> = {
            'content-type': 'application/json',
        };
        const token = String(input.config.externalAuthToken || '').trim();
        if (token) {
            headers.authorization = `Bearer ${token}`;
        }
        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action: 'memo_anchor_submit',
                signerLabel: label,
                chain: 'solana',
                rpcUrl: input.config.rpcUrl,
                commitment: input.config.commitment,
                memoProgramId: input.memoProgramId.toBase58(),
                memoText: input.memoText,
            }),
            signal: controller.signal,
        });
        const isJson = (response.headers.get('content-type') || '').includes('application/json');
        const responseBody = isJson ? await response.json() : await response.text();
        if (!response.ok) {
            const detail = isJson
                ? truncate(JSON.stringify(responseBody))
                : truncate(String(responseBody || ''));
            throw new Error(`external signer request failed (${response.status}): ${detail || 'unknown_error'}`);
        }
        const payload = responseBody as Record<string, unknown>;
        const signature = normalizeSignature(payload?.signature);
        if (!signature) {
            throw new Error('external signer response missing signature');
        }
        return {
            signature,
            slot: normalizeSlot(payload?.slot),
        };
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`external signer request timeout (${timeoutMs}ms)`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

export async function submitMemoAnchorWithSigner(input: {
    config: AnchorSignerConfig;
    memoText: string;
    memoProgramId: PublicKey;
}): Promise<AnchorSubmissionResult> {
    if (input.config.mode === 'external') {
        return submitViaExternal(input);
    }
    return submitViaLocal(input);
}

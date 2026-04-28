import { Program, AnchorProvider, Wallet, type Idl } from '@coral-xyz/anchor';
import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
} from '@solana/web3.js';
import bs58 from 'bs58';

import contributionEngineIdl from '../../idl/contribution_engine.json';

export interface ReferenceMaterializationInput {
    sourceOnChainAddress: string;
    targetOnChainAddress: string;
    referenceType: 'citation';
}

export interface ReferenceMaterializationClient {
    addReferences(input: ReferenceMaterializationInput[]): Promise<string[]>;
}

export interface ContributionEngineReferenceSdk {
    addReference(
        sourceId: PublicKey,
        targetId: PublicKey,
        refType: { citation: Record<string, never> },
    ): Promise<string>;
}

export class ReferenceMaterializationClientError extends Error {
    constructor(
        public readonly code:
            | 'reference_materialization_config_invalid'
            | 'reference_materialization_invalid_input'
            | 'reference_materialization_failed',
        message: string,
        public readonly causeError?: unknown,
    ) {
        super(message);
        this.name = 'ReferenceMaterializationClientError';
    }
}

interface ReferenceMaterializationClientOptions {
    sdk: ContributionEngineReferenceSdk;
    maxRetries?: number;
    retryBaseDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
}

interface ReferenceMaterializationRuntimeConfig {
    rpcUrl: string;
    authoritySecret: string;
    contributionEngineProgramId: string;
}

function trimOrNull(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized.length > 0 ? normalized : null;
}

function parseAuthoritySecret(raw: string): Uint8Array {
    const normalized = trimOrNull(raw);
    if (!normalized) {
        throw new ReferenceMaterializationClientError(
            'reference_materialization_config_invalid',
            'reference materialization authority secret is required',
        );
    }

    try {
        if (normalized.startsWith('[')) {
            const parsed = JSON.parse(normalized);
            if (!Array.isArray(parsed) || parsed.length === 0) {
                throw new Error('empty secret array');
            }
            return Uint8Array.from(parsed.map((value) => Number(value)));
        }
        return bs58.decode(normalized);
    } catch (error) {
        throw new ReferenceMaterializationClientError(
            'reference_materialization_config_invalid',
            'reference materialization authority secret is invalid',
            error,
        );
    }
}

function parsePublicKey(value: string, field: 'sourceOnChainAddress' | 'targetOnChainAddress'): PublicKey {
    try {
        return new PublicKey(value);
    } catch (error) {
        throw new ReferenceMaterializationClientError(
            'reference_materialization_invalid_input',
            `invalid ${field}`,
            error,
        );
    }
}

function normalizeRuntimeConfig(env: NodeJS.ProcessEnv): ReferenceMaterializationRuntimeConfig {
    const rpcUrl = trimOrNull(
        env.REFERENCE_MATERIALIZATION_RPC_URL
        || env.SOLANA_RPC_URL
        || env.RPC_URL,
    );
    const authoritySecret = trimOrNull(
        env.REFERENCE_MATERIALIZATION_AUTHORITY_SECRET
        || env.CONTRIBUTION_ENGINE_AUTHORITY_SECRET,
    );
    const contributionEngineProgramId = trimOrNull(
        env.CONTRIBUTION_ENGINE_PROGRAM_ID
        || env.NEXT_PUBLIC_CONTRIBUTION_ENGINE_PROGRAM_ID,
    );

    if (!rpcUrl || !authoritySecret || !contributionEngineProgramId) {
        throw new ReferenceMaterializationClientError(
            'reference_materialization_config_invalid',
            'reference materialization requires RPC URL, authority secret, and contribution engine program id',
        );
    }
    try {
        new PublicKey(contributionEngineProgramId);
    } catch (error) {
        throw new ReferenceMaterializationClientError(
            'reference_materialization_config_invalid',
            'reference materialization contribution engine program id is invalid',
            error,
        );
    }
    return {
        rpcUrl,
        authoritySecret,
        contributionEngineProgramId,
    };
}

function isDuplicateReferenceError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    const normalized = message.toLowerCase();
    return normalized.includes('already in use')
        || normalized.includes('already exists')
        || normalized.includes('account already initialized');
}

function isRetryableReferenceError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    const normalized = message.toLowerCase();
    return normalized.includes('blockhash not found')
        || normalized.includes('blockhash has expired')
        || normalized.includes('network error')
        || normalized.includes('timeout')
        || normalized.includes('429')
        || normalized.includes('502')
        || normalized.includes('503')
        || normalized.includes('econnrefused')
        || normalized.includes('econnreset');
}

function dedupeReferences(input: ReferenceMaterializationInput[]): ReferenceMaterializationInput[] {
    const seen = new Set<string>();
    const output: ReferenceMaterializationInput[] = [];
    for (const item of input) {
        const key = `${item.sourceOnChainAddress}:${item.targetOnChainAddress}:${item.referenceType}`;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(item);
    }
    return output;
}

async function defaultSleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

export function createReferenceMaterializationClient(
    options: ReferenceMaterializationClientOptions,
): ReferenceMaterializationClient {
    const maxRetries = Math.max(1, Math.trunc(options.maxRetries ?? 3));
    const retryBaseDelayMs = Math.max(0, Math.trunc(options.retryBaseDelayMs ?? 1000));
    const sleep = options.sleep || defaultSleep;

    async function submitWithRetry(reference: ReferenceMaterializationInput): Promise<string | null> {
        const source = parsePublicKey(reference.sourceOnChainAddress, 'sourceOnChainAddress');
        const target = parsePublicKey(reference.targetOnChainAddress, 'targetOnChainAddress');
        let lastError: unknown = null;
        for (let attempt = 0; attempt < maxRetries; attempt += 1) {
            try {
                return await options.sdk.addReference(source, target, { citation: {} });
            } catch (error) {
                if (isDuplicateReferenceError(error)) {
                    return null;
                }
                lastError = error;
                if (!isRetryableReferenceError(error) || attempt >= maxRetries - 1) {
                    break;
                }
                await sleep(retryBaseDelayMs * Math.pow(2, attempt));
            }
        }
        throw new ReferenceMaterializationClientError(
            'reference_materialization_failed',
            'reference materialization failed after retry',
            lastError,
        );
    }

    return {
        async addReferences(input: ReferenceMaterializationInput[]): Promise<string[]> {
            const signatures: string[] = [];
            for (const reference of dedupeReferences(input)) {
                if (reference.referenceType !== 'citation') {
                    throw new ReferenceMaterializationClientError(
                        'reference_materialization_invalid_input',
                        'unsupported reference type',
                    );
                }
                const signature = await submitWithRetry(reference);
                if (signature) signatures.push(signature);
            }
            return signatures;
        },
    };
}

// query-api does not currently depend on @alcheme/sdk. Keep this narrow adapter
// source-compatible with sdk/src/modules/contribution-engine.ts via drift tests.
class AnchorContributionEngineReferenceSdk implements ContributionEngineReferenceSdk {
    private readonly program: Program<Idl>;
    private readonly authority: Keypair;

    constructor(config: ReferenceMaterializationRuntimeConfig) {
        this.authority = Keypair.fromSecretKey(parseAuthoritySecret(config.authoritySecret));
        const connection = new Connection(config.rpcUrl, 'confirmed');
        const wallet = new Wallet(this.authority);
        const provider = new AnchorProvider(connection, wallet, {
            commitment: 'confirmed',
        });
        const programId = new PublicKey(config.contributionEngineProgramId);
        const idl = {
            ...(contributionEngineIdl as unknown as Record<string, unknown>),
            address: programId.toBase58(),
        } as Idl;
        this.program = new Program(idl, provider);
    }

    private findConfigPda(): PublicKey {
        return PublicKey.findProgramAddressSync(
            [Buffer.from('config')],
            this.program.programId,
        )[0];
    }

    private findReferencePda(sourceId: PublicKey, targetId: PublicKey): PublicKey {
        return PublicKey.findProgramAddressSync(
            [Buffer.from('ref'), sourceId.toBuffer(), targetId.toBuffer()],
            this.program.programId,
        )[0];
    }

    async addReference(
        sourceId: PublicKey,
        targetId: PublicKey,
        refType: { citation: Record<string, never> },
    ): Promise<string> {
        return (this.program.methods as any)
            .addReference(refType)
            .accounts({
                config: this.findConfigPda(),
                reference: this.findReferencePda(sourceId, targetId),
                sourceContent: sourceId,
                targetContent: targetId,
                authority: this.authority.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([this.authority])
            .rpc();
    }
}

export function createReferenceMaterializationClientFromEnv(
    env: NodeJS.ProcessEnv = process.env,
): ReferenceMaterializationClient {
    const config = normalizeRuntimeConfig(env);
    return createReferenceMaterializationClient({
        sdk: new AnchorContributionEngineReferenceSdk(config),
    });
}

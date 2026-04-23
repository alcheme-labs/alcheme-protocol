import dotenv from 'dotenv';

dotenv.config();

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required tracker env: ${name}`);
    }
    return value;
}

export interface TrackerConfig {
    /** Solana RPC URL */
    rpcUrl: string;
    /** WebSocket URL for event subscription */
    wsUrl: string;
    /** Path to the authority wallet keypair */
    walletPath: string;
    /** Contribution Engine program ID */
    programId: string;
    /** Identity Registry program ID */
    identityRegistryProgramId: string;
    /** Effective identity registry name used for contributor identity resolution */
    identityRegistryName: string;
    /** Registry Factory program ID */
    registryFactoryProgramId: string;
    /** Event Emitter program ID (for listening to protocol events) */
    eventEmitterProgramId: string;
    /** Polling interval in milliseconds */
    pollIntervalMs: number;
    /** Log level */
    logLevel: string;

    // ---- Settlement (Direction 4) ----

    /** PostgreSQL connection URL */
    dbUrl: string;
    /** Cron expression for settlement scheduling (default: every hour) */
    settlementCron: string;
    /** Enable settlement scheduler on startup */
    settlementEnabled: boolean;
    /** Execute on-chain settle_reputation calls (false = dry-run) */
    settlementExecuteOnChain: boolean;

    // ---- PageRank ----

    /** Damping factor (default 0.85) */
    pageRankDamping: number;
    /** Convergence threshold (default 1e-6) */
    pageRankConvergence: number;
    /** Max iterations (default 100) */
    pageRankMaxIterations: number;

    // ---- Anti-Gaming ----

    /** Mutual citation window in days */
    antiGamingMutualCitationWindowDays: number;
    /** Mutual citation max count */
    antiGamingMutualCitationMaxCount: number;
    /** Spam: max references per user per week */
    antiGamingSpamMaxRefsPerWeek: number;
    /** Ghost contribution min weight */
    antiGamingGhostMinWeight: number;
}

export function loadConfig(): TrackerConfig {
    return {
        rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:8899',
        wsUrl: process.env.WS_URL || 'ws://127.0.0.1:8900',
        walletPath: process.env.WALLET_PATH || process.env.ANCHOR_WALLET || '~/.config/solana/id.json',
        programId: requireEnv('CONTRIBUTION_ENGINE_PROGRAM_ID'),
        identityRegistryProgramId: requireEnv('IDENTITY_REGISTRY_PROGRAM_ID'),
        identityRegistryName: process.env.IDENTITY_REGISTRY_NAME || 'social_hub_identity',
        registryFactoryProgramId: requireEnv('REGISTRY_FACTORY_PROGRAM_ID'),
        eventEmitterProgramId: requireEnv('EVENT_EMITTER_PROGRAM_ID'),
        pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '5000'),
        logLevel: process.env.LOG_LEVEL || 'info',

        // Settlement
        dbUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/alcheme',
        settlementCron: process.env.SETTLEMENT_CRON || '0 * * * *',
        settlementEnabled: process.env.SETTLEMENT_ENABLED === 'true',
        settlementExecuteOnChain: process.env.SETTLEMENT_EXECUTE_ON_CHAIN !== 'false',

        // PageRank
        pageRankDamping: parseFloat(process.env.PAGERANK_DAMPING || '0.85'),
        pageRankConvergence: parseFloat(process.env.PAGERANK_CONVERGENCE || '1e-6'),
        pageRankMaxIterations: parseInt(process.env.PAGERANK_MAX_ITERATIONS || '100'),

        // Anti-Gaming
        antiGamingMutualCitationWindowDays: parseInt(process.env.AG_MUTUAL_CITATION_WINDOW_DAYS || '7'),
        antiGamingMutualCitationMaxCount: parseInt(process.env.AG_MUTUAL_CITATION_MAX_COUNT || '5'),
        antiGamingSpamMaxRefsPerWeek: parseInt(process.env.AG_SPAM_MAX_REFS_PER_WEEK || '50'),
        antiGamingGhostMinWeight: parseFloat(process.env.AG_GHOST_MIN_WEIGHT || '0.01'),
    };
}

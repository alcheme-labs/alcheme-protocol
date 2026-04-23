import { createServer } from 'http';
import type { Server as HttpServer } from 'http';

import { CacheInvalidator } from './services/cacheInvalidator';
import { startOffchainPeerSync, stopOffchainPeerSync } from './services/offchainPeerSync';
import {
    startPendingGhostSettingsReconciler,
    stopPendingGhostSettingsReconciler,
} from './services/pendingGhostSettingsReconciler';
import { startHeatDecayCron, stopHeatDecayCron } from './cron/heat-decay';
import { startIdentityCron, stopIdentityCron } from './cron/identity-evaluation';
import { startDraftWorkflowCron, stopDraftWorkflowCron } from './cron/draft-workflow';
import { startForkRetentionCron, stopForkRetentionCron } from './cron/fork-retention';
import { setupCollaboration, shutdownCollaboration } from './collab/setup';
import { createApp } from './app';
import { prisma } from './database';
import { ensureOffchainDiscussionSchema } from './services/offchainDiscussion';
import { createAiJobHandlers } from './services/aiJobs/handlers';
import { startAiJobWorker, type AiJobWorker } from './services/aiJobs/worker';
import { loadCrystalMintRuntimeConfig, loadNodeRuntimeConfig } from './config/services';

const PORT = process.env.PORT || 4000;

export interface QueryApiServerControl {
    httpServer: HttpServer;
    stop(): Promise<void>;
    aiJobWorker: AiJobWorker;
}

export async function startQueryApiServer(input: {
    port?: number | string;
    registerProcessHandlers?: boolean;
} = {}): Promise<QueryApiServerControl> {
    const runtime = loadNodeRuntimeConfig();
    const crystalMint = loadCrystalMintRuntimeConfig();
    await ensureOffchainDiscussionSchema(prisma);
    const { app, redis, apolloServer, dispose } = await createApp({ prisma });

    redis.on('connect', () => {
        console.log('✅ Connected to Redis');
    });

    redis.on('error', (err) => {
        console.error('❌ Redis connection error:', err);
    });

    const cacheInvalidator = new CacheInvalidator(redis);
    await cacheInvalidator.start();

    const httpServer = createServer(app);
    setupCollaboration(httpServer, prisma, redis);
    const aiJobWorker = startAiJobWorker({
        prisma,
        redis,
        handlers: createAiJobHandlers({
            prisma,
            redis,
        }),
    });

    const port = input.port ?? PORT;
    await new Promise<void>((resolve) => {
        httpServer.listen(port, () => {
            console.log(`🚀 Query API Server ready at http://localhost:${port}`);
            console.log(`📊 GraphQL endpoint: http://localhost:${port}${apolloServer.graphqlPath}`);
            console.log(`🔌 REST API: http://localhost:${port}/api/v1`);
            if (runtime.runtimeRole === 'PRIVATE_SIDECAR') {
                console.log(`🤝 Collab: ws://localhost:${port}/collab/*`);
            } else {
                console.log('🤝 Collab: disabled on public node (private sidecar required)');
            }
            console.log(`🧭 Runtime role: ${runtime.runtimeRole} (${runtime.deploymentProfile})`);
            console.log(`💎 Crystal asset issuance: ${crystalMint.adapterMode}`);
            resolve();
        });
    });

    startHeatDecayCron(prisma);
    startIdentityCron(prisma);
    startDraftWorkflowCron(prisma);
    startForkRetentionCron(prisma);
    startOffchainPeerSync(prisma);
    startPendingGhostSettingsReconciler(prisma);

    let stopped = false;
    const stop = async () => {
        if (stopped) return;
        stopped = true;
        stopHeatDecayCron();
        stopIdentityCron();
        stopDraftWorkflowCron();
        stopForkRetentionCron();
        stopOffchainPeerSync();
        stopPendingGhostSettingsReconciler();
        await aiJobWorker.stop();
        await shutdownCollaboration();
        await cacheInvalidator.stop();
        await dispose();
        await new Promise<void>((resolve) => {
            httpServer.close(() => {
                console.log('HTTP server closed');
                resolve();
            });
        });
        if (typeof (prisma as any).$disconnect === 'function') {
            await prisma.$disconnect();
        }
    };

    if (input.registerProcessHandlers !== false) {
        process.on('SIGTERM', async () => {
            console.log('SIGTERM received, shutting down gracefully...');
            await stop();
            process.exit(0);
        });
    }

    return {
        httpServer,
        stop,
        aiJobWorker,
    };
}

if (process.env.NODE_ENV !== 'test') {
    startQueryApiServer().catch((error) => {
        console.error('Failed to start server:', error);
        process.exit(1);
    });
}

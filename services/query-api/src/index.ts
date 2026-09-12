import 'dotenv/config';

import { createServer } from 'http';
import type { Server as HttpServer } from 'http';

import { CacheInvalidator } from './services/cacheInvalidator';
import { setupCollaboration, shutdownCollaboration } from './collab/setup';
import {
    setupDiscussionRealtimeWebSocket,
    shutdownDiscussionRealtimeWebSocket,
} from './services/discussion/realtime';
import { createApp } from './app';
import { prisma } from './database';
import { ensureOffchainDiscussionSchema } from './services/offchainDiscussion';
import { ensureKnowledgeRelationshipSystemCatalog } from './services/knowledgeRelationshipLabels';
import {
    resolveBackgroundOwnerId,
    startQueryBackgroundServices,
    type QueryBackgroundServicesControl,
} from './runtime/backgroundServices';
import { loadCrystalMintRuntimeConfig, loadNodeRuntimeConfig } from './config/services';

const PORT = process.env.PORT || 4000;

export interface QueryApiServerControl {
    httpServer: HttpServer;
    stop(): Promise<void>;
    backgroundServices: {
        ownerId: string;
        preListen: QueryBackgroundServicesControl;
        postListen: QueryBackgroundServicesControl;
    };
}

function listenHttpServer(
    httpServer: HttpServer,
    port: number | string,
    onListening: () => void,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const onError = (error: Error) => {
            httpServer.off('error', onError);
            reject(error);
        };

        httpServer.once('error', onError);
        httpServer.listen(port, () => {
            httpServer.off('error', onError);
            onListening();
            resolve();
        });
    });
}

async function closeHttpServer(httpServer: HttpServer): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        httpServer.close((error?: Error & { code?: string }) => {
            if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
                reject(error);
                return;
            }
            console.log('HTTP server closed');
            resolve();
        });
    });
}

function wrapServerCleanupError(label: string, error: unknown): Error {
    const wrapped = new Error(`query_api_cleanup_failed:${label}`);
    (wrapped as Error & { cause?: unknown }).cause = error;
    return wrapped;
}

function reportServerCleanupErrors(errors: Error[]): void {
    for (const error of errors) {
        console.error(error.message, (error as Error & { cause?: unknown }).cause);
    }
}

export async function startQueryApiServer(input: {
    port?: number | string;
    registerProcessHandlers?: boolean;
} = {}): Promise<QueryApiServerControl> {
    const runtime = loadNodeRuntimeConfig();
    const crystalMint = loadCrystalMintRuntimeConfig();
    await ensureOffchainDiscussionSchema(prisma);
    await ensureKnowledgeRelationshipSystemCatalog(prisma);
    const { app, redis, apolloServer, dispose } = await createApp({ prisma });

    redis.on('connect', () => {
        console.log('✅ Connected to Redis');
    });

    redis.on('error', (err) => {
        console.error('❌ Redis connection error:', err);
    });

    const cacheInvalidator = new CacheInvalidator(redis);
    let cacheStarted = false;
    let collaborationStarted = false;
    let discussionRealtimeStarted = false;
    let preListenBackgroundServices: QueryBackgroundServicesControl | null = null;
    let postListenBackgroundServices: QueryBackgroundServicesControl | null = null;
    const httpServer = createServer(app);
    let stopped = false;
    const port = input.port ?? PORT;

    const stopStartedResources = async (options: { disconnectPrisma: boolean }): Promise<Error[]> => {
        if (stopped) return [];
        stopped = true;
        const cleanupErrors: Error[] = [];
        const runCleanup = async (label: string, action: () => void | Promise<void>) => {
            try {
                await action();
            } catch (error) {
                cleanupErrors.push(wrapServerCleanupError(label, error));
            }
        };

        await runCleanup('post_listen_background_services', async () => {
            await postListenBackgroundServices?.stop();
        });
        await runCleanup('pre_listen_background_services', async () => {
            await preListenBackgroundServices?.stop();
        });
        if (discussionRealtimeStarted) {
            await runCleanup('discussion_realtime_websocket', () => shutdownDiscussionRealtimeWebSocket());
        }
        if (collaborationStarted) {
            await runCleanup('collaboration', () => shutdownCollaboration());
        }
        if (cacheStarted) {
            await runCleanup('cache_invalidator', () => cacheInvalidator.stop());
        }
        await runCleanup('app_dispose', () => dispose());
        await runCleanup('http_server', () => closeHttpServer(httpServer));
        if (options.disconnectPrisma && typeof (prisma as any).$disconnect === 'function') {
            await runCleanup('prisma_disconnect', () => prisma.$disconnect());
        }
        return cleanupErrors;
    };

    try {
        await cacheInvalidator.start();
        cacheStarted = true;

        setupCollaboration(httpServer, prisma, redis);
        collaborationStarted = true;
        setupDiscussionRealtimeWebSocket(httpServer, prisma, redis);
        discussionRealtimeStarted = true;
        const backgroundOwnerId = resolveBackgroundOwnerId();
        preListenBackgroundServices = await startQueryBackgroundServices({
            prisma,
            redis,
            runtime,
            phase: 'pre_listen',
            ownerId: backgroundOwnerId,
        });

        await listenHttpServer(httpServer, port, () => {
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
        });

        postListenBackgroundServices = await startQueryBackgroundServices({
            prisma,
            redis,
            runtime,
            phase: 'post_listen',
            ownerId: backgroundOwnerId,
        });
    } catch (error) {
        const cleanupErrors = await stopStartedResources({ disconnectPrisma: false });
        reportServerCleanupErrors(cleanupErrors);
        throw error;
    }

    const stop = async () => {
        const cleanupErrors = await stopStartedResources({ disconnectPrisma: true });
        if (cleanupErrors.length > 0) {
            throw new AggregateError(cleanupErrors, 'query_api_shutdown_cleanup_failed');
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
        backgroundServices: {
            ownerId: preListenBackgroundServices.ownerId,
            preListen: preListenBackgroundServices,
            postListen: postListenBackgroundServices,
        },
    };
}

if (process.env.NODE_ENV !== 'test') {
    startQueryApiServer().catch((error) => {
        console.error('Failed to start server:', error);
        process.exit(1);
    });
}

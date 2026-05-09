import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ApolloServer } from 'apollo-server-express';
import type { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

import { prisma as defaultPrisma } from './database';
import { typeDefs } from './graphql/schema';
import { resolvers } from './graphql/resolvers';
import { buildContext } from './graphql/context';
import { restRouter } from './rest';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/logger';
import { rateLimiter } from './middleware/rateLimiter';
import { sessionAuth } from './middleware/sessionAuth';
import { loadNodeRuntimeConfig } from './config/services';
import { loadConsistencyStatus } from './services/consistency';

export interface CreateAppOptions {
    prisma?: PrismaClient;
    redis?: Redis;
}

export interface QueryApiAppContext {
    app: Express;
    prisma: PrismaClient;
    redis: Redis;
    apolloServer: ApolloServer;
    dispose: () => Promise<void>;
}

export async function createApp(options: CreateAppOptions = {}): Promise<QueryApiAppContext> {
    const prisma = options.prisma ?? defaultPrisma;
    const redis = options.redis ?? new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    const ownsRedis = !options.redis;

    const app = express();
    const consistencyHeaderTtlMs = Number(process.env.CONSISTENCY_HEADER_TTL_MS || '1000');
    let consistencyCache:
        | {
            value: Awaited<ReturnType<typeof loadConsistencyStatus>>;
            cachedAt: number;
        }
        | null = null;

    const getConsistencyStatus = async (force = false) => {
        const now = Date.now();
        if (!force && consistencyCache && now - consistencyCache.cachedAt < consistencyHeaderTtlMs) {
            return consistencyCache.value;
        }

        const status = await loadConsistencyStatus(prisma);
        consistencyCache = {
            value: status,
            cachedAt: now,
        };
        return status;
    };

    const allowedOrigins = (
        process.env.CORS_ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) || [
            'http://localhost:3000',
            'http://127.0.0.1:3000',
        ]
    );

    app.use(helmet());
    app.use(
        cors({
            origin: (origin, callback) => {
                if (!origin || allowedOrigins.includes(origin)) {
                    callback(null, true);
                    return;
                }

                callback(new Error(`CORS blocked for origin: ${origin}`));
            },
            credentials: true,
            methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
        })
    );
    app.use(express.json());
    app.use(sessionAuth(redis));
    app.use(async (_req, res, next) => {
        try {
            const runtime = loadNodeRuntimeConfig();
            const status = await getConsistencyStatus();
            res.setHeader('X-Alcheme-Node-Role', runtime.runtimeRole);
            res.setHeader('X-Alcheme-Deployment-Profile', runtime.deploymentProfile);
            res.setHeader('X-Alcheme-Indexer-Id', status.indexerId);
            res.setHeader('X-Alcheme-Read-Commitment', status.readCommitment);
            res.setHeader('X-Alcheme-Indexed-Slot', String(status.indexedSlot));
            res.setHeader('X-Alcheme-Consistency-Stale', status.stale ? '1' : '0');
            if (status.settlement) {
                res.setHeader('X-Alcheme-Settlement-Adapter', status.settlement.adapterId);
                res.setHeader('X-Alcheme-Settlement-Chain-Family', status.settlement.chainFamily);
            }
        } catch (error) {
            console.warn('Failed to attach consistency headers:', error);
        }
        next();
    });
    app.use(requestLogger);

    app.get('/health', async (_req, res) => {
        try {
            await prisma.$queryRaw`SELECT 1`;
            await redis.ping();
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                services: {
                    database: 'up',
                    redis: 'up',
                },
            });
        } catch (error) {
            res.status(503).json({
                status: 'unhealthy',
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    });

    app.get('/sync/status', async (_req, res) => {
        try {
            const status = await getConsistencyStatus(true);
            res.json(status);
        } catch (error) {
            res.status(503).json({
                error: 'sync_status_unavailable',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    });

    app.use('/api/v1', rateLimiter, restRouter(prisma, redis));

    const apolloServer = new ApolloServer({
        typeDefs,
        resolvers,
        context: ({ req }) => buildContext(req as any, prisma, redis),
        introspection: process.env.NODE_ENV !== 'production',
        formatError: (error) => {
            console.error('GraphQL Error:', error);
            return error;
        },
    });

    await apolloServer.start();
    apolloServer.applyMiddleware({
        app: app as any,
        path: '/graphql',
        cors: false,
    });

    app.use(errorHandler);

    return {
        app,
        prisma,
        redis,
        apolloServer,
        dispose: async () => {
            await apolloServer.stop();
            if (ownsRedis) {
                await redis.quit();
            }
        },
    };
}

import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import {
    authorizeDraftAction,
    parseAuthUserIdFromRequest,
} from '../services/membership/checks';
import { computePolicyProfileDigest } from '../services/policy/digest';
import { resolveDraftWorkflowPermission } from '../services/policy/draftWorkflowPermissions';
import { resolveDraftLifecycleReadModel } from '../services/draftLifecycle/readModel';
import {
    buildPublicPolicyDigestSnapshot,
    resolveCirclePolicyProfile,
} from '../services/policy/profile';
import {
    inferStorageProvider,
    normalizeStorageUri,
    normalizeString,
    sha256Hex,
} from '../services/sourceMaterials/uploadBridge';
import {
    buildPrivateTextLocator,
    storePrivateText,
} from '../services/privateContentBridge';

const MAX_TITLE_LENGTH = 256;
const MAX_DOCUMENT_LENGTH = 50_000;

type StorageUploadConfig =
    | {
        // External mode keeps the existing bridge contract:
        // query-api forwards the finalized crystallization document to an
        // upstream upload service, and that service must return a usable
        // public URI/CID (preferably ipfs://...).
        mode: 'external';
        endpoint: string;
        bearerToken: string | null;
    }
    | {
        // Local mode is a development/self-hosted fallback:
        // query-api stores the finalized draft document in its own private
        // content store and synthesizes an IPFS-shaped URI so the rest of the
        // crystallization pipeline can continue without an external bridge.
        // This is intended for local/dev environments, not as the final public
        // publishing path for production knowledge artifacts.
        mode: 'local';
    };

class StorageUploadError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = 'StorageUploadError';
    }
}

function loadStorageUploadConfig(): StorageUploadConfig {
    const endpoint = normalizeString(process.env.STORAGE_UPLOAD_ENDPOINT);
    if (endpoint) {
        return {
            mode: 'external',
            endpoint,
            bearerToken: normalizeString(process.env.STORAGE_UPLOAD_BEARER_TOKEN) || null,
        };
    }

    // STORAGE_UPLOAD_MODE only matters when STORAGE_UPLOAD_ENDPOINT is absent.
    // That lets production/staging keep a real external bridge while local dev
    // can fall back to internal storage without changing the rest of the flow.
    const mode = normalizeString(process.env.STORAGE_UPLOAD_MODE).toLowerCase();
    if (mode === 'local') {
        return { mode: 'local' };
    }

    throw new StorageUploadError(
        503,
        'storage_provider_unavailable',
        'storage upload endpoint is not configured',
    );
}

function resolveStorageUri(payload: any): string | null {
    return (
        normalizeStorageUri(payload?.uri)
        || normalizeStorageUri(payload?.url)
        || normalizeStorageUri(payload?.cid)
        || normalizeStorageUri(payload?.ipfsCid)
        || normalizeStorageUri(payload?.IpfsHash)
        || null
    );
}

async function uploadDraftDocument(input: {
    config: StorageUploadConfig;
    postId: number;
    circleId: number;
    title: string;
    document: string;
}): Promise<{ uri: string; storageProvider: string }> {
    if (input.config.mode === 'local') {
        const digest = sha256Hex(input.document);
        const locator = buildPrivateTextLocator(
            'draft-crystallization',
            'final-document',
            String(input.postId),
            digest,
        );
        await storePrivateText({
            locator,
            content: input.document,
        });
        return {
            // Local mode keeps development self-contained while still producing
            // an IPFS-shaped URI that the existing crystallization pipeline
            // accepts. This URI is only a dev/runtime placeholder unless an
            // external bridge later republishes the document to real IPFS.
            uri: `ipfs://local-draft-${digest}`,
            storageProvider: 'local',
        };
    }

    const response = await fetch(input.config.endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(input.config.bearerToken ? { Authorization: `Bearer ${input.config.bearerToken}` } : {}),
        },
        body: JSON.stringify({
            kind: 'draft_crystallization_document',
            draftPostId: input.postId,
            circleId: input.circleId,
            title: input.title,
            filename: `alcheme-draft-${input.postId}.json`,
            contentType: 'application/json; charset=utf-8',
            document: input.document,
        }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const message = normalizeString(payload?.error || payload?.message) || `storage upstream failed: ${response.status}`;
        throw new StorageUploadError(502, 'storage_upload_failed', message);
    }

    const uri = resolveStorageUri(payload);
    if (!uri) {
        throw new StorageUploadError(
            502,
            'storage_upload_invalid_response',
            'storage upstream did not return a usable URI',
        );
    }

    return {
        uri,
        storageProvider: inferStorageProvider(uri),
    };
}

export function storageRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    router.post('/drafts/:postId/final-document', async (req, res, next) => {
        try {
            const postId = Number.parseInt(String(req.params.postId || ''), 10);
            if (!Number.isFinite(postId) || postId <= 0) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }

            const title = normalizeString(req.body?.title);
            if (!title) {
                return res.status(400).json({ error: 'missing_title' });
            }
            if (title.length > MAX_TITLE_LENGTH) {
                return res.status(400).json({ error: 'title_too_long', maxLength: MAX_TITLE_LENGTH });
            }

            const document = typeof req.body?.document === 'string' ? req.body.document : '';
            if (!document.trim()) {
                return res.status(400).json({ error: 'empty_document' });
            }
            if (document.length > MAX_DOCUMENT_LENGTH) {
                return res.status(400).json({ error: 'document_too_long', maxLength: MAX_DOCUMENT_LENGTH });
            }

            const authUserId = parseAuthUserIdFromRequest(req);
            const access = await authorizeDraftAction(prisma, {
                postId,
                userId: authUserId,
                action: 'read',
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            const circleId = access.post?.circleId;
            if (!Number.isFinite(circleId) || !circleId || circleId <= 0) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'draft must be circle-bound before crystallization upload',
                });
            }
            if (!authUserId) {
                return res.status(401).json({
                    error: 'authentication_required',
                    message: 'authentication is required',
                });
            }
            const permission = await resolveDraftWorkflowPermission(prisma as PrismaClient, {
                circleId,
                userId: authUserId,
                action: 'enter_crystallization',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_crystallize_permission_denied',
                    message: permission.reason,
                });
            }
            const lifecycle = await resolveDraftLifecycleReadModel(prisma, {
                draftPostId: postId,
            });
            if (lifecycle.documentStatus !== 'crystallization_active') {
                return res.status(409).json({
                    error: 'draft_not_ready_for_crystallization_execution',
                    message: '请先发起结晶，进入结晶阶段后再执行结晶。',
                });
            }

            const config = loadStorageUploadConfig();
            const uploaded = await uploadDraftDocument({
                config,
                postId,
                circleId,
                title,
                document,
            });
            const policyProfileDigest = computePolicyProfileDigest(
                buildPublicPolicyDigestSnapshot(
                    await resolveCirclePolicyProfile(prisma, circleId),
                ),
            );

            return res.json({
                ok: true,
                draftPostId: postId,
                circleId,
                uri: uploaded.uri,
                storageProvider: uploaded.storageProvider,
                policyProfileDigest,
            });
        } catch (error) {
            if (error instanceof StorageUploadError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            next(error);
        }
    });

    return router;
}

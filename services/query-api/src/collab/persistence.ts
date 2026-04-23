/**
 * Collaborative Editing — y-leveldb Persistence
 *
 * Configures Yjs persistence with an explicit plaintext storage policy.
 * - trusted_private: local LevelDB-backed persistence
 * - ephemeral_public: in-process runtime cache only
 * - external_service: query-api does not own collab plaintext persistence
 */

import { LeveldbPersistence } from 'y-leveldb';
import path from 'path';
import * as Y from 'yjs';
import { loadNodeRuntimeConfig } from '../config/services';

const PERSISTENCE_DIR = process.env.COLLAB_PERSISTENCE_DIR
    || path.join(process.cwd(), '.collab-data');

export type CollabStoragePolicy = 'trusted_private' | 'ephemeral_public' | 'external_service';

export interface CollabStorageInfo {
    storagePolicy: CollabStoragePolicy;
    persistentPlaintext: boolean;
    persistenceBackend: 'leveldb' | 'runtime_memory' | 'external';
}

interface CollabPersistenceProvider {
    getYDoc(docName: string): Promise<Y.Doc>;
    storeUpdate(docName: string, update: Uint8Array): Promise<void>;
    destroy(): Promise<void>;
}

class EphemeralCollabPersistence implements CollabPersistenceProvider {
    private readonly docs = new Map<string, Y.Doc>();

    async getYDoc(docName: string): Promise<Y.Doc> {
        let doc = this.docs.get(docName);
        if (!doc) {
            doc = new Y.Doc();
            this.docs.set(docName, doc);
        }
        return doc;
    }

    async storeUpdate(docName: string, update: Uint8Array): Promise<void> {
        if (update.byteLength === 0) return;
        const doc = await this.getYDoc(docName);
        Y.applyUpdate(doc, update);
    }

    async destroy(): Promise<void> {
        for (const doc of this.docs.values()) {
            doc.destroy();
        }
        this.docs.clear();
    }
}

type CollabPersistenceInstance = LeveldbPersistence | EphemeralCollabPersistence;

let persistence: CollabPersistenceInstance | null = null;

function normalizeCollabStoragePolicy(raw: string | undefined): Exclude<CollabStoragePolicy, 'external_service'> {
    const normalized = String(raw || 'trusted_private').trim().toLowerCase();
    return normalized === 'ephemeral_public' ? 'ephemeral_public' : 'trusted_private';
}

export function getConfiguredCollabStorageInfo(): CollabStorageInfo {
    const runtime = loadNodeRuntimeConfig();
    const collabMode = String(process.env.COLLAB_MODE || 'builtin').trim().toLowerCase();
    if (collabMode === 'external') {
        return {
            storagePolicy: 'external_service',
            persistentPlaintext: false,
            persistenceBackend: 'external',
        };
    }

    const storagePolicy = runtime.runtimeRole === 'PUBLIC_NODE'
        ? 'ephemeral_public'
        : normalizeCollabStoragePolicy(process.env.COLLAB_STORAGE_POLICY);
    return {
        storagePolicy,
        persistentPlaintext: storagePolicy === 'trusted_private',
        persistenceBackend: storagePolicy === 'trusted_private' ? 'leveldb' : 'runtime_memory',
    };
}

/**
 * Get or create the LevelDB persistence instance.
 */
export function getPersistence(): CollabPersistenceProvider {
    if (!persistence) {
        const storage = getConfiguredCollabStorageInfo();
        if (storage.storagePolicy === 'trusted_private') {
            persistence = new LeveldbPersistence(PERSISTENCE_DIR);
            console.log(`📁 Collab persistence: trusted_private (${PERSISTENCE_DIR})`);
        } else {
            persistence = new EphemeralCollabPersistence();
            console.log(`📁 Collab persistence: ${storage.storagePolicy} (runtime cache only)`);
        }
    }
    return persistence;
}

/**
 * Destroy the persistence instance (for cleanup/shutdown).
 */
export async function closePersistence(): Promise<void> {
    if (persistence) {
        await persistence.destroy();
        persistence = null;
        console.log('📁 Collab persistence closed');
    }
}

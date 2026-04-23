import { afterEach, describe, expect, jest, test } from '@jest/globals';
import * as Y from 'yjs';
import {
    closePersistence,
    getConfiguredCollabStorageInfo,
    getPersistence,
} from '../persistence';

const ORIGINAL_COLLAB_MODE = process.env.COLLAB_MODE;
const ORIGINAL_COLLAB_STORAGE_POLICY = process.env.COLLAB_STORAGE_POLICY;
const ORIGINAL_COLLAB_PERSISTENCE_DIR = process.env.COLLAB_PERSISTENCE_DIR;

afterEach(async () => {
    if (ORIGINAL_COLLAB_MODE === undefined) {
        delete process.env.COLLAB_MODE;
    } else {
        process.env.COLLAB_MODE = ORIGINAL_COLLAB_MODE;
    }

    if (ORIGINAL_COLLAB_STORAGE_POLICY === undefined) {
        delete process.env.COLLAB_STORAGE_POLICY;
    } else {
        process.env.COLLAB_STORAGE_POLICY = ORIGINAL_COLLAB_STORAGE_POLICY;
    }

    if (ORIGINAL_COLLAB_PERSISTENCE_DIR === undefined) {
        delete process.env.COLLAB_PERSISTENCE_DIR;
    } else {
        process.env.COLLAB_PERSISTENCE_DIR = ORIGINAL_COLLAB_PERSISTENCE_DIR;
    }

    await closePersistence();
});

describe('collab persistence storage policy', () => {
    test('ephemeral_public avoids persistent plaintext storage while keeping runtime cache in-process', async () => {
        process.env.COLLAB_MODE = 'builtin';
        process.env.COLLAB_STORAGE_POLICY = 'ephemeral_public';

        expect(getConfiguredCollabStorageInfo()).toMatchObject({
            storagePolicy: 'ephemeral_public',
            persistentPlaintext: false,
            persistenceBackend: 'runtime_memory',
        });

        const provider = getPersistence();
        const updateDoc = new Y.Doc();
        updateDoc.getMap('content').set('body', 'ephemeral runtime text');

        await provider.storeUpdate('crucible-42', Y.encodeStateAsUpdate(updateDoc));

        const restored = await provider.getYDoc('crucible-42');
        expect(restored.getMap('content').get('body')).toBe('ephemeral runtime text');
    });

    test('external collab mode reports no local plaintext custody', async () => {
        process.env.COLLAB_MODE = 'external';

        expect(getConfiguredCollabStorageInfo()).toMatchObject({
            storagePolicy: 'external_service',
            persistentPlaintext: false,
            persistenceBackend: 'external',
        });
    });
});

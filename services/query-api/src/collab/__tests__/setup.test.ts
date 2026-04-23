import { EventEmitter } from 'events';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { setupCollaboration, shutdownCollaboration } from '../setup';

const ORIGINAL_RUNTIME_ROLE = process.env.QUERY_API_RUNTIME_ROLE;
const ORIGINAL_DEPLOYMENT_PROFILE = process.env.QUERY_API_DEPLOYMENT_PROFILE;

function createMockServer() {
    const emitter = new EventEmitter();
    return {
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
    };
}

function createMockSocket() {
    return {
        write: jest.fn(),
        destroy: jest.fn(),
    };
}

afterEach(async () => {
    if (ORIGINAL_RUNTIME_ROLE === undefined) {
        delete process.env.QUERY_API_RUNTIME_ROLE;
    } else {
        process.env.QUERY_API_RUNTIME_ROLE = ORIGINAL_RUNTIME_ROLE;
    }

    if (ORIGINAL_DEPLOYMENT_PROFILE === undefined) {
        delete process.env.QUERY_API_DEPLOYMENT_PROFILE;
    } else {
        process.env.QUERY_API_DEPLOYMENT_PROFILE = ORIGINAL_DEPLOYMENT_PROFILE;
    }

    await shutdownCollaboration();
    jest.clearAllMocks();
});

describe('collab runtime setup', () => {
    test('public node rejects collab upgrades instead of serving sidecar-owned runtime state', () => {
        process.env.QUERY_API_RUNTIME_ROLE = 'PUBLIC_NODE';
        process.env.QUERY_API_DEPLOYMENT_PROFILE = 'public_node_only';

        const server = createMockServer();
        const socket = createMockSocket();

        setupCollaboration(server as any, {} as any, {} as any);
        server.emit('upgrade', { url: '/collab/crucible-42' }, socket, Buffer.alloc(0));

        expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('HTTP/1.1 409 Conflict'));
        expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('"error":"private_sidecar_required"'));
        expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('"route":"collab"'));
        expect(socket.destroy).toHaveBeenCalled();
    });
});

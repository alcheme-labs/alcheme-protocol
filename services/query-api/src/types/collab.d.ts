// Type declarations for y-websocket
declare module 'y-websocket/bin/utils' {
    import { WebSocket } from 'ws';
    import { IncomingMessage } from 'http';
    import * as Y from 'yjs';

    interface SetupWSConnectionOpts {
        docName?: string;
        gc?: boolean;
    }

    interface PersistenceAdapter {
        provider: unknown;
        bindState: (docName: string, ydoc: Y.Doc) => Promise<void> | void;
        writeState: (docName: string, ydoc: Y.Doc) => Promise<void> | void;
    }

    export function setupWSConnection(
        conn: WebSocket,
        req: IncomingMessage,
        opts?: SetupWSConnectionOpts,
    ): void;
    export function setPersistence(persistence: PersistenceAdapter | null): void;
    export const docs: Map<string, Y.Doc>;
}

// Type declarations for y-leveldb
declare module 'y-leveldb' {
    import * as Y from 'yjs';

    export class LeveldbPersistence {
        constructor(dir: string);
        getYDoc(docName: string): Promise<Y.Doc>;
        storeUpdate(docName: string, update: Uint8Array): Promise<void>;
        getStateVector(docName: string): Promise<Uint8Array>;
        clearDocument(docName: string): Promise<void>;
        destroy(): Promise<void>;
    }
}

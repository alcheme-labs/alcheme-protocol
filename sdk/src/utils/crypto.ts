import { createHash } from "crypto";
import { Buffer } from "buffer";

/**
 * Calculate SHA-256 hash of content for integrity verification
 */
export class ContentHasher {
    static async calculateHash(text: string, mediaFiles: (File | Buffer)[] = []): Promise<Uint8Array> {
        // In a browser environment, we might need to use SubtleCrypto
        if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
            return this.calculateHashBrowser(text, mediaFiles);
        }
        
        // Node.js environment
        return this.calculateHashNode(text, mediaFiles);
    }

    private static async calculateHashBrowser(text: string, mediaFiles: (File | Buffer)[]): Promise<Uint8Array> {
        const encoder = new TextEncoder();
        const parts: Uint8Array[] = [];
        
        // 1. Add text content
        parts.push(encoder.encode(text));
        
        // 2. Add media content
        for (const file of mediaFiles) {
            if (file instanceof File) {
                const buffer = await file.arrayBuffer();
                parts.push(new Uint8Array(buffer));
            } else if (Buffer.isBuffer(file)) {
                parts.push(new Uint8Array(file));
            }
        }
        
        // Concatenate all parts
        const totalLength = parts.reduce((acc, part) => acc + part.length, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const part of parts) {
            combined.set(part, offset);
            offset += part.length;
        }
        
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', combined);
        return new Uint8Array(hashBuffer);
    }

    private static async calculateHashNode(text: string, mediaFiles: (File | Buffer)[]): Promise<Uint8Array> {
        const hash = createHash('sha256');
        
        hash.update(text);
        
        for (const file of mediaFiles) {
            if (Buffer.isBuffer(file)) {
                hash.update(file);
            } else {
                // Handle File object in Node env (if polyfilled) or ignore
                // In real implementation, we might need to read stream
            }
        }
        
        return new Uint8Array(hash.digest());
    }
}


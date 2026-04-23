import { describe, expect, test } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

import { resolvers } from '../resolvers';

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.join(ROOT, 'schema.ts');

function read(filePath: string): string {
    return fs.readFileSync(filePath, 'utf8');
}

describe('Task7 RED: GraphQL post v2 audience fields', () => {
    test('Post schema exposes raw audience fields and circle authority mapping', () => {
        const schemaSource = read(SCHEMA_PATH);

        expect(schemaSource).toMatch(/v2AudienceKind:\s*String/);
        expect(schemaSource).toMatch(/v2AudienceRef:\s*Int/);
        expect(schemaSource).toMatch(/protocolCircleId:\s*Int/);
        expect(schemaSource).toMatch(/circleOnChainAddress:\s*String/);
    });

    test('Post resolvers return raw audience fields without guessing circle semantics from visibility alone', async () => {
        const post = {
            visibility: 'CircleOnly',
            v2VisibilityLevel: 'CircleOnly',
            v2AudienceKind: 'CircleOnly',
            v2AudienceRef: 7,
            circleId: 12,
            circle: {
                id: 12,
                onChainAddress: 'circle-pda-12',
            },
        };

        expect((resolvers as any).Post.v2AudienceKind(post)).toBe('CircleOnly');
        expect((resolvers as any).Post.v2AudienceRef(post)).toBe(7);
        expect((resolvers as any).Post.protocolCircleId(post)).toBe(12);
        await expect((resolvers as any).Post.circleOnChainAddress(post, {}, { prisma: {} })).resolves.toBe('circle-pda-12');
    });
});

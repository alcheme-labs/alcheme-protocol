import { describe, expect, test } from '@jest/globals';
import { print } from 'graphql';

import { typeDefs } from '../src/graphql/schema';
import { resolvers } from '../src/graphql/resolvers';

describe('GraphQL baseline smoke', () => {
    test('schema exposes the current code-truth entrypoints', () => {
        const schemaSource = print(typeDefs);

        expect(schemaSource).toContain('user(handle: String!)');
        expect(schemaSource).toContain('post(contentId: String!)');
        expect(schemaSource).toContain('feed(limit: Int = 20, offset: Int = 0');
        expect(schemaSource).toContain('memberProfile(circleId: Int!, userId: Int!)');
        expect(schemaSource).toContain('versionDiff(fromVersion: Int!, toVersion: Int!): KnowledgeVersionDiff');
        expect(schemaSource).toContain('generateGhostDraft(input: GenerateGhostDraftInput!)');
        expect(schemaSource).toContain('displayTitle: String!');
        expect(schemaSource).toContain('displayBody: String');
        expect(schemaSource).not.toContain('generateGhostDraft(postId: Int!): GhostDraftResult!');
        expect(schemaSource).not.toContain('scorePost(postId: Int!): ScoringResult!');
    });

    test('resolver map still exports the core query and mutation surfaces', () => {
        expect(typeof (resolvers as any).Query.user).toBe('function');
        expect(typeof (resolvers as any).Query.post).toBe('function');
        expect(typeof (resolvers as any).Query.feed).toBe('function');
        expect(typeof (resolvers as any).Query.memberProfile).toBe('function');
        expect(typeof (resolvers as any).Knowledge.versionDiff).toBe('function');
        expect(typeof (resolvers as any).Mutation.generateGhostDraft).toBe('function');
        expect((resolvers as any).Mutation.scorePost).toBeUndefined();
    });
});

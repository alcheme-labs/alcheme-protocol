import { describe, expect, test } from '@jest/globals';
import { Prisma } from '@prisma/client';

function getCircleDiscussionMessageFieldNames(): string[] {
    const model = Prisma.dmmf.datamodel.models.find((entry) => entry.name === 'CircleDiscussionMessage');
    if (!model) {
        throw new Error('CircleDiscussionMessage model not found in Prisma DMMF');
    }
    return model.fields.map((field) => field.name);
}

describe('discussion forward schema contract', () => {
    test('CircleDiscussionMessage model exposes forward-card fields', () => {
        const fields = getCircleDiscussionMessageFieldNames();

        expect(fields).toContain('subjectType');
        expect(fields).toContain('subjectId');
        expect(fields).toContain('messageKind');
        expect(fields).toContain('metadata');
        expect(fields).toContain('isEphemeral');
        expect(fields).toContain('expiresAt');
    });
});

import { MemberRole } from '@prisma/client';
import {
    normalizeManagedMemberRole,
    validateCircleMemberRemoval,
    validateCircleMemberRoleChange,
} from '../governance';

describe('membership governance helpers', () => {
    test('normalizes supported managed member roles', () => {
        expect(normalizeManagedMemberRole('member')).toBe(MemberRole.Member);
        expect(normalizeManagedMemberRole('moderator')).toBe(MemberRole.Moderator);
        expect(normalizeManagedMemberRole('curator')).toBe(MemberRole.Moderator);
        expect(normalizeManagedMemberRole('admin')).toBeNull();
    });

    test('rejects role changes for protected roles', () => {
        const result = validateCircleMemberRoleChange({
            actorUserId: 10,
            targetUserId: 11,
            actorIsOwner: true,
            targetRole: MemberRole.Admin,
            nextRole: MemberRole.Member,
        });
        expect(result.allowed).toBe(false);
        expect(result.error).toBe('protected_member_role');
    });

    test('allows owner to promote member to moderator', () => {
        const result = validateCircleMemberRoleChange({
            actorUserId: 10,
            targetUserId: 11,
            actorIsOwner: true,
            targetRole: MemberRole.Member,
            nextRole: MemberRole.Moderator,
        });
        expect(result).toMatchObject({
            allowed: true,
            statusCode: 200,
            error: 'ok',
        });
    });

    test('rejects self removal in managed removal flow', () => {
        const result = validateCircleMemberRemoval({
            actorUserId: 10,
            targetUserId: 10,
            actorIsOwner: true,
            targetRole: MemberRole.Member,
        });
        expect(result.allowed).toBe(false);
        expect(result.error).toBe('self_removal_not_supported');
    });
});

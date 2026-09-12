import type { PrismaClient } from '@prisma/client';

import {
    verifyChainAccountAddress,
    verifyCircleAccountAddress,
    verifyCircleMemberAccountAddress,
    verifyIdentityAccount,
    type ChainAccountVerification,
    type ChainPresenceReason,
    type IdentityAccountVerification,
} from '../chain/accountPresence';

export type ChainProjectionAuditIssueCode =
    | 'identity_account_missing'
    | 'identity_handle_mismatch'
    | 'identity_pubkey_mismatch'
    | 'identity_decode_failed'
    | 'identity_registry_missing'
    | 'circle_account_missing'
    | 'circle_address_invalid'
    | 'member_fallback_address'
    | 'member_account_missing'
    | 'member_address_invalid'
    | 'knowledge_fallback_address'
    | 'knowledge_account_missing'
    | 'knowledge_address_invalid'
    | 'relationship_label_catalog_empty'
    | 'relationship_assignment_missing'
    | 'chain_lookup_unavailable';

export const CHAIN_PROJECTION_AUDIT_MODEL_OWNERSHIP_SCOPE = [
    {
        model: 'KnowledgeRelationshipLabel',
        owner: 'system_catalog',
    },
    {
        model: 'KnowledgeRelationshipAssignment',
        owner: 'read_model_metadata',
    },
] as const;

export type ChainProjectionAuditSeverity = 'error' | 'warning';
export type ChainProjectionAuditEntityType =
    | 'user'
    | 'circle'
    | 'circle_member'
    | 'knowledge'
    | 'system_catalog';

export interface ChainProjectionAuditIssue {
    code: ChainProjectionAuditIssueCode;
    severity: ChainProjectionAuditSeverity;
    entityType: ChainProjectionAuditEntityType;
    entityId: string;
    userId?: number;
    circleId?: number;
    reason: ChainPresenceReason;
    recoverable: boolean;
    message: string;
    refs: {
        handle?: string;
        pubkey?: string | null;
        chainAddress?: string | null;
        accountAddress?: string | null;
        role?: string;
    };
}

export interface ChainProjectionAuditIssueCounts {
    total: number;
    bySeverity: Record<ChainProjectionAuditSeverity, number>;
    byCode: Partial<Record<ChainProjectionAuditIssueCode, number>>;
}

export interface ChainProjectionAuditReport {
    generatedAt: string;
    scanned: {
        users: number;
        activeCircles: number;
        activeMemberships: number;
        knowledge: number;
        relationshipLabels: number;
        relationshipAssignments: number;
    };
    issueCounts: ChainProjectionAuditIssueCounts;
    issues: ChainProjectionAuditIssue[];
    truncated: boolean;
    limit: number;
    filters: {
        circleId: number | null;
    };
    authSplitRisk: boolean;
    diagnosis: string[];
}

export interface ChainProjectionAuditAggregate {
    generatedAt: string;
    scanned: ChainProjectionAuditReport['scanned'];
    issueCounts: ChainProjectionAuditIssueCounts;
    truncated: boolean;
    limit: number;
    filters: ChainProjectionAuditReport['filters'];
    authSplitRisk: boolean;
    diagnosis: string[];
}

export interface ChainProjectionAuditVerifier {
    verifyIdentityAccount(input: {
        handle: string;
        expectedPubkey?: string | null;
    }): Promise<IdentityAccountVerification>;
    verifyCircleAccountAddress(input: {
        address: string | null | undefined;
    }): Promise<ChainAccountVerification>;
    verifyCircleMemberAccountAddress(input: {
        address: string | null | undefined;
    }): Promise<ChainAccountVerification>;
    verifyKnowledgeAccountAddress(input: {
        address: string | null | undefined;
    }): Promise<ChainAccountVerification>;
}

export interface ChainProjectionAuditOptions {
    circleId?: number | null;
    limit?: number;
    includeSensitiveRefs?: boolean;
    verifier?: Partial<ChainProjectionAuditVerifier>;
    now?: Date;
}

const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 1000;

const defaultVerifier: ChainProjectionAuditVerifier = {
    verifyIdentityAccount,
    verifyCircleAccountAddress,
    verifyCircleMemberAccountAddress,
    verifyKnowledgeAccountAddress: verifyChainAccountAddress,
};

function clampLimit(value: number | null | undefined): number {
    if (!Number.isFinite(value) || !value || value <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.trunc(value), MAX_LIMIT);
}

function maskSensitiveRef(value: string | null | undefined, includeSensitiveRefs: boolean): string | null {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) return null;
    if (includeSensitiveRefs) return trimmed;
    if (trimmed.length <= 10) return '[redacted]';
    return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function issueCounts(issues: ChainProjectionAuditIssue[]): ChainProjectionAuditIssueCounts {
    const counts: ChainProjectionAuditIssueCounts = {
        total: issues.length,
        bySeverity: {
            error: 0,
            warning: 0,
        },
        byCode: {},
    };

    for (const issue of issues) {
        counts.bySeverity[issue.severity] += 1;
        counts.byCode[issue.code] = (counts.byCode[issue.code] ?? 0) + 1;
    }

    return counts;
}

function isChainLookupUnavailable(reason: ChainPresenceReason): boolean {
    return reason === 'rpc_unconfigured'
        || reason === 'program_unconfigured'
        || reason === 'lookup_failed'
        || reason === 'identity_registry_missing';
}

function identityIssueCode(reason: ChainPresenceReason): ChainProjectionAuditIssueCode {
    if (reason === 'identity_handle_mismatch') return 'identity_handle_mismatch';
    if (reason === 'identity_pubkey_mismatch') return 'identity_pubkey_mismatch';
    if (reason === 'identity_decode_failed') return 'identity_decode_failed';
    if (reason === 'identity_registry_missing') return 'identity_registry_missing';
    if (isChainLookupUnavailable(reason)) return 'chain_lookup_unavailable';
    return 'identity_account_missing';
}

function circleIssueCode(reason: ChainPresenceReason): ChainProjectionAuditIssueCode {
    if (isChainLookupUnavailable(reason)) return 'chain_lookup_unavailable';
    if (reason === 'account_missing') return 'circle_account_missing';
    return 'circle_address_invalid';
}

function memberIssueCode(reason: ChainPresenceReason): ChainProjectionAuditIssueCode {
    if (isChainLookupUnavailable(reason)) return 'chain_lookup_unavailable';
    if (reason === 'synthetic_projection_address') return 'member_fallback_address';
    if (reason === 'account_missing') return 'member_account_missing';
    return 'member_address_invalid';
}

function knowledgeIssueCode(reason: ChainPresenceReason): ChainProjectionAuditIssueCode {
    if (isChainLookupUnavailable(reason)) return 'chain_lookup_unavailable';
    if (reason === 'synthetic_projection_address') return 'knowledge_fallback_address';
    if (reason === 'invalid_address') return 'knowledge_address_invalid';
    return 'knowledge_account_missing';
}

function severityFor(code: ChainProjectionAuditIssueCode): ChainProjectionAuditSeverity {
    return code === 'chain_lookup_unavailable' ? 'warning' : 'error';
}

function buildDiagnosis(issues: ChainProjectionAuditIssue[]): string[] {
    const codes = new Set(issues.map((issue) => issue.code));
    const diagnosis: string[] = [];

    if (
        codes.has('identity_account_missing')
        || codes.has('identity_handle_mismatch')
        || codes.has('identity_pubkey_mismatch')
        || codes.has('identity_decode_failed')
        || codes.has('identity_registry_missing')
    ) {
        diagnosis.push('identity projection mismatch can make AuthActor fail before circle permissions are evaluated');
    }
    if (codes.has('circle_account_missing') || codes.has('circle_address_invalid')) {
        diagnosis.push('circle projection mismatch can block circle write and management capabilities');
    }
    if (
        codes.has('member_fallback_address')
        || codes.has('member_account_missing')
        || codes.has('member_address_invalid')
    ) {
        diagnosis.push('member projection mismatch can explain legacy membership writes diverging from actor-based writes');
    }
    if (
        codes.has('knowledge_fallback_address')
        || codes.has('knowledge_account_missing')
        || codes.has('knowledge_address_invalid')
    ) {
        diagnosis.push('knowledge projection mismatch can make crystallization binding return knowledge_not_indexed');
    }
    if (codes.has('relationship_label_catalog_empty')) {
        diagnosis.push('knowledge relationship label catalog is missing, so indexer default assignment writes can fail or be skipped');
    }
    if (codes.has('relationship_assignment_missing')) {
        diagnosis.push('some knowledge rows are missing relationship assignment metadata; run system catalog repair/backfill');
    }
    if (codes.has('chain_lookup_unavailable')) {
        diagnosis.push('chain lookup was unavailable, so this audit cannot prove chain projection health');
    }

    return diagnosis;
}

function activeMembershipUsesCreatorProjection(row: {
    userId: number;
    circle: {
        creatorId: number;
    };
}): boolean {
    return row.circle.creatorId === row.userId;
}

export function toChainProjectionAuditAggregate(report: ChainProjectionAuditReport): ChainProjectionAuditAggregate {
    return {
        generatedAt: report.generatedAt,
        scanned: report.scanned,
        issueCounts: report.issueCounts,
        truncated: report.truncated,
        limit: report.limit,
        filters: report.filters,
        authSplitRisk: report.authSplitRisk,
        diagnosis: report.diagnosis,
    };
}

export async function auditChainProjectionConsistency(
    prisma: PrismaClient,
    options: ChainProjectionAuditOptions = {},
): Promise<ChainProjectionAuditReport> {
    const limit = clampLimit(options.limit);
    const take = limit + 1;
    const verifier: ChainProjectionAuditVerifier = {
        ...defaultVerifier,
        ...options.verifier,
    };
    const circleId = typeof options.circleId === 'number' && Number.isFinite(options.circleId)
        ? Math.trunc(options.circleId)
        : null;
    const includeSensitiveRefs = options.includeSensitiveRefs === true;

    const [
        rawUsers,
        rawCircles,
        rawMemberships,
        rawKnowledge,
        relationshipLabelCount,
        relationshipAssignmentCount,
    ] = await Promise.all([
        prisma.user.findMany({
            ...(circleId
                ? {
                    where: {
                        OR: [
                            {
                                circleMembers: {
                                    some: {
                                        circleId,
                                    },
                                },
                            },
                            {
                                createdCircles: {
                                    some: {
                                        id: circleId,
                                    },
                                },
                            },
                        ],
                    },
                }
                : {}),
            orderBy: { id: 'asc' },
            take,
            select: {
                id: true,
                handle: true,
                pubkey: true,
            },
        }),
        prisma.circle.findMany({
            where: {
                lifecycleStatus: 'Active',
                ...(circleId ? { id: circleId } : {}),
            },
            orderBy: { id: 'asc' },
            take,
            select: {
                id: true,
                creatorId: true,
                onChainAddress: true,
            },
        }),
        prisma.circleMember.findMany({
            where: {
                status: 'Active',
                ...(circleId ? { circleId } : {}),
            },
            orderBy: { id: 'asc' },
            take,
            select: {
                id: true,
                circleId: true,
                userId: true,
                role: true,
                status: true,
                onChainAddress: true,
                user: {
                    select: {
                        handle: true,
                        pubkey: true,
                    },
                },
                circle: {
                    select: {
                        creatorId: true,
                        lifecycleStatus: true,
                    },
                },
            },
        }),
        prisma.knowledge.findMany({
            where: circleId ? { circleId } : {},
            orderBy: { id: 'asc' },
            take,
            select: {
                id: true,
                knowledgeId: true,
                circleId: true,
                onChainAddress: true,
                relationshipAssignment: {
                    select: { knowledgeId: true },
                },
            },
        }),
        prisma.knowledgeRelationshipLabel.count(),
        prisma.knowledgeRelationshipAssignment.count(),
    ]);

    const truncated = rawUsers.length > limit
        || rawCircles.length > limit
        || rawMemberships.length > limit
        || rawKnowledge.length > limit;
    const users = rawUsers.slice(0, limit);
    const circles = rawCircles.slice(0, limit);
    const memberships = rawMemberships
        .slice(0, limit)
        .filter((row) => String(row.circle.lifecycleStatus) === 'Active');
    const knowledgeRows = rawKnowledge.slice(0, limit);
    const issues: ChainProjectionAuditIssue[] = [];

    for (const user of users) {
        const verification = await verifier.verifyIdentityAccount({
            handle: user.handle,
            expectedPubkey: user.pubkey,
        });
        if (verification.ok) continue;

        const code = identityIssueCode(verification.reason);
        issues.push({
            code,
            severity: severityFor(code),
            entityType: 'user',
            entityId: `user:${user.id}`,
            userId: user.id,
            reason: verification.reason,
            recoverable: verification.recoverable,
            message: verification.message,
            refs: {
                handle: user.handle,
                pubkey: maskSensitiveRef(user.pubkey, includeSensitiveRefs),
                accountAddress: maskSensitiveRef(verification.accountAddress, includeSensitiveRefs),
            },
        });
    }

    for (const circle of circles) {
        const verification = await verifier.verifyCircleAccountAddress({
            address: circle.onChainAddress,
        });
        if (verification.ok) continue;

        const code = circleIssueCode(verification.reason);
        issues.push({
            code,
            severity: severityFor(code),
            entityType: 'circle',
            entityId: `circle:${circle.id}`,
            userId: circle.creatorId,
            circleId: circle.id,
            reason: verification.reason,
            recoverable: verification.recoverable,
            message: verification.message,
            refs: {
                chainAddress: maskSensitiveRef(verification.accountAddress ?? circle.onChainAddress, includeSensitiveRefs),
            },
        });
    }

    for (const membership of memberships) {
        if (activeMembershipUsesCreatorProjection(membership)) continue;

        const verification = await verifier.verifyCircleMemberAccountAddress({
            address: membership.onChainAddress,
        });
        if (verification.ok) continue;

        const code = memberIssueCode(verification.reason);
        issues.push({
            code,
            severity: severityFor(code),
            entityType: 'circle_member',
            entityId: `circle_member:${membership.id}`,
            userId: membership.userId,
            circleId: membership.circleId,
            reason: verification.reason,
            recoverable: verification.recoverable,
            message: verification.message,
            refs: {
                handle: membership.user.handle,
                pubkey: maskSensitiveRef(membership.user.pubkey, includeSensitiveRefs),
                chainAddress: maskSensitiveRef(
                    verification.accountAddress ?? membership.onChainAddress,
                    includeSensitiveRefs,
                ),
                role: String(membership.role),
            },
        });
    }

    if (relationshipLabelCount === 0) {
        issues.push({
            code: 'relationship_label_catalog_empty',
            severity: 'error',
            entityType: 'system_catalog',
            entityId: 'knowledge_relationship_labels',
            reason: 'account_missing',
            recoverable: true,
            message: 'knowledge relationship label catalog is empty; system catalog bootstrap did not run or was truncated',
            refs: {},
        });
    }

    for (const knowledge of knowledgeRows) {
        const fallbackAddress = String(knowledge.knowledgeId || '').slice(0, 44);
        if (knowledge.onChainAddress === fallbackAddress) {
            issues.push({
                code: 'knowledge_fallback_address',
                severity: 'error',
                entityType: 'knowledge',
                entityId: `knowledge:${knowledge.id}`,
                circleId: knowledge.circleId,
                reason: 'synthetic_projection_address',
                recoverable: true,
                message: 'knowledge projection is stored under the fallback address instead of the on-chain account PDA',
                refs: {
                    chainAddress: maskSensitiveRef(knowledge.onChainAddress, includeSensitiveRefs),
                },
            });
        } else {
            const verification = await verifier.verifyKnowledgeAccountAddress({
                address: knowledge.onChainAddress,
            });
            if (!verification.ok) {
                const code = knowledgeIssueCode(verification.reason);
                issues.push({
                    code,
                    severity: severityFor(code),
                    entityType: 'knowledge',
                    entityId: `knowledge:${knowledge.id}`,
                    circleId: knowledge.circleId,
                    reason: verification.reason,
                    recoverable: verification.recoverable,
                    message: verification.message,
                    refs: {
                        chainAddress: maskSensitiveRef(
                            verification.accountAddress ?? knowledge.onChainAddress,
                            includeSensitiveRefs,
                        ),
                    },
                });
            }
        }

        if (!knowledge.relationshipAssignment) {
            issues.push({
                code: 'relationship_assignment_missing',
                severity: 'warning',
                entityType: 'knowledge',
                entityId: `knowledge:${knowledge.id}`,
                circleId: knowledge.circleId,
                reason: 'account_missing',
                recoverable: true,
                message: 'knowledge is missing default relationship assignment metadata',
                refs: {},
            });
        }
    }

    const counts = issueCounts(issues);
    const diagnosis = buildDiagnosis(issues);

    return {
        generatedAt: (options.now ?? new Date()).toISOString(),
        scanned: {
            users: users.length,
            activeCircles: circles.length,
            activeMemberships: memberships.length,
            knowledge: knowledgeRows.length,
            relationshipLabels: relationshipLabelCount,
            relationshipAssignments: relationshipAssignmentCount,
        },
        issueCounts: counts,
        issues,
        truncated,
        limit,
        filters: {
            circleId,
        },
        authSplitRisk: diagnosis.length > 0,
        diagnosis,
    };
}

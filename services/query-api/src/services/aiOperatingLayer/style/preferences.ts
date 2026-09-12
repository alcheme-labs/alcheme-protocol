import crypto from 'crypto';

import { evaluateAiPolicyGate } from '../policyGate';
import type { StyleAdvisorScope } from './types';
import { validateStylePreferencePayload } from './validator';

type ApplyScope = Extract<StyleAdvisorScope, 'personal' | 'circle'>;

export async function applyStylePreferenceFromProposal(
    prisma: any,
    input: {
        proposalId: string;
        actorUserId: number;
        scope: ApplyScope;
        circleId?: number | null;
    },
): Promise<{
    scope: ApplyScope;
    preference: any;
}> {
    const proposalId = String(input.proposalId || '').trim();
    if (!proposalId) {
        throw new Error('invalid_style_proposal_id');
    }
    const proposal = await prisma.aiProposalArtifact.findUnique({
        where: { id: proposalId },
    });
	    if (!proposal || proposal.taskType !== 'style.life_feel_advisor.v1') {
	        throw new Error('style_proposal_not_found');
	    }
	    if (input.scope === 'personal') {
	        if (proposal.subjectType !== 'style_user' || String(proposal.subjectId) !== String(input.actorUserId)) {
	            throw new Error('style_proposal_scope_mismatch');
	        }
	        if (Number(proposal.createdByUserId ?? 0) !== input.actorUserId) {
	            throw new Error('style_proposal_scope_mismatch');
	        }
	    } else {
        const proposalCircleId = Number(proposal.subjectId);
        const requestedCircleId = Number(input.circleId ?? proposal.subjectId);
        if (
            proposal.subjectType !== 'circle'
            || !Number.isFinite(proposalCircleId)
            || proposalCircleId <= 0
            || !Number.isFinite(requestedCircleId)
            || requestedCircleId <= 0
            || requestedCircleId !== proposalCircleId
        ) {
            throw new Error('style_proposal_scope_mismatch');
        }
    }

	    if (hasProposalValidationErrors(proposal)) {
	        throw new Error('invalid_style_preference:proposal_validation_errors');
	    }
	    if (!isApplicableStyleProposal(proposal, input.scope)) {
	        throw new Error('style_proposal_not_applicable');
	    }

    const policy = await evaluateAiPolicyGate({
        proposedAction: input.scope === 'circle'
            ? 'style.apply_to_circle_style'
            : 'style.apply_to_user_preferences',
        stage: 'apply',
    });
    if (policy.decision !== 'allow' || policy.applyBehavior !== 'domain_owned') {
        throw new Error(`style_apply_denied:${policy.reasonCode}`);
    }

    const validation = validateStylePreferencePayload({
        ...(proposal.proposedDiff && typeof proposal.proposedDiff === 'object'
            ? proposal.proposedDiff
            : {}),
        scope: input.scope,
    });
    if (!validation.ok) {
        throw new Error(`invalid_style_preference:${validation.validationErrors.map((error) => error.reasonCode).join(',')}`);
    }

    const payload = {
        scope: validation.preference.scope,
        tokenPolicyVersion: validation.preference.tokenPolicyVersion,
        tokenSelections: validation.preference.tokenSelections,
        lifeFeelInputs: validation.preference.lifeFeelInputs,
    };
    const now = new Date();
    const scopeCircleId = input.scope === 'circle'
        ? Number(input.circleId ?? proposal.subjectId)
        : null;
    const preference = await prisma.stylePreference.upsert({
        where: input.scope === 'personal'
            ? {
                personal_user_id_key: {
                    scopeType: 'personal',
                    userId: input.actorUserId,
                },
            }
            : {
                circle_scope_id_key: {
                    scopeType: 'circle',
                    circleId: scopeCircleId,
                },
            },
        create: {
            id: buildPreferenceId(input.scope, input.actorUserId, scopeCircleId),
            scopeType: input.scope,
            userId: input.scope === 'personal' ? input.actorUserId : null,
            circleId: scopeCircleId,
            status: 'active',
            preferencePayload: payload,
            sourceProposalId: proposalId,
            rollbackRef: digestJson(proposal.proposedDiff ?? {}),
            createdByUserId: input.actorUserId,
            updatedByUserId: input.actorUserId,
            createdAt: now,
            updatedAt: now,
        },
        update: {
            status: 'active',
            preferencePayload: payload,
            sourceProposalId: proposalId,
            rollbackRef: digestJson(proposal.proposedDiff ?? {}),
            updatedByUserId: input.actorUserId,
            updatedAt: now,
        },
    });

    await prisma.aiProposalArtifact.updateMany({
        where: { id: proposalId },
        data: {
            appliedByUserId: input.actorUserId,
            domainStatus: 'applied',
        },
    });
    await prisma.stylePreferenceEvent.create({
        data: {
            preferenceId: preference?.id ?? null,
            scopeType: input.scope,
            userId: input.scope === 'personal' ? input.actorUserId : null,
            circleId: scopeCircleId,
            actorUserId: input.actorUserId,
            eventType: input.scope === 'circle' ? 'circle_applied' : 'personal_applied',
            eventPayload: {
                proposalId,
                tokenPolicyVersion: payload.tokenPolicyVersion,
            },
        },
    });

    return {
        scope: input.scope,
        preference,
    };
}

export async function loadCurrentStylePreference(
    prisma: any,
    input: {
        scope: ApplyScope;
        actorUserId: number;
        circleId?: number | null;
    },
): Promise<any | null> {
    const rows = await prisma.stylePreference.findMany({
        where: input.scope === 'personal'
            ? {
                scopeType: 'personal',
                userId: input.actorUserId,
                status: 'active',
            }
            : {
                scopeType: 'circle',
                circleId: Number(input.circleId ?? 0),
                status: 'active',
            },
        orderBy: {
            updatedAt: 'desc',
        },
        take: 1,
    });
    return Array.isArray(rows) ? rows[0] ?? null : null;
}

export async function deleteStylePreferencesForActor(
    prisma: any,
    input: {
        actorUserId: number;
    },
): Promise<{
    deletedCount: number;
}> {
    const updated = await prisma.stylePreference.updateMany({
        where: {
            scopeType: 'personal',
            userId: input.actorUserId,
            status: 'active',
        },
        data: {
            status: 'reset',
            updatedByUserId: input.actorUserId,
            updatedAt: new Date(),
        },
    });
    const deletedCount = Number(updated?.count || 0);
    await prisma.stylePreferenceEvent.create({
        data: {
            preferenceId: null,
            scopeType: 'personal',
            userId: input.actorUserId,
            circleId: null,
            actorUserId: input.actorUserId,
            eventType: 'deleted',
            eventPayload: {
                deletedCount,
            },
        },
    });
    return { deletedCount };
}

export async function exportStylePreferencesForActor(
    prisma: any,
    input: {
        actorUserId: number;
    },
): Promise<{
    preferences: Array<Record<string, unknown>>;
}> {
    const rows = await prisma.stylePreference.findMany({
        where: {
            scopeType: 'personal',
            userId: input.actorUserId,
        },
        orderBy: {
            updatedAt: 'desc',
        },
    });
    await prisma.stylePreferenceEvent.create({
        data: {
            preferenceId: null,
            scopeType: 'personal',
            userId: input.actorUserId,
            circleId: null,
            actorUserId: input.actorUserId,
            eventType: 'exported',
            eventPayload: {
                exportedCount: Array.isArray(rows) ? rows.length : 0,
            },
        },
    });
    return {
        preferences: (Array.isArray(rows) ? rows : []).map(serializePreferenceRow),
    };
}

export async function resetCircleStylePreference(
    prisma: any,
    input: {
        actorUserId: number;
        circleId: number;
    },
): Promise<{
    resetCount: number;
}> {
    const updated = await prisma.stylePreference.updateMany({
        where: {
            scopeType: 'circle',
            circleId: input.circleId,
            status: 'active',
        },
        data: {
            status: 'reset',
            updatedByUserId: input.actorUserId,
            updatedAt: new Date(),
        },
    });
    const resetCount = Number(updated?.count || 0);
    await prisma.stylePreferenceEvent.create({
        data: {
            preferenceId: null,
            scopeType: 'circle',
            userId: null,
            circleId: input.circleId,
            actorUserId: input.actorUserId,
            eventType: 'reset',
            eventPayload: {
                resetCount,
            },
        },
    });
    return { resetCount };
}

function serializePreferenceRow(row: any): Record<string, unknown> {
    return {
        id: String(row.id || ''),
        scopeType: String(row.scopeType || ''),
        userId: row.userId ?? null,
        circleId: row.circleId ?? null,
        status: String(row.status || ''),
        preferencePayload: row.preferencePayload && typeof row.preferencePayload === 'object'
            ? row.preferencePayload
            : {},
        sourceProposalId: row.sourceProposalId ? String(row.sourceProposalId) : null,
        rollbackRef: row.rollbackRef ? String(row.rollbackRef) : null,
        createdAt: serializeDate(row.createdAt),
        updatedAt: serializeDate(row.updatedAt),
    };
}

function buildPreferenceId(scope: ApplyScope, actorUserId: number, circleId: number | null): string {
    return `style_pref_${digestJson({ scope, actorUserId, circleId }).slice(0, 24)}`;
}

function serializeDate(value: unknown): string | null {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' && value.trim()) return value;
    return null;
}

function digestJson(value: unknown): string {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(value))
        .digest('hex');
}

function hasProposalValidationErrors(proposal: any): boolean {
    if (Array.isArray(proposal?.validationErrors) && proposal.validationErrors.length > 0) {
        return true;
    }
    const proposedDiff = proposal?.proposedDiff && typeof proposal.proposedDiff === 'object'
        ? proposal.proposedDiff as Record<string, unknown>
        : {};
    return Array.isArray(proposedDiff.validationErrors) && proposedDiff.validationErrors.length > 0;
}

function isApplicableStyleProposal(proposal: any, scope: ApplyScope): boolean {
    const expectedAction = scope === 'circle'
        ? 'style.preview_circle_style'
        : 'style.preview_personal_preferences';
    if (proposal?.status !== 'ready') return false;
    if (proposal?.proposedAction !== expectedAction) return false;
    if (proposal?.rejectedByUserId !== null && proposal?.rejectedByUserId !== undefined) return false;
    if (proposal?.domainStatus !== null && proposal?.domainStatus !== undefined && proposal.domainStatus !== 'proposal_ready') {
        return false;
    }
    if (proposal?.expiresAt === null || proposal?.expiresAt === undefined) return true;
    const expiresAt = proposal.expiresAt instanceof Date
        ? proposal.expiresAt.getTime()
        : Date.parse(String(proposal.expiresAt));
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

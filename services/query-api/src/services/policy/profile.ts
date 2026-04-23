import {
    CircleType,
    JoinRequirement,
    Prisma,
    type PrismaClient,
} from '@prisma/client';
import { loadGhostConfig } from '../../ai/ghost/config';
import {
    loadCircleGhostSettingsPatch,
    resolveCircleGhostSettings,
} from '../../ai/ghost/circle-settings';
import { resolveCircleJoinPolicy } from '../membership/engine';
import { resolveProjectedCircleSettings } from './settingsEnvelope';
import type {
    BlockEditEligibilityPolicySnapshot,
    CirclePolicyProfile,
    DraftWorkflowPolicyPatch,
    DraftWorkflowPolicySnapshot,
    DraftLifecycleTemplatePatch,
    DraftGenerationPolicySnapshot,
    DraftLifecycleTemplateSnapshot,
    ForkPolicySnapshot,
    GhostPolicySnapshot,
    GovernanceRole,
    PolicyInheritanceMode,
    PolicyProfileSourceType,
    PublicPolicyDigestSnapshot,
} from './types';

interface CirclePolicyProfileRow {
    circleId: number;
    sourceType: string | null;
    inheritanceMode: string | null;
    inheritsFromProfileId: string | null;
    inheritsFromCircleId: number | null;
    draftGenerationPolicy: unknown;
    draftLifecycleTemplate: unknown;
    draftWorkflowPolicy: unknown;
    blockEditEligibilityPolicy: unknown;
    forkPolicy: unknown;
    ghostPolicy: unknown;
    localEditability: string | null;
    effectiveFrom: Date | null;
    resolvedFromProfileVersion: number | null;
    configVersion: number | null;
}

interface UpsertCircleDraftLifecycleTemplateInput {
    circleId: number;
    actorUserId: number;
    patch: DraftLifecycleTemplatePatch;
}

interface UpsertCircleDraftWorkflowPolicyInput {
    circleId: number;
    actorUserId: number;
    patch: DraftWorkflowPolicyPatch;
}

interface FallbackCircleSnapshot {
    id: number;
    level: number;
    parentCircleId: number | null;
    createdAt: Date;
    joinRequirement: string;
    circleType: string;
    minCrystals: number;
}

const DEFAULT_MANAGER_ROLES: GovernanceRole[] = ['Owner', 'Admin', 'Moderator'];
const DEFAULT_EFFECTIVE_MEMBER_ROLES: GovernanceRole[] = ['Member', 'Elder', ...DEFAULT_MANAGER_ROLES];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toRecord(value: unknown): Record<string, unknown> | null {
    if (isRecord(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return isRecord(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }
    return null;
}

function asNumber(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

function asOptionalNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') return true;
        if (normalized === 'false' || normalized === '0') return false;
    }
    return fallback;
}

function asDate(value: unknown, fallback: Date): Date {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        if (Number.isFinite(parsed.getTime())) return parsed;
    }
    return fallback;
}

function asOptionalString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function normalizeSourceType(raw: unknown, fallback: PolicyProfileSourceType): PolicyProfileSourceType {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'lv0_default') return 'lv0_default';
    if (value === 'circle_override') return 'circle_override';
    if (value === 'inherited_locked') return 'inherited_locked';
    if (value === 'inherited_editable') return 'inherited_editable';
    return fallback;
}

function normalizeInheritanceMode(raw: unknown, fallback: PolicyInheritanceMode): PolicyInheritanceMode {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'inherit_locked') return 'inherit_locked';
    if (value === 'inherit_but_editable') return 'inherit_but_editable';
    if (value === 'independent') return 'independent';
    return fallback;
}

function resolveLocalEditability(mode: PolicyInheritanceMode): 'locked' | 'editable' {
    return mode === 'inherit_locked' ? 'locked' : 'editable';
}

function fallbackSource(circle: FallbackCircleSnapshot): {
    sourceType: PolicyProfileSourceType;
    inheritanceMode: PolicyInheritanceMode;
    inheritsFromCircleId: number | null;
} {
    if (circle.level <= 0) {
        return {
            sourceType: 'lv0_default',
            inheritanceMode: 'independent',
            inheritsFromCircleId: null,
        };
    }

    if (circle.parentCircleId) {
        return {
            sourceType: 'inherited_editable',
            inheritanceMode: 'inherit_but_editable',
            inheritsFromCircleId: circle.parentCircleId,
        };
    }

    return {
        sourceType: 'circle_override',
        inheritanceMode: 'independent',
        inheritsFromCircleId: null,
    };
}

function normalizeJoinRequirement(raw: string): JoinRequirement {
    if (raw === JoinRequirement.ApprovalRequired) return JoinRequirement.ApprovalRequired;
    if (raw === JoinRequirement.TokenGated) return JoinRequirement.TokenGated;
    if (raw === JoinRequirement.InviteOnly) return JoinRequirement.InviteOnly;
    return JoinRequirement.Free;
}

function normalizeCircleType(raw: string): CircleType {
    if (raw === CircleType.Closed) return CircleType.Closed;
    if (raw === CircleType.Secret) return CircleType.Secret;
    return CircleType.Open;
}

export function buildDefaultLifecycleTemplate(): DraftLifecycleTemplateSnapshot {
    return {
        templateId: 'fast_deposition',
        draftGenerationVotingMinutes: 10,
        draftingWindowMinutes: 30,
        reviewWindowMinutes: 240,
        maxRevisionRounds: 1,
        reviewEntryMode: 'auto_or_manual',
    };
}

export function buildDefaultDraftWorkflowPolicy(): DraftWorkflowPolicySnapshot {
    return {
        createIssueMinRole: 'Member',
        followupIssueMinRole: 'Member',
        reviewIssueMinRole: 'Moderator',
        retagIssueMinRole: 'Moderator',
        applyIssueMinRole: 'Admin',
        manualEndDraftingMinRole: 'Moderator',
        advanceFromReviewMinRole: 'Admin',
        enterCrystallizationMinRole: 'Moderator',
        allowAuthorWithdrawBeforeReview: true,
        allowModeratorRetagIssue: true,
    };
}

function buildDefaultDraftGenerationPolicy(input: {
    allowGhostAutoDraft: boolean;
}): DraftGenerationPolicySnapshot {
    return {
        actionType: 'draft_generation',
        proposalMode: 'signal_based',
        electorateScope: 'discussion_participants_with_manager_guard',
        eligibleRoles: DEFAULT_EFFECTIVE_MEMBER_ROLES,
        voteRule: 'threshold_count',
        thresholdValue: 2,
        quorum: null,
        timeWindowMinutes: 10,
        managerConfirmationRequired: true,
        allowManualMultiSelectCandidate: true,
        allowGhostAutoDraft: input.allowGhostAutoDraft,
    };
}

function buildDefaultBlockEditEligibilityPolicy(): BlockEditEligibilityPolicySnapshot {
    return {
        mode: 'manager_or_contributor_or_temporary_editor',
        managerOverride: true,
        contributorEvidenceRequired: true,
    };
}

function buildDefaultForkPolicy(circle: FallbackCircleSnapshot): ForkPolicySnapshot {
    return {
        enabled: true,
        thresholdMode: 'contribution_threshold',
        minimumContributions: Math.max(1, Number.isFinite(circle.minCrystals) ? Math.floor(circle.minCrystals) : 1),
        minimumRole: 'Member',
        requiresGovernanceVote: false,
        inheritancePrefillSource: 'lv0_default_profile',
        knowledgeLineageInheritance: 'upstream_until_fork_node',
    };
}

function buildGhostPolicySnapshot(input: {
    summaryUseLLM: boolean;
    draftTriggerMode: 'notify_only' | 'auto_draft';
    triggerSummaryUseLLM: boolean;
    triggerGenerateComment: boolean;
}): GhostPolicySnapshot {
    return {
        summaryUseLLM: input.summaryUseLLM,
        draftTriggerMode: input.draftTriggerMode,
        triggerSummaryUseLLM: input.triggerSummaryUseLLM,
        triggerGenerateComment: input.triggerGenerateComment,
    };
}

function normalizeDraftGenerationPolicy(
    raw: unknown,
    fallback: DraftGenerationPolicySnapshot,
): DraftGenerationPolicySnapshot {
    const record = toRecord(raw);
    if (!record) return fallback;

    return {
        ...fallback,
        proposalMode: String(record.proposalMode || '').toLowerCase() === 'auto'
            ? 'auto'
            : String(record.proposalMode || '').toLowerCase() === 'manual'
                ? 'manual'
                : fallback.proposalMode,
        electorateScope: String(record.electorateScope || '').toLowerCase() === 'discussion_participants'
            ? 'discussion_participants'
            : String(record.electorateScope || '').toLowerCase() === 'all_active_members'
                ? 'all_active_members'
                : String(record.electorateScope || '').toLowerCase() === 'qualified_roles'
                    ? 'qualified_roles'
                    : String(record.electorateScope || '').toLowerCase() === 'contributors_of_current_draft'
                        ? 'contributors_of_current_draft'
                        : String(record.electorateScope || '').toLowerCase() === 'hybrid'
                            ? 'hybrid'
                            : fallback.electorateScope,
        voteRule: String(record.voteRule || '').toLowerCase() === 'single_approver'
            ? 'single_approver'
            : String(record.voteRule || '').toLowerCase() === 'majority_of_voters'
                ? 'majority_of_voters'
                : String(record.voteRule || '').toLowerCase() === 'majority_of_eligible'
                    ? 'majority_of_eligible'
                    : String(record.voteRule || '').toLowerCase() === 'unanimity'
                        ? 'unanimity'
                        : fallback.voteRule,
        thresholdValue: Math.max(1, Math.floor(asNumber(record.thresholdValue, fallback.thresholdValue))),
        quorum: asOptionalNumber(record.quorum),
        timeWindowMinutes: Math.max(1, Math.floor(asNumber(record.timeWindowMinutes, fallback.timeWindowMinutes))),
        managerConfirmationRequired: asBoolean(
            record.managerConfirmationRequired,
            fallback.managerConfirmationRequired,
        ),
        allowManualMultiSelectCandidate: asBoolean(
            record.allowManualMultiSelectCandidate,
            fallback.allowManualMultiSelectCandidate,
        ),
        allowGhostAutoDraft: asBoolean(record.allowGhostAutoDraft, fallback.allowGhostAutoDraft),
        eligibleRoles: Array.isArray(record.eligibleRoles)
            ? record.eligibleRoles
                .map((role) => String(role || '').trim())
                .filter((role): role is GovernanceRole => (
                    role === 'Owner'
                    || role === 'Admin'
                    || role === 'Moderator'
                    || role === 'Member'
                    || role === 'Elder'
                    || role === 'Initiate'
                ))
            : fallback.eligibleRoles,
    };
}

function normalizeLifecycleTemplate(
    raw: unknown,
    fallback: DraftLifecycleTemplateSnapshot,
): DraftLifecycleTemplateSnapshot {
    const record = toRecord(raw);
    if (!record) return fallback;
    const templateIdRaw = String(record.templateId || '').trim().toLowerCase();
    const templateId = templateIdRaw === 'standard_collaboration'
        ? 'standard_collaboration'
        : templateIdRaw === 'deep_research'
            ? 'deep_research'
            : fallback.templateId;

    return {
        templateId,
        draftGenerationVotingMinutes: Math.max(
            1,
            Math.floor(asNumber(record.draftGenerationVotingMinutes, fallback.draftGenerationVotingMinutes)),
        ),
        draftingWindowMinutes: Math.max(
            1,
            Math.floor(asNumber(record.draftingWindowMinutes, fallback.draftingWindowMinutes)),
        ),
        reviewWindowMinutes: Math.max(
            1,
            Math.floor(asNumber(record.reviewWindowMinutes, fallback.reviewWindowMinutes)),
        ),
        maxRevisionRounds: Math.max(1, Math.floor(asNumber(record.maxRevisionRounds, fallback.maxRevisionRounds))),
        reviewEntryMode: String(record.reviewEntryMode || '').trim().toLowerCase() === 'auto_only'
            ? 'auto_only'
            : String(record.reviewEntryMode || '').trim().toLowerCase() === 'manual_only'
                ? 'manual_only'
                : String(record.reviewEntryMode || '').trim().toLowerCase() === 'auto_or_manual'
                    ? 'auto_or_manual'
                    : fallback.reviewEntryMode,
    };
}

function normalizeGovernanceRole(raw: unknown, fallback: GovernanceRole): GovernanceRole {
    const normalized = String(raw || '').trim();
    if (
        normalized === 'Owner'
        || normalized === 'Admin'
        || normalized === 'Moderator'
        || normalized === 'Member'
        || normalized === 'Elder'
        || normalized === 'Initiate'
    ) {
        return normalized;
    }
    return fallback;
}

function normalizeDraftWorkflowPolicy(
    raw: unknown,
    fallback: DraftWorkflowPolicySnapshot,
): DraftWorkflowPolicySnapshot {
    const record = toRecord(raw);
    if (!record) return fallback;

    return {
        createIssueMinRole: normalizeGovernanceRole(record.createIssueMinRole, fallback.createIssueMinRole),
        followupIssueMinRole: normalizeGovernanceRole(record.followupIssueMinRole, fallback.followupIssueMinRole),
        reviewIssueMinRole: normalizeGovernanceRole(record.reviewIssueMinRole, fallback.reviewIssueMinRole),
        retagIssueMinRole: normalizeGovernanceRole(record.retagIssueMinRole, fallback.retagIssueMinRole),
        applyIssueMinRole: normalizeGovernanceRole(record.applyIssueMinRole, fallback.applyIssueMinRole),
        manualEndDraftingMinRole: normalizeGovernanceRole(
            record.manualEndDraftingMinRole,
            fallback.manualEndDraftingMinRole,
        ),
        advanceFromReviewMinRole: normalizeGovernanceRole(
            record.advanceFromReviewMinRole,
            fallback.advanceFromReviewMinRole,
        ),
        enterCrystallizationMinRole: normalizeGovernanceRole(
            record.enterCrystallizationMinRole,
            fallback.enterCrystallizationMinRole,
        ),
        allowAuthorWithdrawBeforeReview: asBoolean(
            record.allowAuthorWithdrawBeforeReview,
            fallback.allowAuthorWithdrawBeforeReview,
        ),
        allowModeratorRetagIssue: asBoolean(
            record.allowModeratorRetagIssue,
            fallback.allowModeratorRetagIssue,
        ),
    };
}

function normalizeBlockEditPolicy(
    raw: unknown,
    fallback: BlockEditEligibilityPolicySnapshot,
): BlockEditEligibilityPolicySnapshot {
    const record = toRecord(raw);
    if (!record) return fallback;

    return {
        mode: fallback.mode,
        managerOverride: asBoolean(record.managerOverride, fallback.managerOverride),
        contributorEvidenceRequired: asBoolean(
            record.contributorEvidenceRequired,
            fallback.contributorEvidenceRequired,
        ),
    };
}

function normalizeForkPolicy(raw: unknown, fallback: ForkPolicySnapshot): ForkPolicySnapshot {
    const record = toRecord(raw);
    if (!record) return fallback;

    return {
        ...fallback,
        enabled: asBoolean(record.enabled, fallback.enabled),
        minimumContributions: Math.max(
            1,
            Math.floor(asNumber(record.minimumContributions, fallback.minimumContributions)),
        ),
        minimumRole: String(record.minimumRole || '') === 'Owner'
            ? 'Owner'
            : String(record.minimumRole || '') === 'Admin'
                ? 'Admin'
                : String(record.minimumRole || '') === 'Moderator'
                    ? 'Moderator'
                    : String(record.minimumRole || '') === 'Elder'
                        ? 'Elder'
                        : String(record.minimumRole || '') === 'Initiate'
                            ? 'Initiate'
                            : 'Member',
        requiresGovernanceVote: asBoolean(record.requiresGovernanceVote, fallback.requiresGovernanceVote),
    };
}

function normalizeGhostPolicy(raw: unknown, fallback: GhostPolicySnapshot): GhostPolicySnapshot {
    const record = toRecord(raw);
    if (!record) return fallback;

    return {
        draftTriggerMode: String(record.draftTriggerMode || '').toLowerCase() === 'auto_draft'
            ? 'auto_draft'
            : fallback.draftTriggerMode,
        summaryUseLLM: asBoolean(record.summaryUseLLM, fallback.summaryUseLLM),
        triggerSummaryUseLLM: asBoolean(record.triggerSummaryUseLLM, fallback.triggerSummaryUseLLM),
        triggerGenerateComment: asBoolean(record.triggerGenerateComment, fallback.triggerGenerateComment),
    };
}

function isMissingTableError(error: unknown, tableName: string): boolean {
    const code = (error as { code?: string } | null)?.code;
    if (code === '42P01') return true;
    const message = error instanceof Error ? error.message : String(error ?? '');
    return message.includes(tableName) && message.includes('does not exist');
}

function toJsonbSql(value: unknown): Prisma.Sql {
    if (value === null || value === undefined) {
        return Prisma.sql`NULL`;
    }
    return Prisma.sql`${JSON.stringify(value)}::jsonb`;
}

async function loadPersistedProfileRow(
    prisma: PrismaClient,
    circleId: number,
): Promise<CirclePolicyProfileRow | null> {
    try {
        const rows = await prisma.$queryRaw<CirclePolicyProfileRow[]>`
            SELECT
                circle_id AS "circleId",
                source_type AS "sourceType",
                inheritance_mode AS "inheritanceMode",
                inherits_from_profile_id AS "inheritsFromProfileId",
                inherits_from_circle_id AS "inheritsFromCircleId",
                draft_generation_policy AS "draftGenerationPolicy",
                draft_lifecycle_template AS "draftLifecycleTemplate",
                draft_workflow_policy AS "draftWorkflowPolicy",
                block_edit_eligibility_policy AS "blockEditEligibilityPolicy",
                fork_policy AS "forkPolicy",
                ghost_policy AS "ghostPolicy",
                local_editability AS "localEditability",
                effective_from AS "effectiveFrom",
                resolved_from_profile_version AS "resolvedFromProfileVersion",
                config_version AS "configVersion"
            FROM circle_policy_profiles
            WHERE circle_id = ${circleId}
            ORDER BY config_version DESC NULLS LAST, effective_from DESC NULLS LAST
            LIMIT 1
        `;
        return rows[0] ?? null;
    } catch (error) {
        if (isMissingTableError(error, 'circle_policy_profiles')) {
            return null;
        }
        throw error;
    }
}

export function buildFallbackCirclePolicyProfile(input: {
    circle: FallbackCircleSnapshot;
    ghostPolicy: GhostPolicySnapshot;
}): CirclePolicyProfile {
    const source = fallbackSource(input.circle);
    const joinPolicy = resolveCircleJoinPolicy({
        joinRequirement: normalizeJoinRequirement(input.circle.joinRequirement),
        circleType: normalizeCircleType(input.circle.circleType),
        minCrystals: input.circle.minCrystals,
    });
    const allowGhostAutoDraft = input.ghostPolicy.draftTriggerMode === 'auto_draft'
        && joinPolicy.joinRequirement !== 'InviteOnly'
        && joinPolicy.circleType !== 'Secret';

    return {
        circleId: input.circle.id,
        sourceType: source.sourceType,
        inheritanceMode: source.inheritanceMode,
        inheritsFromProfileId: null,
        inheritsFromCircleId: source.inheritsFromCircleId,
        draftGenerationPolicy: buildDefaultDraftGenerationPolicy({ allowGhostAutoDraft }),
        draftLifecycleTemplate: buildDefaultLifecycleTemplate(),
        draftWorkflowPolicy: buildDefaultDraftWorkflowPolicy(),
        blockEditEligibilityPolicy: buildDefaultBlockEditEligibilityPolicy(),
        forkPolicy: buildDefaultForkPolicy(input.circle),
        ghostPolicy: input.ghostPolicy,
        localEditability: resolveLocalEditability(source.inheritanceMode),
        effectiveFrom: input.circle.createdAt,
        resolvedFromProfileVersion: null,
        configVersion: 1,
    };
}

export function mergeCirclePolicyProfile(
    fallback: CirclePolicyProfile,
    row: CirclePolicyProfileRow | null,
): CirclePolicyProfile {
    if (!row) return fallback;

    const inheritanceMode = normalizeInheritanceMode(row.inheritanceMode, fallback.inheritanceMode);
    const sourceType = normalizeSourceType(row.sourceType, fallback.sourceType);
    const localEditability = resolveLocalEditability(inheritanceMode);

    return {
        ...fallback,
        sourceType,
        inheritanceMode,
        inheritsFromProfileId: row.inheritsFromProfileId ?? fallback.inheritsFromProfileId,
        inheritsFromCircleId: row.inheritsFromCircleId ?? fallback.inheritsFromCircleId,
        draftGenerationPolicy: normalizeDraftGenerationPolicy(
            row.draftGenerationPolicy,
            fallback.draftGenerationPolicy,
        ),
        draftLifecycleTemplate: normalizeLifecycleTemplate(
            row.draftLifecycleTemplate,
            fallback.draftLifecycleTemplate,
        ),
        draftWorkflowPolicy: normalizeDraftWorkflowPolicy(
            row.draftWorkflowPolicy,
            fallback.draftWorkflowPolicy,
        ),
        blockEditEligibilityPolicy: normalizeBlockEditPolicy(
            row.blockEditEligibilityPolicy,
            fallback.blockEditEligibilityPolicy,
        ),
        forkPolicy: normalizeForkPolicy(row.forkPolicy, fallback.forkPolicy),
        ghostPolicy: normalizeGhostPolicy(row.ghostPolicy, fallback.ghostPolicy),
        localEditability,
        effectiveFrom: asDate(row.effectiveFrom, fallback.effectiveFrom),
        resolvedFromProfileVersion: row.resolvedFromProfileVersion ?? fallback.resolvedFromProfileVersion,
        configVersion: Math.max(1, Math.floor(asNumber(row.configVersion, fallback.configVersion))),
    };
}

export function buildPublicPolicyDigestSnapshot(
    profile: CirclePolicyProfile,
): PublicPolicyDigestSnapshot {
    return {
        draftLifecycleTemplate: profile.draftLifecycleTemplate,
        draftWorkflowPolicy: profile.draftWorkflowPolicy,
        forkPolicy: profile.forkPolicy,
    };
}

export async function resolveCirclePolicyProfile(
    prisma: PrismaClient,
    circleId: number,
): Promise<CirclePolicyProfile> {
    const circle = await prisma.circle.findUnique({
        where: { id: circleId },
        select: {
            id: true,
            level: true,
            parentCircleId: true,
            createdAt: true,
            joinRequirement: true,
            circleType: true,
            minCrystals: true,
        },
    });
    if (!circle) {
        throw new Error('circle_not_found');
    }

    const [ghostConfig, ghostPatch, persistedRow] = await Promise.all([
        Promise.resolve(loadGhostConfig()),
        loadCircleGhostSettingsPatch(prisma, circleId),
        loadPersistedProfileRow(prisma, circleId),
    ]);
    const projectedPolicy = await resolveProjectedCircleSettings(prisma, circle);
    const ghostSettings = resolveCircleGhostSettings(ghostConfig, ghostPatch);
    const fallback = buildFallbackCirclePolicyProfile({
        circle: {
            id: circle.id,
            level: circle.level,
            parentCircleId: circle.parentCircleId,
            createdAt: circle.createdAt,
            joinRequirement: projectedPolicy.joinRequirement,
            circleType: projectedPolicy.circleType,
            minCrystals: projectedPolicy.minCrystals,
        },
        ghostPolicy: buildGhostPolicySnapshot(ghostSettings),
    });

    return mergeCirclePolicyProfile(fallback, persistedRow);
}

export async function upsertCircleDraftLifecycleTemplate(
    prisma: PrismaClient,
    input: UpsertCircleDraftLifecycleTemplateInput,
): Promise<CirclePolicyProfile> {
    const currentProfile = await resolveCirclePolicyProfile(prisma, input.circleId);
    const persistedRow = await loadPersistedProfileRow(prisma, input.circleId);

    const nextTemplate = normalizeLifecycleTemplate(
        {
            ...currentProfile.draftLifecycleTemplate,
            ...input.patch,
        },
        currentProfile.draftLifecycleTemplate,
    );

    const nextConfigVersion = Math.max(
        1,
        Math.floor(asNumber(persistedRow?.configVersion, currentProfile.configVersion)),
    ) + 1;
    const sourceType = normalizeSourceType(persistedRow?.sourceType, 'circle_override');
    const inheritanceMode = normalizeInheritanceMode(
        persistedRow?.inheritanceMode,
        currentProfile.inheritanceMode,
    );
    const localEditability = resolveLocalEditability(inheritanceMode);
    const effectiveFrom = new Date();

    await prisma.$executeRaw`
        INSERT INTO circle_policy_profiles (
            circle_id,
            source_type,
            inheritance_mode,
            inherits_from_profile_id,
            inherits_from_circle_id,
            draft_generation_policy,
            draft_lifecycle_template,
            draft_workflow_policy,
            block_edit_eligibility_policy,
            fork_policy,
            ghost_policy,
            local_editability,
            effective_from,
            resolved_from_profile_version,
            config_version,
            updated_by,
            created_at,
            updated_at
        ) VALUES (
            ${input.circleId},
            ${sourceType},
            ${inheritanceMode},
            ${asOptionalString(persistedRow?.inheritsFromProfileId)},
            ${persistedRow?.inheritsFromCircleId ?? currentProfile.inheritsFromCircleId},
            ${toJsonbSql(persistedRow?.draftGenerationPolicy)},
            ${toJsonbSql(nextTemplate)},
            ${toJsonbSql(persistedRow?.draftWorkflowPolicy ?? currentProfile.draftWorkflowPolicy)},
            ${toJsonbSql(persistedRow?.blockEditEligibilityPolicy)},
            ${toJsonbSql(persistedRow?.forkPolicy)},
            ${toJsonbSql(persistedRow?.ghostPolicy)},
            ${localEditability},
            ${effectiveFrom},
            ${persistedRow?.resolvedFromProfileVersion ?? currentProfile.resolvedFromProfileVersion},
            ${nextConfigVersion},
            ${input.actorUserId},
            NOW(),
            NOW()
        )
        ON CONFLICT (circle_id) DO UPDATE SET
            source_type = EXCLUDED.source_type,
            inheritance_mode = EXCLUDED.inheritance_mode,
            inherits_from_profile_id = EXCLUDED.inherits_from_profile_id,
            inherits_from_circle_id = EXCLUDED.inherits_from_circle_id,
            draft_generation_policy = COALESCE(circle_policy_profiles.draft_generation_policy, EXCLUDED.draft_generation_policy),
            draft_lifecycle_template = EXCLUDED.draft_lifecycle_template,
            draft_workflow_policy = COALESCE(circle_policy_profiles.draft_workflow_policy, EXCLUDED.draft_workflow_policy),
            block_edit_eligibility_policy = COALESCE(circle_policy_profiles.block_edit_eligibility_policy, EXCLUDED.block_edit_eligibility_policy),
            fork_policy = COALESCE(circle_policy_profiles.fork_policy, EXCLUDED.fork_policy),
            ghost_policy = COALESCE(circle_policy_profiles.ghost_policy, EXCLUDED.ghost_policy),
            local_editability = EXCLUDED.local_editability,
            effective_from = EXCLUDED.effective_from,
            resolved_from_profile_version = EXCLUDED.resolved_from_profile_version,
            config_version = EXCLUDED.config_version,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
    `;

    return resolveCirclePolicyProfile(prisma, input.circleId);
}

export async function upsertCircleDraftWorkflowPolicy(
    prisma: PrismaClient,
    input: UpsertCircleDraftWorkflowPolicyInput,
): Promise<CirclePolicyProfile> {
    const currentProfile = await resolveCirclePolicyProfile(prisma, input.circleId);
    const persistedRow = await loadPersistedProfileRow(prisma, input.circleId);

    const nextPolicy = normalizeDraftWorkflowPolicy(
        {
            ...currentProfile.draftWorkflowPolicy,
            ...input.patch,
        },
        currentProfile.draftWorkflowPolicy,
    );

    const nextConfigVersion = Math.max(
        1,
        Math.floor(asNumber(persistedRow?.configVersion, currentProfile.configVersion)),
    ) + 1;
    const sourceType = normalizeSourceType(persistedRow?.sourceType, 'circle_override');
    const inheritanceMode = normalizeInheritanceMode(
        persistedRow?.inheritanceMode,
        currentProfile.inheritanceMode,
    );
    const localEditability = resolveLocalEditability(inheritanceMode);
    const effectiveFrom = new Date();

    await prisma.$executeRaw`
        INSERT INTO circle_policy_profiles (
            circle_id,
            source_type,
            inheritance_mode,
            inherits_from_profile_id,
            inherits_from_circle_id,
            draft_generation_policy,
            draft_lifecycle_template,
            draft_workflow_policy,
            block_edit_eligibility_policy,
            fork_policy,
            ghost_policy,
            local_editability,
            effective_from,
            resolved_from_profile_version,
            config_version,
            updated_by,
            created_at,
            updated_at
        ) VALUES (
            ${input.circleId},
            ${sourceType},
            ${inheritanceMode},
            ${asOptionalString(persistedRow?.inheritsFromProfileId)},
            ${persistedRow?.inheritsFromCircleId ?? currentProfile.inheritsFromCircleId},
            ${toJsonbSql(persistedRow?.draftGenerationPolicy)},
            ${toJsonbSql(persistedRow?.draftLifecycleTemplate ?? currentProfile.draftLifecycleTemplate)},
            ${toJsonbSql(nextPolicy)},
            ${toJsonbSql(persistedRow?.blockEditEligibilityPolicy)},
            ${toJsonbSql(persistedRow?.forkPolicy)},
            ${toJsonbSql(persistedRow?.ghostPolicy)},
            ${localEditability},
            ${effectiveFrom},
            ${persistedRow?.resolvedFromProfileVersion ?? currentProfile.resolvedFromProfileVersion},
            ${nextConfigVersion},
            ${input.actorUserId},
            NOW(),
            NOW()
        )
        ON CONFLICT (circle_id) DO UPDATE SET
            source_type = EXCLUDED.source_type,
            inheritance_mode = EXCLUDED.inheritance_mode,
            inherits_from_profile_id = EXCLUDED.inherits_from_profile_id,
            inherits_from_circle_id = EXCLUDED.inherits_from_circle_id,
            draft_generation_policy = COALESCE(circle_policy_profiles.draft_generation_policy, EXCLUDED.draft_generation_policy),
            draft_lifecycle_template = COALESCE(circle_policy_profiles.draft_lifecycle_template, EXCLUDED.draft_lifecycle_template),
            draft_workflow_policy = EXCLUDED.draft_workflow_policy,
            block_edit_eligibility_policy = COALESCE(circle_policy_profiles.block_edit_eligibility_policy, EXCLUDED.block_edit_eligibility_policy),
            fork_policy = COALESCE(circle_policy_profiles.fork_policy, EXCLUDED.fork_policy),
            ghost_policy = COALESCE(circle_policy_profiles.ghost_policy, EXCLUDED.ghost_policy),
            local_editability = EXCLUDED.local_editability,
            effective_from = EXCLUDED.effective_from,
            resolved_from_profile_version = EXCLUDED.resolved_from_profile_version,
            config_version = EXCLUDED.config_version,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
    `;

    return resolveCirclePolicyProfile(prisma, input.circleId);
}

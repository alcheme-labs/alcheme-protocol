export interface Team04ForkThresholdResolvedView {
    enabled: boolean;
    thresholdMode: 'contribution_threshold';
    minimumContributions: number;
    minimumRole: 'Owner' | 'Admin' | 'Moderator' | 'Member' | 'Elder' | 'Initiate';
    requiresGovernanceVote: boolean;
}

export interface Team04InheritanceResolvedView {
    circleId: number;
    sourceType: 'lv0_default' | 'circle_override' | 'inherited_locked' | 'inherited_editable';
    inheritanceMode: 'inherit_locked' | 'inherit_but_editable' | 'independent';
    localEditability: 'locked' | 'editable';
    inheritsFromProfileId: string | null;
    inheritsFromCircleId: number | null;
}

export interface Team04MinimumFieldSet {
    configVersion: number;
    effectiveFrom: string;
    resolvedFromProfileVersion: number | null;
    inheritancePrefillSource: 'lv0_default_profile';
    knowledgeLineageInheritance: 'upstream_until_fork_node';
}

export interface Team04ForkResolvedInputs {
    circleId: number;
    forkThresholdResolvedView: Team04ForkThresholdResolvedView;
    inheritanceResolvedView: Team04InheritanceResolvedView;
    minimumFieldSet: Team04MinimumFieldSet;
}

export type ForkQualificationStatus =
    | 'qualified'
    | 'fork_disabled'
    | 'contribution_shortfall'
    | 'identity_shortfall';

export type ActorIdentityLevel = 'Visitor' | 'Initiate' | 'Member' | 'Elder';

export interface ForkQualificationSnapshot {
    minimumContributions: number;
    contributorCount: number;
    minimumRole: Team04ForkThresholdResolvedView['minimumRole'];
    actorRole: Team04ForkThresholdResolvedView['minimumRole'] | null;
    actorIdentityLevel: ActorIdentityLevel | null;
    requiresGovernanceVote: boolean;
    qualifies: boolean;
    qualificationStatus: ForkQualificationStatus;
}

export interface ForkReadinessInput {
    sourceCircleId: number;
    sourceCircleName?: string | null;
    sourceLevel?: number | null;
    resolvedInputs: Team04ForkResolvedInputs;
    contributorCount?: number | null;
    actorRole?: Team04ForkThresholdResolvedView['minimumRole'] | null;
    actorIdentityLevel?: ActorIdentityLevel | null;
    qualificationSnapshot?: ForkQualificationSnapshot | null;
}

export interface ForkReadinessViewModel {
    sourceCircleId: number;
    sourceCircleName: string;
    sourceLevelLabel: string;
    currentQualificationLabel: string;
    contributionProgressLabel: string;
    identityFloorLabel: string;
    thresholdLabel: string;
    inheritanceLabel: string;
    knowledgeLineageLabel: string;
    prefillSourceLabel: string;
    contributorCount: number;
    qualificationStatus: ForkQualificationStatus;
    canSubmitFork: boolean;
    statusBadgeLabel: string;
    slogan: string;
    declarationPlaceholder: string;
    hintTitle: string;
    hintBody: string;
}

type ForkReadinessTranslateValues = Record<string, string | number | Date>;
type ForkReadinessTranslator = (
    key: string,
    values?: ForkReadinessTranslateValues,
) => string;

export interface ForkReadinessCopy {
    sourceCircleFallback: (input: {sourceCircleId: number}) => string;
    sourceLevelPending: string;
    sourceLevel: (input: {level: number}) => string;
    thresholdDisabled: string;
    thresholdBase: (input: {minimumContributions: number; roleLabel: string}) => string;
    thresholdWithGovernance: (input: {base: string}) => string;
    thresholdReady: (input: {base: string}) => string;
    inheritanceLocked: string;
    inheritanceEditable: string;
    inheritanceIndependent: string;
    knowledgeLineageUpstreamUntilForkNode: string;
    roleLabels: Record<Team04ForkThresholdResolvedView['minimumRole'], string>;
    qualificationQualified: string;
    qualificationForkDisabled: string;
    qualificationIdentityShortfall: (input: {roleLabel: string}) => string;
    qualificationContributionShortfall: (input: {missing: number}) => string;
    qualificationFallback: string;
    statusBadgeQualified: string;
    statusBadgeForkDisabled: string;
    statusBadgeIdentityShortfall: string;
    statusBadgeContributionShortfall: string;
    sourceLevelLabel: (input: {level: number}) => string;
    identityFloor: (input: {roleLabel: string}) => string;
    contributionProgress: (input: {current: number; required: number}) => string;
    prefillSourceLabel: (input: {configVersion: number}) => string;
    slogan: string;
    declarationPlaceholder: string;
    hintTitle: string;
    hintBody: string;
}

export function createForkReadinessCopy(
    t: ForkReadinessTranslator,
): ForkReadinessCopy {
    return {
        sourceCircleFallback: ({sourceCircleId}) => t('defaults.sourceCircleFallback', {sourceCircleId}),
        sourceLevelPending: t('defaults.sourceLevelPending'),
        sourceLevel: ({level}) => t('defaults.sourceLevel', {level}),
        thresholdDisabled: t('threshold.disabled'),
        thresholdBase: ({minimumContributions, roleLabel}) => t('threshold.base', {
            minimumContributions,
            roleLabel,
        }),
        thresholdWithGovernance: ({base}) => t('threshold.withGovernance', {base}),
        thresholdReady: ({base}) => t('threshold.ready', {base}),
        inheritanceLocked: t('inheritance.locked'),
        inheritanceEditable: t('inheritance.editable'),
        inheritanceIndependent: t('inheritance.independent'),
        knowledgeLineageUpstreamUntilForkNode: t('knowledgeLineage.upstreamUntilForkNode'),
        roleLabels: {
            Owner: t('roles.Owner'),
            Admin: t('roles.Admin'),
            Moderator: t('roles.Moderator'),
            Member: t('roles.Member'),
            Elder: t('roles.Elder'),
            Initiate: t('roles.Initiate'),
        },
        qualificationQualified: t('qualification.qualified'),
        qualificationForkDisabled: t('qualification.forkDisabled'),
        qualificationIdentityShortfall: ({roleLabel}) => t('qualification.identityShortfall', {roleLabel}),
        qualificationContributionShortfall: ({missing}) => t('qualification.contributionShortfall', {missing}),
        qualificationFallback: t('qualification.fallback'),
        statusBadgeQualified: t('statusBadge.qualified'),
        statusBadgeForkDisabled: t('statusBadge.forkDisabled'),
        statusBadgeIdentityShortfall: t('statusBadge.identityShortfall'),
        statusBadgeContributionShortfall: t('statusBadge.contributionShortfall'),
        sourceLevelLabel: ({level}) => t('defaults.sourceLevel', {level}),
        identityFloor: ({roleLabel}) => t('defaults.identityFloor', {roleLabel}),
        contributionProgress: ({current, required}) => t('defaults.contributionProgress', {current, required}),
        prefillSourceLabel: ({configVersion}) => t('defaults.prefillSourceLabel', {configVersion}),
        slogan: t('defaults.slogan'),
        declarationPlaceholder: t('defaults.declarationPlaceholder'),
        hintTitle: t('defaults.hintTitle'),
        hintBody: t('defaults.hintBody'),
    };
}

function ensureObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('invalid_object');
    }
    return value as Record<string, unknown>;
}

function asBoolean(value: unknown): boolean {
    return Boolean(value);
}

function asNumber(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error('invalid_number');
    }
    return parsed;
}

function asNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    return asNumber(value);
}

function asString(value: unknown): string {
    if (typeof value !== 'string') {
        throw new Error('invalid_string');
    }
    return value;
}

function formatThresholdLabel(
    input: Team04ForkThresholdResolvedView,
    copy: ForkReadinessCopy,
): string {
    if (!input.enabled) {
        return copy.thresholdDisabled;
    }
    const roleLabel = formatMinimumRoleLabel(input.minimumRole, copy);
    const base = copy.thresholdBase({
        minimumContributions: input.minimumContributions,
        roleLabel,
    });
    return input.requiresGovernanceVote
        ? copy.thresholdWithGovernance({base})
        : copy.thresholdReady({base});
}

function formatInheritanceLabel(
    input: Team04InheritanceResolvedView,
    copy: ForkReadinessCopy,
): string {
    if (input.inheritanceMode === 'inherit_locked') {
        return copy.inheritanceLocked;
    }
    if (input.inheritanceMode === 'inherit_but_editable') {
        return copy.inheritanceEditable;
    }
    return copy.inheritanceIndependent;
}

function formatKnowledgeLineageLabel(
    input: Team04MinimumFieldSet['knowledgeLineageInheritance'],
    copy: ForkReadinessCopy,
): string {
    if (input === 'upstream_until_fork_node') {
        return copy.knowledgeLineageUpstreamUntilForkNode;
    }
    return input;
}

function formatMinimumRoleLabel(
    value: Team04ForkThresholdResolvedView['minimumRole'],
    copy: ForkReadinessCopy,
): string {
    return copy.roleLabels[value] ?? value;
}

function roleRank(value: Team04ForkThresholdResolvedView['minimumRole'] | null | undefined): number {
    switch (value) {
        case 'Initiate':
            return 1;
        case 'Member':
            return 2;
        case 'Elder':
            return 3;
        case 'Moderator':
            return 4;
        case 'Admin':
            return 5;
        case 'Owner':
            return 6;
        default:
            return 0;
    }
}

function identityRank(value: ActorIdentityLevel | null | undefined): number {
    switch (value) {
        case 'Initiate':
            return 1;
        case 'Member':
            return 2;
        case 'Elder':
            return 3;
        default:
            return 0;
    }
}

function requiresManagerRoleFloor(role: Team04ForkThresholdResolvedView['minimumRole']): boolean {
    return role === 'Owner' || role === 'Admin' || role === 'Moderator';
}

function evaluateQualification(input: {
    resolvedInputs: Team04ForkResolvedInputs;
    contributorCount: number;
    actorRole: Team04ForkThresholdResolvedView['minimumRole'] | null;
    actorIdentityLevel: ActorIdentityLevel | null;
}): {
    canSubmitFork: boolean;
    qualificationStatus: ForkQualificationStatus;
} {
    const threshold = input.resolvedInputs.forkThresholdResolvedView;
    if (!threshold.enabled) {
        return {
            canSubmitFork: false,
            qualificationStatus: 'fork_disabled',
        };
    }

    const contributionSatisfied = input.contributorCount >= threshold.minimumContributions;
    const identitySatisfied = requiresManagerRoleFloor(threshold.minimumRole)
        ? roleRank(input.actorRole) >= roleRank(threshold.minimumRole)
        : identityRank(input.actorIdentityLevel) >= roleRank(threshold.minimumRole);

    if (!contributionSatisfied) {
        return {
            canSubmitFork: false,
            qualificationStatus: 'contribution_shortfall',
        };
    }
    if (!identitySatisfied) {
        return {
            canSubmitFork: false,
            qualificationStatus: 'identity_shortfall',
        };
    }
    return {
        canSubmitFork: true,
        qualificationStatus: 'qualified',
    };
}

function formatQualificationLabel(input: {
    qualificationStatus: ForkQualificationStatus;
    contributorCount: number;
    resolvedInputs: Team04ForkResolvedInputs;
    copy: ForkReadinessCopy;
}): string {
    switch (input.qualificationStatus) {
        case 'qualified':
            return input.copy.qualificationQualified;
        case 'fork_disabled':
            return input.copy.qualificationForkDisabled;
        case 'identity_shortfall':
            return input.copy.qualificationIdentityShortfall({
                roleLabel: formatMinimumRoleLabel(
                    input.resolvedInputs.forkThresholdResolvedView.minimumRole,
                    input.copy,
                ),
            });
        case 'contribution_shortfall':
        default: {
            const missing = Math.max(
                0,
                input.resolvedInputs.forkThresholdResolvedView.minimumContributions - input.contributorCount,
            );
            return missing > 0
                ? input.copy.qualificationContributionShortfall({missing})
                : input.copy.qualificationFallback;
        }
    }
}

function formatStatusBadgeLabel(
    status: ForkQualificationStatus,
    copy: ForkReadinessCopy,
): string {
    switch (status) {
        case 'qualified':
            return copy.statusBadgeQualified;
        case 'fork_disabled':
            return copy.statusBadgeForkDisabled;
        case 'identity_shortfall':
            return copy.statusBadgeIdentityShortfall;
        case 'contribution_shortfall':
        default:
            return copy.statusBadgeContributionShortfall;
    }
}

export function pickForkTeam04ResolvedInputs(value: unknown): Team04ForkResolvedInputs {
    const root = ensureObject(value);
    const threshold = ensureObject(root.forkThresholdResolvedView);
    const inheritance = ensureObject(root.inheritanceResolvedView);
    const minimumFieldSet = ensureObject(root.minimumFieldSet);

    return {
        circleId: asNumber(root.circleId),
        forkThresholdResolvedView: {
            enabled: asBoolean(threshold.enabled),
            thresholdMode: asString(threshold.thresholdMode) as Team04ForkThresholdResolvedView['thresholdMode'],
            minimumContributions: asNumber(threshold.minimumContributions),
            minimumRole: asString(threshold.minimumRole) as Team04ForkThresholdResolvedView['minimumRole'],
            requiresGovernanceVote: asBoolean(threshold.requiresGovernanceVote),
        },
        inheritanceResolvedView: {
            circleId: asNumber(inheritance.circleId),
            sourceType: asString(inheritance.sourceType) as Team04InheritanceResolvedView['sourceType'],
            inheritanceMode: asString(inheritance.inheritanceMode) as Team04InheritanceResolvedView['inheritanceMode'],
            localEditability: asString(inheritance.localEditability) as Team04InheritanceResolvedView['localEditability'],
            inheritsFromProfileId: inheritance.inheritsFromProfileId === null ? null : asString(inheritance.inheritsFromProfileId),
            inheritsFromCircleId: asNullableNumber(inheritance.inheritsFromCircleId),
        },
        minimumFieldSet: {
            configVersion: asNumber(minimumFieldSet.configVersion),
            effectiveFrom: asString(minimumFieldSet.effectiveFrom),
            resolvedFromProfileVersion: asNullableNumber(minimumFieldSet.resolvedFromProfileVersion),
            inheritancePrefillSource: asString(minimumFieldSet.inheritancePrefillSource) as Team04MinimumFieldSet['inheritancePrefillSource'],
            knowledgeLineageInheritance: asString(minimumFieldSet.knowledgeLineageInheritance) as Team04MinimumFieldSet['knowledgeLineageInheritance'],
        },
    };
}

export function buildForkReadinessViewModel(
    input: ForkReadinessInput,
    copy: ForkReadinessCopy,
): ForkReadinessViewModel {
    const level = Number.isFinite(Number(input.sourceLevel)) ? Number(input.sourceLevel) : null;
    const resolvedInputs = input.resolvedInputs;
    const localContributorCount = Math.max(0, Number(input.contributorCount || 0));
    const actorRole = input.actorRole ?? null;
    const actorIdentityLevel = input.actorIdentityLevel ?? null;
    const localQualification = evaluateQualification({
        resolvedInputs,
        contributorCount: localContributorCount,
        actorRole,
        actorIdentityLevel,
    });
    const qualification = input.qualificationSnapshot ?? {
        minimumContributions: resolvedInputs.forkThresholdResolvedView.minimumContributions,
        contributorCount: localContributorCount,
        minimumRole: resolvedInputs.forkThresholdResolvedView.minimumRole,
        actorRole,
        actorIdentityLevel,
        requiresGovernanceVote: resolvedInputs.forkThresholdResolvedView.requiresGovernanceVote,
        qualifies: localQualification.canSubmitFork,
        qualificationStatus: localQualification.qualificationStatus,
    };
    const contributorCount = qualification.contributorCount;

    return {
        sourceCircleId: input.sourceCircleId,
        sourceCircleName: String(input.sourceCircleName || copy.sourceCircleFallback({sourceCircleId: input.sourceCircleId})),
        sourceLevelLabel: level === null
            ? copy.sourceLevelPending
            : copy.sourceLevelLabel({level: Math.max(0, level)}),
        currentQualificationLabel: formatQualificationLabel({
            qualificationStatus: qualification.qualificationStatus,
            contributorCount,
            resolvedInputs,
            copy,
        }),
        contributionProgressLabel: copy.contributionProgress({
            current: contributorCount,
            required: resolvedInputs.forkThresholdResolvedView.minimumContributions,
        }),
        identityFloorLabel: copy.identityFloor({
            roleLabel: formatMinimumRoleLabel(resolvedInputs.forkThresholdResolvedView.minimumRole, copy),
        }),
        thresholdLabel: formatThresholdLabel(resolvedInputs.forkThresholdResolvedView, copy),
        inheritanceLabel: formatInheritanceLabel(resolvedInputs.inheritanceResolvedView, copy),
        knowledgeLineageLabel: formatKnowledgeLineageLabel(
            resolvedInputs.minimumFieldSet.knowledgeLineageInheritance,
            copy,
        ),
        prefillSourceLabel: copy.prefillSourceLabel({
            configVersion: resolvedInputs.minimumFieldSet.configVersion,
        }),
        contributorCount,
        qualificationStatus: qualification.qualificationStatus,
        canSubmitFork: qualification.qualifies,
        statusBadgeLabel: formatStatusBadgeLabel(qualification.qualificationStatus, copy),
        slogan: copy.slogan,
        declarationPlaceholder: copy.declarationPlaceholder,
        hintTitle: copy.hintTitle,
        hintBody: copy.hintBody,
    };
}

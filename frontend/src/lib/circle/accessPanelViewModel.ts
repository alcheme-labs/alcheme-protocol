import type { SourceMaterialRecord } from '@/lib/api/circlesSourceMaterials';
import type { CircleExternalAppBindingRecord } from '@/lib/api/externalApps';
import type { CircleGovernanceBinding, CircleGovernanceRequest } from '@/lib/api/governance';

export const SOURCE_MATERIAL_ACCEPT_ACTION = 'source_material.accept';
export const PENDING_SOURCE_MATERIAL_STATUSES = ['nominated', 'submitted', 'review_pending'];
export const ACCEPTED_SOURCE_MATERIAL_STATUSES = ['accepted_to_plaza', 'used_in_draft', 'crystallized'];

export interface BuildAccessPanelViewModelInput {
    sourceMaterials: SourceMaterialRecord[];
    externalAppBindings: CircleExternalAppBindingRecord[];
    governanceBindings: CircleGovernanceBinding[];
    targetGovernanceRequests: CircleGovernanceRequest[];
    canReviewSourceMaterials: boolean;
    canAccessSourceMaterials: boolean;
    t: (key: string, values?: Record<string, string | number>) => string;
}

export interface AccessPanelViewModel {
    externalAppCount: number;
    connectedApps: Array<{
        id: string;
        appId: string;
        title: string;
        meta: string;
        statusLabel: string;
    }>;
    pendingApps: Array<{
        id: string;
        appId: string;
        title: string;
        meta: string;
        statusLabel: string;
    }>;
    pendingMaterials: Array<{
        id: number;
        title: string;
        meta: string;
        authorityLabel: string;
        actionLabel: string;
        actionDisabled: boolean;
        pendingRequestId: string | null;
    }>;
    acceptedMaterials: Array<{
        id: number;
        title: string;
        meta: string;
        statusLabel: string;
        contributorLabel: string | null;
        summary: string | null;
        selectableForDraft: boolean;
    }>;
    reviewAuthority: 'governance' | 'direct' | 'viewer_readonly';
}

export function governanceBindingCoversAction(
    bindings: CircleGovernanceBinding[],
    actionType: string,
): boolean {
    return bindings.some((binding) => {
        if (
            binding.status !== 'active'
            || binding.targetAuthorizationStatus !== 'accepted'
            || binding.committeeMandateStatus !== 'accepted'
        ) {
            return false;
        }
        const scope = String(binding.actionType || binding.actionPrefix || '').trim();
        return Boolean(scope && (actionType === scope || actionType.startsWith(`${scope}.`)));
    });
}

export function buildAccessPanelViewModel(input: BuildAccessPanelViewModelInput): AccessPanelViewModel {
    const hasGovernanceBinding = governanceBindingCoversAction(
        input.governanceBindings,
        SOURCE_MATERIAL_ACCEPT_ACTION,
    );
    const reviewAuthority: AccessPanelViewModel['reviewAuthority'] =
        hasGovernanceBinding && input.canAccessSourceMaterials
            ? 'governance'
            : !hasGovernanceBinding && input.canReviewSourceMaterials
                ? 'direct'
                : 'viewer_readonly';

    const mapAppBinding = (binding: CircleExternalAppBindingRecord) => ({
        id: binding.id,
        appId: binding.appId,
        title: binding.appName || binding.appId,
        meta: input.t(`connected.kind.${binding.bindingKind === 'primary' ? 'primary' : 'attached'}`),
        statusLabel: input.t(`connected.status.${binding.status}`),
    });
    const connectedApps = input.externalAppBindings
        .filter((binding) => binding.status === 'active')
        .map(mapAppBinding);
    const pendingApps = input.externalAppBindings
        .filter((binding) => binding.status === 'pending')
        .map(mapAppBinding);
    const externalAppCount = new Set(input.externalAppBindings.map((binding) => binding.appId)).size;

    const pendingMaterials = input.sourceMaterials
        .filter((material) => PENDING_SOURCE_MATERIAL_STATUSES.includes(String(material.lifecycleStatus || '')))
        .map((material) => {
            const pendingRequest = findActiveSourceMaterialRequest(input.targetGovernanceRequests, material);
            const pendingRequestId = pendingRequest?.id ?? null;
            if (pendingRequestId) {
                return {
                    id: material.id,
                    title: material.name,
                    meta: sourceMaterialMeta(input.t, material),
                    authorityLabel: input.t('pending.authority.inReview'),
                    actionLabel: input.t('pending.actions.inReview'),
                    actionDisabled: true,
                    pendingRequestId,
                };
            }
            if (reviewAuthority === 'governance') {
                return {
                    id: material.id,
                    title: material.name,
                    meta: sourceMaterialMeta(input.t, material),
                    authorityLabel: input.t('pending.authority.governance'),
                    actionLabel: input.t('pending.actions.submitReview'),
                    actionDisabled: false,
                    pendingRequestId: null,
                };
            }
            if (reviewAuthority === 'direct') {
                return {
                    id: material.id,
                    title: material.name,
                    meta: sourceMaterialMeta(input.t, material),
                    authorityLabel: input.t('pending.authority.direct'),
                    actionLabel: input.t('pending.actions.accept'),
                    actionDisabled: false,
                    pendingRequestId: null,
                };
            }
            return {
                id: material.id,
                title: material.name,
                meta: sourceMaterialMeta(input.t, material),
                authorityLabel: hasGovernanceBinding
                    ? input.t('pending.authority.noAccess')
                    : input.t('pending.authority.waiting'),
                actionLabel: input.t('pending.actions.wait'),
                actionDisabled: true,
                pendingRequestId: null,
            };
        });

    const acceptedMaterials = input.sourceMaterials
        .filter((material) => ACCEPTED_SOURCE_MATERIAL_STATUSES.includes(String(material.lifecycleStatus || '')))
        .map((material) => ({
            id: material.id,
            title: material.name,
            meta: sourceMaterialMeta(input.t, material),
            statusLabel: input.t(`accepted.status.${material.lifecycleStatus || 'accepted_to_plaza'}`),
            contributorLabel: communicationContributorLabel(material),
            summary: material.summaryText?.trim() || null,
            selectableForDraft: material.originType === 'communication_message'
                && material.lifecycleStatus === 'accepted_to_plaza'
                && material.draftPostId === null,
        }));

    return {
        externalAppCount,
        connectedApps,
        pendingApps,
        pendingMaterials,
        acceptedMaterials,
        reviewAuthority,
    };
}

function communicationContributorLabel(material: SourceMaterialRecord): string | null {
    if (material.originType !== 'communication_message') return null;
    const provenance = material.provenance;
    const handle = typeof provenance?.originMessageSenderHandle === 'string'
        ? provenance.originMessageSenderHandle.trim()
        : '';
    const pubkey = typeof provenance?.originMessageSenderPubkey === 'string'
        ? provenance.originMessageSenderPubkey.trim()
        : '';
    if (handle) return `@${handle}`;
    if (!pubkey) return null;
    return pubkey.length > 12 ? `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}` : pubkey;
}

function findActiveSourceMaterialRequest(
    requests: CircleGovernanceRequest[],
    material: SourceMaterialRecord,
): CircleGovernanceRequest | null {
    return requests.find((request) =>
        request.targetType === 'source_material'
        && request.targetRef === String(material.id)
        && request.actionType === SOURCE_MATERIAL_ACCEPT_ACTION
        && request.state === 'active'
        && Number(request.payload?.targetCircleId) === Number(material.circleId)
    ) ?? null;
}

function sourceMaterialMeta(
    t: BuildAccessPanelViewModelInput['t'],
    material: SourceMaterialRecord,
): string {
    const originType = String(material.originType || 'manual_upload');
    return t(`material.origin.${originType}`);
}

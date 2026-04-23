export interface TemporaryEditGrantControlView {
    grantId: string;
    blockId: string;
    granteeUserId: number;
    status: 'requested' | 'active' | 'revoked' | 'expired' | 'rejected';
    expiresAt: string | null;
}

export interface ResolveTemporaryGrantControlsInput {
    blockId: string;
    temporaryEditGrants?: TemporaryEditGrantControlView[];
    viewerUserId?: number | null;
    baseCanEditParagraph: boolean;
    canRequestTemporaryEditGrant: boolean;
    canManageTemporaryEditGrants: boolean;
    hasError: boolean;
}

export interface TemporaryGrantControlsState {
    viewerActiveGrant: TemporaryEditGrantControlView | null;
    viewerRequestedGrant: TemporaryEditGrantControlView | null;
    requestedGrant: TemporaryEditGrantControlView | null;
    activeGrant: TemporaryEditGrantControlView | null;
    isEditableParagraph: boolean;
    canRequest: boolean;
    canIssue: boolean;
    canRevoke: boolean;
    showPanel: boolean;
    managerMode: 'requested' | 'active' | null;
}

export function resolveTemporaryGrantControls(
    input: ResolveTemporaryGrantControlsInput,
): TemporaryGrantControlsState {
    const blockGrants = (input.temporaryEditGrants || []).filter((grant) => grant.blockId === input.blockId);
    const viewerActiveGrant = blockGrants.find((grant) =>
        grant.granteeUserId === input.viewerUserId && grant.status === 'active',
    ) || null;
    const viewerRequestedGrant = blockGrants.find((grant) =>
        grant.granteeUserId === input.viewerUserId && grant.status === 'requested',
    ) || null;
    const requestedGrant = blockGrants.find((grant) => grant.status === 'requested') || null;
    const activeGrant = blockGrants.find((grant) => grant.status === 'active') || null;
    const isEditableParagraph = input.baseCanEditParagraph || Boolean(viewerActiveGrant);
    const canRequest =
        !isEditableParagraph
        && input.canRequestTemporaryEditGrant
        && !viewerRequestedGrant;
    const canIssue = input.canManageTemporaryEditGrants && Boolean(requestedGrant);
    const canRevoke = input.canManageTemporaryEditGrants && Boolean(activeGrant);
    const showPanel =
        canIssue
        || canRevoke
        || (!isEditableParagraph && (Boolean(viewerRequestedGrant) || canRequest))
        || input.hasError;

    return {
        viewerActiveGrant,
        viewerRequestedGrant,
        requestedGrant,
        activeGrant,
        isEditableParagraph,
        canRequest,
        canIssue,
        canRevoke,
        showPanel,
        managerMode: canIssue ? 'requested' : canRevoke ? 'active' : null,
    };
}

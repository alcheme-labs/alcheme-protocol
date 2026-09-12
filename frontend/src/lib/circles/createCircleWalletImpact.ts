export type CreateCircleMode = 'knowledge' | 'social';
export type CreateCircleAccessType = 'free' | 'crystal' | 'invite' | 'approval';
export type CreateCircleGenesisMode = 'BLANK' | 'SEEDED';

export interface CreateCircleWalletImpactInput {
    kind?: 'main' | 'auxiliary';
    mode?: CreateCircleMode;
    minCrystals?: number;
    accessType?: CreateCircleAccessType;
    genesisMode?: CreateCircleGenesisMode;
    descriptionChanged?: boolean;
    ghostSettingsChanged?: boolean;
    draftLifecycleChanged?: boolean;
    draftWorkflowChanged?: boolean;
    forkAnchor?: boolean;
}

export interface WalletImpactItem {
    id: string;
    kind: 'transaction' | 'message_signature' | 'funds_transfer' | 'session_signature';
    labelKey: string;
    required: boolean;
}

export interface WalletImpactSummary {
    transactionCount: number;
    messageSignatureCount: number;
    fundsTransferCount: number;
    sessionSignatureCount: number;
    totalPromptCount: number;
    items: WalletImpactItem[];
}

function normalizeMinCrystals(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
}

export function summarizeWalletImpact(items: WalletImpactItem[]): WalletImpactSummary {
    const requiredItems = items.filter((item) => item.required);
    return {
        transactionCount: requiredItems.filter((item) => item.kind === 'transaction').length,
        messageSignatureCount: requiredItems.filter((item) => item.kind === 'message_signature').length,
        fundsTransferCount: requiredItems.filter((item) => item.kind === 'funds_transfer').length,
        sessionSignatureCount: requiredItems.filter((item) => item.kind === 'session_signature').length,
        totalPromptCount: requiredItems.length,
        items,
    };
}

export function resolveCreateCircleWalletImpact(input: CreateCircleWalletImpactInput): WalletImpactSummary {
    const kind = input.kind ?? 'main';
    const mode = input.mode ?? 'knowledge';
    const accessType = input.accessType ?? (normalizeMinCrystals(input.minCrystals) > 0 ? 'crystal' : 'free');
    const effectiveMinCrystals = accessType === 'crystal' ? normalizeMinCrystals(input.minCrystals) : 0;
    const genesisMode = input.genesisMode ?? 'BLANK';

    const items: WalletImpactItem[] = [
        {
            id: 'circle_create',
            kind: 'transaction',
            labelKey: 'CreateCircleSheet.walletImpact.circleCreate',
            required: true,
        },
    ];

    const needsFlagUpdate =
        kind !== 'main'
        || mode !== 'knowledge'
        || effectiveMinCrystals > 0;

    if (needsFlagUpdate) {
        items.push({
            id: 'circle_flags_update',
            kind: 'transaction',
            labelKey: 'CreateCircleSheet.walletImpact.flagsUpdate',
            required: true,
        });
    }

    if (input.forkAnchor) {
        items.push({
            id: 'fork_anchor',
            kind: 'transaction',
            labelKey: 'CreateCircleSheet.walletImpact.forkAnchor',
            required: true,
        });
    }

    const needsPostCreateSettingsSignature =
        Boolean(input.descriptionChanged)
        || Boolean(input.ghostSettingsChanged)
        || Boolean(input.draftLifecycleChanged)
        || Boolean(input.draftWorkflowChanged)
        || genesisMode === 'SEEDED'
        || accessType !== 'free';

    if (needsPostCreateSettingsSignature) {
        items.push({
            id: 'post_create_settings_signature',
            kind: 'message_signature',
            labelKey: 'CreateCircleSheet.walletImpact.postCreateSettings',
            required: true,
        });
    }

    return summarizeWalletImpact(items);
}

type ForkContextMaterialLike = {
    originType?: string | null;
    provenance?: unknown;
};

type ForkContextReleaseProvenance = {
    releaseId: string;
    summaryDigest: string;
    audience: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isForkUpstreamReference(material: ForkContextMaterialLike): boolean {
    return String(material?.originType || '') === 'fork_upstream_reference';
}

function extractForkContextReleaseProvenance(
    material: ForkContextMaterialLike,
): ForkContextReleaseProvenance | null {
    if (!isForkUpstreamReference(material)) {
        return null;
    }
    const provenance = isRecord(material.provenance) ? material.provenance : {};
    const source = isRecord(provenance.source) ? provenance.source : {};
    const restriction = isRecord(provenance.restriction) ? provenance.restriction : {};
    const releaseId = typeof source.releaseId === 'string' ? source.releaseId.trim() : '';
    const summaryDigest = typeof source.summaryDigest === 'string' ? source.summaryDigest.trim() : '';
    const audience = String(restriction.audience || '').trim();
    if (
        source.kind !== 'fork_context_release'
        || restriction.state !== 'released_safe_summary'
        || !releaseId
        || !summaryDigest
    ) {
        return null;
    }
    return {
        releaseId,
        summaryDigest,
        audience,
    };
}

export function isForkUpstreamReferenceAvailableToTargetCircle(
    material: ForkContextMaterialLike,
): boolean {
    if (!isForkUpstreamReference(material)) {
        return true;
    }
    const release = extractForkContextReleaseProvenance(material);
    return !!release && (
        release.audience === 'public'
        || release.audience === 'target_circle'
        || release.audience === 'summary_only'
        || release.audience === 'full_source'
    );
}

export function isForkUpstreamReferenceAvailableToExternalApp(
    material: ForkContextMaterialLike,
): boolean {
    if (!isForkUpstreamReference(material)) {
        return true;
    }
    const release = extractForkContextReleaseProvenance(material);
    return !!release && (
        release.audience === 'public'
        || release.audience === 'external_app'
        || release.audience === 'external_app_summary'
    );
}

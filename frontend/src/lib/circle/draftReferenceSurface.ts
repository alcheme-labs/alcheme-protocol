interface DraftReferenceLike {
    crystalName: string;
}

interface SeededTreeNodeLike {
    nodeType: 'directory' | 'file';
    children?: SeededTreeNodeLike[];
}

export interface DraftReferenceSurfaceInput {
    isSeededCircle: boolean;
    referenceLinks: DraftReferenceLike[];
    seededFileTree: SeededTreeNodeLike[];
}

export interface DraftReferenceSurfaceViewModel {
    showPanel: boolean;
    showFormalReferenceSummary: boolean;
    showSeededEvidence: boolean;
    showAiSourceMaterials: boolean;
    formalReferenceCount: number;
    formalReferenceNames: string[];
}

export function deriveDraftReferenceSurface(
    input: DraftReferenceSurfaceInput,
): DraftReferenceSurfaceViewModel {
    const formalReferenceNames = Array.from(new Set(
        (input.referenceLinks || [])
            .map((reference) => String(reference?.crystalName || '').trim())
            .filter(Boolean),
    ));

    const showSeededEvidence = Boolean(input.isSeededCircle);

    return {
        showPanel: true,
        showFormalReferenceSummary: true,
        showSeededEvidence,
        showAiSourceMaterials: false,
        formalReferenceCount: Array.isArray(input.referenceLinks) ? input.referenceLinks.length : 0,
        formalReferenceNames,
    };
}

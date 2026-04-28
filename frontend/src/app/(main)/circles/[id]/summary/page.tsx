'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

import {
    attachStableOutputDraftBindings,
    pickAutoSelectedFrozenSummaryDraftConsumption,
    type CircleSummarySnapshot,
    type FrozenSummaryDraftConsumption,
} from '@/features/circle-summary/adapter';
import {
    fetchCircleSummaryDraftCandidates,
    fetchCircleSummarySnapshot,
    fetchCircleSummaryKnowledgeOutputs,
    fetchFrozenSummaryDraftConsumption,
} from '@/lib/api/circleSummary';
import CircleSummaryScaffold from '@/features/circle-summary/CircleSummaryScaffold';
import type { CrystalOutputViewModel } from '@/features/crystal-output/adapter';
import { useI18n } from '@/i18n/useI18n';

function parsePositiveInt(value: string | null): number | null {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

export default function CircleSummaryPage() {
    const t = useI18n('CircleSummaryPage');
    const params = useParams();
    const searchParams = useSearchParams();
    const circleId = useMemo(() => parsePositiveInt(String(params.id || '')), [params.id]);
    const draftPostId = useMemo(() => parsePositiveInt(searchParams.get('draft')), [searchParams]);

    const [snapshot, setSnapshot] = useState<CircleSummarySnapshot | null>(null);
    const [snapshotLoading, setSnapshotLoading] = useState(false);
    const [snapshotError, setSnapshotError] = useState<string | null>(null);
    const [requestedDraft, setRequestedDraft] = useState<FrozenSummaryDraftConsumption | null>(null);
    const [requestedDraftLoading, setRequestedDraftLoading] = useState(false);
    const [requestedDraftError, setRequestedDraftError] = useState<string | null>(null);
    const [outputs, setOutputs] = useState<CrystalOutputViewModel[]>([]);
    const [outputsLoading, setOutputsLoading] = useState(false);
    const [outputsError, setOutputsError] = useState<string | null>(null);
    const [draftCandidates, setDraftCandidates] = useState<FrozenSummaryDraftConsumption[]>([]);
    const [draftCandidatesLoading, setDraftCandidatesLoading] = useState(false);
    const [draftCandidatesError, setDraftCandidatesError] = useState<string | null>(null);

    useEffect(() => {
        if (!circleId) return;
        let cancelled = false;

        setSnapshotLoading(true);
        setSnapshotError(null);
        void fetchCircleSummarySnapshot({ circleId })
            .then((nextSnapshot) => {
                if (cancelled) return;
                setSnapshot(nextSnapshot);
            })
            .catch((error) => {
                if (cancelled) return;
                setSnapshot(null);
                setSnapshotError(error instanceof Error ? error.message : t('errors.fetchSnapshot'));
            })
            .finally(() => {
                if (cancelled) return;
                setSnapshotLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [circleId]);

    useEffect(() => {
        if (!circleId) return;
        let cancelled = false;

        setOutputsLoading(true);
        setOutputsError(null);
        void fetchCircleSummaryKnowledgeOutputs({
            circleId,
            messages: {
                formalOutputReadFailed: ({knowledgeId}) => t('warnings.formalOutputReadFailed', {knowledgeId}),
                partialOutputsWarning: ({count, firstWarning}) => t('warnings.partialOutputs', {
                    count,
                    firstWarning,
                }),
            },
        })
            .then((nextOutputs) => {
                if (cancelled) return;
                setOutputs(nextOutputs.outputs);
                setOutputsError(nextOutputs.warning);
            })
            .catch((error) => {
                if (cancelled) return;
                setOutputs([]);
                setOutputsError(error instanceof Error ? error.message : t('errors.fetchOutputs'));
            })
            .finally(() => {
                if (cancelled) return;
                setOutputsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [circleId, t]);

    useEffect(() => {
        if (!draftPostId) {
            setRequestedDraft(null);
            setRequestedDraftError(null);
            setRequestedDraftLoading(false);
            return;
        }

        let cancelled = false;
        setRequestedDraftLoading(true);
        setRequestedDraftError(null);

        void fetchFrozenSummaryDraftConsumption({ draftPostId })
            .then((nextDraft) => {
                if (cancelled) return;
                setRequestedDraft(nextDraft);
            })
            .catch((error) => {
                if (cancelled) return;
                setRequestedDraft(null);
                setRequestedDraftError(error instanceof Error ? error.message : t('errors.fetchDraft'));
            })
            .finally(() => {
                if (cancelled) return;
                setRequestedDraftLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [draftPostId]);

    useEffect(() => {
        if (!circleId || draftPostId || outputsLoading || snapshot) {
            if (snapshot && !draftPostId) {
                setDraftCandidates([]);
                setDraftCandidatesError(null);
                setDraftCandidatesLoading(false);
            }
            return;
        }

        if (outputs.length === 0) {
            setDraftCandidates([]);
            setDraftCandidatesError(null);
            setDraftCandidatesLoading(false);
            return;
        }

        let cancelled = false;
        setDraftCandidatesLoading(true);
        setDraftCandidatesError(null);

        void fetchCircleSummaryDraftCandidates({ circleId })
            .then((nextDraftCandidates) => {
                if (cancelled) return;
                setDraftCandidates(nextDraftCandidates);
            })
            .catch((error) => {
                if (cancelled) return;
                setDraftCandidates([]);
                setDraftCandidatesError(error instanceof Error ? error.message : t('errors.fetchDraftCandidates'));
            })
            .finally(() => {
                if (cancelled) return;
                setDraftCandidatesLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [circleId, draftPostId, outputs, outputsLoading]);

    const resolvedOutputs = useMemo(
        () => attachStableOutputDraftBindings({
            outputs,
            draftCandidates,
        }),
        [draftCandidates, outputs],
    );

    const autoSelectedDraft = useMemo(
        () => pickAutoSelectedFrozenSummaryDraftConsumption({
            requestedDraftPostId: draftPostId,
            outputs: resolvedOutputs,
            draftCandidates,
        }),
        [draftCandidates, draftPostId, resolvedOutputs],
    );

    const draft = requestedDraft ?? autoSelectedDraft;
    const draftLoading = requestedDraftLoading || draftCandidatesLoading;
    const draftError = requestedDraftError || draftCandidatesError;

    if (!circleId) {
        return null;
    }

    return (
        <CircleSummaryScaffold
            circleId={circleId}
            snapshot={snapshot}
            snapshotLoading={snapshotLoading}
            snapshotError={snapshotError}
            draft={draft}
            draftLoading={draftLoading}
            draftError={draftError}
            outputs={resolvedOutputs}
            outputsLoading={outputsLoading}
            outputsError={outputsError}
        />
    );
}

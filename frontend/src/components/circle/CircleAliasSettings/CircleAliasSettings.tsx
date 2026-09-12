'use client';

import { useEffect, useRef, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';

import { FieldAssistInline } from '@/components/alcheme';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import {
    CircleAliasApiError,
    clearMyCircleAlias,
    fetchMyCircleAlias,
    updateMyCircleAlias,
    type CircleAliasResponse,
} from '@/lib/api/circleAliases';
import {
    pollSettingsTextAssistProposal,
    requestSettingsTextAssist,
    type SettingsTextAssistProposalView,
} from '@/lib/api/settingsTextAssist';
import { formatNodeRoutingError } from '@/lib/api/nodeRouting';
import styles from './CircleAliasSettings.module.css';

interface CircleAliasSettingsProps {
    circleId: number | null | undefined;
}

type SettingsTextAssistState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; proposal: SettingsTextAssistProposalView }
    | { status: 'disabled'; message: string }
    | { status: 'error'; message: string };

const CIRCLE_ALIAS_MAX_CHARS = 32;

function trimAlias(value: string): string {
    return value.trim();
}

function resolveAliasErrorMessage(
    t: ReturnType<typeof useI18n>,
    error: unknown,
    fallbackKey: 'loadFailed' | 'saveFailed' | 'clearFailed',
): string {
    if (error instanceof CircleAliasApiError) {
        if (error.status === 401 || error.code === 'auth_session_required' || error.code === 'auth_session_mismatch') {
            return t('alias.errors.authSessionRequired');
        }
        if (error.status === 403 || error.code === 'circle_alias_membership_required') {
            return t('alias.errors.membershipRequired');
        }
        if (error.status === 429 || error.code === 'Too many requests') {
            return t('alias.errors.rateLimited');
        }
        if (
            error.code === 'circle_alias_required'
            || error.code === 'circle_alias_length_invalid'
            || error.code === 'circle_alias_reserved'
        ) {
            return t('alias.errors.invalidAlias');
        }
    }

    return t(`alias.errors.${fallbackKey}`);
}

export default function CircleAliasSettings({ circleId }: CircleAliasSettingsProps) {
    const t = useI18n('CircleSettingsSheet');
    const locale = useCurrentLocale();
    const [data, setData] = useState<CircleAliasResponse | null>(null);
    const [draft, setDraft] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [settingsTextAssistState, setSettingsTextAssistState] = useState<SettingsTextAssistState>({ status: 'idle' });
    const settingsTextAssistAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (!circleId) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetchMyCircleAlias(circleId)
            .then((next) => {
                if (cancelled) return;
                setData(next);
                setDraft(next.alias ?? '');
            })
            .catch((error) => {
                if (!cancelled) setError(resolveAliasErrorMessage(t, error, 'loadFailed'));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [circleId, t]);

    useEffect(() => () => {
        settingsTextAssistAbortRef.current?.abort();
    }, []);

    if (!circleId) return null;

    const currentName = data?.effectiveDisplay.effectiveName || data?.alias || t('alias.empty');
    const inheritedCircleName = data?.inheritedFromCircle?.name ?? null;
    const normalizedDraft = trimAlias(draft);
    const canSave = normalizedDraft.length > 0 && normalizedDraft !== (data?.alias ?? '') && !saving;
    const canClear = Boolean(data?.alias) && !saving;

    const handleSave = async () => {
        if (!canSave) return;
        setSaving(true);
        setError(null);
        try {
            const next = await updateMyCircleAlias(circleId, normalizedDraft);
            setData(next);
            setDraft(next.alias ?? '');
        } catch (error) {
            setError(resolveAliasErrorMessage(t, error, 'saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    const handleClear = async () => {
        if (!canClear) return;
        setSaving(true);
        setError(null);
        try {
            const next = await clearMyCircleAlias(circleId);
            setData(next);
            setDraft(next.alias ?? '');
        } catch (error) {
            setError(resolveAliasErrorMessage(t, error, 'clearFailed'));
        } finally {
            setSaving(false);
        }
    };

    const clearSettingsTextAssist = () => {
        settingsTextAssistAbortRef.current?.abort();
        settingsTextAssistAbortRef.current = null;
        setSettingsTextAssistState({ status: 'idle' });
    };

    const handleGenerateAliasAssist = async () => {
        if (!circleId || loading || saving || settingsTextAssistState.status === 'loading') return;
        settingsTextAssistAbortRef.current?.abort();
        const controller = new AbortController();
        settingsTextAssistAbortRef.current = controller;
        setSettingsTextAssistState({ status: 'loading' });
        try {
            const response = await requestSettingsTextAssist({
                field: 'circle_alias.alias',
                circleId,
                locale,
                userIntent: t('alias.fieldAssist.intent'),
                currentValue: draft,
                surroundingValues: {
                    alias: draft,
                    circleName: data?.inheritedFromCircle?.name ?? '',
                },
            });
            if (response.status === 'disabled') {
                setSettingsTextAssistState({ status: 'disabled', message: t('alias.fieldAssist.disabled') });
                return;
            }
            if (!response.jobId) {
                setSettingsTextAssistState({ status: 'error', message: t('alias.fieldAssist.didNotStart') });
                return;
            }
            const proposal = await pollSettingsTextAssistProposal(response.jobId, {
                signal: controller.signal,
            });
            if (!proposal?.proposedDiff.suggestedValue) {
                setSettingsTextAssistState({ status: 'error', message: t('alias.fieldAssist.empty') });
                return;
            }
            setSettingsTextAssistState({ status: 'ready', proposal });
        } catch (error) {
            if ((error as any)?.name === 'AbortError') return;
            setSettingsTextAssistState({
                status: 'error',
                message: formatNodeRoutingError(error, t('alias.fieldAssist.failed')),
            });
        } finally {
            if (settingsTextAssistAbortRef.current === controller) {
                settingsTextAssistAbortRef.current = null;
            }
        }
    };

    const handleAcceptAliasAssist = () => {
        if (settingsTextAssistState.status !== 'ready') return;
        const value = settingsTextAssistState.proposal.proposedDiff.suggestedValue;
        if (typeof value === 'string') setDraft(value.slice(0, CIRCLE_ALIAS_MAX_CHARS));
        clearSettingsTextAssist();
    };

    return (
        <div className={styles.aliasPanel}>
            <div className={styles.aliasHeader}>
                <div>
                    <div className={styles.aliasTitle}>{t('alias.title')}</div>
                    <div className={styles.aliasCurrent}>
                        {loading ? t('alias.loading') : t('alias.current', { name: currentName })}
                    </div>
                </div>
                {inheritedCircleName && (
                    <span className={styles.inheritedBadge}>
                        {t('alias.inheritedFrom', { circleName: inheritedCircleName })}
                    </span>
                )}
            </div>

            <div className={styles.aliasForm}>
                <input
                    className={styles.aliasInput}
                    value={draft}
                    maxLength={CIRCLE_ALIAS_MAX_CHARS}
                    placeholder={t('alias.placeholder')}
                    onChange={(event) => setDraft(event.target.value)}
                    disabled={loading || saving}
                />
                <FieldAssistInline
                    status={settingsTextAssistState.status}
                    requestLabel={t('alias.fieldAssist.requestLabel')}
                    loadingLabel={t('alias.fieldAssist.loadingLabel')}
                    acceptLabel={t('alias.fieldAssist.acceptLabel')}
                    ignoreLabel={t('alias.fieldAssist.ignoreLabel')}
                    suggestion={settingsTextAssistState.status === 'ready'
                        ? settingsTextAssistState.proposal.proposedDiff.suggestedValue
                        : null}
                    reason={settingsTextAssistState.status === 'ready'
                        ? settingsTextAssistState.proposal.proposedDiff.reason
                        : null}
                    errorMessage={settingsTextAssistState.status === 'error' ? settingsTextAssistState.message : null}
                    disabledReason={settingsTextAssistState.status === 'disabled' ? settingsTextAssistState.message : null}
                    disabled={loading || saving}
                    onRequest={() => { void handleGenerateAliasAssist(); }}
                    onAccept={handleAcceptAliasAssist}
                    onIgnore={clearSettingsTextAssist}
                />
                <div className={styles.aliasActions}>
                    <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => { void handleSave(); }}
                        disabled={!canSave}
                    >
                        <Save size={14} />
                        <span>{saving ? t('alias.saving') : t('alias.save')}</span>
                    </button>
                    <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => { void handleClear(); }}
                        disabled={!canClear}
                    >
                        <Trash2 size={14} />
                        <span>{t('alias.clear')}</span>
                    </button>
                </div>
            </div>
            {error && <div className={styles.aliasError}>{error}</div>}
        </div>
    );
}

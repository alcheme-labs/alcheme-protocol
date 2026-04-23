import { useI18n } from '@/i18n/useI18n';
import styles from './GhostReveal.module.css';
import type {
    GhostDraftCandidateView,
    GhostDraftStatus,
    GhostDraftSuggestionView,
} from '@/hooks/useGhostDraftGeneration';

function renderMetadata(
    candidate: GhostDraftCandidateView | null | undefined,
    t: ReturnType<typeof useI18n>,
) {
    if (!candidate) return null;

    return (
        <>
            {candidate.model && (
                <p className={styles.metaLine}>{t('metadata.model', {model: candidate.model})}</p>
            )}
            {candidate.provenance?.promptVersion && (
                <p className={styles.metaLine}>
                    {t('metadata.promptVersion', {
                        asset: candidate.provenance.promptAsset,
                        version: candidate.provenance.promptVersion,
                    })}
                </p>
            )}
            {candidate.provenance?.sourceDigest && (
                <p className={styles.metaLine}>
                    {t('metadata.sourceDigest', {
                        digest: candidate.provenance.sourceDigest.slice(0, 12),
                    })}
                </p>
            )}
        </>
    );
}

interface GhostRevealProps {
    status: GhostDraftStatus;
    title?: string;
    candidate?: GhostDraftCandidateView | null;
    error?: string | null;
    issueThreadCount?: number;
    canGenerate?: boolean;
    canAccept?: boolean;
    acceptDisabledReason?: string | null;
    canSafelyAutoApply?: boolean;
    onGenerate?: () => void;
    onAccept?: (suggestion: GhostDraftSuggestionView) => void;
    onIgnore?: () => void;
    onRetry?: () => void;
}

function getIssueThreadCount(props: GhostRevealProps): number {
    return Math.max(0, Number(props.issueThreadCount || 0));
}

function renderBody(props: GhostRevealProps, t: ReturnType<typeof useI18n>) {
    const issueThreadCount = getIssueThreadCount(props);

    if (props.status === 'pending') {
        return (
            <div className={styles.statusBlock} role="status">
                <p className={styles.statusTitle}>{t('states.pending.title')}</p>
                <p className={styles.statusHint}>{t('states.pending.hint', { count: issueThreadCount })}</p>
            </div>
        );
    }

    if (props.status === 'error') {
        return (
            <div className={styles.statusBlock} role="status">
                <p className={styles.statusTitle}>{t('states.error.title')}</p>
                <p className={styles.statusError}>{props.error || t('states.error.fallback')}</p>
                <button type="button" className={styles.primaryButton} onClick={props.onRetry}>
                    {t('actions.retry')}
                </button>
            </div>
        );
    }

    if (props.status === 'applied') {
        return (
            <div className={styles.statusBlock} role="status">
                <p className={styles.statusTitle}>{t('states.applied.title')}</p>
                <p className={styles.statusHint}>{t('states.applied.hint')}</p>
                {renderMetadata(props.candidate, t)}
            </div>
        );
    }

    if (props.status === 'accepted') {
        return (
            <div className={styles.statusBlock} role="status">
                <p className={styles.statusTitle}>{t('states.accepted.title')}</p>
                <p className={styles.statusHint}>{t('states.accepted.hint')}</p>
                {renderMetadata(props.candidate, t)}
            </div>
        );
    }

    if (props.status === 'candidate' && props.candidate) {
        const suggestions = props.candidate.suggestions;
        return (
            <div className={styles.statusBlock} role="status">
                <p className={styles.statusTitle}>{t('states.candidate.title')}</p>
                <p className={styles.statusHint}>
                    {props.canSafelyAutoApply
                        ? t('states.candidate.emptyDraftHint', { count: issueThreadCount })
                        : t('states.candidate.existingDraftHint', { count: issueThreadCount })}
                </p>
                <p className={styles.statusHint}>{t('states.candidate.carryHint')}</p>
                <div className={styles.suggestionList}>
                    {suggestions.map((suggestion) => (
                        <article key={suggestion.suggestionId} className={styles.suggestionCard}>
                            <div className={styles.suggestionHeader}>
                                <p className={styles.suggestionTarget}>
                                    {t('candidate.targetLabel', {
                                        targetRef: suggestion.targetRef,
                                        count: suggestion.threadIds.length,
                                    })}
                                </p>
                                {suggestion.summary && (
                                    <p className={styles.suggestionSummary}>{suggestion.summary}</p>
                                )}
                            </div>
                            <pre className={styles.preview}>{suggestion.suggestedText}</pre>
                            <div className={styles.actions}>
                                <button
                                    type="button"
                                    className={styles.primaryButton}
                                    onClick={() => props.onAccept?.(suggestion)}
                                    disabled={!props.canAccept}
                                >
                                    {t('actions.accept')}
                                </button>
                            </div>
                            {!props.canAccept && props.acceptDisabledReason && (
                                <p className={styles.statusHint}>{props.acceptDisabledReason}</p>
                            )}
                        </article>
                    ))}
                </div>
                {renderMetadata(props.candidate, t)}
                <div className={styles.actions}>
                    <button type="button" className={styles.secondaryButton} onClick={props.onIgnore}>
                        {t('actions.ignore')}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.statusBlock} role="status">
            <p className={styles.statusTitle}>{t('states.idle.title')}</p>
            <p className={styles.statusHint}>{t('states.idle.hint', { count: issueThreadCount })}</p>
            <button
                type="button"
                className={styles.primaryButton}
                onClick={props.onGenerate}
                disabled={!props.canGenerate}
            >
                {t('actions.generate')}
            </button>
        </div>
    );
}

export default function GhostReveal(props: GhostRevealProps) {
    const t = useI18n('GhostReveal');
    const title = props.title || t('defaultTitle');

    return (
        <section className={`${styles.ghost} ${styles.revealed}`} aria-label={title}>
            <div className={styles.edgeGlow} aria-hidden="true" />
            <div className={styles.systemPrompt}>
                <span className={styles.promptIcon} aria-hidden="true">AI</span>
                <span className={styles.promptText}>{title}</span>
            </div>
            <div className={styles.content}>
                <div className={styles.title}>{title}</div>
                {renderBody(props, t)}
            </div>
        </section>
    );
}

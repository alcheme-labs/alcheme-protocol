import type { DraftDiscussionWorkbenchItem } from './draftDiscussionWorkbenchModel';
import styles from './DraftDiscussionPanel.module.css';

interface DraftDiscussionThreadCardProps {
    item: DraftDiscussionWorkbenchItem;
    stateLabel: string;
    issueTypeLabel: string;
    highlighted?: boolean;
    onOpen?: () => void;
}

export default function DraftDiscussionThreadCard({
    item,
    stateLabel,
    issueTypeLabel,
    highlighted = false,
    onOpen,
}: DraftDiscussionThreadCardProps) {
    return (
        <article
            className={styles.workbenchThreadCard}
            data-current-version={item.isCurrentVersion ? 'true' : undefined}
            data-recent={highlighted ? 'true' : undefined}
            role={onOpen ? 'button' : undefined}
            tabIndex={onOpen ? 0 : undefined}
            onClick={onOpen}
            onKeyDown={(event) => {
                if (!onOpen) return;
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpen();
                }
            }}
        >
            <header className={styles.workbenchThreadHeader}>
                <div className={styles.workbenchThreadTitleBlock}>
                    <p className={styles.workbenchThreadTarget}>{item.targetLabel}</p>
                    <p className={styles.workbenchThreadVersion}>{item.versionLabel}</p>
                </div>
                <div className={styles.threadBadges}>
                    <span className={styles.issueTypeBadge}>{issueTypeLabel}</span>
                    <span className={styles.stateBadge}>{stateLabel}</span>
                </div>
            </header>

            <p className={styles.workbenchThreadSummary}>{item.primarySummary}</p>

            {item.latestActivitySummary && (
                <p className={styles.workbenchThreadActivity}>{item.latestActivitySummary}</p>
            )}

            <div className={styles.workbenchNextStep}>
                <span className={styles.workbenchNextStepLabel}>{item.nextStepLabel}</span>
                {item.disabledReason && (
                    <span className={styles.workbenchDisabledReason}>{item.disabledReason}</span>
                )}
            </div>
        </article>
    );
}

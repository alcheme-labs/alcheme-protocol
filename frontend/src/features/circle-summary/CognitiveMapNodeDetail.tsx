import Link from 'next/link';

import type {
    CognitiveMapAction,
    CognitiveMapNodeView,
} from './adapter';
import { useI18n } from '@/i18n/useI18n';
import styles from './CircleSummaryScaffold.module.css';

interface CognitiveMapNodeDetailProps {
    node: CognitiveMapNodeView;
}

function actionContent(action: CognitiveMapAction, label: string) {
    return (
        <>
            <span>{label}</span>
            {!action.enabled && action.disabledReason && (
                <small>{action.disabledReason}</small>
            )}
        </>
    );
}

function ActionControl({
    action,
    className,
    label,
}: {
    action: CognitiveMapAction;
    className: string;
    label: string;
}) {
    if (action.enabled && action.href) {
        return (
            <Link href={action.href} className={className}>
                {actionContent(action, label)}
            </Link>
        );
    }
    return (
        <button
            type="button"
            className={className}
            disabled={!action.enabled}
        >
            {actionContent(action, label)}
        </button>
    );
}

export default function CognitiveMapNodeDetail({
    node,
}: CognitiveMapNodeDetailProps) {
    const t = useI18n('CircleSummaryCognitiveMap');
    const primaryAction = node.primaryAction;
    const statusLabel = node.circleId
        ? t(`access.${node.accessState}`)
        : node.statusLabel || node.recommendationSource || t('detail.fallbackStatus');

    return (
        <aside
            className={styles.nodeDetail}
            data-cognitive-map-node-detail
            data-node-id={node.id}
        >
            <div className={styles.nodeDetailHeader}>
                <span className={styles.branchRouteLabel}>{t(`nodeKinds.${node.kind}`)}</span>
                <h3 className={styles.branchTitle}>{node.title}</h3>
                <p className={styles.branchRouteHint}>
                    {statusLabel}
                </p>
            </div>

            <ActionControl
                action={primaryAction}
                label={t(`actions.${primaryAction.kind}`)}
                className={styles.detailPrimaryAction}
            />

            {node.secondaryActions.length > 0 && (
                <div className={styles.detailSecondaryActions}>
                    {node.secondaryActions.map((action) => (
                        <ActionControl
                            key={`${action.kind}-${action.label}`}
                            action={action}
                            label={t(`actions.${action.kind}`)}
                            className={styles.detailSecondaryAction}
                        />
                    ))}
                </div>
            )}
        </aside>
    );
}

'use client';

import { useI18n } from '@/i18n/useI18n';

export interface GovernanceExecutionRecoveryPresentation {
    blocker: string | null;
    category: string | null;
    action: string | null;
    retryMode: string | null;
    nextEligibleAt: string | null;
    acceptedDecisionPreserved: true;
}

export default function GovernanceExecutionRecoveryStatus({
    recovery,
    boundaryText,
    blockerText,
    className,
}: {
    recovery: GovernanceExecutionRecoveryPresentation;
    boundaryText: string;
    blockerText: string | null;
    className?: string;
}) {
    const t = useI18n('GovernanceExecutionRecovery');
    return (
        <div
            className={className}
            role="alert"
            data-provider-recovery={recovery.category ?? 'unclassified'}
            data-recovery-blocker={recovery.blocker ?? 'unavailable'}
            data-recovery-action={recovery.action ?? 'unavailable'}
            data-governance-decision-preserved={recovery.acceptedDecisionPreserved}
        >
            <strong>{boundaryText}</strong>
            {blockerText ? <span>{blockerText}</span> : null}
            {recovery.category ? <span>{t(`category.${recovery.category}`)}</span> : null}
            {recovery.action ? <span>{t(`action.${recovery.action}`)}</span> : null}
            {recovery.retryMode ? <span>{t(`retryMode.${recovery.retryMode}`)}</span> : null}
            {recovery.nextEligibleAt ? (
                <time dateTime={recovery.nextEligibleAt}>
                    {new Date(recovery.nextEligibleAt).toLocaleString()}
                </time>
            ) : null}
        </div>
    );
}

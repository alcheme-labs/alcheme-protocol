'use client';

import { useI18n } from '@/i18n/useI18n';

export interface GovernanceProviderIncidentPresentation {
    id: string;
    state: 'suspected' | 'confirmed' | 'contained' | 'reconciled';
    evidenceDigest: string;
    occurredAt: string;
    pendingExecution: 'blocked' | 'eligible_after_reconciliation';
    originalDecisionAndReceipt: 'preserved';
}

export default function GovernanceProviderIncidentStatus({
    incident,
}: {
    incident: GovernanceProviderIncidentPresentation;
}) {
    const t = useI18n('GovernanceProviderIncident');
    return (
        <span
            role={incident.pendingExecution === 'blocked' ? 'alert' : 'status'}
            data-provider-incident={incident.state}
            data-provider-pending-execution={incident.pendingExecution}
            data-provider-original-decision-receipt={incident.originalDecisionAndReceipt}
        >
            {t(`state.${incident.state}`)}
            {' · '}{t(`pendingExecution.${incident.pendingExecution}`)}
            {' · '}{t('decisionReceiptPreserved')}
            {' · '}{incident.id.slice(0, 12)}…
            {' · '}{incident.evidenceDigest.slice(0, 12)}…
            {' · '}{new Date(incident.occurredAt).toLocaleString()}
        </span>
    );
}

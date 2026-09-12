import type { CircleGovernanceRequest } from '@/lib/api/governance';

type DecisionStatus = CircleGovernanceRequest['decisionStatus'] | 'not_ready';
type ExecutionStatus = CircleGovernanceRequest['executionStatus'];

export default function GovernanceDecisionExecutionStatus({
    decisionStatus,
    executionStatus,
    decisionText,
    executionText,
    className,
    statusClassName,
}: {
    decisionStatus: DecisionStatus;
    executionStatus: ExecutionStatus;
    decisionText: string;
    executionText: string;
    className?: string;
    statusClassName?: string;
}) {
    return (
        <div
            className={className}
            role="status"
            aria-label={`${decisionText}; ${executionText}`}
            data-governance-decision-status={decisionStatus}
            data-governance-execution-status={executionStatus}
        >
            <span className={statusClassName} data-governance-status-kind="decision">
                {decisionText}
            </span>
            {' · '}
            <span className={statusClassName} data-governance-status-kind="execution">
                {executionText}
            </span>
        </div>
    );
}

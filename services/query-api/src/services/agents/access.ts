import type { CircleActor } from '../auth/actor';

export interface AgentManagementDecision {
    allowed: boolean;
    statusCode: number;
    error: string;
    message: string;
    circleId: number | null;
}

function isManagerRole(role: unknown): boolean {
    const normalized = String(role ?? '');
    return normalized === 'Owner' || normalized === 'Admin';
}

export function assertAgentManagementActor(actor: CircleActor): AgentManagementDecision {
    if (!isManagerRole(actor.membership.role)) {
        return {
            allowed: false,
            statusCode: 403,
            error: 'agent_management_forbidden',
            message: 'only circle owners or admins can manage agents',
            circleId: actor.circle.id,
        };
    }

    return {
        allowed: true,
        statusCode: 200,
        error: 'ok',
        message: 'ok',
        circleId: actor.circle.id,
    };
}

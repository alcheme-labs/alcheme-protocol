import type { GuardianFindingLevel, GuardianFindingNotificationStatus } from './types';

export interface GuardianOpsAlertEmail {
    to: string;
    subject: string;
    body: string;
}

interface NotifyGuardianFindingInput {
    findingId: string;
    circleId: number;
    level: GuardianFindingLevel;
    title: string;
    summary: string;
    opsEmails: string[];
    sendEmail?: (email: GuardianOpsAlertEmail) => Promise<void>;
}

export async function notifyGuardianFindingRecipients(
    prisma: any,
    input: NotifyGuardianFindingInput,
): Promise<{
    status: GuardianFindingNotificationStatus;
    recipientCount: number;
    error?: string;
}> {
    if (input.level === 'observe') {
        await updateNotificationState(prisma, input.findingId, 'skipped', null);
        return {
            status: 'skipped',
            recipientCount: 0,
        };
    }

    const recipientEmails = normalizeOpsEmails(input.opsEmails);
    if (recipientEmails.length === 0) {
        await updateNotificationState(prisma, input.findingId, 'skipped', 'ops_alert_email_not_configured');
        return {
            status: 'skipped',
            recipientCount: 0,
        };
    }

    try {
        const sendEmail = input.sendEmail ?? sendGuardianOpsAlertEmail;
        await Promise.all(recipientEmails.map((to) => sendEmail({
            to,
            subject: `[Alcheme Guardian] ${input.title}`,
            body: [
                input.summary,
                '',
                `Finding: ${input.findingId}`,
                `Circle: ${input.circleId}`,
                `Level: ${input.level}`,
            ].join('\n'),
        })));
        await updateNotificationState(prisma, input.findingId, 'sent', null);
        return {
            status: 'sent',
            recipientCount: recipientEmails.length,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await updateNotificationState(prisma, input.findingId, 'failed', message);
        return {
            status: 'failed',
            recipientCount: recipientEmails.length,
            error: message,
        };
    }
}

export async function recordGuardianFindingNotificationFailure(
    prisma: any,
    input: {
        findingId: string;
        error: unknown;
    },
): Promise<void> {
    const message = input.error instanceof Error ? input.error.message : String(input.error);
    await updateNotificationState(prisma, input.findingId, 'failed', message);
}

export async function sendGuardianOpsAlertEmail(input: GuardianOpsAlertEmail): Promise<void> {
    console.warn('[Guardian ops alert email transport pending]', {
        to: input.to,
        subject: input.subject,
    });
    throw new Error('ops_alert_email_transport_not_configured');
}

export function parseOpsAlertEmails(raw: unknown): string[] {
    return normalizeOpsEmails(String(raw || '').split(','));
}

async function updateNotificationState(
    prisma: any,
    findingId: string,
    status: GuardianFindingNotificationStatus,
    error: string | null,
): Promise<void> {
    if (typeof prisma?.guardianFinding?.update !== 'function') return;
    await prisma.guardianFinding.update({
        where: { id: findingId },
        data: {
            notificationStatus: status,
            notificationError: error,
        },
    });
}

function normalizeOpsEmails(values: readonly unknown[]): string[] {
    const emails = new Set<string>();
    for (const value of values) {
        const email = String(value || '').trim().toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
        emails.add(email);
    }
    return [...emails];
}

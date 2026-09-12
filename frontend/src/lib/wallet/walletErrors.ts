export type NormalizedWalletErrorCode =
    | 'phantom_port_disconnected'
    | 'user_rejected'
    | 'wallet_not_ready'
    | 'wallet_not_selected'
    | 'wallet_action_already_in_flight'
    | 'wallet_connection_failed'
    | 'wallet_signature_failed'
    | 'wallet_transaction_failed';

export interface NormalizedWalletError {
    code: NormalizedWalletErrorCode;
    messageKey: string;
    rawMessage: string;
}

function collectErrorMessages(error: unknown, seen = new Set<unknown>()): string[] {
    if (!error || seen.has(error)) return [];
    seen.add(error);

    if (typeof error === 'string') return [error];
    if (typeof error !== 'object') return [String(error)];

    const messages: string[] = [];
    const record = error as {
        name?: unknown;
        message?: unknown;
        code?: unknown;
        error?: unknown;
        cause?: unknown;
    };
    if (typeof record.name === 'string') messages.push(record.name);
    if (typeof record.message === 'string') messages.push(record.message);
    if (typeof record.code === 'string' || typeof record.code === 'number') {
        messages.push(String(record.code));
    }
    messages.push(...collectErrorMessages(record.error, seen));
    messages.push(...collectErrorMessages(record.cause, seen));
    return messages.filter((message) => message.trim().length > 0);
}

export function normalizeWalletError(error: unknown): NormalizedWalletError {
    const rawMessage = collectErrorMessages(error).join(' ') || String(error ?? '');
    const message = rawMessage.toLowerCase();

    if (
        message.includes('disconnected port')
        || message.includes('failed to send message to service worker')
        || message.includes('attempting to use a disconnected port object')
    ) {
        return {
            code: 'phantom_port_disconnected',
            messageKey: 'errors.phantomPortDisconnected',
            rawMessage,
        };
    }

    if (
        message.includes('user rejected')
        || message.includes('user denied')
        || message.includes('rejected the request')
        || message.includes('cancelled')
    ) {
        return {
            code: 'user_rejected',
            messageKey: 'errors.userRejected',
            rawMessage,
        };
    }

    if (message.includes('not ready') || message.includes('wallet_not_ready')) {
        return {
            code: 'wallet_not_ready',
            messageKey: 'errors.walletNotReady',
            rawMessage,
        };
    }

    if (message.includes('not selected') || message.includes('wallet_not_selected')) {
        return {
            code: 'wallet_not_selected',
            messageKey: 'errors.walletNotSelected',
            rawMessage,
        };
    }

    if (message.includes('wallet_action_already_in_flight')) {
        return {
            code: 'wallet_action_already_in_flight',
            messageKey: 'errors.actionAlreadyInFlight',
            rawMessage,
        };
    }

    if (message.includes('sign')) {
        return {
            code: 'wallet_signature_failed',
            messageKey: 'errors.signatureFailed',
            rawMessage,
        };
    }

    if (message.includes('transaction')) {
        return {
            code: 'wallet_transaction_failed',
            messageKey: 'errors.transactionFailed',
            rawMessage,
        };
    }

    return {
        code: 'wallet_connection_failed',
        messageKey: 'errors.connectionFailed',
        rawMessage,
    };
}

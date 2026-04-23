export interface DiscussionSessionTokenOptions {
    forceNew?: boolean;
}

export function isDiscussionSessionAuthError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return (
        message.includes('invalid_discussion_session_token')
        || message.includes('discussion_session_not_found')
        || message.includes('discussion_session_token_mismatch')
        || message.includes('discussion_session_required')
        || message.includes('discussion_session_id_mismatch')
        || message.includes('missing_discussion_session_token')
    );
}

export async function runWithDiscussionSessionRecovery<T>(input: {
    useSessionTokenAuth: boolean;
    getToken: (options?: DiscussionSessionTokenOptions) => Promise<string | null>;
    resetSession: () => void;
    run: (token: string | null) => Promise<T>;
}): Promise<T> {
    const token = await input.getToken();

    try {
        return await input.run(token);
    } catch (error) {
        if (!input.useSessionTokenAuth || !isDiscussionSessionAuthError(error)) {
            throw error;
        }

        input.resetSession();
        const freshToken = await input.getToken({ forceNew: true });
        return input.run(freshToken);
    }
}

export interface DiscussionWalletPolicyInput {
    discussionAuthMode?: string | null;
    requireSignature?: string | null;
}

export interface DiscussionWalletPolicy {
    useSessionTokenAuth: boolean;
    shouldSignEachMessage: boolean;
    requiresWalletPromptPerMessage: boolean;
}

export function resolveDiscussionWalletPolicy(input: DiscussionWalletPolicyInput): DiscussionWalletPolicy {
    const useSessionTokenAuth = (input.discussionAuthMode || 'session_token') === 'session_token';
    const shouldSignEachMessage = !useSessionTokenAuth && input.requireSignature === 'true';
    return {
        useSessionTokenAuth,
        shouldSignEachMessage,
        requiresWalletPromptPerMessage: shouldSignEachMessage,
    };
}

export type BrowserOnlyMockUnsupportedAction =
    | 'identity_registration'
    | 'create_circle'
    | 'join_circle'
    | 'leave_circle'
    | 'update_member_role'
    | 'remove_member'
    | 'onchain_transaction';

export function isBrowserOnlyMockWallet(
    envValue = process.env.NEXT_PUBLIC_E2E_WALLET_MOCK,
): boolean {
    return envValue === '1';
}

export function getBrowserOnlyMockUnsupportedError(
    action: BrowserOnlyMockUnsupportedAction,
): string {
    return `browser_only_mock_unsupported:${action}`;
}

export function assertBrowserMockCannotFinalizeOnchain(
    action: BrowserOnlyMockUnsupportedAction = 'onchain_transaction',
): never {
    throw new Error(getBrowserOnlyMockUnsupportedError(action));
}

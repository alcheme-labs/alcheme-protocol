export const WALLET_ONLY_DEV_SANDBOX_ERROR = 'wallet_only_dev_requires_sandbox_environment';

export function isWalletOnlyDevSandboxEnvironment(environment: string | null | undefined): boolean {
    return environment === 'sandbox';
}

export function assertWalletOnlyDevSandboxEnvironment(environment: string | null | undefined): void {
    if (!isWalletOnlyDevSandboxEnvironment(environment)) {
        throw new Error(WALLET_ONLY_DEV_SANDBOX_ERROR);
    }
}

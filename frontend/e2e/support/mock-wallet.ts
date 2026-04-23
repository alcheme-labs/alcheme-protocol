import type { Page } from '@playwright/test';

export const E2E_WALLET_NAME = 'Codex E2E Wallet';
export const E2E_WALLET_PUBKEY = '11111111111111111111111111111111';

export async function installMockWallet(
    page: Page,
    input?: { pubkey?: string },
) {
    const pubkey = input?.pubkey || E2E_WALLET_PUBKEY;
    await page.addInitScript(
        ({ walletName, walletPubkey }) => {
            if (!window.localStorage.getItem('walletName')) {
                window.localStorage.setItem('walletName', JSON.stringify(walletName));
            }
            if (!window.localStorage.getItem('alcheme_e2e_wallet_pubkey')) {
                window.localStorage.setItem('alcheme_e2e_wallet_pubkey', walletPubkey);
            }
        },
        {
            walletName: E2E_WALLET_NAME,
            walletPubkey: pubkey,
        },
    );
}

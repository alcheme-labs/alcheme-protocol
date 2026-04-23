'use client';

import { useMemo } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Wallet } from '@coral-xyz/anchor';
import { Alcheme } from '@alcheme/sdk';

const REQUIRED_PROGRAM_ID_ENV = [
    'NEXT_PUBLIC_IDENTITY_PROGRAM_ID',
    'NEXT_PUBLIC_CONTENT_PROGRAM_ID',
    'NEXT_PUBLIC_ACCESS_PROGRAM_ID',
    'NEXT_PUBLIC_EVENT_PROGRAM_ID',
    'NEXT_PUBLIC_FACTORY_PROGRAM_ID',
    'NEXT_PUBLIC_MESSAGING_PROGRAM_ID',
    'NEXT_PUBLIC_CIRCLES_PROGRAM_ID',
    'NEXT_PUBLIC_CONTRIBUTION_ENGINE_PROGRAM_ID',
] as const;

const RAW_PROGRAM_ID_ENV = {
    NEXT_PUBLIC_IDENTITY_PROGRAM_ID: process.env.NEXT_PUBLIC_IDENTITY_PROGRAM_ID,
    NEXT_PUBLIC_CONTENT_PROGRAM_ID: process.env.NEXT_PUBLIC_CONTENT_PROGRAM_ID,
    NEXT_PUBLIC_ACCESS_PROGRAM_ID: process.env.NEXT_PUBLIC_ACCESS_PROGRAM_ID,
    NEXT_PUBLIC_EVENT_PROGRAM_ID: process.env.NEXT_PUBLIC_EVENT_PROGRAM_ID,
    NEXT_PUBLIC_FACTORY_PROGRAM_ID: process.env.NEXT_PUBLIC_FACTORY_PROGRAM_ID,
    NEXT_PUBLIC_MESSAGING_PROGRAM_ID: process.env.NEXT_PUBLIC_MESSAGING_PROGRAM_ID,
    NEXT_PUBLIC_CIRCLES_PROGRAM_ID: process.env.NEXT_PUBLIC_CIRCLES_PROGRAM_ID,
    NEXT_PUBLIC_CONTRIBUTION_ENGINE_PROGRAM_ID: process.env.NEXT_PUBLIC_CONTRIBUTION_ENGINE_PROGRAM_ID,
} satisfies Record<typeof REQUIRED_PROGRAM_ID_ENV[number], string | undefined>;

function getRequiredProgramId(envName: keyof typeof RAW_PROGRAM_ID_ENV): string {
    const value = RAW_PROGRAM_ID_ENV[envName];
    if (!value) {
        throw new Error(`Missing required frontend program ID env: ${envName}`);
    }
    return value;
}

const PROGRAM_IDS = {
    identity: getRequiredProgramId('NEXT_PUBLIC_IDENTITY_PROGRAM_ID'),
    content: getRequiredProgramId('NEXT_PUBLIC_CONTENT_PROGRAM_ID'),
    access: getRequiredProgramId('NEXT_PUBLIC_ACCESS_PROGRAM_ID'),
    event: getRequiredProgramId('NEXT_PUBLIC_EVENT_PROGRAM_ID'),
    factory: getRequiredProgramId('NEXT_PUBLIC_FACTORY_PROGRAM_ID'),
    messaging: getRequiredProgramId('NEXT_PUBLIC_MESSAGING_PROGRAM_ID'),
    circles: getRequiredProgramId('NEXT_PUBLIC_CIRCLES_PROGRAM_ID'),
    contributionEngine: getRequiredProgramId('NEXT_PUBLIC_CONTRIBUTION_ENGINE_PROGRAM_ID'),
};

/**
 * useAlchemeSDK — 初始化 Alcheme SDK 实例
 *
 * 依赖 wallet-adapter 提供的 connection + wallet。
 * 钱包未连接时返回 null。
 */
export function useAlchemeSDK(): Alcheme | null {
    const { connection } = useConnection();
    const wallet = useWallet();

    const sdk = useMemo(() => {
        /*
         * The draft lifecycle "enter crystallization / archive / restore" actions only need a
         * normal single-transaction signer. Some wallet adapters in local/dev flows expose
         * `signTransaction` but not `signAllTransactions`, and the stricter check here incorrectly
         * made the UI behave like "wallet not connected" even though the wallet was usable.
         *
         * Keep requiring a real public key + single-transaction signer, but synthesize
         * `signAllTransactions` from `signTransaction` when the adapter does not implement it.
         * That keeps Anchor happy without falsely blocking lifecycle actions behind a capability
         * they do not actually need.
         */
        if (!wallet.publicKey || !wallet.signTransaction) {
            return null;
        }

        const signAllTransactions = wallet.signAllTransactions
            ? wallet.signAllTransactions.bind(wallet)
            : async <T>(transactions: T[]): Promise<T[]> => {
                const signed: T[] = [];
                for (const transaction of transactions) {
                    signed.push(await wallet.signTransaction!(transaction as any) as T);
                }
                return signed;
            };

        // 把 wallet-adapter 适配成 Anchor Wallet 接口
        const anchorWallet: Wallet = {
            publicKey: wallet.publicKey,
            signTransaction: wallet.signTransaction,
            signAllTransactions,
        } as Wallet;

        return new Alcheme({
            connection,
            wallet: anchorWallet,
            programIds: PROGRAM_IDS,
        });
    }, [connection, wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions]);

    return sdk;
}

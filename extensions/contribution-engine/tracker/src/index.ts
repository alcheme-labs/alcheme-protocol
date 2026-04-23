import { loadConfig } from './config';
import { EventListener } from './event-listener';
import { adaptProtocolEvent, CONTRIBUTION_SOURCE_PROTOCOL_EVENT_TYPES } from './core-event-adapter';
import { LedgerBuilder } from './ledger-builder';
import { Submitter } from './submitter';
import { createLogger, format, transports } from 'winston';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Direction 4: Settlement imports
import { Connection } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { ChainReader } from './data/chain-reader';
import { DbWriter } from './data/db-writer';
import { Settler } from './settler';
import { Scheduler } from './scheduler';

/**
 * Contribution Tracker — 服务入口
 *
 * 连接 EventListener → LedgerBuilder → Submitter 三个模块：
 * 1. EventListener 监听 event-emitter 的协议事件
 * 2. LedgerBuilder 在 Crystal 结晶时生成贡献账本
 * 3. Submitter 将账本提交到链上 contribution-engine 程序
 *
 * Direction 4 扩展:
 * 4. Scheduler 定时触发 Settler 执行 PageRank + 链上 settle_reputation
 */
async function main(): Promise<void> {
    const config = loadConfig();

    const logger = createLogger({
        level: config.logLevel,
        format: format.combine(
            format.timestamp(),
            format.printf(({ timestamp, level, message }) =>
                `${timestamp} [Main] ${level}: ${message}`
            ),
        ),
        transports: [new transports.Console()],
    });

    logger.info('=== Alcheme Contribution Tracker 启动 ===');
    logger.info(`RPC: ${config.rpcUrl}`);
    logger.info(`Program: ${config.programId}`);
    logger.info(`Event Emitter: ${config.eventEmitterProgramId}`);
    logger.info(`Identity Registry Name: ${config.identityRegistryName}`);

    ensureAnchorWalletEnv(config.walletPath, logger);

    // 初始化 Anchor 连接 (Submitter 和 Settler 共用)
    const connection = new Connection(config.rpcUrl);
    const wallet = anchor.Wallet.local();
    const provider = new anchor.AnchorProvider(connection, wallet, {});

    // 加载 contribution-engine IDL (从 tracker/idl/ 本地目录)
    const ceProgram = new anchor.Program(
        require('../idl/contribution_engine.json'),
        provider,
    );

    // 初始化组件
    const listener = new EventListener(
        config.rpcUrl,
        config.eventEmitterProgramId,
        config.logLevel,
    );

    const ledgerBuilder = new LedgerBuilder(
        undefined,  // 使用默认角色权重
        config.logLevel,
    );

    const submitter = new Submitter(
        ceProgram,
        wallet.payer,
        { logLevel: config.logLevel },
    );

    // 注册事件处理器：Crystal 结晶 → 生成账本 → 提交链上
    for (const protocolEventType of CONTRIBUTION_SOURCE_PROTOCOL_EVENT_TYPES) {
        listener.on(protocolEventType, async (event) => {
            const sourceEvent = adaptProtocolEvent(event);
            if (!sourceEvent) return;

            logger.info(`检测到 Crystal 结晶事件, slot=${sourceEvent.slot}`);

            const ledger = await ledgerBuilder.buildLedger(sourceEvent);
            if (!ledger) {
                logger.warn('账本生成失败，跳过');
                return;
            }

            logger.info(
                `账本生成完成: 贡献者=${ledger.contributions.length}, ` +
                `引用=${ledger.references.length}, 总权重=${ledger.totalWeight.toFixed(4)}`
            );

            const result = await submitter.submitLedger(ledger);
            if (result.errors.length > 0) {
                logger.warn(`提交完成但有 ${result.errors.length} 个错误`);
            } else {
                logger.info(`提交成功: ${result.contributionsRecorded} 条贡献, ${result.referencesAdded} 条引用`);
            }
        });
    }

    // 启动轮询
    await listener.startPolling(config.pollIntervalMs);
    logger.info(`轮询已启动, 间隔=${config.pollIntervalMs}ms`);

    // ==================== Direction 4: Settlement Scheduler ====================

    if (config.settlementEnabled) {
        logger.info('=== 声誉结算模块启动 ===');
        logger.info(`DB: ${config.dbUrl.replace(/:[^:]*@/, ':***@')}`);
        logger.info(`Cron: ${config.settlementCron}`);
        logger.info(`On-chain 执行: ${config.settlementExecuteOnChain}`);

        try {
            // 加载 Settler 专用的 IDL (从 tracker/idl/ 本地目录)
            const irProgram = new anchor.Program(
                require('../idl/identity_registry.json'),
                provider,
            );
            const rfProgram = new anchor.Program(
                require('../idl/registry_factory.json'),
                provider,
            );

            const chainReader = new ChainReader(connection, ceProgram, config.logLevel);
            const dbWriter = new DbWriter(config.dbUrl, config.logLevel);

            const settler = new Settler(
                chainReader,
                dbWriter,
                ceProgram,
                irProgram,
                rfProgram,
                wallet.payer,
                {
                    pageRank: {
                        dampingFactor: config.pageRankDamping,
                        convergenceThreshold: config.pageRankConvergence,
                        maxIterations: config.pageRankMaxIterations,
                    },
                    antiGaming: {
                        mutualCitationWindowDays: config.antiGamingMutualCitationWindowDays,
                        mutualCitationMaxCount: config.antiGamingMutualCitationMaxCount,
                        spamMaxReferencesPerWeek: config.antiGamingSpamMaxRefsPerWeek,
                        ghostContributionMinWeight: config.antiGamingGhostMinWeight,
                    },
                    writeToDb: true,
                    executeOnChain: config.settlementExecuteOnChain,
                },
                {
                    identityRegistryName: config.identityRegistryName,
                },
                config.logLevel,
            );

            const scheduler = new Scheduler(settler, config.settlementCron, config.logLevel);
            scheduler.start();

            logger.info('声誉结算定时任务已启动');
        } catch (err) {
            logger.error(`声誉结算模块启动失败: ${err}`);
            logger.warn('事件轮询仍在运行，结算功能已禁用');
        }
    } else {
        logger.info('声誉结算模块未启用 (设置 SETTLEMENT_ENABLED=true 以启用)');
    }
}

function ensureAnchorWalletEnv(
    configWalletPath: string,
    logger: ReturnType<typeof createLogger>,
): void {
    if (process.env.ANCHOR_WALLET && process.env.ANCHOR_WALLET.trim().length > 0) {
        return;
    }

    const resolvedFromConfig = resolveWalletPath(configWalletPath);
    if (fs.existsSync(resolvedFromConfig)) {
        process.env.ANCHOR_WALLET = resolvedFromConfig;
        logger.info(`ANCHOR_WALLET 未设置，使用 WALLET_PATH: ${resolvedFromConfig}`);
        return;
    }

    const fallback = path.join(os.homedir(), '.config', 'solana', 'id.json');
    if (fallback !== resolvedFromConfig && fs.existsSync(fallback)) {
        process.env.ANCHOR_WALLET = fallback;
        logger.info(`ANCHOR_WALLET/WALLET_PATH 不可用，回退到: ${fallback}`);
        return;
    }

    throw new Error(
        `expected environment variable ANCHOR_WALLET is not set, and wallet file not found at ${resolvedFromConfig}`,
    );
}

function resolveWalletPath(inputPath: string): string {
    const trimmed = (inputPath || '').trim();
    if (trimmed.length === 0) {
        return path.join(os.homedir(), '.config', 'solana', 'id.json');
    }

    if (trimmed === '~') {
        return os.homedir();
    }

    if (trimmed.startsWith('~/')) {
        return path.join(os.homedir(), trimmed.slice(2));
    }

    return path.resolve(trimmed);
}

main().catch((err) => {
    console.error('Contribution Tracker 启动失败:', err);
    process.exit(1);
});

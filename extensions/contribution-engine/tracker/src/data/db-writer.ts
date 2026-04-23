/**
 * DbWriter — 将 authority scores, 反作弊标记, 结算历史写入 PostgreSQL
 *
 * 使用 pg 驱动。MVP 阶段直接写入；生产环境可接入连接池。
 */

import { Pool, PoolConfig } from 'pg';
import { createLogger, format, transports, Logger } from 'winston';
import { AntiGamingFlag } from '../anti-gaming';

// ==================== 类型定义 ====================

export interface AuthorityScoreRow {
    crystalId: string;
    score: number;
    epoch: number;
}

export interface SettlementHistoryRow {
    crystalId: string;
    contributorPubkey: string;
    contributionRole: string;
    contributionWeight: number;
    authorityScore: number;
    reputationDelta: number;
    txSignature: string | null;
}

// ==================== DbWriter ====================

export class DbWriter {
    private pool: Pool;
    private logger: Logger;

    constructor(dbUrl: string, logLevel: string = 'info') {
        this.pool = new Pool({ connectionString: dbUrl });
        this.logger = createLogger({
            level: logLevel,
            format: format.combine(
                format.timestamp(),
                format.printf(({ timestamp, level, message }) =>
                    `${timestamp} [DbWriter] ${level}: ${message}`
                ),
            ),
            transports: [new transports.Console()],
        });
    }

    /**
     * 批量写入 authority scores
     */
    async writeAuthorityScores(scores: AuthorityScoreRow[]): Promise<void> {
        if (scores.length === 0) return;

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            for (const row of scores) {
                await client.query(
                    `INSERT INTO authority_scores (crystal_id, score, epoch)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (crystal_id, epoch) DO UPDATE SET
                       score = EXCLUDED.score,
                       calculated_at = NOW()`,
                    [row.crystalId, row.score, row.epoch],
                );
            }

            await client.query('COMMIT');
            this.logger.info(`写入 ${scores.length} 条 authority scores (epoch=${scores[0]?.epoch})`);
        } catch (err) {
            await client.query('ROLLBACK');
            this.logger.error(`写入 authority_scores 失败: ${err}`);
            throw err;
        } finally {
            client.release();
        }
    }

    /**
     * 写入反作弊标记
     */
    async writeAntiGamingFlags(flags: AntiGamingFlag[]): Promise<void> {
        if (flags.length === 0) return;

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            for (const flag of flags) {
                await client.query(
                    `INSERT INTO anti_gaming_flags (user_pubkey, flag_type, details)
                     VALUES ($1, $2, $3)`,
                    [flag.userPubkey, flag.flagType, JSON.stringify(flag.details)],
                );
            }

            await client.query('COMMIT');
            this.logger.info(`写入 ${flags.length} 条 anti-gaming flags`);
        } catch (err) {
            await client.query('ROLLBACK');
            this.logger.error(`写入 anti_gaming_flags 失败: ${err}`);
            throw err;
        } finally {
            client.release();
        }
    }

    /**
     * 记录结算历史
     */
    async writeSettlementHistory(rows: SettlementHistoryRow[]): Promise<void> {
        if (rows.length === 0) return;

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            for (const row of rows) {
                await client.query(
                    `INSERT INTO settlement_history
                       (crystal_id, contributor_pubkey, contribution_role, contribution_weight, authority_score, reputation_delta, tx_signature)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        row.crystalId,
                        row.contributorPubkey,
                        row.contributionRole,
                        row.contributionWeight,
                        row.authorityScore,
                        row.reputationDelta,
                        row.txSignature,
                    ],
                );
            }

            await client.query('COMMIT');
            this.logger.info(`写入 ${rows.length} 条 settlement history`);
        } catch (err) {
            await client.query('ROLLBACK');
            this.logger.error(`写入 settlement_history 失败: ${err}`);
            throw err;
        } finally {
            client.release();
        }
    }

    /**
     * 获取当前 epoch (最大 epoch + 1)
     */
    async getCurrentEpoch(): Promise<number> {
        try {
            const result = await this.pool.query(
                'SELECT COALESCE(MAX(epoch), 0) + 1 AS next_epoch FROM authority_scores',
            );
            return result.rows[0].next_epoch;
        } catch {
            // 表不存在时返回 1
            return 1;
        }
    }

    /**
     * 根据钱包公钥解析用户 handle
     */
    async findUserHandleByPubkey(pubkey: string): Promise<string | null> {
        const result = await this.pool.query(
            'SELECT handle FROM users WHERE pubkey = $1 LIMIT 1',
            [pubkey],
        );
        return result.rows[0]?.handle ?? null;
    }

    /**
     * 关闭连接池
     */
    async close(): Promise<void> {
        await this.pool.end();
        this.logger.info('数据库连接池已关闭');
    }
}

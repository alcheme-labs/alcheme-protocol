/**
 * Scheduler — 定时触发结算周期
 *
 * MVP: node-cron 进程内定时器
 * 生产: BullMQ (技术债)
 */

import cron from 'node-cron';
import { createLogger, format, transports, Logger } from 'winston';
import { Settler, SettlementResult } from './settler';

export class Scheduler {
    private settler: Settler;
    private cronExpression: string;
    private task: cron.ScheduledTask | null = null;
    private running = false;
    private logger: Logger;

    /**
     * @param settler - 结算器实例
     * @param cronExpression - Cron 表达式 (默认: 每小时)
     */
    constructor(
        settler: Settler,
        cronExpression: string = '0 * * * *',
        logLevel: string = 'info',
    ) {
        this.settler = settler;
        this.cronExpression = cronExpression;
        this.logger = createLogger({
            level: logLevel,
            format: format.combine(
                format.timestamp(),
                format.printf(({ timestamp, level, message }) =>
                    `${timestamp} [Scheduler] ${level}: ${message}`
                ),
            ),
            transports: [new transports.Console()],
        });
    }

    /**
     * 启动定时任务
     */
    start(): void {
        if (this.task) {
            this.logger.warn('定时任务已在运行');
            return;
        }

        this.task = cron.schedule(this.cronExpression, async () => {
            if (this.running) {
                this.logger.warn('上一个结算周期仍在运行，跳过');
                return;
            }

            this.running = true;
            try {
                this.logger.info('定时结算触发');
                const result = await this.settler.runEpoch();
                this.logResult(result);
            } catch (err) {
                this.logger.error(`结算周期异常: ${err}`);
            } finally {
                this.running = false;
            }
        });

        this.logger.info(`定时结算已启动: ${this.cronExpression}`);
    }

    /**
     * 停止定时任务
     */
    stop(): void {
        if (this.task) {
            this.task.stop();
            this.task = null;
            this.logger.info('定时结算已停止');
        }
    }

    /**
     * 手动触发一次结算 (不受 cron 控制)
     */
    async triggerManual(): Promise<SettlementResult> {
        if (this.running) {
            throw new Error('结算正在运行中');
        }

        this.running = true;
        try {
            this.logger.info('手动触发结算');
            const result = await this.settler.runEpoch();
            this.logResult(result);
            return result;
        } finally {
            this.running = false;
        }
    }

    private logResult(result: SettlementResult): void {
        this.logger.info(
            `结算完成 [epoch=${result.epoch}]: ` +
            `${result.crystalsProcessed} crystals, ` +
            `${result.entriesSettled} entries, ` +
            `${result.errors.length} errors`
        );
    }
}

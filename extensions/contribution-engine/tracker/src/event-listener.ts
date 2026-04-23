import { Connection, PublicKey } from '@solana/web3.js';
import { createLogger, format, transports, Logger } from 'winston';
import { ProtocolEvent, ProtocolEventType } from './types';

/**
 * EventListener — 监听 Solana 上 event-emitter 程序发出的协议事件
 *
 * 实现方式：
 * 1. MVP 阶段：轮询 (polling) event-emitter 的 EventBatch 账户
 * 2. 未来：接入 Yellowstone gRPC 实时订阅
 */
export class EventListener {
    private connection: Connection;
    private eventEmitterProgramId: PublicKey;
    private eventEmitterProgramIdBase58: string;
    private logger: Logger;
    private lastProcessedSlot: number = 0;
    private readonly maxSlotsPerPoll: number;
    private pollingInProgress = false;
    private handlers: Map<ProtocolEventType, EventHandler[]> = new Map();

    constructor(
        rpcUrl: string,
        eventEmitterProgramId: string,
        logLevel: string = 'info',
    ) {
        this.connection = new Connection(rpcUrl, 'confirmed');
        this.eventEmitterProgramId = new PublicKey(eventEmitterProgramId);
        this.eventEmitterProgramIdBase58 = this.eventEmitterProgramId.toBase58();
        this.maxSlotsPerPoll = parseInt(process.env.POLL_MAX_SLOTS || '32');
        this.logger = createLogger({
            level: logLevel,
            format: format.combine(
                format.timestamp(),
                format.printf(({ timestamp, level, message }) =>
                    `${timestamp} [EventListener] ${level}: ${message}`
                ),
            ),
            transports: [new transports.Console()],
        });
    }

    /**
     * 注册事件处理器
     */
    on(eventType: ProtocolEventType, handler: EventHandler): void {
        const existing = this.handlers.get(eventType) || [];
        existing.push(handler);
        this.handlers.set(eventType, existing);
        this.logger.info(`注册事件处理器: ${eventType}`);
    }

    /**
     * 开始轮询事件
     * 通过按 slot 拉取 block 日志，避免本地节点对 getSignaturesForAddress 的不稳定实现
     */
    async startPolling(intervalMs: number): Promise<void> {
        this.logger.info(
            `开始轮询事件, 间隔=${intervalMs}ms, event-emitter=${this.eventEmitterProgramIdBase58}, maxSlotsPerPoll=${this.maxSlotsPerPoll}`,
        );

        if (this.lastProcessedSlot === 0) {
            try {
                const currentSlot = await this.connection.getSlot('confirmed');
                this.lastProcessedSlot = Math.max(0, currentSlot - this.maxSlotsPerPoll);
                this.logger.info(
                    `初始化轮询游标: lastProcessedSlot=${this.lastProcessedSlot}, currentSlot=${currentSlot}`,
                );
            } catch (err) {
                this.logger.warn(`初始化 slot 游标失败，使用默认 0: ${err}`);
            }
        }

        const poll = async () => {
            if (this.pollingInProgress) {
                this.logger.warn('上一次轮询尚未完成，跳过本次 tick');
                return;
            }

            this.pollingInProgress = true;
            try {
                const events = await this.fetchNewEvents();
                for (const event of events) {
                    await this.dispatchEvent(event);
                }
            } catch (err) {
                this.logger.error(`轮询错误: ${err}`);
            } finally {
                this.pollingInProgress = false;
            }
        };

        // 立即执行一次
        await poll();

        // 定期轮询
        setInterval(poll, intervalMs);
    }

    /**
     * 获取新事件
     * 通过 getSlot + getBlock 拉取区块日志并解析事件
     */
    private async fetchNewEvents(): Promise<ProtocolEvent[]> {
        const events: ProtocolEvent[] = [];

        try {
            const latestSlot = await this.connection.getSlot('confirmed');
            if (latestSlot <= this.lastProcessedSlot) {
                return events;
            }

            const fromSlot = this.lastProcessedSlot + 1;
            const toSlot = Math.min(latestSlot, fromSlot + this.maxSlotsPerPoll - 1);

            for (let slot = fromSlot; slot <= toSlot; slot += 1) {
                let block: {
                    transactions?: Array<{
                        meta?: {
                            logMessages?: string[] | null;
                        } | null;
                    }>;
                } | null;
                try {
                    // surfpool may default to jsonParsed for getBlock; force JSON string accountKeys.
                    // web3.js typings do not expose `encoding` here, so cast to any for runtime compatibility.
                    block = await (this.connection as any).getBlock(slot, {
                        encoding: 'json',
                        maxSupportedTransactionVersion: 0,
                        transactionDetails: 'full',
                        rewards: false,
                        commitment: 'confirmed',
                    }) as {
                        transactions?: Array<{
                            meta?: {
                                logMessages?: string[] | null;
                            } | null;
                        }>;
                    } | null;
                } catch (err) {
                    if (this.isSkippableBlockError(err)) {
                        this.logger.debug(`slot=${slot} 无可用 block（跳过）`);
                    } else {
                        this.logger.warn(`获取 block 失败 slot=${slot}: ${err}`);
                    }
                    continue;
                }

                if (!block?.transactions?.length) {
                    continue;
                }

                for (const tx of block.transactions) {
                    const logs = tx.meta?.logMessages;
                    if (!logs || logs.length === 0) continue;

                    if (!logs.some((line: string) => line.includes(this.eventEmitterProgramIdBase58))) {
                        continue;
                    }

                    // 解析日志中的事件
                    const parsedEvents = this.parseLogEvents(logs, slot);
                    events.push(...parsedEvents);
                }
            }

            this.lastProcessedSlot = toSlot;
            if (events.length > 0) {
                this.logger.debug(`发现 ${events.length} 条新事件（slot ${fromSlot}-${toSlot}）`);
            }
        } catch (err) {
            this.logger.error(`获取事件失败: ${err}`);
        }

        return events;
    }

    private isSkippableBlockError(err: unknown): boolean {
        const message = String(err).toLowerCase();
        return message.includes('slot was skipped') ||
            message.includes('block not available') ||
            message.includes('long-term storage');
    }

    /**
     * 从交易日志中解析协议事件
     * 查找 "Program log:" 前缀的事件数据
     */
    private parseLogEvents(logs: string[], slot: number): ProtocolEvent[] {
        const events: ProtocolEvent[] = [];

        for (const log of logs) {
            // 匹配 Anchor 事件格式: "Program data: <base64>"
            // 或自定义日志: "Program log: EVENT:ContentStatusChanged:{...}"
            if (log.includes('EVENT:ContentStatusChanged')) {
                events.push({
                    type: ProtocolEventType.ContentStatusChanged,
                    timestamp: Date.now(),
                    slot,
                    data: this.parseEventData(log),
                });
            } else if (log.includes('EVENT:ContentCreated')) {
                events.push({
                    type: ProtocolEventType.ContentCreated,
                    timestamp: Date.now(),
                    slot,
                    data: this.parseEventData(log),
                });
            } else if (log.includes('EVENT:KnowledgeSubmitted')) {
                events.push({
                    type: ProtocolEventType.KnowledgeSubmitted,
                    timestamp: Date.now(),
                    slot,
                    data: this.parseEventData(log),
                });
            }
        }

        return events;
    }

    /**
     * 解析事件数据 JSON
     */
    private parseEventData(log: string): Record<string, unknown> {
        try {
            const jsonStart = log.indexOf('{');
            if (jsonStart >= 0) {
                return JSON.parse(log.substring(jsonStart));
            }
        } catch {
            this.logger.warn(`无法解析事件数据: ${log}`);
        }
        return {};
    }

    /**
     * 分发事件到注册的处理器
     */
    private async dispatchEvent(event: ProtocolEvent): Promise<void> {
        const handlers = this.handlers.get(event.type) || [];
        this.logger.info(`分发事件: ${event.type}, handlers=${handlers.length}`);

        for (const handler of handlers) {
            try {
                await handler(event);
            } catch (err) {
                this.logger.error(`处理器执行失败: ${event.type}, error=${err}`);
            }
        }
    }
}

export type EventHandler = (event: ProtocolEvent) => Promise<void>;

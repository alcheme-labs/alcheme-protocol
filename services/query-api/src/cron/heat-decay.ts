import { PrismaClient } from '@prisma/client';

/**
 * 热度衰减定时任务
 * 
 * 公式: heatScore *= e^(-λ * Δt)
 * - λ (DECAY_RATE) = 0.05 每小时
 * - Δt = 时间间隔 (小时)
 * 
 * 每小时运行一次：
 * - 草稿 / 帖子热度：较快衰减
 * - 晶体 / 知识热度：较慢衰减
 */

const DRAFT_DECAY_RATE = 0.05; // λ = 0.05 每小时
const KNOWLEDGE_DECAY_RATE = 0.02; // 晶体传播热度衰减更慢
const INTERVAL_MS = 60 * 60 * 1000; // 1 小时
const MIN_HEAT = 0.01; // 低于此值的帖子不再衰减（直接归零）

let intervalHandle: NodeJS.Timeout | null = null;

export function startHeatDecayCron(prisma: PrismaClient): void {
    console.log('🔥 Heat decay cron started (interval: 1h, λ=0.05)');

    const decay = async () => {
        try {
            const start = Date.now();

            const draftDecayFactor = Math.exp(-DRAFT_DECAY_RATE);
            const knowledgeDecayFactor = Math.exp(-KNOWLEDGE_DECAY_RATE);

            const postResult = await prisma.$executeRawUnsafe(
                `UPDATE posts 
                 SET heat_score = heat_score * $1,
                     updated_at = NOW()
                 WHERE heat_score > $2`,
                draftDecayFactor,
                MIN_HEAT,
            );

            const knowledgeResult = await prisma.$executeRawUnsafe(
                `UPDATE knowledge
                 SET heat_score = heat_score * $1,
                     updated_at = NOW()
                 WHERE heat_score > $2`,
                knowledgeDecayFactor,
                MIN_HEAT,
            );

            // 归零极小值
            await prisma.$executeRawUnsafe(
                `UPDATE posts 
                 SET heat_score = 0, updated_at = NOW()
                WHERE heat_score > 0 AND heat_score <= $1`,
                MIN_HEAT,
            );
            await prisma.$executeRawUnsafe(
                `UPDATE knowledge
                 SET heat_score = 0, updated_at = NOW()
                 WHERE heat_score > 0 AND heat_score <= $1`,
                MIN_HEAT,
            );

            const elapsed = Date.now() - start;
            console.log(
                `🔥 Heat decay: updated ${postResult} posts (factor=${draftDecayFactor.toFixed(4)}) `
                + `and ${knowledgeResult} knowledge rows (factor=${knowledgeDecayFactor.toFixed(4)}) in ${elapsed}ms`,
            );
        } catch (error) {
            console.error('🔥 Heat decay cron error:', error);
        }
    };

    // 启动时立即执行一次
    decay();

    // 每小时执行
    intervalHandle = setInterval(decay, INTERVAL_MS);
}

export function stopHeatDecayCron(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        console.log('🔥 Heat decay cron stopped');
    }
}

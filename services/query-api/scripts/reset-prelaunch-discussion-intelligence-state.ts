import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Args {
    dryRun: boolean;
    resetHistory: boolean;
    circleId: number | null;
    help: boolean;
}

function parseArgs(argv: string[]): Args {
    const help = argv.includes('--help') || argv.includes('-h');
    const dryRun = argv.includes('--dry-run');
    const resetHistory = argv.includes('--reset-history');
    const circleArg = argv.find((arg) => arg.startsWith('--circle-id='));
    const parsedCircleId = circleArg ? Number.parseInt(circleArg.split('=')[1] || '', 10) : Number.NaN;
    const circleId = Number.isFinite(parsedCircleId) && parsedCircleId > 0 ? parsedCircleId : null;

    if (resetHistory && circleId !== null) {
        throw new Error('--reset-history 目前只支持全局执行；不要和 --circle-id 一起用');
    }

    return {
        dryRun,
        resetHistory,
        circleId,
        help,
    };
}

function printUsage() {
    console.log([
        'Usage:',
        '  npx tsx services/query-api/scripts/reset-prelaunch-discussion-intelligence-state.ts [--dry-run] [--circle-id=<id>]',
        '  npx tsx services/query-api/scripts/reset-prelaunch-discussion-intelligence-state.ts --reset-history',
        '',
        'Notes:',
        '  --reset-history 会删除全部 discussion 消息、highlights 和 discussion stream watermark。',
        '  --circle-id 只用于局部重置 canonical analysis，不会清全局 watermark。',
        '  需要设置 DATABASE_URL。',
    ].join('\n'));
}

function sqlCircleFilter(column = 'circle_id', circleId: number | null = null) {
    return circleId === null ? Prisma.empty : Prisma.sql` AND ${Prisma.raw(column)} = ${circleId}`;
}

async function tableExists(tableName: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ exists: string | null }>>(Prisma.sql`
        SELECT to_regclass(${`public.${tableName}`})::text AS "exists"
    `);
    return Boolean(rows[0]?.exists);
}

async function countRows(input: Args) {
    const messageRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM circle_discussion_messages
        WHERE TRUE
        ${sqlCircleFilter('circle_id', input.circleId)}
    `);
    const summaryRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM circle_summary_snapshots
        WHERE TRUE
        ${sqlCircleFilter('circle_id', input.circleId)}
    `);
    const aiJobRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM ai_jobs
        WHERE job_type IN ('discussion_message_analyze', 'discussion_circle_reanalyze')
        ${input.circleId === null ? Prisma.empty : Prisma.sql`AND scope_circle_id = ${input.circleId}`}
    `);
    const highlightRows = input.resetHistory
        ? await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
            SELECT COUNT(*)::bigint AS count
            FROM discussion_message_highlights
        `)
        : [{ count: BigInt(0) }];
    const watermarkRows = input.resetHistory
        ? await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
            SELECT COUNT(*)::bigint AS count
            FROM offchain_sync_watermarks
            WHERE stream_key = 'circle-discussion'
        `)
        : [{ count: BigInt(0) }];
    const auditRows = await tableExists('discussion_scoring_audit_runs')
        ? await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
            SELECT COUNT(*)::bigint AS count
            FROM discussion_scoring_audit_runs
        `)
        : [{ count: BigInt(0) }];

    return {
        discussionMessages: Number(messageRows[0]?.count || 0),
        circleSummarySnapshots: Number(summaryRows[0]?.count || 0),
        discussionAiJobs: Number(aiJobRows[0]?.count || 0),
        discussionHighlights: Number(highlightRows[0]?.count || 0),
        discussionWatermarks: Number(watermarkRows[0]?.count || 0),
        scoringAuditRuns: Number(auditRows[0]?.count || 0),
    };
}

async function resetDiscussionAnalysisState(circleId: number | null) {
    return prisma.$executeRaw(Prisma.sql`
        UPDATE circle_discussion_messages
        SET
            relevance_status = 'pending',
            relevance_score = 1.000,
            semantic_score = NULL,
            embedding_score = NULL,
            quality_score = NULL,
            spam_score = NULL,
            decision_confidence = NULL,
            relevance_method = 'pending',
            actual_mode = NULL,
            analysis_version = NULL,
            topic_profile_version = NULL,
            semantic_facets = '[]'::jsonb,
            focus_score = NULL,
            focus_label = NULL,
            is_featured = FALSE,
            feature_reason = NULL,
            featured_at = NULL,
            analysis_completed_at = NULL,
            analysis_error_code = NULL,
            analysis_error_message = NULL,
            updated_at = NOW()
        WHERE TRUE
        ${sqlCircleFilter('circle_id', circleId)}
    `);
}

async function clearDiscussionAiJobs(circleId: number | null) {
    return prisma.$executeRaw(Prisma.sql`
        DELETE FROM ai_jobs
        WHERE job_type IN ('discussion_message_analyze', 'discussion_circle_reanalyze')
        ${circleId === null ? Prisma.empty : Prisma.sql`AND scope_circle_id = ${circleId}`}
    `);
}

async function clearCircleSummarySnapshots(circleId: number | null) {
    return prisma.$executeRaw(Prisma.sql`
        DELETE FROM circle_summary_snapshots
        WHERE TRUE
        ${sqlCircleFilter('circle_id', circleId)}
    `);
}

async function clearDiscussionAuditRuns() {
    if (!(await tableExists('discussion_scoring_audit_runs'))) {
        return 0;
    }
    return prisma.$executeRawUnsafe('DELETE FROM discussion_scoring_audit_runs');
}

async function resetDiscussionHistory() {
    const deletedHighlights = await prisma.$executeRaw(Prisma.sql`
        DELETE FROM discussion_message_highlights
    `);
    const deletedMessages = await prisma.$executeRaw(Prisma.sql`
        DELETE FROM circle_discussion_messages
    `);
    const deletedWatermarks = await prisma.$executeRaw(Prisma.sql`
        DELETE FROM offchain_sync_watermarks
        WHERE stream_key = 'circle-discussion'
    `);

    return {
        deletedHighlights,
        deletedMessages,
        deletedWatermarks,
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printUsage();
        return;
    }
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is required');
    }
    const before = await countRows(args);

    if (args.dryRun) {
        console.log(JSON.stringify({
            mode: 'dry-run',
            ...args,
            before,
        }, null, 2));
        return;
    }

    const resetAnalysisCount = await resetDiscussionAnalysisState(args.circleId);
    const deletedAiJobs = await clearDiscussionAiJobs(args.circleId);
    const deletedSummarySnapshots = await clearCircleSummarySnapshots(args.circleId);
    const deletedAuditRuns = await clearDiscussionAuditRuns();
    const historyReset = args.resetHistory ? await resetDiscussionHistory() : null;
    const after = await countRows(args);

    console.log(JSON.stringify({
        mode: 'execute',
        ...args,
        resetAnalysisCount,
        deletedAiJobs,
        deletedSummarySnapshots,
        deletedAuditRuns,
        historyReset,
        before,
        after,
    }, null, 2));
}

main()
    .catch((error) => {
        console.error('[reset-prelaunch-discussion-intelligence-state] failed', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

import { DEFAULT_LOCALE, type AppLocale, isSupportedLocale } from './locale';
import type { GovernanceRole } from '../services/policy/types';

export type CopyPrimitive = string | number | boolean | null | undefined;
export type CopyParams = Record<string, CopyPrimitive>;

type LocalizedCopy = Partial<Record<AppLocale, string>> & { en: string };

const ROLE_LABELS: Record<GovernanceRole | 'higher', LocalizedCopy> = {
    Owner: { en: 'circle owner', zh: '圈主' },
    Admin: { en: 'admin', zh: '管理员' },
    Moderator: { en: 'moderator', zh: '主持人' },
    Elder: { en: 'elder', zh: '长老' },
    Member: { en: 'member', zh: '成员' },
    Initiate: { en: 'initiate', zh: '初始成员' },
    higher: { en: 'a higher role', zh: '更高权限' },
};

export type QueryApiCopyKey =
    | 'draft.crystallization.lifecycleFinalizeFailed'
    | 'draft.crystallization.missingCircleContextRegister'
    | 'draft.crystallization.missingCircleContextBinding'
    | 'draft.crystallization.notReadyForAttemptRegistration'
    | 'draft.crystallization.notReadyForExecution'
    | 'discussion.forward.emptySourceMessage'
    | 'discussion.member.unknown'
    | 'ghostDraft.circleContextRequired'
    | 'ghostDraft.applyPermissionRequired'
    | 'ghostDraft.acceptPermissionRequired'
    | 'graphql.activity.draft'
    | 'graphql.activity.crystal'
    | 'graphql.activity.post'
    | 'graphql.publicFlow.discussionTitle'
    | 'graphql.publicFlow.crystalTitle'
    | 'knowledge.version.field.eventType'
    | 'knowledge.version.field.actorHandle'
    | 'knowledge.version.field.contributorsCount'
    | 'knowledge.version.field.contributorsRoot'
    | 'knowledge.version.field.sourceEventTimestamp'
    | 'knowledge.version.summary.unavailableContentSnapshots'
    | 'knowledge.version.summary.changedFields'
    | 'knowledge.version.summary.noChanges'
    | 'circleSummary.timeTbd'
    | 'circleSummary.issueMap.primaryTitle'
    | 'circleSummary.issueMap.primaryBodyWithOutput'
    | 'circleSummary.issueMap.primaryBodyEmpty'
    | 'circleSummary.issueMap.draftTitle'
    | 'circleSummary.issueMap.draftBodyWithDraft'
    | 'circleSummary.issueMap.draftBodyEmpty'
    | 'circleSummary.issueMap.conflictTitle'
    | 'circleSummary.issueMap.conflictBodyOpenThreads'
    | 'circleSummary.issueMap.conflictBodyClosed'
    | 'circleSummary.branch.primaryRoute'
    | 'circleSummary.branch.parallelRoute'
    | 'circleSummary.branch.citationSummary'
    | 'circleSummary.breakdown.factDiscussions'
    | 'circleSummary.breakdown.crystallizedOutputs'
    | 'circleSummary.breakdown.publicIssues'
    | 'circleSummary.breakdown.explanationDiscussions'
    | 'circleSummary.breakdown.explanationBodyWithCount'
    | 'circleSummary.breakdown.explanationBodyWithOutput'
    | 'circleSummary.breakdown.explanationBodyEmpty'
    | 'circleSummary.breakdown.overallMood'
    | 'circleSummary.breakdown.moodWithEmotions'
    | 'circleSummary.breakdown.moodAligning'
    | 'circleSummary.breakdown.moodConverging'
    | 'circleSummary.conflict.openThreadsNote'
    | 'circleSummary.conflict.emotionNote'
    | 'circleSummary.conflict.noOpenThreadsNote'
    | 'circleSummary.timeline.draftBaselineTitle'
    | 'circleSummary.timeline.draftBaselineSummary'
    | 'circleSummary.timeline.outputWithEvidence'
    | 'circleSummary.timeline.outputMissingEvidence'
    | 'circleSummary.openQuestions.unsettledTitle'
    | 'circleSummary.openQuestions.unsettledBody'
    | 'circleSummary.openQuestions.firstOutputTitle'
    | 'circleSummary.openQuestions.firstOutputBody'
    | 'circleSummary.openQuestions.expandBranchesTitle'
    | 'circleSummary.openQuestions.expandBranchesBody'
    | 'discussionSummary.noContent';

const COPY: Record<QueryApiCopyKey, LocalizedCopy> = {
    'draft.crystallization.lifecycleFinalizeFailed': {
        en: 'Crystallization binding completed, but the draft lifecycle could not be finalized. Please retry later.',
        zh: '结晶绑定已完成，但草稿生命周期未能收口，请稍后重试。',
    },
    'draft.crystallization.missingCircleContextRegister': {
        en: 'Circle context is required to register crystallization recovery state.',
        zh: '缺少圈层上下文，无法登记结晶恢复记录。',
    },
    'draft.crystallization.missingCircleContextBinding': {
        en: 'Circle context is required to bind crystallized knowledge.',
        zh: '缺少圈层上下文，无法执行结晶绑定。',
    },
    'draft.crystallization.notReadyForAttemptRegistration': {
        en: 'Start crystallization first. Recovery state can only be registered after the draft enters crystallization.',
        zh: '请先发起结晶，进入结晶阶段后再登记结晶恢复记录。',
    },
    'draft.crystallization.notReadyForExecution': {
        en: 'Start crystallization first. This action is only available after the draft enters crystallization.',
        zh: '请先发起结晶，进入结晶阶段后再执行结晶。',
    },
    'discussion.forward.emptySourceMessage': {
        en: 'The original message is empty',
        zh: '原消息内容为空',
    },
    'discussion.member.unknown': {
        en: 'A member',
        zh: '某位成员',
    },
    'ghostDraft.circleContextRequired': {
        en: 'Ghost draft suggestion acceptance requires a circle-bound draft.',
        zh: '接受 Ghost Draft 建议需要草稿已绑定圈层。',
    },
    'ghostDraft.applyPermissionRequired': {
        en: 'Issue application permission is required.',
        zh: '需要问题写入正文权限。',
    },
    'ghostDraft.acceptPermissionRequired': {
        en: 'Issue acceptance permission is required.',
        zh: '需要问题审议确认权限。',
    },
    'graphql.activity.draft': {
        en: 'Updated a draft',
        zh: '更新了一份草稿',
    },
    'graphql.activity.crystal': {
        en: 'Crystallized knowledge',
        zh: '结晶了一枚知识',
    },
    'graphql.activity.post': {
        en: 'Published an update',
        zh: '发布了一条动态',
    },
    'graphql.publicFlow.discussionTitle': {
        en: 'Circle discussion',
        zh: '圈层讨论',
    },
    'graphql.publicFlow.crystalTitle': {
        en: 'Knowledge crystal',
        zh: '知识结晶',
    },
    'knowledge.version.field.eventType': { en: 'Event type', zh: '事件类型' },
    'knowledge.version.field.actorHandle': { en: 'Actor', zh: '执行者' },
    'knowledge.version.field.contributorsCount': { en: 'Contributor count', zh: '贡献者人数' },
    'knowledge.version.field.contributorsRoot': { en: 'Contribution root', zh: '贡献根' },
    'knowledge.version.field.sourceEventTimestamp': { en: 'Source event timestamp', zh: '来源事件时间戳' },
    'knowledge.version.summary.unavailableContentSnapshots': {
        en: 'Only version-event metadata can be compared for now; historical body snapshots are not stored yet.',
        zh: '当前只能比较版本事件元数据；历史正文快照尚未入库。',
    },
    'knowledge.version.summary.changedFields': {
        en: 'There are {count} readable version differences.',
        zh: '当前可读到 {count} 处版本差异。',
    },
    'knowledge.version.summary.noChanges': {
        en: 'No differences are visible within the currently readable range.',
        zh: '两个版本在当前可读范围内没有差异。',
    },
    'circleSummary.timeTbd': { en: 'Time pending', zh: '时间待补' },
    'circleSummary.issueMap.primaryTitle': { en: 'Start with the conclusion that has stabilized', zh: '先看这条已经站稳的结论' },
    'circleSummary.issueMap.primaryBodyWithOutput': {
        en: 'The clearest sedimented focus is "{title}". It is currently the best entry point into this circle.',
        zh: '当前最清晰的沉淀焦点是“{title}”，它已经成为这个圈层目前最适合先进入的认知入口。',
    },
    'circleSummary.issueMap.primaryBodyEmpty': {
        en: 'No stable sedimented result has formed yet, so this page first clarifies what is starting to focus and what is still forming.',
        zh: '当前还没有形成稳定的沉淀结果，因此这页先帮助你看清：哪些内容已开始聚焦，哪些仍在形成中。',
    },
    'circleSummary.issueMap.draftTitle': { en: 'Then review the draft body it is based on', zh: '再回看它基于哪份正文' },
    'circleSummary.issueMap.draftBodyWithDraft': {
        en: 'This snapshot traces back to draft #{draftPostId} stable version v{version}, so you can see how this round of sedimentation formed.',
        zh: '当前快照回到草稿 #{draftPostId} 的 v{version} 稳定版本，继续理解这轮沉淀是怎么形成的。',
    },
    'circleSummary.issueMap.draftBodyEmpty': {
        en: 'There is no single body baseline yet, so start from the sedimented conclusions without inventing draft truth.',
        zh: '当前还没有唯一的正文基线，因此先从已经沉淀出来的结论进入，不伪造草稿真相。',
    },
    'circleSummary.issueMap.conflictTitle': { en: 'What is still being debated', zh: '还有哪些点仍在争论' },
    'circleSummary.issueMap.conflictBodyOpenThreads': {
        en: 'There are still {count} open issue threads, so this summary keeps a path back into revision.',
        zh: '当前还有 {count} 条未关闭的问题单，说明这页总结仍保留继续修订的入口。',
    },
    'circleSummary.issueMap.conflictBodyClosed': {
        en: 'There are no open issue threads; conflict context mainly appears between different sedimented branches.',
        zh: '当前没有悬而未决的问题单，冲突上下文主要体现在不同沉淀分支之间。',
    },
    'circleSummary.branch.primaryRoute': { en: 'Main entry', zh: '主线入口' },
    'circleSummary.branch.parallelRoute': { en: 'Parallel branch {index}', zh: '并行分支 {index}' },
    'circleSummary.branch.citationSummary': {
        en: 'Total citations {citations} · Preview outbound {outbound} / preview inbound {inbound}',
        zh: '总被引 {citations} · 预览引用 {outbound} / 预览被引 {inbound}',
    },
    'circleSummary.breakdown.factDiscussions': { en: 'Fact discussions', zh: '事实类讨论' },
    'circleSummary.breakdown.crystallizedOutputs': { en: 'Crystallized outputs', zh: '已结晶输出' },
    'circleSummary.breakdown.publicIssues': { en: 'Public issue threads', zh: '公开问题单' },
    'circleSummary.breakdown.explanationDiscussions': { en: 'Explanation discussions', zh: '解释类讨论' },
    'circleSummary.breakdown.explanationBodyWithCount': {
        en: '{count} recent ready discussions were identified as explanatory, so this summary prioritizes that reasoning context.',
        zh: '最近 ready 讨论里有 {count} 条被识别为解释型发言，当前总结优先吸收这些解释脉络。',
    },
    'circleSummary.breakdown.explanationBodyWithOutput': {
        en: 'This overview starts from "{title}", then traces back to the source draft and binding evidence.',
        zh: '当前总览优先从“{title}”进入，再回到来源草稿与绑定证据。',
    },
    'circleSummary.breakdown.explanationBodyEmpty': {
        en: 'There is no main sedimented line yet, so the overview remains exploratory instead of inventing a stable conclusion.',
        zh: '当前还没有主线沉淀，因此总览保持探索态，不额外伪造稳定结论。',
    },
    'circleSummary.breakdown.overallMood': { en: 'Overall mood', zh: '总体氛围' },
    'circleSummary.breakdown.moodWithEmotions': { en: '{count} recent emotional discussions', zh: '最近存在 {count} 条情绪型讨论' },
    'circleSummary.breakdown.moodAligning': { en: 'Still aligning', zh: '仍在对齐中' },
    'circleSummary.breakdown.moodConverging': { en: 'Converging', zh: '趋于收敛' },
    'circleSummary.conflict.openThreadsNote': { en: '{count} issue threads still need to be closed.', zh: '仍有 {count} 条问题单待关闭。' },
    'circleSummary.conflict.emotionNote': { en: '{count} recent emotional discussions entered the ready view.', zh: '最近有 {count} 条情绪型讨论进入 ready 口径。' },
    'circleSummary.conflict.noOpenThreadsNote': { en: 'There are no open issue threads.', zh: '当前没有未关闭的问题单。' },
    'circleSummary.timeline.draftBaselineTitle': { en: 'Stable draft baseline v{version}', zh: '稳定草稿基线 v{version}' },
    'circleSummary.timeline.draftBaselineSummary': { en: 'This summary uses draft #{draftPostId} as a traceable body source.', zh: '当前总结以草稿 #{draftPostId} 为可回溯正文来源。' },
    'circleSummary.timeline.outputWithEvidence': { en: 'Sedimented into a knowledge result with formal binding evidence.', zh: '已沉淀为知识结果，并保留正式绑定证据。' },
    'circleSummary.timeline.outputMissingEvidence': { en: 'Sedimented into a knowledge result, but source binding still needs completion.', zh: '已沉淀为知识结果，但来源绑定仍待补齐。' },
    'circleSummary.openQuestions.unsettledTitle': { en: 'Which issues still need sedimentation?', zh: '还有哪些问题未被沉淀？' },
    'circleSummary.openQuestions.unsettledBody': { en: 'There are still {count} open issue threads that need draft and discussion context.', zh: '当前还有 {count} 条问题单未关闭，需要继续回到草稿与讨论上下文。' },
    'circleSummary.openQuestions.firstOutputTitle': { en: 'When will the first stable output form?', zh: '何时形成第一条稳定输出？' },
    'circleSummary.openQuestions.firstOutputBody': { en: 'There are no crystallized results yet. Continue draft review and crystallization.', zh: '当前还没有结晶结果，需要继续推进草稿审阅与结晶。' },
    'circleSummary.openQuestions.expandBranchesTitle': { en: 'Which branches are worth expanding next?', zh: '哪些分支值得继续扩展？' },
    'circleSummary.openQuestions.expandBranchesBody': { en: 'Stable sedimentation exists. Next, expand branches through references and issue threads.', zh: '当前已有稳定沉淀，下一步可结合引用关系和问题单继续扩展分支。' },
    'discussionSummary.noContent': {
        en: 'There is no discussion content to summarize yet.',
        zh: '当前还没有可总结的讨论内容。',
    },
};

export type DraftWorkflowPermissionReasonCode =
    | 'ok'
    | 'inactive_member'
    | 'role_required_create_issue'
    | 'role_required_followup_issue'
    | 'author_withdraw_disabled'
    | 'role_required_review_issue'
    | 'role_required_retag_issue'
    | 'role_required_apply_issue'
    | 'role_required_end_drafting_early'
    | 'role_required_advance_from_review'
    | 'role_required_enter_crystallization'
    | 'retag_disabled';

const PERMISSION_REASON_COPY: Record<DraftWorkflowPermissionReasonCode, LocalizedCopy> = {
    ok: { en: 'ok', zh: 'ok' },
    inactive_member: {
        en: 'Only active circle members can perform this action.',
        zh: '只有活跃圈层成员才能执行这个动作。',
    },
    role_required_create_issue: {
        en: 'The current circle policy requires at least {roleLabel} to submit issue threads.',
        zh: '当前圈层策略要求至少 {roleLabel} 才能提交问题单。',
    },
    role_required_followup_issue: {
        en: 'The current circle policy requires at least {roleLabel} to add follow-up issue threads.',
        zh: '当前圈层策略要求至少 {roleLabel} 才能继续追加问题单。',
    },
    author_withdraw_disabled: {
        en: 'The current circle policy does not allow authors to withdraw issue threads before review.',
        zh: '当前圈层策略不允许在进入审议前撤回自己的问题单。',
    },
    role_required_review_issue: {
        en: 'The current circle policy requires at least {roleLabel} to start or handle issue review.',
        zh: '当前圈层策略要求至少 {roleLabel} 才能发起或处理问题单审议。',
    },
    role_required_retag_issue: {
        en: 'The current circle policy requires at least {roleLabel} to change issue type.',
        zh: '当前圈层策略要求至少 {roleLabel} 才能调整问题类型。',
    },
    role_required_apply_issue: {
        en: 'The current circle policy requires at least {roleLabel} to confirm that an issue has been applied to the body.',
        zh: '当前圈层策略要求至少 {roleLabel} 才能确认问题已写入正文。',
    },
    role_required_end_drafting_early: {
        en: 'The current circle policy requires at least {roleLabel} to end editing early and enter review.',
        zh: '当前圈层策略要求至少 {roleLabel} 才能提前结束编辑并进入审阅。',
    },
    role_required_advance_from_review: {
        en: 'The current circle policy requires at least {roleLabel} to finish this review round and enter the next revision.',
        zh: '当前圈层策略要求至少 {roleLabel} 才能结束本轮审阅并进入下一轮修订。',
    },
    role_required_enter_crystallization: {
        en: 'The current circle policy requires at least {roleLabel} to start crystallization.',
        zh: '当前圈层策略要求至少 {roleLabel} 才能发起结晶。',
    },
    retag_disabled: {
        en: 'The current circle policy does not allow issue type changes during review.',
        zh: '当前圈层策略暂不允许在审议过程中调整问题类型。',
    },
};

export function normalizeCopyLocale(locale: AppLocale | string | null | undefined): AppLocale {
    return typeof locale === 'string' && isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
}

function interpolate(template: string, params: CopyParams = {}): string {
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
        const value = params[key];
        return value === null || value === undefined ? match : String(value);
    });
}

export function localizeText(copy: LocalizedCopy, locale: AppLocale | string | null | undefined, params?: CopyParams): string {
    const normalized = normalizeCopyLocale(locale);
    const template = copy[normalized] ?? copy.en;
    return interpolate(template, params);
}

export function localizeQueryApiCopy(key: QueryApiCopyKey, locale: AppLocale | string | null | undefined, params?: CopyParams): string {
    return localizeText(COPY[key], locale, params);
}

export function localizeGovernanceRole(role: GovernanceRole | null | undefined, locale: AppLocale | string | null | undefined): string {
    return localizeText(ROLE_LABELS[role ?? 'higher'] || ROLE_LABELS.higher, locale);
}

export function localizeDraftWorkflowPermissionReason(input: {
    reasonCode: DraftWorkflowPermissionReasonCode;
    minRole?: GovernanceRole | null;
}, locale: AppLocale | string | null | undefined): string {
    const roleLabel = localizeGovernanceRole(input.minRole ?? null, locale);
    return localizeText(PERMISSION_REASON_COPY[input.reasonCode], locale, { roleLabel });
}

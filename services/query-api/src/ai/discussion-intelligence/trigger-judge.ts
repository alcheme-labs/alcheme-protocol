import { serviceConfig } from '../../config/services';
import { getPromptSchema, getSystemPrompt } from '../prompts/registry';
import { generateStructuredOutput } from './llm';

export interface TriggerJudgeInput {
    circleName: string;
    circleDescription?: string | null;
    mode: 'notify_only' | 'auto_draft';
    allowLLM?: boolean;
    messageCount: number;
    focusedRatio: number;
    questionCount: number;
    participantCount: number;
    spamRatio: number;
    topicHeat: number;
    summary: string;
}

export interface TriggerJudgeResult {
    shouldTrigger: boolean;
    recommendedAction: 'none' | 'notify_only' | 'auto_draft';
    reasonCode: string;
    reason: string;
    confidence: number;
    riskFlags: string[];
    method: 'rule' | 'llm';
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function parseResult(raw: Record<string, unknown> | null): TriggerJudgeResult | null {
    if (!raw) return null;
    const shouldTrigger = Boolean(raw.should_trigger);
    const recommendedActionRaw = String(raw.recommended_action || '').trim().toLowerCase();
    const recommendedAction = (
        recommendedActionRaw === 'auto_draft'
        || recommendedActionRaw === 'notify_only'
        || recommendedActionRaw === 'none'
    )
        ? (recommendedActionRaw as 'none' | 'notify_only' | 'auto_draft')
        : null;
    const reasonCode = String(raw.reason_code || '').trim();
    const reason = String(raw.reason || '').trim();
    const confidenceRaw = Number(raw.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? clamp01(confidenceRaw) : NaN;
    const riskFlags = Array.isArray(raw.risk_flags)
        ? raw.risk_flags.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
        : [];

    if (!recommendedAction || !reasonCode || !reason || !Number.isFinite(confidence)) {
        return null;
    }

    return {
        shouldTrigger,
        recommendedAction,
        reasonCode: reasonCode.slice(0, 64),
        reason: reason.slice(0, 320),
        confidence,
        riskFlags,
        method: 'llm',
    };
}

function buildUserPrompt(input: TriggerJudgeInput): string {
    const schema = getPromptSchema('discussion-trigger-judge');
    return [
        'Task: decide whether this discussion should trigger draft workflow.',
        '',
        'Context:',
        JSON.stringify({
            circleName: input.circleName,
            circleDescription: input.circleDescription || '',
            mode: input.mode,
            stats: {
                messageCount: input.messageCount,
                focusedRatio: input.focusedRatio,
                questionCount: input.questionCount,
                participantCount: input.participantCount,
                spamRatio: input.spamRatio,
                topicHeat: input.topicHeat,
            },
            summary: input.summary,
        }),
        '',
        'Return JSON matching this schema:',
        JSON.stringify(schema),
    ].join('\n');
}

function fallbackRuleDecision(input: TriggerJudgeInput): TriggerJudgeResult {
    const blockedBySpam = input.spamRatio >= 0.35;
    const hasSignal =
        input.messageCount >= 10
        && input.focusedRatio >= 0.55
        && input.questionCount >= 2
        && input.participantCount >= 2
        && input.topicHeat >= 0.45;

    if (blockedBySpam || !hasSignal) {
        return {
            shouldTrigger: false,
            recommendedAction: 'none',
            reasonCode: blockedBySpam ? 'rule_spam_ratio_high' : 'rule_signal_insufficient',
            reason: blockedBySpam ? 'spam ratio too high' : 'discussion signal is insufficient',
            confidence: 0.7,
            riskFlags: blockedBySpam ? ['spam_risk'] : ['low_signal'],
            method: 'rule',
        };
    }

    return {
        shouldTrigger: true,
        recommendedAction: input.mode === 'auto_draft' ? 'auto_draft' : 'notify_only',
        reasonCode: 'rule_signal_pass',
        reason: 'discussion signal passes hard gate',
        confidence: 0.62,
        riskFlags: [],
        method: 'rule',
    };
}

export async function judgeDiscussionTrigger(input: TriggerJudgeInput): Promise<TriggerJudgeResult> {
    const rule = fallbackRuleDecision(input);
    if (serviceConfig.ai.mode !== 'builtin' || input.allowLLM === false) return rule;

    const llmRaw = await generateStructuredOutput({
        modelTask: 'discussion-trigger',
        systemPrompt: getSystemPrompt('discussion-trigger-judge'),
        userPrompt: buildUserPrompt(input),
        temperature: 0.1,
        maxOutputTokens: 280,
    });
    const parsed = parseResult(llmRaw);
    if (!parsed) return rule;

    // Safety guard: never escalate above configured mode.
    const recommendedAction = input.mode === 'notify_only' && parsed.recommendedAction === 'auto_draft'
        ? 'notify_only'
        : parsed.recommendedAction;

    return {
        ...parsed,
        recommendedAction,
    };
}

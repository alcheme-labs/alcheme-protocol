/**
 * Ghost Draft — Dynamic User Prompt Builder
 *
 * Dynamic context assembly stays here, but canonical system prompts now live in
 * the registry under services/query-api/prompts/.
 */

export interface GhostDraftContext {
    /** The post being responded to */
    originalPost: {
        text: string;
        tags: string[];
    };
    /** Circle context for tone/topic awareness */
    circle?: {
        name: string;
        description?: string;
    };
    /** Recent posts in the thread for context */
    threadContext?: string[];
    /** Pending draft discussion issues that this revision should address */
    pendingIssueThreads?: Array<{
        threadId: string;
        state: 'open' | 'proposed' | 'accepted';
        issueType: string;
        targetType: string;
        targetRef: string;
        summary: string;
    }>;
    pendingSuggestionTargets?: Array<{
        targetType: 'paragraph' | 'structure' | 'document';
        targetRef: string;
        threadIds: string[];
        issueTypes: string[];
        summaries: string[];
    }>;
    /** Grounded source file snippets from seeded references */
    seededSourceContext?: Array<{
        path: string;
        line: number;
        fileName: string;
        lineText: string;
        snippet: string;
        contentDigest?: string | null;
    }>;
    /** Extracted uploaded material chunks available for grounding */
    sourceMaterialContext?: Array<{
        materialId: number;
        name: string;
        mimeType?: string | null;
        locatorType: string;
        locatorRef: string;
        text: string;
        textDigest: string;
        contentDigest?: string | null;
    }>;
    /** User's writing style (from their recent posts) */
    userStyleHints?: string[];
}

export function buildGhostDraftSuggestionTargets(
    pendingIssueThreads: NonNullable<GhostDraftContext['pendingIssueThreads']>,
): NonNullable<GhostDraftContext['pendingSuggestionTargets']> {
    const grouped = new Map<string, NonNullable<GhostDraftContext['pendingSuggestionTargets']>[number]>();

    pendingIssueThreads.forEach((thread) => {
        const targetType = String(thread.targetType || '').trim().toLowerCase() as 'paragraph' | 'structure' | 'document';
        const targetRef = String(thread.targetRef || '').trim();
        if (!targetRef) return;
        const key = `${targetType}:${targetRef}`;
        const existing = grouped.get(key);
        if (existing) {
            if (!existing.threadIds.includes(thread.threadId)) {
                existing.threadIds.push(thread.threadId);
            }
            if (!existing.issueTypes.includes(thread.issueType)) {
                existing.issueTypes.push(thread.issueType);
            }
            if (thread.summary && !existing.summaries.includes(thread.summary)) {
                existing.summaries.push(thread.summary);
            }
            return;
        }

        grouped.set(key, {
            targetType,
            targetRef,
            threadIds: [thread.threadId],
            issueTypes: thread.issueType ? [thread.issueType] : [],
            summaries: thread.summary ? [thread.summary] : [],
        });
    });

    return Array.from(grouped.values());
}

/**
 * Build the user prompt for Ghost Draft generation.
 */
export function buildGhostDraftUserPrompt(ctx: GhostDraftContext): string {
    const parts: string[] = [];

    if (ctx.pendingIssueThreads?.length) {
        parts.push('Pending issue threads to address in this revision:');
        ctx.pendingIssueThreads.forEach((thread, index) => {
            parts.push(
                `  ${index + 1}. Thread #${thread.threadId} [${thread.state}] [${thread.issueType}] ${thread.targetRef}`,
            );
            parts.push(`     Summary: ${thread.summary.slice(0, 320)}`);
        });
        parts.push('');
    }

    if (ctx.pendingSuggestionTargets?.length) {
        parts.push('Suggestion targets to revise (return one suggestion per target_ref):');
        ctx.pendingSuggestionTargets.forEach((target, index) => {
            parts.push(
                `  ${index + 1}. ${target.targetRef} threads=[${target.threadIds.join(', ')}] issue_types=[${target.issueTypes.join(', ')}]`,
            );
            target.summaries.forEach((summary, summaryIndex) => {
                parts.push(`     ${summaryIndex + 1}) ${summary.slice(0, 240)}`);
            });
        });
        parts.push('');
    }

    if (ctx.threadContext?.length) {
        parts.push('Thread context (oldest first):');
        ctx.threadContext.forEach((msg, i) => {
            parts.push(`  ${i + 1}. ${msg.slice(0, 200)}`);
        });
        parts.push('');
    }

    if (ctx.seededSourceContext?.length) {
        parts.push('Seeded source context:');
        ctx.seededSourceContext.forEach((item, index) => {
            parts.push(`  ${index + 1}. @file:${item.path}:${item.line} (${item.fileName})`);
            if (item.lineText) {
                parts.push(`     Focus line: ${item.lineText.slice(0, 220)}`);
            }
            if (item.snippet) {
                parts.push('     Nearby excerpt:');
                parts.push(`     ${item.snippet.split('\n').join('\n     ').slice(0, 600)}`);
            }
        });
        parts.push('');
    }

    if (ctx.sourceMaterialContext?.length) {
        parts.push('Uploaded source materials:');
        ctx.sourceMaterialContext.forEach((item, index) => {
            parts.push(`  ${index + 1}. ${item.name} [${item.locatorType}:${item.locatorRef}]`);
            parts.push(`     ${item.text.slice(0, 320)}`);
        });
        parts.push('');
    }

    parts.push('Current draft body:');
    parts.push(ctx.originalPost.text.slice(0, 1600));

    if (ctx.originalPost.tags.length > 0) {
        parts.push(`Tags: ${ctx.originalPost.tags.join(', ')}`);
    }

    parts.push('');
    parts.push('Return a JSON object with a `suggestions` array.');
    parts.push('Each suggestion must map to one target_ref from the list above and revise only that target.');
    parts.push('Preserve the existing section structure inside the affected paragraph when the current draft is already structured.');
    parts.push('Match the primary language already used by the current draft body and the issue-thread summaries.');

    return parts.join('\n');
}

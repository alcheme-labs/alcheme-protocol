export interface GovernanceCaseShareInput {
    id: string;
    title: string;
    requestedDecision: string;
    phase: string;
    decisionStatus: string | null;
    executionStatus: string | null;
    publicUrl: string;
    publiclyReadable: boolean;
}

export function buildGovernanceCaseMarkdownSummary(
    input: GovernanceCaseShareInput,
): string | null {
    if (!input.publiclyReadable) return null;
    const id = markdownText(input.id);
    const title = markdownText(input.title);
    const requestedDecision = markdownText(input.requestedDecision);
    const publicUrl = normalizedPublicUrl(input.publicUrl);
    if (!id || !title || !requestedDecision || !publicUrl) return null;
    const decisionStatus = input.decisionStatus || 'not_started';
    const executionStatus = input.executionStatus || 'not_ready';
    return [
        `# ${title}`,
        '',
        `- Case: [${id}](${publicUrl})`,
        `- Phase: \`${markdownCode(input.phase || 'unavailable')}\``,
        `- Decision: \`${markdownCode(decisionStatus)}\``,
        `- Execution: \`${markdownCode(executionStatus)}\``,
        '',
        '## Requested decision',
        '',
        requestedDecision,
    ].join('\n');
}

function markdownText(value: string): string {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/([\\`*_{}\[\]()<>#+\-.!|])/g, '\\$1');
}

function markdownCode(value: string): string {
    return String(value || '').trim().replace(/`/g, '');
}

function normalizedPublicUrl(value: string): string | null {
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return null;
    }
}

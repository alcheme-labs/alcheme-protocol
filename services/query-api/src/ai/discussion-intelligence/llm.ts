import { generateAiText } from '../provider';

interface StructuredOutputInput {
    modelTask: 'scoring' | 'ghost-draft' | 'discussion-summary' | 'discussion-trigger';
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
    maxOutputTokens?: number;
}

function collectJsonObjectCandidates(raw: string): string[] {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    const candidates: string[] = [];
    const fencedPattern = /```(?:json)?\s*([\s\S]*?)```/gi;
    for (const match of trimmed.matchAll(fencedPattern)) {
        candidates.push(match[1].trim());
    }

    const withoutThinkTags = trimmed.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    candidates.push(withoutThinkTags);

    for (let start = 0; start < withoutThinkTags.length; start += 1) {
        if (withoutThinkTags[start] !== '{') continue;
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let index = start; index < withoutThinkTags.length; index += 1) {
            const char = withoutThinkTags[index];
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (char === '\\') {
                    escaped = true;
                } else if (char === '"') {
                    inString = false;
                }
                continue;
            }
            if (char === '"') {
                inString = true;
                continue;
            }
            if (char === '{') {
                depth += 1;
            } else if (char === '}') {
                depth -= 1;
                if (depth === 0) {
                    candidates.push(withoutThinkTags.slice(start, index + 1));
                    break;
                }
            }
        }
    }

    return Array.from(new Set(candidates.filter((candidate) => candidate.length > 0)));
}

function parseJSONObject(raw: string): Record<string, unknown> | null {
    for (const candidate of collectJsonObjectCandidates(raw)) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            // Try the next candidate.
        }
    }
    return null;
}

export async function generateStructuredOutput(
    input: StructuredOutputInput,
): Promise<Record<string, unknown> | null> {
    try {
        const result = await generateAiText({
            task: input.modelTask,
            systemPrompt: input.systemPrompt,
            userPrompt: input.userPrompt,
            temperature: input.temperature ?? 0.1,
            maxOutputTokens: input.maxOutputTokens ?? 400,
        });
        const parsed = parseJSONObject(result.text || '');
        if (!parsed) {
            console.warn('[discussion-intelligence] structured output parse failed', {
                task: input.modelTask,
                outputLength: String(result.text || '').length,
            });
        }
        return parsed;
    } catch (error) {
        console.warn('[discussion-intelligence] structured output request failed', {
            task: input.modelTask,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

import { generateAiText } from '../provider';

interface StructuredOutputInput {
    modelTask: 'scoring' | 'ghost-draft' | 'discussion-summary' | 'discussion-trigger';
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
    maxOutputTokens?: number;
}

function parseJSONObject(raw: string): Record<string, unknown> | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

    try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        return null;
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
        return parseJSONObject(result.text || '');
    } catch {
        return null;
    }
}

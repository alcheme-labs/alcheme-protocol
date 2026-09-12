export interface ParsedSourceGroundedAskOutput {
    answer: string;
    limitations: string[];
    citedRefIds: string[];
    citationNotes: Record<string, string>;
    confidence: 'low' | 'medium' | 'high';
}

export function parseSourceGroundedAskModelOutput(input: {
    rawText: unknown;
    allowedRefIds: string[];
}): ParsedSourceGroundedAskOutput {
    const payload = parseJsonObject(input.rawText);
    const answer = typeof payload.answer === 'string' ? payload.answer.trim() : '';
    if (!answer) throw new Error('invalid_model_output');

    const allowed = new Set(input.allowedRefIds);
    const citationsInput = Array.isArray(payload.citations) ? payload.citations : [];
    const citedRefIds: string[] = [];
    const citationNotes: Record<string, string> = {};
    for (const citation of citationsInput) {
        if (!citation || typeof citation !== 'object' || Array.isArray(citation)) {
            throw new Error('invalid_model_output');
        }
        const refId = String((citation as any).refId || '').trim();
        if (!refId || !allowed.has(refId)) {
            throw new Error('invalid_model_output');
        }
        if (!citedRefIds.includes(refId)) citedRefIds.push(refId);
        const note = typeof (citation as any).note === 'string'
            ? (citation as any).note.trim()
            : '';
        if (note) citationNotes[refId] = note.slice(0, 240);
    }
    if (citedRefIds.length === 0 && allowed.size > 0) {
        throw new Error('invalid_model_output');
    }

    const limitations = Array.isArray(payload.limitations)
        ? payload.limitations
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .slice(0, 5)
        : [];
    const confidence = payload.confidence === 'high' || payload.confidence === 'medium'
        ? payload.confidence
        : 'low';
    return {
        answer,
        limitations,
        citedRefIds,
        citationNotes,
        confidence,
    };
}

function parseJsonObject(rawText: unknown): Record<string, unknown> {
    if (rawText && typeof rawText === 'object' && !Array.isArray(rawText)) {
        return rawText as Record<string, unknown>;
    }
    const text = String(rawText || '').trim();
    if (!text) throw new Error('invalid_model_output');
    const withoutFence = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    try {
        const parsed = JSON.parse(withoutFence);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('invalid_model_output');
        }
        return parsed;
    } catch {
        throw new Error('invalid_model_output');
    }
}

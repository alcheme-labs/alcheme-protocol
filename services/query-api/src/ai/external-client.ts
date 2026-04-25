import { serviceConfig } from '../config/services';

export interface ExternalAiTextRequest {
    task: 'scoring' | 'ghost-draft' | 'discussion-initial-draft' | 'discussion-summary' | 'discussion-trigger';
    model: string;
    systemPrompt?: string | null;
    userPrompt: string;
    temperature?: number;
    maxOutputTokens?: number;
}

export interface ExternalAiEmbeddingRequest {
    task: 'discussion-relevance' | 'circle-topic-profile';
    model: string;
    text: string;
}

function getExternalAiBaseUrl(): string {
    const raw = String(serviceConfig.ai.externalUrl || '').trim();
    if (!raw) {
        throw new Error('AI_EXTERNAL_URL is required when AI_MODE=external');
    }
    return raw.endsWith('/') ? raw : `${raw}/`;
}

function buildExternalAiUrl(pathname: string): string {
    return new URL(pathname.replace(/^\/+/, ''), getExternalAiBaseUrl()).toString();
}

function getExternalAiTimeoutMs(): number {
    const raw = Number((serviceConfig.ai as any).externalTimeoutMs ?? 15000);
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 15000;
}

async function readErrorMessage(response: Response): Promise<string> {
    try {
        const payload = await response.json();
        if (typeof payload?.message === 'string' && payload.message.trim()) {
            return payload.message.trim();
        }
        if (typeof payload?.error === 'string' && payload.error.trim()) {
            return payload.error.trim();
        }
    } catch {
        // ignore parse failures
    }
    return `external ai request failed with status ${response.status}`;
}

export async function generateExternalAiText(input: ExternalAiTextRequest): Promise<string> {
    const controller = new AbortController();
    const timeoutMs = getExternalAiTimeoutMs();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(buildExternalAiUrl('/generate-text'), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                task: input.task,
                model: input.model,
                systemPrompt: input.systemPrompt ?? null,
                userPrompt: input.userPrompt,
                temperature: input.temperature ?? 0.1,
                maxOutputTokens: input.maxOutputTokens ?? 400,
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(await readErrorMessage(response));
        }

        const payload = await response.json().catch(() => null) as { text?: unknown } | null;
        const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
        if (!text) {
            throw new Error('external ai response did not include text');
        }
        return text;
    } catch (error) {
        if ((error as any)?.name === 'AbortError') {
            throw new Error(`external ai request timed out after ${timeoutMs}ms`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutHandle);
    }
}

export async function generateExternalAiEmbedding(input: ExternalAiEmbeddingRequest): Promise<number[]> {
    const controller = new AbortController();
    const timeoutMs = getExternalAiTimeoutMs();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(buildExternalAiUrl('/embed'), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                task: input.task,
                model: input.model,
                text: input.text,
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(await readErrorMessage(response));
        }

        const payload = await response.json().catch(() => null) as
            | { embedding?: unknown; embeddings?: unknown }
            | null;
        const candidate = Array.isArray(payload?.embedding)
            ? payload?.embedding
            : Array.isArray(payload?.embeddings)
                ? (payload?.embeddings as unknown[])[0]
                : null;
        if (!Array.isArray(candidate) || candidate.length === 0) {
            throw new Error('external ai response did not include embedding');
        }

        const embedding = candidate
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value));
        if (embedding.length === 0) {
            throw new Error('external ai response did not include embedding');
        }
        return embedding;
    } catch (error) {
        if ((error as any)?.name === 'AbortError') {
            throw new Error(`external ai request timed out after ${timeoutMs}ms`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutHandle);
    }
}

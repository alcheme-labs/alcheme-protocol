import { generateAiEmbedding } from './provider';

function normalizeText(input: string): string {
    return String(input || '').replace(/\s+/g, ' ').trim();
}

export function cosineSimilarity(a: number[], b: number[]): number {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) {
        return 0;
    }

    const length = Math.min(a.length, b.length);
    let dot = 0;
    let aNorm = 0;
    let bNorm = 0;

    for (let index = 0; index < length; index += 1) {
        const av = Number(a[index]);
        const bv = Number(b[index]);
        if (!Number.isFinite(av) || !Number.isFinite(bv)) {
            continue;
        }
        dot += av * bv;
        aNorm += av * av;
        bNorm += bv * bv;
    }

    if (aNorm <= 0 || bNorm <= 0) {
        return 0;
    }

    return Math.max(0, Math.min(1, dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm))));
}

export async function embedDiscussionText(input: {
    text: string;
    purpose: 'discussion-relevance' | 'circle-topic-profile';
}): Promise<{
    embedding: number[];
    providerMode: 'builtin' | 'external';
    model: string;
}> {
    const normalized = normalizeText(input.text);
    if (!normalized) {
        throw new Error('embedding_text_required');
    }

    const result = await generateAiEmbedding({
        task: input.purpose,
        text: normalized,
        dataBoundary: 'public_protocol',
    });

    return result;
}

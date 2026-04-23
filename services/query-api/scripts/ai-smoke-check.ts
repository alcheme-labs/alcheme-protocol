import { generateAiEmbedding, generateAiText } from '../src/ai/provider';
import { serviceConfig } from '../src/config/services';

export interface AiSmokeCheckResult {
    mode: 'builtin' | 'external';
    builtinTextApi?: 'chat_completions' | 'responses';
    textProviderMode: 'builtin' | 'external';
    textModel: string;
    textPreview: string;
    embeddingProviderMode: 'builtin' | 'external';
    embeddingModel: string;
    embeddingDimensions: number;
}

function clipPreview(input: string): string {
    const normalized = String(input || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= 80) return normalized;
    return `${normalized.slice(0, 79)}…`;
}

export async function runAiSmokeCheck(): Promise<AiSmokeCheckResult> {
    let text;
    try {
        text = await generateAiText({
            task: 'discussion-summary',
            systemPrompt: 'Reply with a very short confirmation.',
            userPrompt: 'Return exactly: OK',
            temperature: 0,
            maxOutputTokens: 16,
            dataBoundary: 'public_protocol',
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`text_path_failed:${message}`);
    }
    if (!String(text.text || '').trim()) {
        throw new Error('ai_smoke_text_empty');
    }

    let embedding;
    try {
        embedding = await generateAiEmbedding({
            task: 'discussion-relevance',
            text: '异步编程、事件循环、I/O 等待',
            dataBoundary: 'public_protocol',
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`embedding_failed:${message}`);
    }
    if (!Array.isArray(embedding.embedding) || embedding.embedding.length === 0) {
        throw new Error('ai_smoke_embedding_empty');
    }

    return {
        mode: serviceConfig.ai.mode,
        builtinTextApi: serviceConfig.ai.mode === 'builtin' ? serviceConfig.ai.builtinTextApi : undefined,
        textProviderMode: text.providerMode,
        textModel: text.model,
        textPreview: clipPreview(text.text),
        embeddingProviderMode: embedding.providerMode,
        embeddingModel: embedding.model,
        embeddingDimensions: embedding.embedding.length,
    };
}

async function main() {
    const result = await runAiSmokeCheck();
    console.log(
        `[ai-smoke] mode=${result.mode}`
        + `${result.builtinTextApi ? ` builtin_text_api=${result.builtinTextApi}` : ''}`
        + ` text_provider=${result.textProviderMode} text_model=${result.textModel}`,
    );
    console.log(`[ai-smoke] text_ok preview=${JSON.stringify(result.textPreview)}`);
    console.log(
        `[ai-smoke] embedding_ok provider=${result.embeddingProviderMode} model=${result.embeddingModel} dimensions=${result.embeddingDimensions}`,
    );
}

if (require.main === module) {
    main().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ai-smoke] failed: ${message}`);
        process.exit(1);
    });
}

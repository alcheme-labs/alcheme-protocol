import { describe, expect, test } from '@jest/globals';

import {
    loadAiModelConfig,
    loadAiRuntimeConfig,
} from '../ai';

describe('ai config', () => {
    test('loads builtin runtime config from canonical env names', () => {
        const config = loadAiRuntimeConfig({
            AI_MODE: 'builtin',
            NEW_API_URL: 'https://gateway.example/v1',
            NEW_API_KEY: 'secret-key',
            NEW_API_TIMEOUT_MS: '3210',
        } as NodeJS.ProcessEnv);

        expect(config).toEqual({
            mode: 'builtin',
            builtinTextApi: 'chat_completions',
            externalUrl: undefined,
            externalTimeoutMs: 15000,
            externalPrivateContentMode: 'deny',
            gatewayUrl: 'https://gateway.example/v1',
            gatewayKey: 'secret-key',
            gatewayTimeoutMs: 3210,
        });
    });

    test('loads external runtime config and preserves private-content mode', () => {
        const config = loadAiRuntimeConfig({
            AI_MODE: 'external',
            AI_EXTERNAL_URL: 'https://external.example/ai',
            AI_EXTERNAL_TIMEOUT_MS: '9000',
            AI_EXTERNAL_PRIVATE_CONTENT_MODE: 'allow',
        } as NodeJS.ProcessEnv);

        expect(config).toEqual({
            mode: 'external',
            builtinTextApi: 'chat_completions',
            externalUrl: 'https://external.example/ai',
            externalTimeoutMs: 9000,
            externalPrivateContentMode: 'allow',
            gatewayUrl: 'http://localhost:3000/v1',
            gatewayKey: '',
            gatewayTimeoutMs: 15000,
        });
    });

    test('loads model config from env without scattering process.env reads', () => {
        const config = loadAiModelConfig({
            SCORING_MODEL: 'score-model',
            GHOST_DRAFT_MODEL: 'draft-model',
            DISCUSSION_SUMMARY_MODEL: 'summary-model',
            DISCUSSION_TRIGGER_MODEL: 'trigger-model',
            EMBEDDING_MODEL: 'embed-model',
        } as NodeJS.ProcessEnv);

        expect(config).toEqual({
            scoring: 'score-model',
            ghostDraft: 'draft-model',
            discussionInitialDraft: 'draft-model',
            discussionSummary: 'summary-model',
            discussionTrigger: 'trigger-model',
            embedding: 'embed-model',
        });
    });

    test('falls back to chat_completions when AI_BUILTIN_TEXT_API is invalid', () => {
        const config = loadAiRuntimeConfig({
            AI_MODE: 'builtin',
            AI_BUILTIN_TEXT_API: 'weird_mode',
        } as NodeJS.ProcessEnv);

        expect(config.builtinTextApi).toBe('chat_completions');
    });
});

import fs from 'fs';
import path from 'path';

export type PromptTemplateId =
    | 'discussion-relevance'
    | 'discussion-semantic-facets'
    | 'discussion-trigger-judge'
    | 'discussion-initial-draft'
    | 'discussion-summary'
    | 'ghost-draft-comment';

interface PromptTemplateDef {
    systemFile: string;
    schemaFile?: string;
    version: string;
}

export interface PromptTemplate {
    id: PromptTemplateId;
    version: string;
    promptsDir: string;
    system: string;
    schema: unknown | null;
}

const TEMPLATE_DEFS: Record<PromptTemplateId, PromptTemplateDef> = {
    'discussion-relevance': {
        systemFile: 'discussion-relevance.system.md',
        schemaFile: 'schemas/discussion-relevance.schema.json',
        version: 'v1',
    },
    'discussion-semantic-facets': {
        systemFile: 'discussion-semantic-facets.system.md',
        schemaFile: 'schemas/discussion-semantic-facets.schema.json',
        version: 'v1',
    },
    'discussion-trigger-judge': {
        systemFile: 'discussion-trigger-judge.system.md',
        schemaFile: 'schemas/discussion-trigger-judge.schema.json',
        version: 'v1',
    },
    'discussion-summary': {
        systemFile: 'discussion-summary.system.md',
        schemaFile: 'schemas/discussion-summary.schema.json',
        version: 'v1',
    },
    'discussion-initial-draft': {
        systemFile: 'discussion-initial-draft.system.md',
        schemaFile: 'schemas/discussion-initial-draft.schema.json',
        version: 'v1',
    },
    'ghost-draft-comment': {
        systemFile: 'ghost-draft-comment.system.md',
        schemaFile: 'schemas/ghost-draft-comment.schema.json',
        version: 'v1',
    },
};

const TEMPLATE_CACHE = new Map<PromptTemplateId, PromptTemplate>();

function uniqueList(items: string[]): string[] {
    return Array.from(new Set(items.filter((item) => item.trim().length > 0)));
}

function candidatePromptDirs(): string[] {
    const explicit = String(process.env.ALCHEME_PROMPTS_DIR || '').trim();
    return uniqueList([
        explicit,
        path.resolve(process.cwd(), 'prompts'),
        path.resolve(process.cwd(), 'services/query-api/prompts'),
        path.resolve(__dirname, '../../../prompts'),
    ]);
}

function fileExists(filepath: string): boolean {
    try {
        return fs.existsSync(filepath);
    } catch {
        return false;
    }
}

function resolvePromptsDir(requiredSystemFile: string): string {
    const dirs = candidatePromptDirs();
    for (const dir of dirs) {
        const expected = path.join(dir, requiredSystemFile);
        if (fileExists(expected)) {
            return dir;
        }
    }
    throw new Error(
        `prompt assets not found: ${requiredSystemFile}; checked ${dirs.join(', ')}`,
    );
}

function readTextFile(filepath: string): string {
    return fs.readFileSync(filepath, 'utf8').trim();
}

function readJsonFile(filepath: string): unknown {
    const raw = fs.readFileSync(filepath, 'utf8');
    return JSON.parse(raw);
}

export function loadPromptTemplate(id: PromptTemplateId): PromptTemplate {
    const cached = TEMPLATE_CACHE.get(id);
    if (cached) return cached;

    const def = TEMPLATE_DEFS[id];
    const promptsDir = resolvePromptsDir(def.systemFile);
    const systemPath = path.join(promptsDir, def.systemFile);
    const schemaPath = def.schemaFile ? path.join(promptsDir, def.schemaFile) : null;

    const template: PromptTemplate = {
        id,
        version: def.version,
        promptsDir,
        system: readTextFile(systemPath),
        schema: schemaPath ? readJsonFile(schemaPath) : null,
    };
    TEMPLATE_CACHE.set(id, template);
    return template;
}

export function getSystemPrompt(id: PromptTemplateId): string {
    return loadPromptTemplate(id).system;
}

export function getPromptSchema(id: PromptTemplateId): unknown | null {
    return loadPromptTemplate(id).schema;
}

export function getPromptMetadata(id: PromptTemplateId): {
    promptAsset: PromptTemplateId;
    promptVersion: string;
} {
    const prompt = loadPromptTemplate(id);
    return {
        promptAsset: prompt.id,
        promptVersion: prompt.version,
    };
}

export function renderPromptVariables(
    template: string,
    vars: Record<string, string | number | boolean | null | undefined>,
): string {
    let rendered = template;
    Object.entries(vars).forEach(([key, value]) => {
        const safeValue = value === null || value === undefined ? '' : String(value);
        rendered = rendered.replaceAll(`{{${key}}}`, safeValue);
    });
    return rendered;
}

export function clearPromptTemplateCache(): void {
    TEMPLATE_CACHE.clear();
}

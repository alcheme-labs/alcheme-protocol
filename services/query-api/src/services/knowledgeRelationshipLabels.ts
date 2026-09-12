import { Prisma, type PrismaClient } from '@prisma/client';
import type { AppLocale } from '../i18n/locale';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export const DEFAULT_KNOWLEDGE_RELATIONSHIP_LABEL_KEY = 'original';

type LocalizedJsonMap = Record<string, unknown>;

interface KnowledgeRelationshipPrismaDelegates {
    knowledgeRelationshipLabel: {
        findMany(args: Record<string, unknown>): Promise<any[]>;
        findUnique(args: Record<string, unknown>): Promise<any | null>;
    };
    knowledgeRelationshipAssignment: {
        findMany(args: Record<string, unknown>): Promise<any[]>;
        findUnique?(args: Record<string, unknown>): Promise<any | null>;
        updateMany?(args: Record<string, unknown>): Promise<{ count?: number }>;
    };
}

export interface KnowledgeRelationshipLabelView {
    key: string;
    displayName: string;
    description: string;
    useCases: string[];
    example: string | null;
    status: string;
    source: string;
    sortOrder: number;
}

export interface KnowledgeRelationshipAssignmentView {
    knowledgeId: string;
    labelKey: string;
    label: KnowledgeRelationshipLabelView;
    sourceKnowledgeIds: string[];
    sourceDraftId: string | null;
    assignedBy: string;
    confidence: number | null;
    createdAt: Date;
    updatedAt: Date;
}

export const SYSTEM_LABEL_CATALOG = [
    {
        key: 'original',
        displayName: {
            zh: '原始结晶',
            en: 'Original crystal',
            es: 'Cristal original',
            fr: 'Cristal original',
        },
        description: {
            zh: '从讨论或草稿首次沉淀出的独立知识。',
            en: 'An independent knowledge crystal first distilled from a discussion or draft.',
            es: 'Un conocimiento independiente destilado por primera vez desde una discusión o borrador.',
            fr: 'Une connaissance indépendante issue pour la première fois d’une discussion ou d’un brouillon.',
        },
        useCases: {
            zh: ['某次讨论首次形成可复用结论。'],
            en: ['A discussion forms a reusable conclusion for the first time.'],
            es: ['Una discusión forma una conclusión reutilizable por primera vez.'],
            fr: ['Une discussion forme une conclusion réutilisable pour la première fois.'],
        },
        example: {
            zh: '一次讨论首次沉淀出可复用判断。',
            en: 'A discussion first produces a reusable conclusion.',
            es: 'Una discusión produce por primera vez una conclusión reutilizable.',
            fr: 'Une discussion produit pour la première fois une conclusion réutilisable.',
        },
        status: 'active',
        source: 'system_fallback',
        sortOrder: 10,
    },
    {
        key: 'extension',
        displayName: {
            zh: '扩展结晶',
            en: 'Extension crystal',
            es: 'Cristal de extensión',
            fr: 'Cristal d’extension',
        },
        description: {
            zh: '基于已有知识向外展开新场景、新应用或新问题。',
            en: 'Extends existing knowledge into a new scenario, application, or question.',
            es: 'Amplía conocimiento existente hacia un nuevo escenario, aplicación o problema.',
            fr: 'Étend une connaissance existante vers un nouveau scénario, usage ou problème.',
        },
        useCases: {
            zh: ['不是修正旧知识，而是在旧知识基础上继续延展。'],
            en: ['It does not correct old knowledge; it expands from it.'],
            es: ['No corrige conocimiento anterior; lo extiende.'],
            fr: ['Ne corrige pas l’ancienne connaissance ; l’étend.'],
        },
        example: {
            zh: '把已有结论应用到新的使用场景。',
            en: 'Applies an existing conclusion to a new use case.',
            es: 'Aplica una conclusión existente a un nuevo caso de uso.',
            fr: 'Applique une conclusion existante à un nouveau cas d’usage.',
        },
        status: 'active',
        source: 'system_fallback',
        sortOrder: 20,
    },
    {
        key: 'supplement',
        displayName: {
            zh: '补充结晶',
            en: 'Supplement crystal',
            es: 'Cristal suplementario',
            fr: 'Cristal complémentaire',
        },
        description: {
            zh: '给已有知识补充遗漏背景、边界、案例或证据。',
            en: 'Adds missing context, boundaries, examples, or evidence to existing knowledge.',
            es: 'Añade contexto, límites, ejemplos o evidencia que faltaban a un conocimiento existente.',
            fr: 'Ajoute du contexte, des limites, des exemples ou des preuves manquantes à une connaissance existante.',
        },
        useCases: {
            zh: ['原知识基本成立，但还不完整。'],
            en: ['The existing knowledge is basically valid but incomplete.'],
            es: ['El conocimiento existente es válido en general, pero incompleto.'],
            fr: ['La connaissance existante est globalement valable, mais incomplète.'],
        },
        example: {
            zh: '补上一条旧结论缺少的适用边界。',
            en: 'Adds a missing boundary to a previous conclusion.',
            es: 'Añade un límite que faltaba a una conclusión anterior.',
            fr: 'Ajoute une limite manquante à une conclusion précédente.',
        },
        status: 'active',
        source: 'system_fallback',
        sortOrder: 30,
    },
    {
        key: 'correction',
        displayName: {
            zh: '修正结晶',
            en: 'Correction crystal',
            es: 'Cristal de corrección',
            fr: 'Cristal de correction',
        },
        description: {
            zh: '修正已有知识中的事实、表述、边界或结论问题。',
            en: 'Corrects a fact, wording, boundary, or conclusion in existing knowledge.',
            es: 'Corrige un hecho, redacción, límite o conclusión en un conocimiento existente.',
            fr: 'Corrige un fait, une formulation, une limite ou une conclusion dans une connaissance existante.',
        },
        useCases: {
            zh: ['发现旧结论有错误或需要更准确表述。'],
            en: ['An old conclusion is wrong or needs more precise wording.'],
            es: ['Una conclusión anterior es errónea o necesita una formulación más precisa.'],
            fr: ['Une conclusion précédente est erronée ou nécessite une formulation plus précise.'],
        },
        example: {
            zh: '修正一个过度绝对化的判断。',
            en: 'Corrects an overly absolute claim.',
            es: 'Corrige una afirmación demasiado absoluta.',
            fr: 'Corrige une affirmation trop absolue.',
        },
        status: 'active',
        source: 'system_fallback',
        sortOrder: 40,
    },
    {
        key: 'counterexample',
        displayName: {
            zh: '反例结晶',
            en: 'Counterexample crystal',
            es: 'Cristal de contraejemplo',
            fr: 'Cristal de contre-exemple',
        },
        description: {
            zh: '给已有知识提供反例、限制条件或挑战证据。',
            en: 'Provides a counterexample, limitation, or challenging evidence for existing knowledge.',
            es: 'Aporta un contraejemplo, limitación o evidencia que cuestiona un conocimiento existente.',
            fr: 'Apporte un contre-exemple, une limite ou une preuve qui remet en question une connaissance existante.',
        },
        useCases: {
            zh: ['说明某结论不是所有场景都成立。'],
            en: ['Shows that a conclusion does not hold in every scenario.'],
            es: ['Muestra que una conclusión no se cumple en todos los escenarios.'],
            fr: ['Montre qu’une conclusion ne tient pas dans tous les scénarios.'],
        },
        example: {
            zh: '指出某个结论在一个具体场景下不成立。',
            en: 'Shows a specific scenario where a conclusion does not hold.',
            es: 'Muestra un escenario específico donde una conclusión no se cumple.',
            fr: 'Montre un scénario précis où une conclusion ne tient pas.',
        },
        status: 'active',
        source: 'system_fallback',
        sortOrder: 50,
    },
    {
        key: 'synthesis',
        displayName: {
            zh: '综合结晶',
            en: 'Synthesis crystal',
            es: 'Cristal de síntesis',
            fr: 'Cristal de synthèse',
        },
        description: {
            zh: '综合多条讨论或多条知识，形成更高层结论。',
            en: 'Synthesizes multiple discussions or knowledge items into a higher-level conclusion.',
            es: 'Sintetiza varias discusiones o conocimientos en una conclusión de nivel superior.',
            fr: 'Synthétise plusieurs discussions ou connaissances en une conclusion de niveau supérieur.',
        },
        useCases: {
            zh: ['多条知识需要被整理成一个上位判断。'],
            en: ['Multiple knowledge items need to be organized into a higher-level judgment.'],
            es: ['Varios conocimientos deben organizarse en un juicio de nivel superior.'],
            fr: ['Plusieurs connaissances doivent être organisées en un jugement de niveau supérieur.'],
        },
        example: {
            zh: '把几条相关结论整理成一个更高层判断。',
            en: 'Organizes several related conclusions into a higher-level judgment.',
            es: 'Organiza varias conclusiones relacionadas en un juicio de nivel superior.',
            fr: 'Organise plusieurs conclusions liées en un jugement de niveau supérieur.',
        },
        status: 'active',
        source: 'system_fallback',
        sortOrder: 60,
    },
] as const;

function jsonb(value: unknown): string {
    return JSON.stringify(value);
}

export async function ensureKnowledgeRelationshipSystemCatalog(prisma: PrismaLike): Promise<void> {
    for (const label of SYSTEM_LABEL_CATALOG) {
        await prisma.$executeRaw(Prisma.sql`
            INSERT INTO knowledge_relationship_labels (
                key,
                display_name,
                description,
                use_cases,
                example,
                status,
                source,
                sort_order,
                created_at,
                updated_at
            ) VALUES (
                ${label.key},
                ${jsonb(label.displayName)}::jsonb,
                ${jsonb(label.description)}::jsonb,
                ${jsonb(label.useCases)}::jsonb,
                ${label.example ? jsonb(label.example) : null}::jsonb,
                'active',
                'system_seed',
                ${label.sortOrder},
                NOW(),
                NOW()
            )
            ON CONFLICT (key) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                description = EXCLUDED.description,
                use_cases = EXCLUDED.use_cases,
                example = EXCLUDED.example,
                status = EXCLUDED.status,
                sort_order = EXCLUDED.sort_order,
                updated_at = NOW()
            WHERE knowledge_relationship_labels.source = 'system_seed'
        `);
    }
}

export async function backfillDefaultKnowledgeRelationshipAssignments(prisma: PrismaLike): Promise<void> {
    await prisma.$executeRaw(Prisma.sql`
        INSERT INTO knowledge_relationship_assignments (
            knowledge_id,
            label_key,
            source_knowledge_ids,
            assigned_by,
            created_at,
            updated_at
        )
        SELECT
            k.knowledge_id,
            l.key,
            '[]'::jsonb,
            'system_default',
            NOW(),
            NOW()
        FROM knowledge k
        JOIN knowledge_relationship_labels l
          ON l.key = ${DEFAULT_KNOWLEDGE_RELATIONSHIP_LABEL_KEY}
        WHERE l.key = ${DEFAULT_KNOWLEDGE_RELATIONSHIP_LABEL_KEY}
          AND NOT EXISTS (
            SELECT 1
            FROM knowledge_relationship_assignments existing
            WHERE existing.knowledge_id = k.knowledge_id
        )
        ON CONFLICT (knowledge_id) DO NOTHING
    `);
}

export async function ensureDefaultKnowledgeRelationshipAssignment(
    prisma: PrismaLike,
    input: {
        knowledgeId: string;
        sourceDraftId?: string | null;
    },
): Promise<void> {
    const knowledgeId = String(input.knowledgeId || '').trim();
    if (!knowledgeId) return;
    const sourceDraftId = String(input.sourceDraftId || '').trim() || null;

    await prisma.$executeRaw(Prisma.sql`
        INSERT INTO knowledge_relationship_assignments (
            knowledge_id,
            label_key,
            source_knowledge_ids,
            source_draft_id,
            assigned_by,
            created_at,
            updated_at
        )
        SELECT
            k.knowledge_id,
            l.key,
            '[]'::jsonb,
            ${sourceDraftId},
            'system_default',
            NOW(),
            NOW()
        FROM knowledge k
        JOIN knowledge_relationship_labels l
          ON l.key = ${DEFAULT_KNOWLEDGE_RELATIONSHIP_LABEL_KEY}
        WHERE k.knowledge_id = ${knowledgeId}
        ON CONFLICT (knowledge_id) DO UPDATE SET
            source_draft_id = COALESCE(EXCLUDED.source_draft_id, knowledge_relationship_assignments.source_draft_id),
            updated_at = CASE
                WHEN EXCLUDED.source_draft_id IS NOT NULL
                  AND knowledge_relationship_assignments.source_draft_id IS DISTINCT FROM EXCLUDED.source_draft_id
                THEN NOW()
                ELSE knowledge_relationship_assignments.updated_at
            END
        WHERE knowledge_relationship_assignments.label_key = ${DEFAULT_KNOWLEDGE_RELATIONSHIP_LABEL_KEY}
          AND knowledge_relationship_assignments.assigned_by = 'system_default'
    `);
}

export async function assignKnowledgeRelationshipLabel(
    prisma: PrismaLike,
    input: {
        knowledgeId: string;
        labelKey: string;
        sourceKnowledgeIds?: string[];
        sourceDraftId?: string | null;
        assignedBy: string;
        confidence?: number | null;
        onlyIfDefaultOriginal?: boolean;
    },
): Promise<{
    updated: boolean;
    reason: 'updated' | 'label_not_active' | 'assignment_not_default' | 'unsupported_prisma_delegate';
}> {
    const db = prisma as PrismaLike & KnowledgeRelationshipPrismaDelegates;
    const knowledgeId = String(input.knowledgeId || '').trim();
    const labelKey = String(input.labelKey || '').trim();
    if (!knowledgeId || !labelKey) {
        return { updated: false, reason: 'label_not_active' };
    }
    const label = await db.knowledgeRelationshipLabel.findUnique({
        where: { key: labelKey },
    });
    if (!label || label.status !== 'active') {
        return { updated: false, reason: 'label_not_active' };
    }
    if (typeof db.knowledgeRelationshipAssignment.updateMany !== 'function') {
        return { updated: false, reason: 'unsupported_prisma_delegate' };
    }

    if (typeof db.knowledgeRelationshipAssignment.findUnique === 'function') {
        const current = await db.knowledgeRelationshipAssignment.findUnique({
            where: { knowledgeId },
        });
        if (
            current
            && (input.onlyIfDefaultOriginal ?? true)
            && (
                current.labelKey !== DEFAULT_KNOWLEDGE_RELATIONSHIP_LABEL_KEY
                || current.assignedBy !== 'system_default'
            )
        ) {
            return { updated: false, reason: 'assignment_not_default' };
        }
        if (!current) {
            await ensureDefaultKnowledgeRelationshipAssignment(prisma, {
                knowledgeId,
                sourceDraftId: input.sourceDraftId,
            });
        }
    } else {
        await ensureDefaultKnowledgeRelationshipAssignment(prisma, {
            knowledgeId,
            sourceDraftId: input.sourceDraftId,
        });
    }

    const sourceKnowledgeIds = Array.from(new Set(
        (input.sourceKnowledgeIds ?? [])
            .map((value) => String(value || '').trim())
            .filter(Boolean),
    ));
    const confidence = input.confidence === null || input.confidence === undefined
        ? null
        : Math.max(0, Math.min(1, Number(input.confidence)));
    const result = await db.knowledgeRelationshipAssignment.updateMany({
        where: {
            knowledgeId,
            ...(input.onlyIfDefaultOriginal ?? true
                ? {
                    labelKey: DEFAULT_KNOWLEDGE_RELATIONSHIP_LABEL_KEY,
                    assignedBy: 'system_default',
                }
                : {}),
        },
        data: {
            labelKey,
            sourceKnowledgeIds,
            sourceDraftId: input.sourceDraftId ?? undefined,
            assignedBy: String(input.assignedBy || 'ai_classifier').slice(0, 48),
            confidence: Number.isFinite(confidence) ? confidence : null,
        },
    });
    const updated = Number(result?.count || 0) > 0;
    return {
        updated,
        reason: updated ? 'updated' : 'assignment_not_default',
    };
}

function normalizeLocalizedMap(value: unknown): LocalizedJsonMap {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as LocalizedJsonMap
        : {};
}

function localizedText(value: unknown, locale: AppLocale, fallback = ''): string {
    const map = normalizeLocalizedMap(value);
    const localized = map[locale];
    if (typeof localized === 'string' && localized.trim()) return localized.trim();

    const english = map.en;
    if (typeof english === 'string' && english.trim()) return english.trim();

    const firstString = Object.values(map).find((candidate): candidate is string =>
        typeof candidate === 'string' && candidate.trim().length > 0,
    );
    return firstString?.trim() ?? fallback;
}

function localizedStringArray(value: unknown, locale: AppLocale): string[] {
    const map = normalizeLocalizedMap(value);
    const localized = map[locale];
    if (Array.isArray(localized)) {
        return localized.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    }

    const english = map.en;
    if (Array.isArray(english)) {
        return english.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    }

    const firstArray = Object.values(map).find(Array.isArray);
    return (firstArray ?? []).filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function normalizeConfidence(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value === 'object' && typeof (value as { toNumber?: () => number }).toNumber === 'function') {
        const parsed = (value as { toNumber: () => number }).toNumber();
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function fallbackLabel(locale: AppLocale): KnowledgeRelationshipLabelView {
    return toLabelView(SYSTEM_LABEL_CATALOG[0], locale);
}

function fallbackLabelCatalog(locale: AppLocale): KnowledgeRelationshipLabelView[] {
    return SYSTEM_LABEL_CATALOG.map((row) => toLabelView(row, locale));
}

function toLabelView(row: any, locale: AppLocale): KnowledgeRelationshipLabelView {
    if (!row) return fallbackLabel(locale);
    return {
        key: row.key,
        displayName: localizedText(row.displayName, locale, row.key),
        description: localizedText(row.description, locale),
        useCases: localizedStringArray(row.useCases, locale),
        example: localizedText(row.example, locale) || null,
        status: row.status,
        source: row.source,
        sortOrder: Number(row.sortOrder ?? 0),
    };
}

function toAssignmentView(
    row: any,
    locale: AppLocale,
    fallbackKnowledgeId?: string,
    fallbackOriginalLabel?: any,
): KnowledgeRelationshipAssignmentView {
    const label = toLabelView(row?.label ?? fallbackOriginalLabel, locale);
    return {
        knowledgeId: row?.knowledgeId ?? fallbackKnowledgeId ?? '',
        labelKey: row?.labelKey ?? label.key,
        label,
        sourceKnowledgeIds: normalizeStringList(row?.sourceKnowledgeIds),
        sourceDraftId: row?.sourceDraftId ?? null,
        assignedBy: row?.assignedBy ?? 'system_fallback',
        confidence: normalizeConfidence(row?.confidence),
        createdAt: row?.createdAt ?? new Date(0),
        updatedAt: row?.updatedAt ?? new Date(0),
    };
}

export function formatSourceDraftVersionLabel(version: number | null | undefined, locale: AppLocale): string | null {
    if (!Number.isInteger(version) || Number(version) <= 0) return null;
    if (locale === 'zh') return `来源草稿版本 v${version}`;
    if (locale === 'es') return `Versión del borrador fuente v${version}`;
    if (locale === 'fr') return `Version du brouillon source v${version}`;
    return `Source draft version v${version}`;
}

export function formatInternalRecordVersionLabel(version: number | null | undefined, locale: AppLocale): string | null {
    if (!Number.isInteger(version) || Number(version) <= 0) return null;
    if (locale === 'zh') return `内部记录版本 ${version}`;
    if (locale === 'es') return `Versión interna de registro ${version}`;
    if (locale === 'fr') return `Version interne du dossier ${version}`;
    return `Internal record version ${version}`;
}

export async function listKnowledgeRelationshipLabels(
    prisma: PrismaLike,
    input: {
        status?: string | null;
        locale: AppLocale;
    },
): Promise<KnowledgeRelationshipLabelView[]> {
    const db = prisma as PrismaLike & KnowledgeRelationshipPrismaDelegates;
    const status = input.status ?? 'active';
    const rows = await db.knowledgeRelationshipLabel.findMany({
        where: status ? { status } : undefined,
        orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
    if (rows.length === 0 && status === 'active') {
        return fallbackLabelCatalog(input.locale);
    }
    return rows.map((row) => toLabelView(row, input.locale));
}

export async function resolveKnowledgeRelationshipAssignmentsForKnowledgeIds(
    prisma: PrismaLike,
    knowledgeIds: string[],
    input: {
        locale: AppLocale;
        includeInactiveAssignedLabel?: boolean;
    },
): Promise<Map<string, KnowledgeRelationshipAssignmentView>> {
    const db = prisma as PrismaLike & KnowledgeRelationshipPrismaDelegates;
    const uniqueKnowledgeIds = Array.from(
        new Set(knowledgeIds.map((value) => value.trim()).filter(Boolean)),
    );
    if (uniqueKnowledgeIds.length === 0) return new Map();

    const includeInactiveAssignedLabel = input.includeInactiveAssignedLabel ?? true;
    const rows = await db.knowledgeRelationshipAssignment.findMany({
        where: { knowledgeId: { in: uniqueKnowledgeIds } },
        include: { label: true },
    });

    const byKnowledgeId = new Map<string, KnowledgeRelationshipAssignmentView>();
    for (const row of rows) {
        const effectiveRow = includeInactiveAssignedLabel || row.label?.status === 'active'
            ? row
            : { ...row, label: null };
        byKnowledgeId.set(row.knowledgeId, toAssignmentView(effectiveRow, input.locale));
    }

    if (byKnowledgeId.size < uniqueKnowledgeIds.length) {
        const originalLabel = await db.knowledgeRelationshipLabel.findUnique({
            where: { key: DEFAULT_KNOWLEDGE_RELATIONSHIP_LABEL_KEY },
        });
        for (const knowledgeId of uniqueKnowledgeIds) {
            if (!byKnowledgeId.has(knowledgeId)) {
                byKnowledgeId.set(
                    knowledgeId,
                    toAssignmentView(null, input.locale, knowledgeId, originalLabel),
                );
            }
        }
    }

    return byKnowledgeId;
}

export async function resolveKnowledgeRelationshipAssignment(
    prisma: PrismaLike,
    knowledgeId: string,
    input: {
        locale: AppLocale;
        includeInactiveAssignedLabel?: boolean;
    },
): Promise<KnowledgeRelationshipAssignmentView> {
    const assignments = await resolveKnowledgeRelationshipAssignmentsForKnowledgeIds(
        prisma,
        [knowledgeId],
        input,
    );
    return assignments.get(knowledgeId) ?? toAssignmentView(null, input.locale, knowledgeId);
}

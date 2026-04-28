import { Prisma, type PrismaClient } from '@prisma/client';
import { localizeQueryApiCopy } from '../i18n/copy';
import { DEFAULT_LOCALE, type AppLocale } from '../i18n/locale';

export interface KnowledgeVersionSnapshotView {
    knowledgeId: string;
    version: number;
    eventType: string;
    actorPubkey: string | null;
    actorHandle: string | null;
    contributorsCount: number | null;
    contributorsRoot: string | null;
    sourceEventTimestamp: string;
    eventAt: Date;
    createdAt: Date;
    title: string | null;
    description: string | null;
    ipfsCid: string | null;
    contentHash: string | null;
    hasContentSnapshot: boolean;
}

export interface KnowledgeVersionFieldChange {
    field: string;
    label: string;
    fromValue: string;
    toValue: string;
}

export interface KnowledgeVersionDiffView {
    knowledgeId: string;
    fromVersion: number;
    toVersion: number;
    fromSnapshot: KnowledgeVersionSnapshotView;
    toSnapshot: KnowledgeVersionSnapshotView;
    fieldChanges: KnowledgeVersionFieldChange[];
    unavailableFields: string[];
    summary: string;
}

interface VersionEventRow {
    id: bigint;
    knowledgeId: string;
    eventType: string;
    version: number;
    actorPubkey: string | null;
    contributorsCount: number | null;
    contributorsRoot: string | null;
    sourceEventTimestamp: bigint;
    eventAt: Date;
    createdAt: Date;
}

interface KnowledgeRow {
    knowledgeId: string;
    title: string;
    description: string | null;
    ipfsCid: string | null;
    contentHash: string | null;
    version: number;
}

function stringifyDiffValue(value: string | number | null | undefined): string {
    if (value === null || value === undefined || value === '') return '—';
    return String(value);
}

function pushChange(
    changes: KnowledgeVersionFieldChange[],
    input: {
        field: string;
        label: string;
        fromValue: string | number | null | undefined;
        toValue: string | number | null | undefined;
    },
) {
    const fromValue = stringifyDiffValue(input.fromValue);
    const toValue = stringifyDiffValue(input.toValue);
    if (fromValue === toValue) return;
    changes.push({
        field: input.field,
        label: input.label,
        fromValue,
        toValue,
    });
}

function buildSnapshot(input: {
    knowledgeId: string;
    version: number;
    event: VersionEventRow;
    actorHandle: string | null;
    currentKnowledge: KnowledgeRow;
}): KnowledgeVersionSnapshotView {
    const isCurrentVersion = input.version === input.currentKnowledge.version;
    return {
        knowledgeId: input.knowledgeId,
        version: input.version,
        eventType: input.event.eventType,
        actorPubkey: input.event.actorPubkey,
        actorHandle: input.actorHandle,
        contributorsCount: input.event.contributorsCount,
        contributorsRoot: input.event.contributorsRoot,
        sourceEventTimestamp: String(input.event.sourceEventTimestamp),
        eventAt: input.event.eventAt,
        createdAt: input.event.createdAt,
        title: isCurrentVersion ? input.currentKnowledge.title : null,
        description: isCurrentVersion ? input.currentKnowledge.description : null,
        ipfsCid: isCurrentVersion ? input.currentKnowledge.ipfsCid : null,
        contentHash: isCurrentVersion ? input.currentKnowledge.contentHash : null,
        hasContentSnapshot: isCurrentVersion,
    };
}

export async function loadKnowledgeVersionDiff(
    prisma: PrismaClient,
    input: {
        knowledgeId: string;
        fromVersion: number;
        toVersion: number;
        locale?: AppLocale;
    },
): Promise<KnowledgeVersionDiffView | null> {
    const locale = input.locale ?? DEFAULT_LOCALE;
    const knowledgeId = String(input.knowledgeId || '').trim();
    if (!knowledgeId) return null;

    const currentKnowledge = await prisma.knowledge.findUnique({
        where: { knowledgeId },
        select: {
            knowledgeId: true,
            title: true,
            description: true,
            ipfsCid: true,
            contentHash: true,
            version: true,
        },
    }) as KnowledgeRow | null;

    if (!currentKnowledge) {
        return null;
    }

    const versions = Array.from(new Set([input.fromVersion, input.toVersion]));
    const rows = await prisma.$queryRaw<VersionEventRow[]>(Prisma.sql`
        SELECT
            id,
            knowledge_id AS "knowledgeId",
            event_type AS "eventType",
            version,
            actor_pubkey AS "actorPubkey",
            contributors_count AS "contributorsCount",
            contributors_root AS "contributorsRoot",
            source_event_timestamp AS "sourceEventTimestamp",
            event_at AS "eventAt",
            created_at AS "createdAt"
        FROM knowledge_version_events
        WHERE knowledge_id = ${knowledgeId}
          AND version IN (${Prisma.join(versions)})
        ORDER BY event_at DESC, id DESC
    `);

    const latestEventByVersion = new Map<number, VersionEventRow>();
    for (const row of rows) {
        if (!latestEventByVersion.has(row.version)) {
            latestEventByVersion.set(row.version, row);
        }
    }

    const fromEvent = latestEventByVersion.get(input.fromVersion);
    const toEvent = latestEventByVersion.get(input.toVersion);
    if (!fromEvent || !toEvent) {
        return null;
    }

    const actorPubkeys = Array.from(
        new Set([fromEvent.actorPubkey, toEvent.actorPubkey].filter((value): value is string => Boolean(value))),
    );
    const users = actorPubkeys.length > 0
        ? await prisma.user.findMany({
            where: { pubkey: { in: actorPubkeys } },
            select: { pubkey: true, handle: true },
        })
        : [];
    const handleByPubkey = new Map(users.map((user) => [user.pubkey, user.handle]));

    const fromSnapshot = buildSnapshot({
        knowledgeId,
        version: input.fromVersion,
        event: fromEvent,
        actorHandle: fromEvent.actorPubkey ? (handleByPubkey.get(fromEvent.actorPubkey) ?? null) : null,
        currentKnowledge,
    });
    const toSnapshot = buildSnapshot({
        knowledgeId,
        version: input.toVersion,
        event: toEvent,
        actorHandle: toEvent.actorPubkey ? (handleByPubkey.get(toEvent.actorPubkey) ?? null) : null,
        currentKnowledge,
    });

    const fieldChanges: KnowledgeVersionFieldChange[] = [];
    pushChange(fieldChanges, {
        field: 'eventType',
        label: localizeQueryApiCopy('knowledge.version.field.eventType', locale),
        fromValue: fromSnapshot.eventType,
        toValue: toSnapshot.eventType,
    });
    pushChange(fieldChanges, {
        field: 'actorHandle',
        label: localizeQueryApiCopy('knowledge.version.field.actorHandle', locale),
        fromValue: fromSnapshot.actorHandle ?? fromSnapshot.actorPubkey,
        toValue: toSnapshot.actorHandle ?? toSnapshot.actorPubkey,
    });
    pushChange(fieldChanges, {
        field: 'contributorsCount',
        label: localizeQueryApiCopy('knowledge.version.field.contributorsCount', locale),
        fromValue: fromSnapshot.contributorsCount,
        toValue: toSnapshot.contributorsCount,
    });
    pushChange(fieldChanges, {
        field: 'contributorsRoot',
        label: localizeQueryApiCopy('knowledge.version.field.contributorsRoot', locale),
        fromValue: fromSnapshot.contributorsRoot,
        toValue: toSnapshot.contributorsRoot,
    });
    pushChange(fieldChanges, {
        field: 'sourceEventTimestamp',
        label: localizeQueryApiCopy('knowledge.version.field.sourceEventTimestamp', locale),
        fromValue: fromSnapshot.sourceEventTimestamp,
        toValue: toSnapshot.sourceEventTimestamp,
    });

    const unavailableFields = ['title', 'description', 'ipfsCid', 'contentHash']
        .filter((field) => !fromSnapshot.hasContentSnapshot || !toSnapshot.hasContentSnapshot);

    const summary = unavailableFields.length > 0
        ? localizeQueryApiCopy('knowledge.version.summary.unavailableContentSnapshots', locale)
        : fieldChanges.length > 0
            ? localizeQueryApiCopy('knowledge.version.summary.changedFields', locale, { count: fieldChanges.length })
            : localizeQueryApiCopy('knowledge.version.summary.noChanges', locale);

    return {
        knowledgeId,
        fromVersion: input.fromVersion,
        toVersion: input.toVersion,
        fromSnapshot,
        toSnapshot,
        fieldChanges,
        unavailableFields,
        summary,
    };
}

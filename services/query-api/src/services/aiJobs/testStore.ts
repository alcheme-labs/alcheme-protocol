import { jest } from '@jest/globals';

type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

export interface InMemoryAiJobRow {
    id: number;
    jobType: string;
    dedupeKey: string | null;
    scopeType: string;
    scopeDraftPostId: number | null;
    scopeCircleId: number | null;
    requestedByUserId: number | null;
    status: string;
    attempts: number;
    maxAttempts: number;
    availableAt: Date;
    claimedAt: Date | null;
    completedAt: Date | null;
    workerId: string | null;
    claimToken: string | null;
    payloadJson: JsonValue | null;
    resultJson: JsonValue | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
}

function cloneJson<T extends JsonValue | null>(value: T): T {
    if (value === null) return value;
    return JSON.parse(JSON.stringify(value));
}

function asRecord(value: unknown): Record<string, unknown> {
    return value as unknown as Record<string, unknown>;
}

function cloneRow(row: InMemoryAiJobRow | null | undefined): InMemoryAiJobRow | null {
    if (!row) return null;
    return {
        ...row,
        availableAt: new Date(row.availableAt),
        claimedAt: row.claimedAt ? new Date(row.claimedAt) : null,
        completedAt: row.completedAt ? new Date(row.completedAt) : null,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
        payloadJson: cloneJson(row.payloadJson),
        resultJson: cloneJson(row.resultJson),
    };
}

function normalizeDate(value: unknown, fallback: Date): Date {
    if (value instanceof Date) return new Date(value);
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date(fallback);
}

function matchesScalar(actual: unknown, expected: unknown): boolean {
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
        const operator = expected as Record<string, unknown>;
        if (Object.prototype.hasOwnProperty.call(operator, 'lte')) {
            return actual instanceof Date
                && operator.lte instanceof Date
                && actual.getTime() <= operator.lte.getTime();
        }
        if (Object.prototype.hasOwnProperty.call(operator, 'in')) {
            const values = Array.isArray(operator.in) ? operator.in : [];
            return values.includes(actual as never);
        }
    }
    return actual === expected;
}

function matchesWhere(row: InMemoryAiJobRow, where: Record<string, unknown> | undefined): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, expected]) => {
        if (expected === undefined) return true;
        return matchesScalar(asRecord(row)[key], expected);
    });
}

function applyData(row: InMemoryAiJobRow, data: Record<string, unknown>) {
    for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        if (value && typeof value === 'object' && !Array.isArray(value) && 'increment' in value) {
            const amount = Number((value as { increment: unknown }).increment || 0);
            asRecord(row)[key] = Number(asRecord(row)[key] || 0) + amount;
            continue;
        }
        if (
            key === 'availableAt'
            || key === 'claimedAt'
            || key === 'completedAt'
            || key === 'createdAt'
            || key === 'updatedAt'
        ) {
            asRecord(row)[key] = value ? normalizeDate(value, row.updatedAt) : null;
            continue;
        }
        asRecord(row)[key] = value as never;
    }
    row.updatedAt = data.updatedAt ? normalizeDate(data.updatedAt, row.updatedAt) : new Date();
}

function sortRows(rows: InMemoryAiJobRow[], orderBy: Array<Record<string, 'asc' | 'desc'>> | undefined) {
    if (!orderBy?.length) return rows;
    return [...rows].sort((left, right) => {
        for (const order of orderBy) {
            const [field, direction] = Object.entries(order)[0] || [];
            if (!field) continue;
            const leftValue = asRecord(left)[field];
            const rightValue = asRecord(right)[field];
            const leftComparable = leftValue instanceof Date ? leftValue.getTime() : Number(leftValue ?? 0);
            const rightComparable = rightValue instanceof Date ? rightValue.getTime() : Number(rightValue ?? 0);
            if (leftComparable === rightComparable) continue;
            const diff = leftComparable < rightComparable ? -1 : 1;
            return direction === 'desc' ? diff * -1 : diff;
        }
        return 0;
    });
}

export function createInMemoryAiJobPrisma(seed: Partial<InMemoryAiJobRow>[] = []) {
    let nextId = 1;
    const rows: InMemoryAiJobRow[] = [];

    function insert(partial: Partial<InMemoryAiJobRow>) {
        const now = partial.createdAt ? normalizeDate(partial.createdAt, new Date()) : new Date();
        const row: InMemoryAiJobRow = {
            id: partial.id ?? nextId++,
            jobType: String(partial.jobType || 'ghost_draft_generate'),
            dedupeKey: partial.dedupeKey ?? null,
            scopeType: String(partial.scopeType || 'draft'),
            scopeDraftPostId:
                partial.scopeDraftPostId === null || partial.scopeDraftPostId === undefined
                    ? null
                    : Number(partial.scopeDraftPostId),
            scopeCircleId:
                partial.scopeCircleId === null || partial.scopeCircleId === undefined
                    ? null
                    : Number(partial.scopeCircleId),
            requestedByUserId:
                partial.requestedByUserId === null || partial.requestedByUserId === undefined
                    ? null
                    : Number(partial.requestedByUserId),
            status: String(partial.status || 'queued'),
            attempts: Number(partial.attempts ?? 0),
            maxAttempts: Number(partial.maxAttempts ?? 3),
            availableAt: normalizeDate(partial.availableAt, now),
            claimedAt: partial.claimedAt ? normalizeDate(partial.claimedAt, now) : null,
            completedAt: partial.completedAt ? normalizeDate(partial.completedAt, now) : null,
            workerId: partial.workerId ?? null,
            claimToken: partial.claimToken ?? null,
            payloadJson: cloneJson((partial.payloadJson as JsonValue | null | undefined) ?? null),
            resultJson: cloneJson((partial.resultJson as JsonValue | null | undefined) ?? null),
            lastErrorCode: partial.lastErrorCode ?? null,
            lastErrorMessage: partial.lastErrorMessage ?? null,
            createdAt: now,
            updatedAt: partial.updatedAt ? normalizeDate(partial.updatedAt, now) : now,
        };
        rows.push(row);
        nextId = Math.max(nextId, row.id + 1);
    }

    seed.forEach(insert);

    return {
        aiJob: {
            findUnique: jest.fn(async ({ where }: any) => {
                if (where?.id !== undefined) {
                    return cloneRow(rows.find((row) => row.id === Number(where.id)));
                }
                if (where?.dedupeKey !== undefined) {
                    return cloneRow(rows.find((row) => row.dedupeKey === String(where.dedupeKey)));
                }
                return null;
            }),
            findMany: jest.fn(async ({ where, orderBy, take }: any = {}) => {
                const filtered = rows.filter((row) => matchesWhere(row, where));
                const ordered = sortRows(filtered, orderBy);
                const limited = typeof take === 'number' ? ordered.slice(0, take) : ordered;
                return limited.map((row) => cloneRow(row));
            }),
            create: jest.fn(async ({ data }: any) => {
                const dedupeKey = data?.dedupeKey ? String(data.dedupeKey) : null;
                if (dedupeKey && rows.some((row) => row.dedupeKey === dedupeKey)) {
                    const error = new Error('unique constraint') as Error & { code?: string };
                    error.code = 'P2002';
                    throw error;
                }
                const now = data?.createdAt ? normalizeDate(data.createdAt, new Date()) : new Date();
                const row: InMemoryAiJobRow = {
                    id: nextId++,
                    jobType: String(data?.jobType || 'ghost_draft_generate'),
                    dedupeKey,
                    scopeType: String(data?.scopeType || 'draft'),
                    scopeDraftPostId:
                        data?.scopeDraftPostId === null || data?.scopeDraftPostId === undefined
                            ? null
                            : Number(data.scopeDraftPostId),
                    scopeCircleId:
                        data?.scopeCircleId === null || data?.scopeCircleId === undefined
                            ? null
                            : Number(data.scopeCircleId),
                    requestedByUserId:
                        data?.requestedByUserId === null || data?.requestedByUserId === undefined
                            ? null
                            : Number(data.requestedByUserId),
                    status: String(data?.status || 'queued'),
                    attempts: Number(data?.attempts ?? 0),
                    maxAttempts: Number(data?.maxAttempts ?? 3),
                    availableAt: normalizeDate(data?.availableAt, now),
                    claimedAt: data?.claimedAt ? normalizeDate(data.claimedAt, now) : null,
                    completedAt: data?.completedAt ? normalizeDate(data.completedAt, now) : null,
                    workerId: data?.workerId ?? null,
                    claimToken: data?.claimToken ?? null,
                    payloadJson: cloneJson((data?.payloadJson as JsonValue | null | undefined) ?? null),
                    resultJson: cloneJson((data?.resultJson as JsonValue | null | undefined) ?? null),
                    lastErrorCode: data?.lastErrorCode ?? null,
                    lastErrorMessage: data?.lastErrorMessage ?? null,
                    createdAt: now,
                    updatedAt: data?.updatedAt ? normalizeDate(data.updatedAt, now) : now,
                };
                rows.push(row);
                return cloneRow(row);
            }),
            updateMany: jest.fn(async ({ where, data }: any) => {
                let count = 0;
                for (const row of rows) {
                    if (!matchesWhere(row, where)) continue;
                    applyData(row, data || {});
                    count += 1;
                }
                return { count };
            }),
            update: jest.fn(async ({ where, data }: any) => {
                const row = rows.find((item) => item.id === Number(where?.id));
                if (!row) {
                    throw new Error('ai_job_not_found');
                }
                applyData(row, data || {});
                return cloneRow(row);
            }),
        },
        __rows: rows,
    };
}

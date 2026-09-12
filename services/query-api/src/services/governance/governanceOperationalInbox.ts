export const GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS = [
  'taskKind',
  'home',
  'subject',
  'identity',
  'assignee',
  'stage',
  'effect',
  'age',
  'risk',
  'institutionalAuthority',
  'mandate',
  'provider',
  'blockingReason',
  'deadline',
] as const;

export type GovernanceOperationalInboxFilterKey =
  typeof GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS[number];

export type GovernanceOperationalInboxFilters = Partial<
  Record<GovernanceOperationalInboxFilterKey, string>
>;

export interface GovernanceOperationalInboxFacetRecord {
  id: string;
  source: 'case' | 'operation' | 'institutional_duty';
  values: Record<GovernanceOperationalInboxFilterKey, string[]>;
}

export interface GovernanceOperationalInboxFacet {
  value: string;
  count: number;
}

function filterValue(value: unknown, key: GovernanceOperationalInboxFilterKey): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error(`governance_operational_inbox_filter_invalid:${key}`);
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`governance_operational_inbox_filter_invalid:${key}`);
  }
  return normalized;
}

export function parseGovernanceOperationalInboxFilters(
  query: Record<string, unknown> | null | undefined,
): GovernanceOperationalInboxFilters {
  const filters: GovernanceOperationalInboxFilters = {};
  for (const key of GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS) {
    const value = filterValue(query?.[key], key);
    if (value) filters[key] = value;
  }
  return filters;
}

function uniqueValues(values: readonly unknown[]): string[] {
  return [...new Set(values.flatMap((value) => {
    if (typeof value !== 'string') return [];
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }))].sort((left, right) => left.localeCompare(right));
}

export function governanceOperationalInboxFacetRecord(input: {
  id: string;
  source: GovernanceOperationalInboxFacetRecord['source'];
  values: Partial<Record<GovernanceOperationalInboxFilterKey, readonly unknown[]>>;
}): GovernanceOperationalInboxFacetRecord {
  return {
    id: input.id,
    source: input.source,
    values: Object.fromEntries(GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS.map((key) => (
      [key, uniqueValues(input.values[key] ?? [])]
    ))) as Record<GovernanceOperationalInboxFilterKey, string[]>,
  };
}

export function filterGovernanceOperationalInboxRecords(
  records: readonly GovernanceOperationalInboxFacetRecord[],
  filters: GovernanceOperationalInboxFilters,
): GovernanceOperationalInboxFacetRecord[] {
  return records.filter((record) => GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS.every((key) => (
    !filters[key] || record.values[key].includes(filters[key]!)
  )));
}

export function projectGovernanceOperationalInboxFacets(
  records: readonly GovernanceOperationalInboxFacetRecord[],
): Record<GovernanceOperationalInboxFilterKey, GovernanceOperationalInboxFacet[]> {
  return Object.fromEntries(GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS.map((key) => {
    const counts = new Map<string, number>();
    for (const record of records) {
      for (const value of record.values[key]) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    return [key, [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((left, right) => left.value.localeCompare(right.value))];
  })) as Record<GovernanceOperationalInboxFilterKey, GovernanceOperationalInboxFacet[]>;
}

function validDate(value: unknown): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

export function governanceOperationalInboxAgeBucket(
  occurredAt: unknown,
  now: Date,
): 'lt_24h' | '1_7d' | '8_30d' | 'gt_30d' | null {
  const date = validDate(occurredAt);
  if (!date) return null;
  const ageMs = Math.max(0, now.getTime() - date.getTime());
  if (ageMs < 24 * 60 * 60 * 1000) return 'lt_24h';
  if (ageMs <= 7 * 24 * 60 * 60 * 1000) return '1_7d';
  if (ageMs <= 30 * 24 * 60 * 60 * 1000) return '8_30d';
  return 'gt_30d';
}

export function governanceOperationalInboxDeadlineBucket(
  deadline: unknown,
  now: Date,
): 'overdue' | 'next_24h' | 'next_7d' | 'later' | 'none' {
  const date = validDate(deadline);
  if (!date) return 'none';
  const remainingMs = date.getTime() - now.getTime();
  if (remainingMs < 0) return 'overdue';
  if (remainingMs <= 24 * 60 * 60 * 1000) return 'next_24h';
  if (remainingMs <= 7 * 24 * 60 * 60 * 1000) return 'next_7d';
  return 'later';
}

export const GOVERNANCE_CASE_SEARCH_SCOPES = [
  'proposal',
  'claim',
  'source',
  'review',
  'decision',
  'execution',
  'outcome',
] as const;

export type GovernanceCaseSearchScope = typeof GOVERNANCE_CASE_SEARCH_SCOPES[number];

export const CIRCLE_GOVERNANCE_SEARCH_FILTER_KEYS = [
  'template',
  'status',
  'actor',
  'provider',
  'date',
  'result',
  'relationship',
] as const;

export type CircleGovernanceSearchFilterKey =
  typeof CIRCLE_GOVERNANCE_SEARCH_FILTER_KEYS[number];

export type CircleGovernanceSearchFilters = Partial<
  Record<CircleGovernanceSearchFilterKey, string>
>;

export interface GovernanceCaseSearchResult {
  id: string;
  scope: GovernanceCaseSearchScope;
  title: string;
  excerpt: string;
  canonicalUrl: string;
}

export interface CircleGovernanceSearchFacet {
  value: string;
  count: number;
}

function parseSearchValue(
  value: unknown,
  key: string,
  options: { minimumLength?: number } = {},
): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error(`governance_search_filter_invalid:${key}`);
  }
  const normalized = value.normalize('NFKC').trim();
  if (!normalized) return null;
  if (
    normalized.length > 256
    || normalized.length < (options.minimumLength ?? 1)
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error(`governance_search_filter_invalid:${key}`);
  }
  return normalized;
}

export function parseGovernanceCaseSearchQuery(value: unknown): string | null {
  return parseSearchValue(value, 'q', { minimumLength: 2 });
}

export function parseCircleGovernanceSearch(
  query: Record<string, unknown> | null | undefined,
): { q: string | null; filters: CircleGovernanceSearchFilters } {
  const filters: CircleGovernanceSearchFilters = {};
  for (const key of CIRCLE_GOVERNANCE_SEARCH_FILTER_KEYS) {
    const value = parseSearchValue(query?.[key], key);
    if (value) filters[key] = value;
  }
  return {
    q: parseGovernanceCaseSearchQuery(query?.q),
    filters,
  };
}

function normalizedSearchText(value: unknown): string {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase();
}

function matchesQuery(values: readonly unknown[], query: string): boolean {
  const corpus = normalizedSearchText(values.filter((value) => value != null).join('\n'));
  return normalizedSearchText(query).split(/\s+/).every((term) => corpus.includes(term));
}

function jsonSearchText(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return '';
  }
}

function excerpt(values: readonly unknown[]): string {
  const value = values
    .filter((item) => typeof item === 'string' || typeof item === 'number')
    .map(String)
    .map((item) => item.trim())
    .find(Boolean) ?? '';
  return value.length <= 240 ? value : `${value.slice(0, 237)}...`;
}

export function projectGovernanceCaseSearch(
  governanceCase: any,
  rawQuery: unknown,
): {
  query: string;
  total: number;
  scopeCounts: Array<{ scope: GovernanceCaseSearchScope; count: number }>;
  results: GovernanceCaseSearchResult[];
} | null {
  const query = parseGovernanceCaseSearchQuery(rawQuery);
  if (!query) return null;
  const baseUrl = String(governanceCase?.canonicalUrl ?? '');
  const results: GovernanceCaseSearchResult[] = [];
  const add = (
    scope: GovernanceCaseSearchScope,
    id: string,
    title: string,
    values: readonly unknown[],
    fragment: string,
  ) => {
    if (!matchesQuery(values, query)) return;
    results.push({
      id,
      scope,
      title,
      excerpt: excerpt(values),
      canonicalUrl: `${baseUrl}#${fragment}`,
    });
  };

  add('proposal', `${governanceCase.id}:proposal`, String(governanceCase.title ?? ''), [
    governanceCase.id,
    governanceCase.title,
    governanceCase.requestedDecision,
    governanceCase.caseType,
    governanceCase.template?.templateId,
    governanceCase.template?.labelKey,
    governanceCase.governedSubject?.type,
    governanceCase.governedSubject?.ref,
    jsonSearchText(governanceCase.requestedAction),
  ], 'case-proposal');

  for (const claim of governanceCase.brief?.claims ?? []) {
    add('claim', String(claim.id), String(claim.text ?? claim.id), [
      claim.id,
      claim.text,
      claim.sectionKey,
      claim.coverageStatus,
    ], 'case-brief-claims-title');
  }
  for (const source of governanceCase.brief?.sources ?? []) {
    add('source', `source:${source.id}`, String(source.name ?? source.canonicalUrl), [
      source.id,
      source.name,
      source.canonicalUrl,
      source.externalAuthorLabel,
      source.contentDigest,
      source.sourceVersion,
    ], 'case-brief-sources-title');
  }
  for (const event of governanceCase.workflow?.timeline ?? []) {
    if (!String(event.eventType ?? '').includes('review') && !event.reviewPublicBasis) continue;
    add('review', String(event.id), String(event.eventType ?? event.id), [
      event.eventType,
      event.reviewPublicBasis,
      event.reason,
      event.actorPubkey,
      event.subjectPubkey,
      event.fromState,
      event.toState,
    ], 'case-workflow-title');
  }

  const request = governanceCase.primaryRequest;
  if (request) {
    add('decision', `${governanceCase.id}:decision`, String(request.decisionStatus ?? request.state), [
      request.id,
      request.actionType,
      request.state,
      request.decisionStatus,
      jsonSearchText(request.decision),
      jsonSearchText(governanceCase.decisionStages),
      jsonSearchText(governanceCase.voteSummary),
    ], 'case-decision-stages-title');
    add('execution', `${governanceCase.id}:execution`, String(request.executionStatus ?? request.actionType), [
      request.id,
      request.actionType,
      request.executionStatus,
      jsonSearchText(request.receipts),
      jsonSearchText(governanceCase.decisionStages?.stages?.map((stage: any) => stage.provider)),
    ], 'case-workflow-title');
  }

  if (governanceCase.actualOutcome) {
    add('outcome', `${governanceCase.id}:actual-outcome`, String(
      governanceCase.actualOutcome.summary ?? governanceCase.actualOutcome.integrity,
    ), [
      governanceCase.actualOutcome.summary,
      governanceCase.actualOutcome.integrity,
      ...governanceCase.actualOutcome.quantitativeImpact ?? [],
      ...governanceCase.actualOutcome.deviations ?? [],
      ...governanceCase.actualOutcome.failures ?? [],
      ...governanceCase.actualOutcome.outstandingObligations ?? [],
    ], 'case-actual-outcome-title');
  }
  for (const artifact of governanceCase.decisionOutputArtifacts ?? []) {
    add('outcome', String(artifact.id), String(artifact.kind ?? artifact.id), [
      artifact.id,
      artifact.kind,
      artifact.integrity,
      artifact.schemaRef,
      artifact.subject?.type,
      artifact.subject?.ref,
      jsonSearchText(artifact.constraints),
    ], 'case-decision-output-title');
  }

  const scopeCounts = GOVERNANCE_CASE_SEARCH_SCOPES.map((scope) => ({
    scope,
    count: results.filter((result) => result.scope === scope).length,
  }));
  return {
    query,
    total: results.length,
    scopeCounts,
    results: results.slice(0, 100),
  };
}

function unique(values: readonly unknown[]): string[] {
  return [...new Set(values.flatMap((value) => {
    if (typeof value !== 'string' && typeof value !== 'number') return [];
    const normalized = String(value).normalize('NFKC').trim();
    return normalized ? [normalized] : [];
  }))].sort((left, right) => left.localeCompare(right));
}

function circleCaseSearchValues(governanceCase: any): Record<CircleGovernanceSearchFilterKey, string[]> {
  const openedAt = new Date(String(governanceCase.openedAt ?? ''));
  const date = Number.isFinite(openedAt.getTime())
    ? openedAt.toISOString().slice(0, 7)
    : null;
  const stages = governanceCase.decisionStages?.integrity === 'verified'
    && Array.isArray(governanceCase.decisionStages.stages)
    ? governanceCase.decisionStages.stages
    : [];
  const request = governanceCase.primaryRequest;
  return {
    template: unique([governanceCase.template?.templateId]),
    status: unique([
      `phase:${governanceCase.phase}`,
      request?.state ? `request:${request.state}` : null,
    ]),
    actor: unique([governanceCase.proposerPubkey]),
    provider: unique([
      governanceCase.template?.actionContract?.executionAdapter
        ? `execution_adapter:${governanceCase.template.actionContract.executionAdapter}`
        : null,
      ...stages.map((stage: any) => (
        stage?.provider?.type && stage?.provider?.version
          ? `${stage.provider.type}:${stage.provider.version}`
          : null
      )),
    ]),
    date: unique([date]),
    result: unique([
      request?.decisionStatus ? `decision:${request.decisionStatus}` : null,
      request?.executionStatus ? `execution:${request.executionStatus}` : null,
      governanceCase.actualOutcome?.integrity === 'verified' ? 'outcome:recorded' : null,
    ]),
    relationship: unique([governanceCase.relationship?.kind ?? 'standalone']),
  };
}

function circleCaseMatchesQuery(governanceCase: any, query: string | null): boolean {
  if (!query) return true;
  return matchesQuery([
    governanceCase.id,
    governanceCase.title,
    governanceCase.requestedDecision,
    governanceCase.caseType,
    governanceCase.template?.templateId,
    governanceCase.governedSubject?.type,
    governanceCase.governedSubject?.ref,
  ], query);
}

export function projectCircleGovernanceSearch(
  governanceCases: readonly any[],
  input: { q: string | null; filters: CircleGovernanceSearchFilters },
): {
  cases: any[];
  search: {
    query: string | null;
    appliedFilters: CircleGovernanceSearchFilters;
    facets: Record<CircleGovernanceSearchFilterKey, CircleGovernanceSearchFacet[]>;
    total: number;
    matched: number;
    providerFinality: 'not_asserted';
  };
} {
  const records = governanceCases.map((governanceCase) => ({
    governanceCase,
    values: circleCaseSearchValues(governanceCase),
  }));
  const cases = records.filter((record) => (
    circleCaseMatchesQuery(record.governanceCase, input.q)
    && CIRCLE_GOVERNANCE_SEARCH_FILTER_KEYS.every((key) => (
      !input.filters[key] || record.values[key].includes(input.filters[key]!)
    ))
  )).map((record) => record.governanceCase);
  const facets = Object.fromEntries(CIRCLE_GOVERNANCE_SEARCH_FILTER_KEYS.map((key) => {
    const counts = new Map<string, number>();
    for (const record of records) {
      for (const value of record.values[key]) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    return [key, [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((left, right) => left.value.localeCompare(right.value))];
  })) as Record<CircleGovernanceSearchFilterKey, CircleGovernanceSearchFacet[]>;
  return {
    cases,
    search: {
      query: input.q,
      appliedFilters: input.filters,
      facets,
      total: records.length,
      matched: cases.length,
      providerFinality: 'not_asserted',
    },
  };
}

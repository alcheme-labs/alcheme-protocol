import { hashCanonicalGovernanceValue } from './canonicalCodec';

export const GOVERNANCE_BRIEF_SECTION_DEFINITIONS = [
  { key: 'identity', heading: 'Identity' },
  { key: 'requested_decision', heading: 'Requested decision' },
  { key: 'background', heading: 'Background' },
  { key: 'options', heading: 'Options' },
  { key: 'arguments', heading: 'Arguments' },
  { key: 'supporting_evidence', heading: 'Supporting evidence' },
  { key: 'arguments_for', heading: 'Arguments for' },
  { key: 'arguments_against', heading: 'Arguments against' },
  { key: 'risks', heading: 'Risks' },
  { key: 'open_questions', heading: 'Open questions' },
  { key: 'execution_plan', heading: 'Execution plan' },
  { key: 'provider_readiness', heading: 'Provider readiness' },
  { key: 'outcome', heading: 'Outcome' },
] as const;

export type GovernanceBriefSectionKey = typeof GOVERNANCE_BRIEF_SECTION_DEFINITIONS[number]['key'];

export interface GovernanceBriefSectionReadiness {
  key: GovernanceBriefSectionKey;
  heading: string;
  complete: boolean;
  ownerPubkey: string | null;
}

export interface GovernanceBriefReadiness {
  sectionReady: boolean;
  sections: GovernanceBriefSectionReadiness[];
  missingSectionKeys: GovernanceBriefSectionKey[];
}

export type GovernanceBriefSectionBodies = Partial<Record<GovernanceBriefSectionKey, string>>;

export const GOVERNANCE_BRIEF_CLAIM_SECTION_KEYS = [
  'supporting_evidence',
  'arguments_for',
  'arguments_against',
  'risks',
] as const satisfies readonly GovernanceBriefSectionKey[];

export type GovernanceBriefClaimSectionKey = typeof GOVERNANCE_BRIEF_CLAIM_SECTION_KEYS[number];

export interface GovernanceBriefClaim {
  id: string;
  sectionKey: GovernanceBriefClaimSectionKey;
  ordinal: number;
  text: string;
  digest: string;
}

const PLACEHOLDER_VALUES = new Set([
  'tbd',
  'todo',
  'to be completed',
  'pending',
  '待补',
  '待填写',
  '待定',
]);

function normalizeHeading(value: string): string {
  return value
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/[:：]\s*$/, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

const SECTION_BY_HEADING = new Map(
  GOVERNANCE_BRIEF_SECTION_DEFINITIONS.map((section) => [
    normalizeHeading(section.heading),
    section,
  ]),
);

function meaningfulSectionBody(value: string): boolean {
  const normalized = value.trim().replace(/^\[|\]$/g, '').trim().toLowerCase();
  return normalized.length > 0 && !PLACEHOLDER_VALUES.has(normalized);
}

export function resolveGovernanceBriefReadiness(input: {
  contentSnapshot: string;
  ownerPubkey?: string | null;
}): GovernanceBriefReadiness {
  const bodies = parseGovernanceBriefSectionLines(input.contentSnapshot);
  const sections = GOVERNANCE_BRIEF_SECTION_DEFINITIONS.map((definition) => ({
    ...definition,
    complete: meaningfulSectionBody((bodies.get(definition.key) || []).join('\n')),
    ownerPubkey: input.ownerPubkey || null,
  }));
  const missingSectionKeys = sections
    .filter((section) => !section.complete)
    .map((section) => section.key);

  return {
    sectionReady: missingSectionKeys.length === 0,
    sections,
    missingSectionKeys,
  };
}

export function extractGovernanceBriefSectionBodies(
  contentSnapshot: string,
): GovernanceBriefSectionBodies {
  const bodies = parseGovernanceBriefSectionLines(contentSnapshot);
  return Object.fromEntries(
    GOVERNANCE_BRIEF_SECTION_DEFINITIONS.flatMap(({ key }) => {
      const body = (bodies.get(key) || []).join('\n').trim();
      return meaningfulSectionBody(body) ? [[key, body]] : [];
    }),
  );
}

export function extractGovernanceBriefClaims(input: {
  snapshotDigest: string;
  contentSnapshot: string;
}): GovernanceBriefClaim[] {
  const sections = extractGovernanceBriefSectionBodies(input.contentSnapshot);
  return GOVERNANCE_BRIEF_CLAIM_SECTION_KEYS.flatMap((sectionKey) => {
    const lines = String(sections[sectionKey] ?? '')
      .split('\n')
      .map((line) => line.trim().replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
      .filter(Boolean);
    return lines.map((text, ordinal) => {
      const digest = hashCanonicalGovernanceValue('governance-brief-claim', { sectionKey, text });
      const identityDigest = hashCanonicalGovernanceValue('governance-brief-claim-identity', {
        snapshotDigest: input.snapshotDigest,
        sectionKey,
        ordinal,
        digest,
      });
      return {
        id: `brief-claim:${identityDigest.slice(0, 48)}`,
        sectionKey,
        ordinal,
        text,
        digest,
      };
    });
  });
}

function parseGovernanceBriefSectionLines(
  contentSnapshot: string,
): Map<GovernanceBriefSectionKey, string[]> {
  const bodies = new Map<GovernanceBriefSectionKey, string[]>();
  let activeSection: GovernanceBriefSectionKey | null = null;

  for (const line of String(contentSnapshot || '').replace(/\r\n?/g, '\n').split('\n')) {
    const heading = line.match(/^\s*#{1,6}\s+(.+?)\s*$/);
    const definition = heading ? SECTION_BY_HEADING.get(normalizeHeading(heading[1])) : null;
    if (definition) {
      activeSection = definition.key;
      if (!bodies.has(activeSection)) bodies.set(activeSection, []);
      continue;
    }
    if (heading) {
      activeSection = null;
      continue;
    }
    if (activeSection) bodies.get(activeSection)?.push(line);
  }
  return bodies;
}

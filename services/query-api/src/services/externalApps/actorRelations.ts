const RELATED_SUPPORT_RELATIONS = new Set([
  "owner",
  "team",
  "investor",
  "affiliate",
  "sponsor",
  "guild",
  "node_operator",
  "reviewer",
]);

export function isIndependentExternalAppSupportSignal(relationType: string): boolean {
  const normalized = String(relationType || "unknown").trim().toLowerCase();
  return !RELATED_SUPPORT_RELATIONS.has(normalized);
}

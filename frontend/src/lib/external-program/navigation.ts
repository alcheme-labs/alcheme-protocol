export function parsePositiveCircleId(value: string | number | null | undefined): number | null {
  const raw = typeof value === "number" ? String(value) : String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const normalized = Number(raw);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

export function buildCircleExternalAppHref(input: {
  appId: string;
  bindingCircleId: number;
  returnCircleId?: number | null;
}): string {
  const bindingCircleId = parsePositiveCircleId(input.bindingCircleId);
  const returnCircleId = parsePositiveCircleId(input.returnCircleId);
  const encodedAppId = encodeURIComponent(input.appId);
  if (!bindingCircleId) return `/apps/${encodedAppId}`;

  const baseHref = `/circles/${bindingCircleId}/apps/${encodedAppId}`;
  return returnCircleId && returnCircleId !== bindingCircleId
    ? `${baseHref}?returnCircleId=${returnCircleId}`
    : baseHref;
}

export function buildCircleExternalAppBackHref(input: {
  bindingCircleId: number;
  returnCircleId?: number | null;
}): string {
  const bindingCircleId = parsePositiveCircleId(input.bindingCircleId);
  const returnCircleId = parsePositiveCircleId(input.returnCircleId);
  if (!bindingCircleId) return "/circles";
  return returnCircleId && returnCircleId !== bindingCircleId
    ? `/circles/${returnCircleId}?shortcutCircleId=${bindingCircleId}`
    : `/circles/${bindingCircleId}`;
}

import crypto from "node:crypto";

export function stableStringify(value: unknown): string {
  return canonicalizeJson(value);
}

export function canonicalizeJson(value: unknown): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError("Non-finite number is not allowed in JCS-compatible JSON");
      }
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "object":
      if (Array.isArray(value)) {
        return `[${value.map(canonicalizeArrayItem).join(",")}]`;
      }
      if (!isPlainObject(value)) {
        throw new TypeError("Only plain JSON objects are allowed in JCS-compatible digest");
      }
      return canonicalizeObject(value as Record<string, unknown>);
    default:
      throw new TypeError(`Unsupported JSON value for JCS-compatible digest: ${typeof value}`);
  }
}

export function digestJson(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

export function assertJcsCompatibleJson(value: unknown): void {
  stableStringify(value);
}

function canonicalizeArrayItem(value: unknown): string {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`Unsupported JSON value for JCS-compatible digest: ${typeof value}`);
  }
  return canonicalizeJson(value);
}

function canonicalizeObject(value: Record<string, unknown>): string {
  const entries = Object.keys(value)
    .sort()
    .map((key) => {
      const nested = value[key];
      if (nested === undefined || typeof nested === "function" || typeof nested === "symbol") {
        throw new TypeError(`Unsupported JSON value for JCS-compatible digest: ${typeof nested}`);
      }
      return `${JSON.stringify(key)}:${canonicalizeJson(nested)}`;
    });

  return `{${entries.join(",")}}`;
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

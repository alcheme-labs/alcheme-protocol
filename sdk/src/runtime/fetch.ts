type FetchLike = typeof fetch;

export function resolveRuntimeFetch(fetchOverride?: FetchLike): FetchLike {
  if (fetchOverride && fetchOverride !== globalThis.fetch) {
    return ((input, init) => fetchOverride(input, init)) as FetchLike;
  }
  return ((input, init) => globalThis.fetch(input, init)) as FetchLike;
}

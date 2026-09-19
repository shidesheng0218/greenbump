/**
 * Shared fetch with a hard timeout for ecosystem registry lookups
 * (crates.io, Maven Central, …). Without this, a hung registry stalls the
 * whole outdated-detection phase forever — changelog.ts already had its own
 * 8s version; this generalizes it.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

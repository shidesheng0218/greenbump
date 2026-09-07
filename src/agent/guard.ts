/**
 * Hard, tool-layer guardrails for the fix agent.
 *
 * The system prompt already TELLS the model not to touch dependency
 * manifests, lockfiles, or secrets — but a prompt is a soft constraint the
 * model can ignore (confused deputy, long-context drift, prompt injection
 * via a malicious changelog). These checks ENFORCE the boundary where the
 * tool call is executed, so a misbehaving model physically cannot:
 *   - overwrite the manifest/lockfile the upgrade step manages, or
 *   - read secret files whose contents would be sent to the LLM provider.
 */

/** True when a path looks like a credentials/secrets file the agent must never read or write. */
export function isSensitivePath(relPath: string): boolean {
  const base = relPath.split("/").pop()!.toLowerCase();
  if (base === ".env" || base.startsWith(".env.")) {
    // Templates are meant to be shared/readable; real env files are not.
    return !/\.(example|sample|template|dist)$/.test(base);
  }
  if (/\.(pem|key|p12|pfx|jks|keystore)$/.test(base)) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(base)) return true;
  if ([".npmrc", ".netrc", ".pypirc", ".dockercfg", "credentials", "credentials.json", "secrets.json", "secrets.yml", "secrets.yaml"].includes(base)) {
    return true;
  }
  return false;
}

/**
 * True when a path is a dependency manifest or lockfile owned by the
 * upgrade step. Matched by basename so workspace packages
 * (packages/foo/package.json) are covered too, not just the repo root.
 */
export function isProtectedWrite(relPath: string, manifestFiles: string[], lockFiles: string[]): boolean {
  const base = relPath.split("/").pop()!;
  return manifestFiles.includes(base) || lockFiles.includes(base) || isSensitivePath(relPath);
}

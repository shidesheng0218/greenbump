#!/usr/bin/env node
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { detectOutdated } from "../engine/detect.js";
import { detectPackageManager } from "../engine/pm.js";
import { buildScanReport } from "../engine/scan/impact.js";
import { findPeerConflicts } from "../engine/peers.js";
import { scanOutdatedForVulns } from "../engine/security/scan.js";
import { WORKSPACE_ROOT, type WorkspaceOutdated } from "../engine/workspace.js";

/**
 * greenbump MCP server (stdio transport, no SDK).
 *
 * Exposes the *deterministic* half of greenbump — impact analysis, outdated
 * listing, peer requirements, advisories — to an MCP client such as Claude
 * Code or Cursor. Nothing here calls a model or modifies a file: an editor
 * agent asks "what would this upgrade touch?", gets file:line answers, and
 * decides what to do itself. The paid fix loop stays in the CLI.
 *
 * Wire format: one JSON-RPC 2.0 message per line on stdin/stdout.
 */

const SERVER_INFO = { name: "greenbump", version: "0.10.0" };
const SUPPORTED_PROTOCOL = "2024-11-05";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const TOOLS = [
  {
    name: "list_outdated",
    description:
      "List outdated direct dependencies for a project. Read-only; no network calls beyond the package manager's own.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Project directory (default: current working directory)" },
        ecosystem: { type: "string", description: "Ecosystem id (npm, poetry, cargo, …); auto-detected if omitted" },
      },
    },
  },
  {
    name: "scan_impact",
    description:
      "Report which files and lines a dependency upgrade would break, using greenbump's deterministic analysis " +
      "(built-in codemods + cached changelog digests). No LLM, no API key, no network.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Project directory (default: current working directory)" },
        dep: { type: "string", description: "Dependency to analyze; omit to analyze every outdated dependency" },
        to: { type: "string", description: "Target version (default: latest)" },
        ecosystem: { type: "string", description: "Ecosystem id; auto-detected if omitted" },
      },
    },
  },
  {
    name: "check_upgrade",
    description:
      "Analyze one specific upgrade: breaking-change impact, peer dependencies that must move with it, and known " +
      "security advisories on the current version. Does not install or modify anything.",
    inputSchema: {
      type: "object",
      properties: {
        dep: { type: "string", description: "Dependency name" },
        to: { type: "string", description: "Target version (default: latest)" },
        cwd: { type: "string", description: "Project directory (default: current working directory)" },
        ecosystem: { type: "string", description: "Ecosystem id; auto-detected if omitted" },
      },
      required: ["dep"],
    },
  },
  {
    name: "security_scan",
    description:
      "Find outdated dependencies with known vulnerabilities (osv.dev) and the lowest version that fixes each. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Project directory (default: current working directory)" },
        ecosystem: { type: "string", description: "Ecosystem id; auto-detected if omitted" },
      },
    },
  },
] as const;

function str(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = params?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function text(body: string, isError = false) {
  return { content: [{ type: "text", text: body }], ...(isError ? { isError: true } : {}) };
}

async function resolveProject(params: Record<string, unknown> | undefined) {
  const cwd = str(params, "cwd") ?? process.cwd();
  const pm = str(params, "ecosystem") ?? (await detectPackageManager(cwd));
  return { cwd, pm };
}

async function callListOutdated(params: Record<string, unknown> | undefined): Promise<string> {
  const { cwd, pm } = await resolveProject(params);
  const outdated = await detectOutdated(pm, cwd);
  if (outdated.length === 0) return "All dependencies are up to date.";
  return [
    `${outdated.length} outdated dependenc${outdated.length === 1 ? "y" : "ies"} (${pm}):`,
    ...outdated.map((o) => `- ${o.name}: ${o.current} → ${o.latest}`),
  ].join("\n");
}

async function callScanImpact(params: Record<string, unknown> | undefined): Promise<string> {
  const { cwd, pm } = await resolveProject(params);
  const to = str(params, "to");
  const dep = str(params, "dep");
  const outdated = await detectOutdated(pm, cwd);
  if (outdated.length === 0) return "All dependencies are up to date.";

  const targets: WorkspaceOutdated[] = (dep ? outdated.filter((o) => o.name === dep) : outdated).map((o) => ({
    name: o.name,
    current: o.current,
    wanted: o.wanted,
    latest: to ?? o.latest,
    workspacePath: WORKSPACE_ROOT,
  }));
  if (targets.length === 0) return `\`${dep}\` is not outdated. Outdated: ${outdated.map((o) => o.name).join(", ")}`;

  const report = await buildScanReport(cwd, targets);
  const lines: string[] = [];
  lines.push(
    `${report.summary.depsWithKnownBreaking} of ${report.summary.depsScanned} outdated dependencies have known breaking changes; ` +
      `${report.summary.filesAffected} file(s), ${report.summary.locationsAffected} location(s) affected.`,
  );
  for (const d of report.detections) {
    if (d.status !== "ok" && d.status !== "approx") {
      lines.push(`\n${d.name} ${d.current} → ${d.latest}: ${d.status}`);
      continue;
    }
    const affected = d.changes.filter((c) => c.matches > 0);
    lines.push(
      `\n${d.name} ${d.current} → ${d.latest}: ${d.changes.length} known change(s), ${affected.length} touch this code ` +
        `(${d.filesMatched} file(s), ${d.locationsMatched} location(s))`,
    );
    for (const c of affected) {
      lines.push(`  - [${c.severity}] ${c.description}`);
      for (const fg of c.fileGroups.slice(0, 5)) {
        for (const loc of fg.locations.slice(0, 3)) {
          lines.push(`      ${loc.file}:${loc.line}: ${loc.excerpt}`);
        }
      }
    }
  }
  return lines.join("\n");
}

async function callCheckUpgrade(params: Record<string, unknown> | undefined): Promise<string> {
  const dep = str(params, "dep");
  if (!dep) return "check_upgrade requires a `dep` parameter.";
  const { cwd, pm } = await resolveProject(params);
  const outdated = await detectOutdated(pm, cwd);
  const current = outdated.find((o) => o.name === dep);
  if (!current) {
    return `\`${dep}\` is not outdated (or not a direct dependency). Outdated: ${outdated.map((o) => o.name).join(", ") || "none"}`;
  }
  const to = str(params, "to") ?? current.latest;

  const report = await buildScanReport(cwd, [
    { name: dep, current: current.current, wanted: current.wanted, latest: to, workspacePath: WORKSPACE_ROOT },
  ]);
  const det = report.detections[0];
  const affected = det?.changes.filter((c) => c.matches > 0) ?? [];
  const peers = await findPeerConflicts(cwd, pm, dep, to);

  const lines: string[] = [`${dep} ${current.current} → ${to}`];
  lines.push(`impact: ${det?.changes.length ?? 0} known breaking change(s), ${affected.length} touch this codebase`);
  for (const c of affected) {
    lines.push(`  - [${c.severity}] ${c.description}`);
    for (const fg of c.fileGroups.slice(0, 5)) {
      for (const loc of fg.locations.slice(0, 3)) lines.push(`      ${loc.file}:${loc.line}: ${loc.excerpt}`);
    }
  }
  if (peers.length > 0) {
    lines.push("peer dependencies that must move with it:");
    for (const p of peers) {
      lines.push(
        p.resolution === "upgrade"
          ? `  - ${p.name} ${p.current} → ${p.suggested} (requires ${p.required})`
          : `  - ${p.name}: ${p.resolution} (requires ${p.required})`,
      );
    }
  }
  const vulns = (await scanOutdatedForVulns(pm, [current])).find((f) => f.name === dep);
  if (vulns) {
    lines.push(`security: ${vulns.vulns.length} advisor${vulns.vulns.length === 1 ? "y" : "ies"} on ${current.current} ` +
      `(worst: ${vulns.worst.severity})${vulns.minimalFix ? `, lowest fix ${vulns.minimalFix}` : ""}`);
    for (const v of vulns.vulns.slice(0, 5)) lines.push(`  - ${v.id} [${v.severity}] ${v.summary}`);
  } else {
    lines.push("security: no known advisories on the current version");
  }
  return lines.join("\n");
}

async function callSecurityScan(params: Record<string, unknown> | undefined): Promise<string> {
  const { cwd, pm } = await resolveProject(params);
  const outdated = await detectOutdated(pm, cwd);
  if (outdated.length === 0) return "All dependencies are up to date.";
  const findings = await scanOutdatedForVulns(pm, outdated);
  if (findings.length === 0) {
    return `No known advisories among ${outdated.length} outdated dependencies.`;
  }
  const lines = [`${findings.length} of ${outdated.length} outdated dependencies have known advisories:`];
  for (const f of findings) {
    lines.push(
      `- ${f.name}@${f.current} (worst: ${f.worst.severity}): ${f.vulns.length} advisor${f.vulns.length === 1 ? "y" : "ies"}` +
        (f.minimalFix ? `, lowest fix ${f.minimalFix}` : ""),
    );
  }
  return lines.join("\n");
}

async function dispatch(method: string, params: Record<string, unknown> | undefined): Promise<unknown> {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: SUPPORTED_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = str(params, "name");
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      switch (name) {
        case "list_outdated":
          return text(await callListOutdated(args));
        case "scan_impact":
          return text(await callScanImpact(args));
        case "check_upgrade":
          return text(await callCheckUpgrade(args));
        case "security_scan":
          return text(await callSecurityScan(args));
        default:
          throw Object.assign(new Error(`unknown tool: ${name}`), { rpcCode: -32602 });
      }
    }
    case "resources/list":
      return { resources: [] };
    case "prompts/list":
      return { prompts: [] };
    default:
      throw Object.assign(new Error(`method not found: ${method}`), { rpcCode: -32601 });
  }
}

function send(msg: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

/** Handle one line of input (one JSON-RPC message), writing any response to stdout. */
export async function handleLine(line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req: JsonRpcRequest;
  try {
    req = JSON.parse(trimmed) as JsonRpcRequest;
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    return;
  }

  // Notifications (no id) never get a response.
  const isNotification = req.id === undefined;
  if (isNotification) return;

  try {
    const result = await dispatch(req.method, req.params);
    send({ jsonrpc: "2.0", id: req.id ?? null, result });
  } catch (err) {
    const e = err as Error & { rpcCode?: number };
    send({
      jsonrpc: "2.0",
      id: req.id ?? null,
      error: { code: e.rpcCode ?? -32603, message: e.message },
    });
  }
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  // Serialize handling so tool calls never interleave their responses.
  let queue: Promise<void> = Promise.resolve();
  for await (const line of rl) {
    queue = queue.then(() => handleLine(line)).catch(() => {});
  }
  await queue;
}

// Only auto-start when executed directly (so tests can import handleLine).
// Compare decoded paths: import.meta.url percent-encodes spaces and non-ASCII,
// so a naive `file://${argv[1]}` comparison silently fails to start the server
// in any directory whose path contains a space or a CJK character.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
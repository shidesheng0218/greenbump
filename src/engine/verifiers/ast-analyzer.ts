import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import ts from "typescript";

/**
 * AST-level analysis of the changes the fix agent made.
 *
 * Catches the class of problems that "tests pass" misses:
 * - exported API surface shrank (something downstream imports may now break)
 * - a function's arity or return shape changed
 * - types were loosened to `any` to silence the compiler
 *
 * This runs on the git diff (before/after the fix), not on the dependency's
 * own code — it answers "did the fix quietly change OUR public API?"
 */

export interface AstChange {
  kind:
    | "export-removed"
    | "export-added"
    | "signature-changed"
    | "type-loosened-to-any"
    | "export-type-removed";
  file: string;
  symbol: string;
  detail: string;
  severity: "info" | "warning" | "critical";
}

export interface AstAnalysisResult {
  changes: AstChange[];
  /** critical changes → needsReview */
  hasCritical: boolean;
  summary: string;
}

interface ExportedSymbol {
  name: string;
  kind: "function" | "class" | "const" | "type" | "interface" | "enum" | "unknown";
  signature?: string;
}

const ANALYZABLE_EXT = new Set([".ts", ".tsx", ".mts", ".cts"]);
const MAX_FILE_SIZE = 500_000;

/** Extract the exported symbol table from a TS/TSX file. */
function extractExports(code: string, filename: string): Map<string, ExportedSymbol> {
  const symbols = new Map<string, ExportedSymbol>();
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true);
  } catch {
    return symbols;
  }

  const hasExportModifier = (node: ts.Node): boolean => {
    const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  };

  const isDefault = (node: ts.Node): boolean => {
    const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
  };

  const visit = (node: ts.Node): void => {
    // export function foo(...) / export class Foo / export const foo
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node)) &&
      hasExportModifier(node)
    ) {
      const name = isDefault(node) ? "default" : node.name?.getText(sourceFile);
      if (name) {
        symbols.set(name, {
          name,
          kind: ts.isFunctionDeclaration(node)
            ? "function"
            : ts.isClassDeclaration(node)
              ? "class"
              : ts.isInterfaceDeclaration(node)
                ? "interface"
                : ts.isTypeAliasDeclaration(node)
                  ? "type"
                  : "enum",
          signature: ts.isFunctionDeclaration(node) ? signatureOf(node, sourceFile) : undefined,
        });
      }
    }

    // export const foo = ...
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const decl of node.declarationList.declarations) {
        const name = decl.name.getText(sourceFile);
        symbols.set(name, {
          name,
          kind: "const",
          signature: decl.type?.getText(sourceFile),
        });
      }
    }

    // export { a, b } / export { a as b }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) {
        const name = el.name.getText(sourceFile);
        symbols.set(name, { name, kind: "unknown" });
      }
    }

    // export default <expr>
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      symbols.set("default", { name: "default", kind: "unknown" });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return symbols;
}

function signatureOf(fn: ts.FunctionDeclaration, sf: ts.SourceFile): string {
  const params = fn.parameters.map((p) => {
    const type = p.type ? p.type.getText(sf) : "any";
    return `${p.name.getText(sf)}: ${type}`;
  });
  const ret = fn.type ? fn.type.getText(sf) : "void";
  return `(${params.join(", ")}) => ${ret}`;
}

/**
 * Compare the exported API surface before vs after the fix.
 * `changedFiles` are the files the fix agent touched (project-relative).
 * For each, we compare git HEAD content (pre-upgrade... actually pre-fix)
 * against current working-tree content.
 */
export async function analyzeApiChanges(
  cwd: string,
  changedFiles: string[],
  readBefore: (path: string) => Promise<string | null>,
): Promise<AstAnalysisResult> {
  const changes: AstChange[] = [];

  for (const file of changedFiles) {
    const ext = file.slice(file.lastIndexOf("."));
    if (!ANALYZABLE_EXT.has(ext)) continue;

    const abs = join(cwd, file);
    let after: string;
    try {
      const s = await stat(abs);
      if (s.size > MAX_FILE_SIZE) continue;
      after = await readFile(abs, "utf8");
    } catch {
      continue; // file deleted or unreadable — covered by change-detector
    }

    const before = await readBefore(file);
    if (before === null) continue; // new file — nothing to compare

    const beforeExports = extractExports(before, file);
    const afterExports = extractExports(after, file);

    // Removed exports
    for (const [name, sym] of beforeExports) {
      if (!afterExports.has(name)) {
        changes.push({
          kind: sym.kind === "type" || sym.kind === "interface" ? "export-type-removed" : "export-removed",
          file,
          symbol: name,
          detail: `${sym.kind} \`${name}\` was exported before the fix but is no longer exported`,
          severity: name === "default" ? "critical" : "warning",
        });
        continue;
      }

      // Signature changes on functions
      const afterSym = afterExports.get(name)!;
      if (
        sym.kind === "function" &&
        afterSym.kind === "function" &&
        sym.signature &&
        afterSym.signature &&
        sym.signature !== afterSym.signature
      ) {
        changes.push({
          kind: "signature-changed",
          file,
          symbol: name,
          detail: `\`${name}\` signature changed: ${sym.signature} → ${afterSym.signature}`,
          severity: "warning",
        });
      }
    }

    // Newly-loosened types: any introduced where a concrete type existed
    const loosened = detectTypeLoosening(before, after, file);
    changes.push(...loosened);
  }

  const hasCritical = changes.some((c) => c.severity === "critical");
  const criticalCount = changes.filter((c) => c.severity === "critical").length;
  const warningCount = changes.filter((c) => c.severity === "warning").length;

  const summary =
    changes.length === 0
      ? "no API surface changes detected"
      : `${criticalCount} critical, ${warningCount} warning(s) — exported API changed`;

  return { changes, hasCritical, summary };
}

/** Detect `any` annotations introduced by the fix (silencing the compiler). */
function detectTypeLoosening(before: string, after: string, file: string): AstChange[] {
  const out: AstChange[] = [];
  const countAny = (code: string): number => {
    const m = code.match(/:\s*any\b|<any>|as any\b/g);
    return m ? m.length : 0;
  };
  const beforeCount = countAny(before);
  const afterCount = countAny(after);
  if (afterCount > beforeCount) {
    out.push({
      kind: "type-loosened-to-any",
      file,
      symbol: "(multiple)",
      detail: `fix introduced ${afterCount - beforeCount} new \`any\` annotation(s) — may be masking a real type error`,
      severity: "warning",
    });
  }
  return out;
}

/** Read a file's content from git HEAD (used as the "before" state). */
export async function readFromGitHead(cwd: string, path: string): Promise<string | null> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    execFile(
      "git",
      ["show", `HEAD:${path}`],
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) resolve(null);
        else resolve(stdout);
      },
    );
  });
}

/** List TS/TSX files in the project (for full-project scans, if needed). */
export async function listAnalyzableFiles(cwd: string, root = "."): Promise<string[]> {
  const IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(join(cwd, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (IGNORE.has(e.name)) continue;
      const rel = dir === "." ? e.name : `${dir}/${e.name}`;
      if (e.isDirectory()) await walk(rel);
      else {
        const ext = e.name.slice(e.name.lastIndexOf("."));
        if (ANALYZABLE_EXT.has(ext)) out.push(rel);
      }
    }
  }
  await walk(root);
  return out;
}

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface SuspiciousChange {
  type: "test-modified" | "large-deletion" | "test-commented" | "test-removed";
  file: string;
  description: string;
  severity: "warning" | "critical";
}

/**
 * Detect suspicious changes in the git diff that might indicate the LLM
 * "cheated" to make tests pass (e.g., commenting out tests, deleting code).
 */
export async function detectSuspiciousChanges(
  cwd: string
): Promise<SuspiciousChange[]> {
  const changes: SuspiciousChange[] = [];

  try {
    // Get git diff for staged + unstaged changes
    const { stdout: diff } = await execAsync("git diff HEAD", { cwd });
    if (!diff.trim()) return []; // No changes

    // 1. Detect test file modifications
    const testFileChanges = detectTestFileChanges(diff);
    changes.push(...testFileChanges);

    // 2. Detect large deletions (>50 lines in a single file)
    const largeDeletions = detectLargeDeletions(diff);
    changes.push(...largeDeletions);

    // 3. Detect commented-out tests (heuristic)
    const commentedTests = detectCommentedTests(diff);
    changes.push(...commentedTests);

    // 4. Detect removed test cases (it('...') or test('...') deletions)
    const removedTests = detectRemovedTests(diff);
    changes.push(...removedTests);
  } catch (err) {
    // Git command failed (e.g., not a git repo) - ignore
  }

  return changes;
}

function detectTestFileChanges(diff: string): SuspiciousChange[] {
  const changes: SuspiciousChange[] = [];
  const testFilePattern = /\.(test|spec)\.(ts|js|tsx|jsx)$/;

  // Parse diff to find modified files
  const fileHeaderPattern = /^diff --git a\/(.+?) b\/(.+?)$/gm;
  let match: RegExpExecArray | null;

  while ((match = fileHeaderPattern.exec(diff)) !== null) {
    const filePath = match[2];
    if (testFilePattern.test(filePath)) {
      changes.push({
        type: "test-modified",
        file: filePath,
        description: "Test file was modified during fix loop",
        severity: "critical",
      });
    }
  }

  return changes;
}

function detectLargeDeletions(diff: string): SuspiciousChange[] {
  const changes: SuspiciousChange[] = [];

  // Split diff by file
  const fileDiffs = diff.split(/^diff --git /m).slice(1); // First element is empty

  for (const fileDiff of fileDiffs) {
    const fileMatch = fileDiff.match(/^a\/(.+?) b\/(.+?)$/m);
    if (!fileMatch) continue;

    const filePath = fileMatch[2];

    // Count deletions (lines starting with -)
    const lines = fileDiff.split("\n");
    let deletions = 0;

    for (const line of lines) {
      if (line.startsWith("-") && !line.startsWith("---")) {
        deletions++;
      }
    }

    if (deletions > 50) {
      changes.push({
        type: "large-deletion",
        file: filePath,
        description: `${deletions} lines deleted (possible over-aggressive fix)`,
        severity: "warning",
      });
    }
  }

  return changes;
}

function detectCommentedTests(diff: string): SuspiciousChange[] {
  const changes: SuspiciousChange[] = [];

  // Look for patterns like:
  // -  it('should work', () => {
  // +  // it('should work', () => {
  // or
  // -  test('should work', () => {
  // +  /* test('should work', () => {

  const lines = diff.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    const prevLine = lines[i];
    const currLine = lines[i + 1];

    if (
      prevLine.startsWith("-") &&
      /\b(it|test|describe)\(/.test(prevLine) &&
      currLine.startsWith("+") &&
      (/^[+]\s*(\/\/|\/\*)/.test(currLine) ||
        currLine.includes("// it(") ||
        currLine.includes("// test(") ||
        currLine.includes("/* it(") ||
        currLine.includes("/* test("))
    ) {
      // Extract approximate location
      const fileContext = findFileContext(diff, i);
      changes.push({
        type: "test-commented",
        file: fileContext || "unknown",
        description: "Test case appears to have been commented out",
        severity: "critical",
      });
    }
  }

  return changes;
}

function detectRemovedTests(diff: string): SuspiciousChange[] {
  const changes: SuspiciousChange[] = [];

  // Look for deleted test cases (lines starting with - that contain it( or test()
  const lines = diff.split("\n");
  let removedTestCount = 0;
  let currentFile = "unknown";

  for (const line of lines) {
    // Track current file
    const fileMatch = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
    if (fileMatch) {
      currentFile = fileMatch[2];
      removedTestCount = 0; // Reset counter for new file
    }

    // Check for deleted test cases
    if (
      line.startsWith("-") &&
      !line.startsWith("---") &&
      /\b(it|test)\s*\(/.test(line)
    ) {
      removedTestCount++;
    }
  }

  if (removedTestCount > 0) {
    changes.push({
      type: "test-removed",
      file: currentFile,
      description: `${removedTestCount} test case(s) were deleted`,
      severity: "critical",
    });
  }

  return changes;
}

function findFileContext(diff: string, lineIndex: number): string | null {
  // Walk backwards to find the nearest "diff --git" header
  const lines = diff.split("\n");
  for (let i = lineIndex; i >= 0; i--) {
    const match = lines[i].match(/^diff --git a\/(.+?) b\/(.+?)$/);
    if (match) return match[2];
  }
  return null;
}

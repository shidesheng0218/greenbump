import { test } from "node:test";
import assert from "node:assert/strict";
import { osvEcosystem, minimalFix, sortBySeverity, compareSeverity, normalizeSeverity, type Vulnerability } from "./osv.js";

function vuln(partial: Partial<Vulnerability>): Vulnerability {
  return {
    id: "GHSA-test",
    summary: "a vulnerability",
    severity: "high",
    aliases: [],
    fixedVersions: [],
    url: "",
    ...partial,
  };
}

test("osvEcosystem: maps greenbump ecosystem ids to osv.dev names", () => {
  assert.equal(osvEcosystem("npm"), "npm");
  assert.equal(osvEcosystem("yarn"), "npm");
  assert.equal(osvEcosystem("pnpm"), "npm");
  assert.equal(osvEcosystem("poetry"), "PyPI");
  assert.equal(osvEcosystem("uv"), "PyPI");
  assert.equal(osvEcosystem("cargo"), "crates.io");
  assert.equal(osvEcosystem("maven"), "Maven");
  assert.equal(osvEcosystem("gradle"), "Maven");
  assert.equal(osvEcosystem("composer"), "Packagist");
  assert.equal(osvEcosystem("bundler"), "RubyGems");
  assert.equal(osvEcosystem("nuget"), "NuGet");
});

test("osvEcosystem: ecosystems with no osv.dev equivalent return null", () => {
  assert.equal(osvEcosystem("cocoapods"), null);
  assert.equal(osvEcosystem("unknown-ecosystem"), null);
});

test("minimalFix: picks the lowest fixed version above the installed one", () => {
  const vulns = [
    vuln({ id: "a", fixedVersions: ["4.17.21"] }),
    vuln({ id: "b", fixedVersions: ["4.17.19", "4.17.21"] }),
  ];
  assert.equal(minimalFix("4.17.15", vulns), "4.17.19");
});

test("minimalFix: ignores fixes that are not newer than the installed version", () => {
  assert.equal(minimalFix("4.17.21", [vuln({ fixedVersions: ["4.17.19"] })]), null);
});

test("minimalFix: returns null when no advisory declares a fix", () => {
  assert.equal(minimalFix("1.0.0", [vuln({ fixedVersions: [] })]), null);
  assert.equal(minimalFix("1.0.0", []), null);
});

test("sortBySeverity: critical first, unknown last", () => {
  const sorted = sortBySeverity([
    vuln({ id: "low", severity: "low" }),
    vuln({ id: "crit", severity: "critical" }),
    vuln({ id: "unk", severity: "unknown" }),
    vuln({ id: "med", severity: "medium" }),
    vuln({ id: "high", severity: "high" }),
  ]);
  assert.deepEqual(sorted.map((v) => v.id), ["crit", "high", "med", "low", "unk"]);
});

test("compareSeverity: orders by triage priority", () => {
  assert.ok(compareSeverity("critical", "high") < 0);
  assert.ok(compareSeverity("low", "high") > 0);
  assert.equal(compareSeverity("medium", "medium"), 0);
});
test("normalizeSeverity: GitHub's MODERATE maps to medium", () => {
  // Real OSV records for lodash use this exact value; treating it as unknown
  // was understating half of the advisories.
  assert.equal(normalizeSeverity("MODERATE"), "medium");
  assert.equal(normalizeSeverity("moderate"), "medium");
  assert.equal(normalizeSeverity("CRITICAL"), "critical");
  assert.equal(normalizeSeverity("HIGH"), "high");
  assert.equal(normalizeSeverity("LOW"), "low");
});

test("normalizeSeverity: numeric CVSS scores are banded", () => {
  assert.equal(normalizeSeverity(undefined, ["9.8"]), "critical");
  assert.equal(normalizeSeverity(undefined, ["7.5"]), "high");
  assert.equal(normalizeSeverity(undefined, ["5.3"]), "medium");
  assert.equal(normalizeSeverity(undefined, ["2.1"]), "low");
});

test("normalizeSeverity: a CVSS vector string is not guessed at", () => {
  // OSV most often stores a vector, not a number. Deriving a band from it
  // would require the full CVSS base-score algorithm — report unknown.
  assert.equal(normalizeSeverity(undefined, ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L"]), "unknown");
});

test("normalizeSeverity: database severity wins over a CVSS score", () => {
  assert.equal(normalizeSeverity("HIGH", ["2.0"]), "high");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { satisfies, compareVersions, parseVersion, lowerBoundOfRange } from "./semver-lite.js";

const v = (s: string) => parseVersion(s)!;

test("semver-lite: parseVersion handles plain, prerelease and v-prefixed versions", () => {
  assert.deepEqual(parseVersion("19.2.0"), { major: 19, minor: 2, patch: 0, prerelease: "" });
  assert.deepEqual(parseVersion("v1.2.3"), { major: 1, minor: 2, patch: 3, prerelease: "" });
  assert.deepEqual(parseVersion("1.0.0-rc.1"), { major: 1, minor: 0, patch: 0, prerelease: "rc.1" });
  assert.deepEqual(parseVersion("1.0.0+build.5"), { major: 1, minor: 0, patch: 0, prerelease: "" });
  assert.equal(parseVersion("not-a-version"), null);
  assert.equal(parseVersion("1.2"), null);
});

test("semver-lite: compareVersions orders numerically and puts prereleases first", () => {
  assert.equal(compareVersions(v("1.2.3"), v("1.2.3")), 0);
  assert.equal(compareVersions(v("1.2.3"), v("1.10.0")), -1); // numeric, not lexical
  assert.equal(compareVersions(v("2.0.0"), v("1.99.99")), 1);
  assert.equal(compareVersions(v("1.0.0-rc.1"), v("1.0.0")), -1);
});

test("semver-lite: caret ranges", () => {
  assert.equal(satisfies("19.2.0", "^19.0.0"), true);
  assert.equal(satisfies("19.9.9", "^19.0.0"), true);
  assert.equal(satisfies("20.0.0", "^19.0.0"), false);
  assert.equal(satisfies("18.9.9", "^19.0.0"), false);
  // ^0.x narrows to the minor
  assert.equal(satisfies("0.2.5", "^0.2.3"), true);
  assert.equal(satisfies("0.3.0", "^0.2.3"), false);
  // ^0.0.x narrows to the patch
  assert.equal(satisfies("0.0.3", "^0.0.3"), true);
  assert.equal(satisfies("0.0.4", "^0.0.3"), false);
});

test("semver-lite: tilde ranges", () => {
  assert.equal(satisfies("1.2.9", "~1.2.3"), true);
  assert.equal(satisfies("1.3.0", "~1.2.3"), false);
  assert.equal(satisfies("1.9.0", "~1"), true);
  assert.equal(satisfies("2.0.0", "~1"), false);
});

test("semver-lite: comparators and space-AND", () => {
  assert.equal(satisfies("19.0.0", ">=19"), true);
  assert.equal(satisfies("18.9.0", ">=19"), false);
  assert.equal(satisfies("19.5.0", ">=19 <20"), true);
  assert.equal(satisfies("20.0.0", ">=19 <20"), false);
  assert.equal(satisfies("20.0.0", "<=20"), true);
  assert.equal(satisfies("20.0.1", "<=20"), false);
});

test("semver-lite: or-ranges", () => {
  assert.equal(satisfies("1.5.0", "^1 || ^2"), true);
  assert.equal(satisfies("2.5.0", "^1 || ^2"), true);
  assert.equal(satisfies("3.0.0", "^1 || ^2"), false);
});

test("semver-lite: x-ranges and wildcards", () => {
  assert.equal(satisfies("1.9.9", "1.x"), true);
  assert.equal(satisfies("2.0.0", "1.x"), false);
  assert.equal(satisfies("1.2.9", "1.2.x"), true);
  assert.equal(satisfies("1.3.0", "1.2.x"), false);
  assert.equal(satisfies("9.9.9", "*"), true);
  assert.equal(satisfies("9.9.9", ""), true);
});

test("semver-lite: hyphen ranges", () => {
  assert.equal(satisfies("1.5.0", "1.2.3 - 2.3.4"), true);
  assert.equal(satisfies("2.3.4", "1.2.3 - 2.3.4"), true);
  assert.equal(satisfies("2.3.5", "1.2.3 - 2.3.4"), false);
  assert.equal(satisfies("1.2.2", "1.2.3 - 2.3.4"), false);
});

test("semver-lite: exact versions", () => {
  assert.equal(satisfies("1.2.3", "1.2.3"), true);
  assert.equal(satisfies("1.2.4", "1.2.3"), false);
  assert.equal(satisfies("1.2.3", "=1.2.3"), true);
});

test("semver-lite: prereleases only match a range that names the same base prerelease", () => {
  assert.equal(satisfies("1.0.0-rc.1", "^1.0.0"), false);
  assert.equal(satisfies("1.0.0-rc.1", "^1.0.0-rc.0"), true);
});

test("semver-lite: an unparseable range is permissive rather than blocking", () => {
  assert.equal(satisfies("1.2.3", "latest"), true);
  assert.equal(satisfies("1.2.3", "git+https://example.com/x.git"), true);
  assert.equal(satisfies("1.2.3", "workspace:*"), true);
});

test("lowerBoundOfRange: extracts the smallest satisfying version", () => {
  assert.equal(lowerBoundOfRange("^19.2.0"), "19.2.0");
  assert.equal(lowerBoundOfRange("~1.2.3"), "1.2.3");
  assert.equal(lowerBoundOfRange(">=19.0.0 <20"), "19.0.0");
  assert.equal(lowerBoundOfRange("1.x"), "1.0.0");
  assert.equal(lowerBoundOfRange("*"), null);
  assert.equal(lowerBoundOfRange(">19.0.0"), null); // exclusive lower bound has no minimum
});
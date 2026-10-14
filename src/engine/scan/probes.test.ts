import { test } from "node:test";
import assert from "node:assert/strict";
import {
  probesFromChange,
  probesFromCodemod,
  codemodsForUpgrade,
  escapeRegExpLiteral,
  REQUIRES_IMPORT_PREFIX,
} from "./probes.js";
import type { BreakingChange } from "../analyzers/changelog-parser.js";

function change(partial: Partial<BreakingChange>): BreakingChange {
  return {
    description: "some change",
    oldApi: "ReactDOM.render",
    newApi: "createRoot",
    severity: "high",
    ...partial,
  };
}

test("probesFromChange: dotted API call produces a literal pattern, not a regex", () => {
  const probes = probesFromChange(change({ oldApi: "ReactDOM.render(el, root)" }), "react-dom", 0);
  assert.equal(probes.length, 1);
  assert.equal(probes[0].pattern, escapeRegExpLiteral("ReactDOM.render"));
  assert.equal(probes[0].approx, false);
  assert.deepEqual(probes[0].refs, [{ depName: "react-dom", changeIndex: 0 }]);
});

test("probesFromChange: dots and parens in the API are escaped so '.' matches literally", () => {
  const probes = probesFromChange(change({ oldApi: "err.error.errors" }), "zod", 0);
  assert.equal(probes[0].pattern, "err\\.error\\.errors");
  // A literal match must not treat '.' as any-char
  assert.ok(new RegExp(probes[0].pattern).test("err.error.errors"));
  assert.ok(!new RegExp(probes[0].pattern).test("errXerrorXerrors"));
});

test("probesFromChange: bare identifier is gated to files importing the package", () => {
  const probes = probesFromChange(change({ oldApi: "describe" }), "vitest", 2);
  assert.equal(probes.length, 1);
  assert.equal(probes[0].fileFilter, `${REQUIRES_IMPORT_PREFIX}vitest`);
  assert.equal(probes[0].approx, false);
});

test("probesFromChange: short head before the paren falls back to longest member, marked approx", () => {
  // Primary = "fn" (2 chars, below the length floor) → fall back to the
  // longest `.member` path found anywhere in the full oldApi string.
  const probes = probesFromChange(change({ oldApi: "fn(obj.someLongMemberName)" }), "pkg", 0);
  assert.equal(probes.length, 1);
  assert.equal(probes[0].approx, true);
  assert.equal(probes[0].pattern, escapeRegExpLiteral(".someLongMemberName"));
});

test("probesFromChange: a usable head is preferred over the member fallback", () => {
  const probes = probesFromChange(change({ oldApi: "client.oldMethod()" }), "pkg", 0);
  assert.equal(probes[0].approx, false);
  assert.equal(probes[0].pattern, escapeRegExpLiteral("client.oldMethod"));
});

test("probesFromChange: prose with no dots and no usable head yields no probes", () => {
  const probes = probesFromChange(change({ oldApi: "" }), "pkg", 0);
  assert.deepEqual(probes, []);
});

test("probesFromCodemod: uses the transform pattern and carries its fileFilter", () => {
  const probes = probesFromCodemod(
    {
      package: "lodash",
      errorMatch: "_",
      description: "_.pluck → _.map",
      transform: { find: "_\\.pluck\\(", replace: "_.map(", fileFilter: "src" },
    },
    "lodash",
    0,
  );
  assert.equal(probes.length, 1);
  assert.equal(probes[0].pattern, "_\\.pluck\\(");
  assert.equal(probes[0].fileFilter, "src");
});

test("probesFromCodemod: guidance-only codemod (no transform) yields no probes", () => {
  const probes = probesFromCodemod(
    { package: "eslint", errorMatch: "eslintrc", description: "flat config migration" },
    "eslint",
    0,
  );
  assert.deepEqual(probes, []);
});

test("codemodsForUpgrade: matches by package and major range (zod 3→4)", () => {
  const found = codemodsForUpgrade("zod", "3.23.8", "4.0.5");
  assert.ok(found.length > 0);
  assert.ok(found.every((c) => c.package === "zod"));
});

test("codemodsForUpgrade: does not match a minor bump inside the same major", () => {
  const found = codemodsForUpgrade("zod", "3.22.0", "3.23.8");
  assert.equal(found.length, 0);
});

test("codemodsForUpgrade: a later major than the range is excluded (react-dom 18→20)", () => {
  const found = codemodsForUpgrade("react-dom", "18.3.1", "20.0.0");
  assert.equal(found.length, 0);
});

test("codemodsForUpgrade: multi-major range still matches (mongoose 6→8)", () => {
  const found = codemodsForUpgrade("mongoose", "6.5.0", "8.0.0");
  assert.ok(found.some((c) => c.description.includes("deleteOne")));
});

test("codemodsForUpgrade: wildcard codemods are NOT attributed to an unrelated package", () => {
  // The generic `assert.equal` / `util.is*` codemods are `package: "*"` and
  // error-gated. Before this gate they were reported as breaking changes of
  // every outdated dependency (a zod bump "breaking" assert.equal).
  const zodCodemods = codemodsForUpgrade("zod", "3.23.8", "4.0.5");
  assert.ok(!zodCodemods.some((c) => c.package === "*"), "wildcard codemod leaked into zod");

  const expressCodemods = codemodsForUpgrade("express", "4.19.2", "5.0.1");
  assert.ok(!expressCodemods.some((c) => c.package === "*"), "wildcard codemod leaked into express");
});

test("codemodsForUpgrade: wildcard codemods DO apply to a Node runtime upgrade", () => {
  const found = codemodsForUpgrade("@types/node", "20.0.0", "22.0.0");
  assert.ok(found.some((c) => c.package === "*"));
});

test("escapeRegExpLiteral: neutralizes regex metacharacters", () => {
  const escaped = escapeRegExpLiteral("a.b(c)[d]*");
  assert.ok(new RegExp(escaped).test("a.b(c)[d]*"));
  assert.ok(!new RegExp(escaped).test("axbxcxd"));
});
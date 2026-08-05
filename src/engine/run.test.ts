import { test } from "node:test";
import assert from "node:assert/strict";
import { computeNeedsReview } from "./run.js";

test("computeNeedsReview: unverifiable always needs review, regardless of anything else", () => {
  assert.equal(
    computeNeedsReview({ unverifiable: true, neededFix: false, fixed: true, testFilesTouched: [] }),
    true,
  );
});

test("computeNeedsReview: clean upgrade (no fix needed) never needs review", () => {
  assert.equal(
    computeNeedsReview({ unverifiable: false, neededFix: false, fixed: true, testFilesTouched: [] }),
    false,
  );
});

test("computeNeedsReview: fixed with a test file touched needs review", () => {
  assert.equal(
    computeNeedsReview({
      unverifiable: false,
      neededFix: true,
      fixed: true,
      testFilesTouched: ["src/foo.test.ts"],
    }),
    true,
  );
});

test("computeNeedsReview: fixed with no test file touched does not need review", () => {
  assert.equal(
    computeNeedsReview({ unverifiable: false, neededFix: true, fixed: true, testFilesTouched: [] }),
    false,
  );
});

test("computeNeedsReview: fix loop failed (unfixed) never needs review — that's exit code 2's job, not 3's", () => {
  assert.equal(
    computeNeedsReview({
      unverifiable: false,
      neededFix: true,
      fixed: false,
      testFilesTouched: ["src/foo.test.ts"],
    }),
    false,
  );
});

test("computeNeedsReview: budgetExceeded always needs review, even on a clean/no-fix-needed run", () => {
  assert.equal(
    computeNeedsReview({
      unverifiable: false,
      neededFix: false,
      fixed: true,
      testFilesTouched: [],
      budgetExceeded: true,
    }),
    true,
  );
});

test("computeNeedsReview: budgetExceeded still needs review even when fixed with no test file touched", () => {
  assert.equal(
    computeNeedsReview({
      unverifiable: false,
      neededFix: true,
      fixed: true,
      testFilesTouched: [],
      budgetExceeded: true,
    }),
    true,
  );
});

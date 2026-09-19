import { test } from "node:test";
import assert from "node:assert/strict";
import { generateComposeFile } from "./template-generator.js";

test("generateComposeFile: no fixed network name, so compose's per-project default network applies", async () => {
  // orchestrator.ts joins the verify container to `${projectName}_default`.
  // An explicit `name:` on the network would suppress the project prefix and
  // break that join (and collide across concurrent runs).
  const yaml = await generateComposeFile(["postgres"]);
  assert.ok(yaml.includes("postgres"));
  assert.doesNotMatch(yaml, /networks:/);
  assert.doesNotMatch(yaml, /greenbump_network/);
});

test("generateComposeFile: unknown services produce an empty file", async () => {
  assert.equal(await generateComposeFile(["nonsense-service"]), "");
});

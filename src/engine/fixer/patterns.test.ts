import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  tryBuiltinCodemods,
  buildContextKey,
  FixTier,
} from "./patterns.js";

async function withProject(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-patterns-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content, "utf8");
  }
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const reactApp = `import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';

ReactDOM.render(
  <App />,
  document.getElementById('root')
);
`;

test("codemods: React 18→19 ReactDOM.render is rewritten to createRoot", async () => {
  await withProject({ "src/index.tsx": reactApp }, async (dir) => {
    const result = await tryBuiltinCodemods({
      cwd: dir,
      packageName: "react-dom",
      fromVersion: "18.3.1",
      toVersion: "19.2.0",
      failureOutput: "TypeError: ReactDOM.render is not a function",
      candidateFiles: ["src/index.tsx"],
    });

    assert.equal(result.applied, true);
    assert.equal(result.tier, FixTier.REGEX);
    assert.deepEqual(result.editedFiles, ["src/index.tsx"]);
    assert.equal(result.tokensUsed.inputTokens, 0);

    const fixed = await readFile(join(dir, "src/index.tsx"), "utf8");
    assert.ok(fixed.includes("createRoot("));
    assert.ok(fixed.includes("from 'react-dom/client'"));
    assert.ok(!fixed.includes("ReactDOM.render("));
  });
});

test("codemods: non-matching error output leaves files untouched", async () => {
  await withProject({ "src/index.tsx": reactApp }, async (dir) => {
    const result = await tryBuiltinCodemods({
      cwd: dir,
      packageName: "react-dom",
      fromVersion: "18.3.1",
      toVersion: "19.2.0",
      failureOutput: "Error: something entirely different",
      candidateFiles: ["src/index.tsx"],
    });

    assert.equal(result.applied, false);
    const unchanged = await readFile(join(dir, "src/index.tsx"), "utf8");
    assert.equal(unchanged, reactApp);
  });
});

test("codemods: wrong package does not apply the react codemod", async () => {
  await withProject({ "src/index.tsx": reactApp }, async (dir) => {
    const result = await tryBuiltinCodemods({
      cwd: dir,
      packageName: "lodash",
      fromVersion: "4.0.0",
      toVersion: "5.0.0",
      failureOutput: "TypeError: ReactDOM.render is not a function",
      candidateFiles: ["src/index.tsx"],
    });

    assert.equal(result.applied, false);
  });
});

test("codemods: wrong major version range does not apply", async () => {
  await withProject({ "src/index.tsx": reactApp }, async (dir) => {
    const result = await tryBuiltinCodemods({
      cwd: dir,
      packageName: "react-dom",
      fromVersion: "17.0.2",
      toVersion: "18.3.1",
      failureOutput: "TypeError: ReactDOM.render is not a function",
      candidateFiles: ["src/index.tsx"],
    });

    assert.equal(result.applied, false);
  });
});

test("codemods: Vue 2→3 new Vue() is rewritten to createApp()", async () => {
  const vueApp = `import Vue from 'vue';
import App from './App.vue';

new Vue({
  render: h => h(App),
}).$mount('#app');
`;
  await withProject({ "src/main.js": vueApp }, async (dir) => {
    const result = await tryBuiltinCodemods({
      cwd: dir,
      packageName: "vue",
      fromVersion: "2.7.0",
      toVersion: "3.4.0",
      failureOutput: "TypeError: Vue is not a constructor",
      candidateFiles: ["src/main.js"],
    });

    assert.equal(result.applied, true);
    const fixed = await readFile(join(dir, "src/main.js"), "utf8");
    assert.ok(fixed.includes("createApp("));
    assert.ok(!fixed.includes("new Vue("));
  });
});

test("buildContextKey: identical errors across different paths collide", () => {
  const key1 = buildContextKey(
    "react",
    "18.0.0",
    "19.0.0",
    "TypeError: ReactDOM.render is not a function\n    at /home/alice/project/src/index.tsx:5:3",
  );
  const key2 = buildContextKey(
    "react",
    "18.0.0",
    "19.0.0",
    "TypeError: ReactDOM.render is not a function\n    at /home/bob/other/src/main.tsx:12:7",
  );
  assert.equal(key1, key2);
});

test("buildContextKey: different errors produce different keys", () => {
  const key1 = buildContextKey("react", "18.0.0", "19.0.0", "TypeError: foo is not a function");
  const key2 = buildContextKey("react", "18.0.0", "19.0.0", "TypeError: bar is not a function");
  assert.notEqual(key1, key2);
});

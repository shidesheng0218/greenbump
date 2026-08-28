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

// ── v0.7.0: expanded codemod library ──────────────────────────────────────

test("codemods: express 4→5 app.del() is rewritten to app.delete()", async () => {
  const app = `app.del('/users/:id', handler);\n`;
  await withProject({ "src/app.js": app }, async (dir) => {
    const result = await tryBuiltinCodemods({
      cwd: dir,
      packageName: "express",
      fromVersion: "4.18.0",
      toVersion: "5.0.0",
      failureOutput: "TypeError: app.del is not a function",
      candidateFiles: ["src/app.js"],
    });
    assert.equal(result.applied, true);
    const fixed = await readFile(join(dir, "src/app.js"), "utf8");
    assert.ok(fixed.includes("app.delete("));
    assert.ok(!fixed.includes("app.del("));
  });
});

test("codemods: express res.send(status) is rewritten to res.sendStatus(status)", async () => {
  const app = `res.send(404);\n`;
  await withProject({ "src/app.js": app }, async (dir) => {
    const result = await tryBuiltinCodemods({
      cwd: dir,
      packageName: "express",
      fromVersion: "4.18.0",
      toVersion: "5.0.0",
      failureOutput: "TypeError: res.send(status) is not a function",
      candidateFiles: ["src/app.js"],
    });
    assert.equal(result.applied, true);
    const fixed = await readFile(join(dir, "src/app.js"), "utf8");
    assert.ok(fixed.includes("res.sendStatus(404)"));
  });
});

test("codemods: zod error.errors is rewritten to error.issues", async () => {
  const src = `if (!result.success) console.log(result.error.errors);\n`;
  await withProject({ "src/validate.ts": src }, async (dir) => {
    const result = await tryBuiltinCodemods({
      cwd: dir,
      packageName: "zod",
      fromVersion: "3.23.0",
      toVersion: "4.0.0",
      failureOutput: "TypeError: error.errors is not a function",
      candidateFiles: ["src/validate.ts"],
    });
    assert.equal(result.applied, true);
    const fixed = await readFile(join(dir, "src/validate.ts"), "utf8");
    assert.ok(fixed.includes(".error.issues"));
  });
});

test("codemods: zod z.string().email() is rewritten to z.email()", async () => {
  const src = `const schema = z.string().email();\n`;
  await withProject({ "src/schema.ts": src }, async (dir) => {
    const result = await tryBuiltinCodemods({
      cwd: dir,
      packageName: "zod",
      fromVersion: "3.23.0",
      toVersion: "4.0.0",
      failureOutput: "deprecated z.string().email() usage",
      candidateFiles: ["src/schema.ts"],
    });
    assert.equal(result.applied, true);
    const fixed = await readFile(join(dir, "src/schema.ts"), "utf8");
    assert.ok(fixed.includes("z.email()"));
  });
});

test("codemods: util.isArray() is rewritten to Array.isArray() (package '*')", async () => {
  const src = `if (util.isArray(x)) return x;\n`;
  await withProject({ "src/util.js": src }, async (dir) => {
    const result = await tryBuiltinCodemods({
      cwd: dir,
      packageName: "node",
      fromVersion: "20.0.0",
      toVersion: "22.0.0",
      failureOutput: "TypeError: util.isArray is not a function",
      candidateFiles: ["src/util.js"],
    });
    assert.equal(result.applied, true);
    const fixed = await readFile(join(dir, "src/util.js"), "utf8");
    assert.ok(fixed.includes("Array.isArray(x)"));
  });
});

test("codemods: lodash _.pluck() is rewritten to _.map()", async () => {
  const src = `const names = _.pluck(users, 'name');\n`;
  await withProject({ "src/users.js": src }, async (dir) => {
    const result = await tryBuiltinCodemods({
      cwd: dir,
      packageName: "lodash",
      fromVersion: "3.10.0",
      toVersion: "4.0.0",
      failureOutput: "TypeError: _.pluck is not a function",
      candidateFiles: ["src/users.js"],
    });
    assert.equal(result.applied, true);
    const fixed = await readFile(join(dir, "src/users.js"), "utf8");
    assert.ok(fixed.includes("_.map(users, 'name')"));
  });
});

test("codemods: react-router-dom 5→6 <Switch> is rewritten to <Routes>", async () => {
  const src = `<Switch>\n  <Route path="/" />\n</Switch>\n`;
  await withProject({ "src/App.jsx": src }, async (dir) => {
    const result = await tryBuiltinCodemods({
      cwd: dir,
      packageName: "react-router-dom",
      fromVersion: "5.3.0",
      toVersion: "6.0.0",
      failureOutput: "Switch is not exported from react-router-dom",
      candidateFiles: ["src/App.jsx"],
    });
    assert.equal(result.applied, true);
    const fixed = await readFile(join(dir, "src/App.jsx"), "utf8");
    assert.ok(fixed.includes("<Routes>"));
  });
});

test("codemods: mongoose doc.remove() is rewritten to doc.deleteOne()", async () => {
  const src = `await user.remove();\n`;
  await withProject({ "src/user.js": src }, async (dir) => {
    const result = await tryBuiltinCodemods({
      cwd: dir,
      packageName: "mongoose",
      fromVersion: "6.5.0",
      toVersion: "7.0.0",
      failureOutput: "TypeError: user.remove is not a function",
      candidateFiles: ["src/user.js"],
    });
    assert.equal(result.applied, true);
    const fixed = await readFile(join(dir, "src/user.js"), "utf8");
    assert.ok(fixed.includes(".deleteOne()"));
  });
});

test("codemods: versionRange with toMajor covers a multi-major bump (mongoose 6→8)", async () => {
  const src = `await user.remove();\n`;
  await withProject({ "src/user.js": src }, async (dir) => {
    const result = await tryBuiltinCodemods({
      cwd: dir,
      packageName: "mongoose",
      fromVersion: "6.5.0",
      toVersion: "8.0.0",
      failureOutput: "TypeError: user.remove is not a function",
      candidateFiles: ["src/user.js"],
    });
    assert.equal(result.applied, true);
  });
});

test("codemods: ESLint 9 guidance creates a flat config when missing", async () => {
  const src = `module.exports = {};\n`;
  await withProject({ ".eslintrc.js": src }, async (dir) => {
    const result = await tryBuiltinCodemods({
      cwd: dir,
      packageName: "eslint",
      fromVersion: "8.57.0",
      toVersion: "9.0.0",
      failureOutput: "ESLint configuration in .eslintrc.js is invalid",
      candidateFiles: [".eslintrc.js"],
    });
    assert.equal(result.applied, true);
    assert.ok(result.editedFiles.includes("eslint.config.js"));
    const created = await readFile(join(dir, "eslint.config.js"), "utf8");
    assert.ok(created.includes("export default"));
  });
});

test("codemods: ESLint 9 guidance skips creating flat config if it already exists", async () => {
  await withProject(
    { "eslint.config.js": "export default [{ custom: true }];\n" },
    async (dir) => {
      const result = await tryBuiltinCodemods({
        cwd: dir,
        packageName: "eslint",
        fromVersion: "8.57.0",
        toVersion: "9.0.0",
        failureOutput: "ESLint configuration in .eslintrc.js is invalid",
        candidateFiles: [],
      });
      assert.equal(result.applied, false);
      const untouched = await readFile(join(dir, "eslint.config.js"), "utf8");
      assert.ok(untouched.includes("custom: true"));
    },
  );
});

test("codemods: pure guidance codemod (axios) surfaces advice without marking applied", async () => {
  await withProject({}, async (dir) => {
    const result = await tryBuiltinCodemods({
      cwd: dir,
      packageName: "axios",
      fromVersion: "0.27.0",
      toVersion: "1.0.0",
      failureOutput: "TypeError: axios.defaults.baseURL is undefined",
      candidateFiles: [],
    });
    assert.equal(result.applied, false);
    assert.equal(result.editedFiles.length, 0);
    assert.ok(result.advice && result.advice.length > 0);
    assert.match(result.advice![0], /Axios 1\.x/);
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

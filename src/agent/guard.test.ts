import { test } from "node:test";
import assert from "node:assert/strict";
import { isSensitivePath, isProtectedWrite } from "./guard.js";

test("isSensitivePath: blocks real env/secret files", () => {
  for (const p of [
    ".env",
    ".env.local",
    ".env.production",
    "config/.env",
    "server.pem",
    "certs/private.key",
    "keystore.p12",
    "id_rsa",
    "id_ed25519.pub",
    ".npmrc",
    ".netrc",
    "credentials.json",
    "secrets.yaml",
  ]) {
    assert.equal(isSensitivePath(p), true, p);
  }
});

test("isSensitivePath: allows env templates and normal source files", () => {
  for (const p of [
    ".env.example",
    ".env.sample",
    ".env.template",
    "src/app.ts",
    "environment.ts",
    "README.md",
    "public.key.pem.txt",
  ]) {
    assert.equal(isSensitivePath(p), false, p);
  }
});

test("isProtectedWrite: blocks manifests and lockfiles by basename, at any depth", () => {
  const manifests = ["package.json"];
  const locks = ["package-lock.json", "yarn.lock"];
  assert.equal(isProtectedWrite("package.json", manifests, locks), true);
  assert.equal(isProtectedWrite("packages/foo/package.json", manifests, locks), true);
  assert.equal(isProtectedWrite("yarn.lock", manifests, locks), true);
  assert.equal(isProtectedWrite("src/app.ts", manifests, locks), false);
});

test("isProtectedWrite: also blocks secrets files on write", () => {
  assert.equal(isProtectedWrite(".env", ["package.json"], []), true);
  assert.equal(isProtectedWrite(".env.example", ["package.json"], []), false);
});

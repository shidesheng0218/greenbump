import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYarnOutdated } from "./yarn.js";
import { parseGoListOutdated } from "./go.js";
import { parseComposerOutdated } from "./composer.js";
import { parsePubOutdated } from "./pub.js";
import { parseNugetOutdated } from "./nuget.js";
import { parseCargoToml } from "./cargo.js";
import { parsePomXml } from "./maven.js";
import { parseGradleBuildFile } from "./gradle.js";
import { parseBundlerOutdated } from "./bundler.js";
import { parsePoetryOutdated } from "./poetry.js";
import { parseCocoapodsOutdated } from "./cocoapods.js";
import { parseMixOutdated } from "./mix.js";
import { parseConanfileTxt } from "./conan.js";
import { parseNpmOutdated } from "./npm.js";
import { parsePnpmOutdated } from "./pnpm.js";
import { parsePipOutdated } from "./pip.js";
import { parseUvOutdated } from "./uv.js";
import { parsePipenvOutdated } from "./pipenv.js";
import { parseElmDirectDeps } from "./elm.js";
import { parsePackageResolved, parsePackageSwiftDeps } from "./swiftpm.js";

test("yarn: parses the ndjson table row, skips non-table lines", () => {
  const stdout = [
    JSON.stringify({ type: "info", data: "unrelated" }),
    JSON.stringify({
      type: "table",
      data: {
        head: ["Package", "Current", "Wanted", "Latest", "Package Type", "URL"],
        body: [
          ["lodash", "4.17.20", "4.17.21", "4.17.21", "dependencies", ""],
          ["left-pad", "1.0.0", "1.0.0", "1.0.0", "dependencies", ""],
        ],
      },
    }),
  ].join("\n");
  const result = parseYarnOutdated(stdout);
  assert.deepEqual(result, [{ name: "lodash", current: "4.17.20", wanted: "", latest: "4.17.21" }]);
});

test("go: parses ndjson module stream, skips main/indirect/no-update", () => {
  const stdout = [
    JSON.stringify({ Path: "example.com/app", Main: true }),
    JSON.stringify({ Path: "example.com/indirect", Version: "v1.0.0", Indirect: true, Update: { Version: "v1.1.0" } }),
    JSON.stringify({ Path: "example.com/nodiff", Version: "v1.0.0", Update: { Version: "v1.0.0" } }),
    JSON.stringify({ Path: "example.com/direct", Version: "v1.0.0", Update: { Version: "v1.2.0" } }),
  ].join("\n");
  const result = parseGoListOutdated(stdout);
  assert.deepEqual(result, [{ name: "example.com/direct", current: "v1.0.0", wanted: "", latest: "v1.2.0" }]);
});

test("composer: parses `composer outdated --format json`", () => {
  const stdout = JSON.stringify({
    installed: [
      { name: "monolog/monolog", version: "2.0.0", latest: "3.5.0" },
      { name: "psr/log", version: "1.1.4", latest: "1.1.4" },
    ],
  });
  const result = parseComposerOutdated(stdout);
  assert.deepEqual(result, [{ name: "monolog/monolog", current: "2.0.0", wanted: "", latest: "3.5.0" }]);
});

test("pub: parses `dart pub outdated --json`", () => {
  const stdout = JSON.stringify({
    packages: [
      { package: "http", current: { version: "0.13.0" }, latest: { version: "1.2.0" } },
      { package: "path", current: { version: "1.8.0" }, latest: { version: "1.8.0" } },
    ],
  });
  const result = parsePubOutdated(stdout);
  assert.deepEqual(result, [{ name: "http", current: "0.13.0", wanted: "", latest: "1.2.0" }]);
});

test("nuget: parses `dotnet list package --outdated` table", () => {
  const stdout = [
    "Project 'App' has the following updates to its packages",
    "   [net8.0]:",
    "   Top-level Package      Requested   Resolved   Latest",
    "   > Newtonsoft.Json      13.0.1      13.0.1     13.0.3",
  ].join("\n");
  const result = parseNugetOutdated(stdout);
  assert.deepEqual(result, [{ name: "Newtonsoft.Json", current: "13.0.1", wanted: "13.0.1", latest: "13.0.3" }]);
});

test("cargo: parses [dependencies] section of Cargo.toml", () => {
  const raw = [
    "[package]",
    'name = "app"',
    "",
    "[dependencies]",
    'serde = "1.0"',
    'tokio = "^1.28"',
    "",
    "[dev-dependencies]",
    'criterion = "0.5"',
  ].join("\n");
  const result = parseCargoToml(raw);
  assert.deepEqual([...result.entries()], [["serde", "1.0"], ["tokio", "1.28"]]);
});

test("maven: parses <dependency> blocks from pom.xml", () => {
  const raw = `<project>
  <dependencies>
    <dependency>
      <groupId>org.apache.commons</groupId>
      <artifactId>commons-lang3</artifactId>
      <version>3.12.0</version>
    </dependency>
  </dependencies>
</project>`;
  const result = parsePomXml(raw);
  assert.deepEqual(result, [{ name: "org.apache.commons:commons-lang3", version: "3.12.0" }]);
});

test("gradle: parses implementation(...) dependency declarations", () => {
  const raw = `dependencies {
    implementation("com.google.guava:guava:31.1-jre")
    testImplementation 'junit:junit:4.13.2'
}`;
  const result = parseGradleBuildFile(raw);
  assert.deepEqual(result, [
    { group: "com.google.guava", artifact: "guava", version: "31.1-jre" },
    { group: "junit", artifact: "junit", version: "4.13.2" },
  ]);
});

test("bundler: parses `bundle outdated` gem lines", () => {
  const stdout = [
    "Fetching gem metadata...",
    "Gem   Current   Latest   Requested   Groups",
    "* rails (newest 7.1.2, installed 7.0.4, requested ~> 7.0) in groups \"default\"",
    "* rake (newest 13.1.0, installed 13.1.0)",
  ].join("\n");
  const result = parseBundlerOutdated(stdout);
  assert.deepEqual(result, [{ name: "rails", current: "7.0.4", wanted: "", latest: "7.1.2" }]);
});

test("poetry: parses `poetry show -o` plain-text table", () => {
  const stdout = ["requests   2.28.0   2.31.0   HTTP library", "click      8.1.3    8.1.3    CLI toolkit"].join("\n");
  const result = parsePoetryOutdated(stdout);
  assert.deepEqual(result, [{ name: "requests", current: "2.28.0", wanted: "", latest: "2.31.0" }]);
});

test("cocoapods: parses `pod outdated` list lines, using the (latest version) suffix", () => {
  // The value after "->" is only what the Podfile's constraint resolves
  // to (often == current for an exact pin, as with AFNetworking below) —
  // the true latest is only in the "(latest version X)" suffix.
  const stdout = [
    "The following pod updates are available:",
    "- AFNetworking 3.2.1 -> 3.2.1 (latest version 4.0.1)",
    "- Alamofire 5.6.0 -> 5.6.0 (latest version 5.6.0)",
  ].join("\n");
  const result = parseCocoapodsOutdated(stdout);
  assert.deepEqual(result, [{ name: "AFNetworking", current: "3.2.1", wanted: "", latest: "4.0.1" }]);
});

test("mix: parses `mix hex.outdated` table rows, including the Only column", () => {
  // Real `mix hex.outdated` output always has the "Only" column; it's blank
  // for deps with no `only:` restriction (e.g. jason below).
  const stdout = [
    "Dependency  Only  Current  Latest  Status               ",
    "ex_doc      dev   0.29.0   0.40.3  Update not possible  ",
    "jason             1.2.0    1.4.5   Update not possible  ",
    "",
    "Run `mix hex.outdated APP` to see requirements for a specific dependency.",
  ].join("\n");
  const result = parseMixOutdated(stdout);
  assert.deepEqual(result, [
    { name: "ex_doc", current: "0.29.0", wanted: "", latest: "0.40.3" },
    { name: "jason", current: "1.2.0", wanted: "", latest: "1.4.5" },
  ]);
});

test("conan: parses [requires] section of conanfile.txt", () => {
  const raw = ["[requires]", "zlib/1.2.13", "boost/1.83.0", "", "[generators]", "CMakeDeps"].join("\n");
  const result = parseConanfileTxt(raw);
  assert.deepEqual(result, [
    { name: "zlib", version: "1.2.13" },
    { name: "boost", version: "1.83.0" },
  ]);
});

test("npm: parses `npm outdated --json` output, dropping entries already at latest", () => {
  const data = {
    lodash: { current: "4.17.20", latest: "4.17.21" },
    axios: { current: "1.3.0", latest: "1.3.0" },
  };
  const result = parseNpmOutdated(data);
  assert.deepEqual(result, [{ name: "lodash", current: "4.17.20", wanted: "", latest: "4.17.21" }]);
});

test("npm: null data (non-JSON stdout) yields empty result", () => {
  assert.deepEqual(parseNpmOutdated(null), []);
});

test("pnpm: parses `pnpm outdated --format json`, tolerating missing current/latest", () => {
  const data = {
    lodash: { current: "4.17.20", latest: "4.17.21" },
    // pnpm can omit fields for workspace-linked packages; guard against undefined.
    weird: {},
  };
  const result = parsePnpmOutdated(data);
  assert.deepEqual(result, [{ name: "lodash", current: "4.17.20", wanted: "", latest: "4.17.21" }]);
});

test("pnpm: null data yields empty result", () => {
  assert.deepEqual(parsePnpmOutdated(null), []);
});

test("pip: parses `pip list --outdated --format json`", () => {
  const data = [
    { name: "requests", version: "2.28.0", latest_version: "2.31.0" },
    { name: "flask", version: "2.0.0", latest_version: "2.3.3" },
  ];
  const result = parsePipOutdated(data);
  assert.deepEqual(result, [
    { name: "requests", current: "2.28.0", wanted: "", latest: "2.31.0" },
    { name: "flask", current: "2.0.0", wanted: "", latest: "2.3.3" },
  ]);
});

test("pip: null data yields empty result", () => {
  assert.deepEqual(parsePipOutdated(null), []);
});

test("uv: parses `uv pip list --outdated --format json` (same shape as pip)", () => {
  const data = [{ name: "requests", version: "2.28.0", latest_version: "2.31.0" }];
  const result = parseUvOutdated(data);
  assert.deepEqual(result, [{ name: "requests", current: "2.28.0", wanted: "", latest: "2.31.0" }]);
});

test("uv: null data yields empty result", () => {
  assert.deepEqual(parseUvOutdated(null), []);
});

test("pipenv: parses `pipenv run pip list --outdated --format json`", () => {
  const data = [{ name: "django", version: "4.0.0", latest_version: "4.2.5" }];
  const result = parsePipenvOutdated(data);
  assert.deepEqual(result, [{ name: "django", current: "4.0.0", wanted: "", latest: "4.2.5" }]);
});

test("pipenv: null data yields empty result", () => {
  assert.deepEqual(parsePipenvOutdated(null), []);
});

test("elm: extracts direct dependencies from elm.json, ignoring indirect deps", () => {
  const json = {
    dependencies: {
      direct: { "elm/core": "1.0.5", "elm/json": "1.1.3" },
      indirect: { "elm/bytes": "1.0.8" },
    },
  };
  assert.deepEqual(parseElmDirectDeps(json), { "elm/core": "1.0.5", "elm/json": "1.1.3" });
});

test("elm: missing dependencies field yields empty object", () => {
  assert.deepEqual(parseElmDirectDeps({}), {});
});

test("swiftpm: parses Package.resolved pins into a name-to-version map", () => {
  const raw = JSON.stringify({
    pins: [
      { identity: "swift-log", state: { version: "1.5.3" } },
      { identity: "no-version-pin", state: {} },
    ],
  });
  assert.deepEqual(parsePackageResolved(raw), { "swift-log": "1.5.3" });
});

test("swiftpm: extracts .package(url:, from:) declarations and joins with resolved versions", () => {
  const manifest = [
    ".package(url: \"https://github.com/apple/swift-log.git\", from: \"1.4.0\")",
    ".package(url: \"https://github.com/apple/swift-nio.git\", from: \"2.0.0\")",
  ].join("\n");
  const resolved = { "swift-log": "1.5.3" }; // swift-nio has no resolved pin (e.g. not yet fetched)
  const result = parsePackageSwiftDeps(manifest, resolved);
  assert.deepEqual(result, [
    { name: "swift-log", current: "1.5.3", url: "https://github.com/apple/swift-log.git" },
  ]);
});

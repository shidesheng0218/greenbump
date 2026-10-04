const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const rrd = require("react-router-dom");
const src = readFileSync(join(__dirname, "src", "App.jsx"), "utf8");
const m = src.match(/<(Switch|Routes)>/);
assert.ok(m, "App.jsx should wrap routes in a router container (src/App.jsx:5:7)");
assert.equal(
  typeof rrd[m[1]],
  "function",
  `${m[1]} is not exported by the installed react-router-dom (used in src/App.jsx:5:7)`,
);
console.log("router OK");

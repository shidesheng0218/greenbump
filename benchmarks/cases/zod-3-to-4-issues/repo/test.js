const assert = require("node:assert/strict");
const { firstIssue } = require("./src/validate.js");
const msg = firstIssue({ name: 1, age: "x" });
assert.equal(typeof msg, "string");
console.log("validation OK");

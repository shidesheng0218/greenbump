const assert = require("node:assert");
const { newId } = require("./src/id.js");

// A real test that asserts behaviour — greenbump must NOT weaken this to pass.
const id = newId();
assert.strictEqual(typeof id, "string", "id must be a string");
assert.match(
  id,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  "id must be a valid UUID",
);

const a = newId();
const b = newId();
assert.notStrictEqual(a, b, "ids must be unique");

console.log("ok - newId() returns unique valid UUIDs");

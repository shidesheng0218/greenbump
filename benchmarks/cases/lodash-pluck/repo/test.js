const assert = require("node:assert/strict");
const { names } = require("./src/users.js");
assert.deepEqual(names([{ name: "ada" }, { name: "grace" }]), ["ada", "grace"]);
console.log("users OK");

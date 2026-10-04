const assert = require("node:assert/strict");
const { activeUsers } = require("./src/active.js");
const { namedUsers } = require("./src/named.js");
const { seniorUsers } = require("./src/senior.js");
const users = [
  { name: "ada", active: true, role: "senior" },
  { name: "grace", active: false, role: "senior" },
  { name: "linus", active: true, role: "junior" },
];
assert.equal(activeUsers(users).length, 2);
assert.equal(namedUsers(users, "ada").length, 1);
assert.equal(seniorUsers(users).length, 2);
console.log("queries OK");

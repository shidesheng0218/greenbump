const assert = require("node:assert/strict");
const { pairs } = require("./src/calc.js");
assert.deepEqual(pairs([1, 2, 3, 4]), [[1, 2], [3, 4]]);
console.log("calc OK");

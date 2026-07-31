// Uses the uuid v3 API. This BREAKS on uuid v7+:
//   - the `uuid/v4` subpath import was removed
//   - the correct modern usage is `const { v4 } = require('uuid')`
// greenbump's fix agent should adapt this call site.
const uuidv4 = require("uuid/v4");

function newId() {
  return uuidv4();
}

module.exports = { newId };

// Breaks on uuid v7+: the `uuid/v4` subpath import was removed.
// Note the different local name (`generateId`) from models/todo.js —
// a fix agent that patches one call site and re-runs tests will only
// see this one break AFTER fixing todo.js, one at a time.
const generateId = require("uuid/v4");

function createUser(name) {
  return { id: generateId(), name };
}

module.exports = { createUser };

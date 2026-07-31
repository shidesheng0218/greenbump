// Breaks on uuid v7+: the `uuid/v4` subpath import was removed.
const uuidv4 = require("uuid/v4");

function createTodo(title) {
  return { id: uuidv4(), title, done: false };
}

module.exports = { createTodo };

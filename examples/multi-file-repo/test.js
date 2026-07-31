const assert = require("node:assert");
const { createTodo } = require("./models/todo.js");
const { createUser } = require("./models/user.js");
const { startSession } = require("./services/session.js");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const todo = createTodo("write tests");
assert.match(todo.id, UUID_RE, "todo id must be a valid UUID");
assert.strictEqual(todo.title, "write tests");

const user = createUser("ada");
assert.match(user.id, UUID_RE, "user id must be a valid UUID");

const session = startSession(user.id);
assert.match(session.token, UUID_RE, "session token must be a valid UUID");
assert.strictEqual(session.userId, user.id);

console.log("ok - todo, user, and session all generate valid UUIDs");

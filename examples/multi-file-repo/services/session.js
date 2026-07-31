// Breaks on uuid v7+: the `uuid/v4` subpath import was removed.
// Yet another local name (`newUUID`) — third independent call site.
const newUUID = require("uuid/v4");

function startSession(userId) {
  return { token: newUUID(), userId, startedAt: Date.now() };
}

module.exports = { startSession };

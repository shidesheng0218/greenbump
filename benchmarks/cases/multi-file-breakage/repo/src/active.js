const _ = require("lodash");
function activeUsers(users) {
  return _.where(users, { active: true });
}
module.exports = { activeUsers };

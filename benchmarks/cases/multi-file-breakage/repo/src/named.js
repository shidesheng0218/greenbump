const _ = require("lodash");
function namedUsers(users, name) {
  return _.where(users, { name });
}
module.exports = { namedUsers };

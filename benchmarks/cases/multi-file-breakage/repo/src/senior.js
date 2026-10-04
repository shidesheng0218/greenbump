const _ = require("lodash");
function seniorUsers(users) {
  return _.where(users, { role: "senior" });
}
module.exports = { seniorUsers };

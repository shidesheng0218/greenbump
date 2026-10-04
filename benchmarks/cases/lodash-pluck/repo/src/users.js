const _ = require("lodash");
function names(users) {
  return _.pluck(users, "name");
}
module.exports = { names };

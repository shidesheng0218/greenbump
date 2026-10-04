const _ = require("lodash");
function pairs(list) {
  return _.chunk(list, 2);
}
module.exports = { pairs };

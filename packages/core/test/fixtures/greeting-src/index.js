"use strict";
const { format } = require("./lib/format.js");

module.exports.greet = function greet(name) {
  return format("Hello", name);
};

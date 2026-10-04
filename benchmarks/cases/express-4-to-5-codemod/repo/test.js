const express = require("express");
const { registerRoutes } = require("./src/routes.js");
const app = express();
registerRoutes(app);
console.log("routes registered OK");

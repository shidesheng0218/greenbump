function registerRoutes(app) {
  app.del("/old-endpoint", (req, res) => res.json({ ok: true }));
}
module.exports = { registerRoutes };

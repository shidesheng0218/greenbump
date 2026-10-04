function createApp(express) {
  const app = express();
  app.get("/missing", (req, res) => {
    res.send(404);
  });
  return app;
}
module.exports = { createApp };

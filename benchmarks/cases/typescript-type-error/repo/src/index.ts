import express from "express";

const app = express();
app.del("/old-endpoint", (req, res) => {
  res.json({ ok: true });
});

export default app;

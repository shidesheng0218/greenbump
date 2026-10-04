const express = require("express");
const { createApp } = require("./src/server.js");
const app = createApp(express);
const srv = app.listen(0, async () => {
  const port = srv.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/missing`);
  srv.close();
  if (r.status !== 404) {
    console.error(
      `FAIL src/server.js:4:9 — res.send(404) returned status ${r.status}, expected 404 (Express 5 removed res.send(status))`,
    );
    process.exit(1);
  }
  console.log("status endpoint OK");
});

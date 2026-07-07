const express = require("express");
const app = express();
app.get("/api/test", (req, res) => res.json({ ok: true, time: Date.now() }));
app.get("*", (req, res) => res.send("Hello Vercel!"));
module.exports = app;
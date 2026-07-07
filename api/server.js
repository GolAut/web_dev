
const express = require("express");
const { kv } = require("@vercel/kv");
const app = express();

app.get("/api/ping", async (req, res) => {
  try {
    await kv.set("ping", "pong");
    var val = await kv.get("ping");
    res.json({ ok: true, val });
  } catch(e) {
    res.json({ error: e.message, code: e.code, cause: e.cause?.message });
  }
});

app.get("/api/debug", async (req, res) => {
  try {
    var test = await kv.get("ping");
    res.json({ test, env_url: !!process.env.KV_REST_API_URL, env_token: !!process.env.KV_REST_API_TOKEN, env_kv_url: !!process.env.KV_URL });
  } catch(e) {
    res.json({ error: e.message, code: e.code, cause: e.cause?.message });
  }
});

module.exports = app;


const express = require("express");
const crypto = require("crypto");
const { kv } = require("@vercel/kv");

const app = express();
app.use(express.json({ limit: "10mb" }));

const ADMIN_TOKEN = "tp-admin-" + crypto.randomBytes(16).toString("hex");

// === Helpers ===
function hashPw(pw) { return crypto.createHash("sha256").update(pw + "tp-salt-2024").digest("hex"); }
function k(key) { return "tp:" + key; }

function requireAdmin(req, res, next) {
  if (req.headers.authorization === ADMIN_TOKEN) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// === Init admin (deferred, runs on first request) ===
var initDone = false;
async function ensureInit() {
  if (initDone) return;
  try {
    var admin = await kv.hgetall(k("admin:admin"));
    if (!admin || !admin.username) {
      await kv.hset(k("admin:admin"), {
        username: "admin",
        password_hash: hashPw("admin123"),
        created_at: new Date().toISOString(),
        total_logins: "0"
      });
    }
    initDone = true;
  } catch(e) {
    console.error("KV init error:", e.message);
    throw e;
  }
}

// === AUTH ===
app.post("/api/login", async (req, res) => { try { await ensureInit(); } catch(e) { return res.status(500).json({ error: "KV connection failed" }); }
  try {
    const { username, password } = req.body;
    const admin = await kv.hgetall(k("admin:" + username));
    if (!admin || !admin.username || hashPw(password) !== admin.password_hash) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    var logins = parseInt(admin.total_logins || 0) + 1;
    await kv.hset(k("admin:" + username), { total_logins: String(logins), last_login: new Date().toISOString() });
    var logEntry = {
      username, time: new Date().toISOString(),
      ip: req.headers["x-forwarded-for"] || "local",
      agent: (req.headers["user-agent"] || "").substring(0, 200)
    };
    await kv.lpush(k("logs:" + username), JSON.stringify(logEntry));
    res.json({ token: ADMIN_TOKEN, username });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// === PLANS ===
app.get("/api/plans", requireAdmin, async (req, res) => {
  try {
    var ids = await kv.smembers(k("plan_ids"));
    var result = [];
    for (var id of (ids || [])) {
      var p = await kv.hgetall(k("plan:" + id));
      if (p && p.id) {
        result.push({ id: p.id, title: p.title, original_name: p.original_name, access_key: p.access_key, created_at: p.created_at, views: parseInt(p.views || 0), share_url: "/view/" + p.id + "?key=" + p.access_key });
      }
    }
    result.sort((a,b) => parseInt(b.id) - parseInt(a.id));
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/plans", requireAdmin, async (req, res) => {
  try {
    const { title, content, filename } = req.body;
    if (!content) return res.status(400).json({ error: "Missing HTML content" });
    var nextId = String((await kv.incr(k("next_plan_id"))));
    var plan = {
      id: nextId,
      title: title || (filename || "untitled").replace(/\.html?$/, ""),
      original_name: filename || "travel-plan.html",
      access_key: crypto.randomBytes(4).toString("hex"),
      created_at: new Date().toISOString(),
      views: "0",
      file_content: content
    };
    await kv.hset(k("plan:" + nextId), plan);
    await kv.sadd(k("plan_ids"), nextId);
    res.json({ id: plan.id, title: plan.title, original_name: plan.original_name, access_key: plan.access_key, created_at: plan.created_at, views: 0, share_url: "/view/" + plan.id + "?key=" + plan.access_key });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/plans/:id", requireAdmin, async (req, res) => {
  try {
    var id = req.params.id;
    var plan = await kv.hgetall(k("plan:" + id));
    if (!plan || !plan.id) return res.status(404).json({ error: "Plan not found" });
    await kv.del(k("plan:" + id));
    await kv.srem(k("plan_ids"), id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/plans/:id/regenerate-key", requireAdmin, async (req, res) => {
  try {
    var id = req.params.id;
    var plan = await kv.hgetall(k("plan:" + id));
    if (!plan || !plan.id) return res.status(404).json({ error: "Plan not found" });
    var newKey = crypto.randomBytes(4).toString("hex");
    await kv.hset(k("plan:" + id), { access_key: newKey });
    res.json({ access_key: newKey, share_url: "/view/" + id + "?key=" + newKey });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// === USER ===
app.get("/api/user/info", requireAdmin, async (req, res) => {
  try {
    var username = req.query.username || "admin";
    var admin = await kv.hgetall(k("admin:" + username));
    if (!admin || !admin.username) return res.status(404).json({ error: "User not found" });
    var rawLogs = await kv.lrange(k("logs:" + username), 0, 49);
    var history = (rawLogs || []).map(l => { try { return JSON.parse(l); } catch(e) { return l; } });
    res.json({
      username: admin.username,
      total_logins: parseInt(admin.total_logins || 0),
      last_login: admin.last_login || null,
      created_at: admin.created_at || null,
      login_history: history
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/user/change-password", requireAdmin, async (req, res) => {
  try {
    const { old_password, new_password } = req.body;
    if (!old_password || !new_password || new_password.length < 4)
      return res.status(400).json({ error: "Invalid password" });
    var admin = await kv.hgetall(k("admin:admin"));
    if (!admin || hashPw(old_password) !== admin.password_hash)
      return res.status(401).json({ error: "Old password incorrect" });
    await kv.hset(k("admin:admin"), { password_hash: hashPw(new_password) });
    res.json({ success: true, message: "Password changed" });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// === VIEW ===
app.get("/api/plan-content/:id", async (req, res) => {
  try {
    var id = req.params.id;
    var plan = await kv.hgetall(k("plan:" + id));
    if (!plan || !plan.id) return res.status(404).json({ error: "Plan not found" });
    if (req.query.key !== plan.access_key && req.headers.authorization !== ADMIN_TOKEN)
      return res.status(403).json({ error: "Invalid access key" });
    var views = parseInt(plan.views || 0) + 1;
    await kv.hset(k("plan:" + id), { views: String(views) });
    var html = Buffer.from(plan.file_content, "base64").toString("utf-8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/plans/:id/download", async (req, res) => {
  try {
    var id = req.params.id;
    var plan = await kv.hgetall(k("plan:" + id));
    if (!plan || !plan.id) return res.status(404).json({ error: "Plan not found" });
    if (req.query.key !== plan.access_key && req.headers.authorization !== ADMIN_TOKEN)
      return res.status(403).json({ error: "Invalid access key" });
    var html = Buffer.from(plan.file_content, "base64").toString("utf-8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"" + encodeURIComponent(plan.original_name || "plan.html") + "\"");
    res.send(html);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// === Static Routes ===
app.get("/view/:id", (req, res) => {
  var qs = "?id=" + req.params.id;
  if (req.query.key) qs += "&key=" + encodeURIComponent(req.query.key);
  res.redirect("/viewer.html" + qs);
});
app.get("/admin", (req, res) => res.redirect("/index.html"));
app.get("/", (req, res) => res.redirect("/index.html"));

// === Debug ===
app.get("/api/debug", async (req, res) => {
  var ids = await kv.smembers(k("plan_ids"));
  res.json({ plans: (ids || []).length, kv_connected: true });
});

module.exports = app;

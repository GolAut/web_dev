
const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "10mb" }));

const ADMIN_TOKEN = "tp-admin-" + crypto.randomBytes(16).toString("hex");
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// === KV Helpers (raw fetch) ===
function k(key) { return "tp:" + key; }

async function kv_get(key) {
  var resp = await fetch(KV_URL + "/get/" + key, {
    headers: { Authorization: "Bearer " + KV_TOKEN }
  });
  if (!resp.ok) return null;
  var data = await resp.json();
  return data.result;
}

async function kv_set(key, value) {
  await fetch(KV_URL + "/set/" + key, {
    method: "POST",
    headers: { Authorization: "Bearer " + KV_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ value: typeof value === "string" ? value : JSON.stringify(value) })
  });
}

async function kv_del(key) {
  await fetch(KV_URL + "/del/" + key, {
    method: "POST",
    headers: { Authorization: "Bearer " + KV_TOKEN }
  });
}

async function kv_incr(key) {
  var resp = await fetch(KV_URL + "/incr/" + key, {
    method: "POST",
    headers: { Authorization: "Bearer " + KV_TOKEN }
  });
  var data = await resp.json();
  return data.result;
}

async function kv_sadd(key, member) {
  await fetch(KV_URL + "/sadd/" + key + "/" + encodeURIComponent(String(member)), {
    method: "POST",
    headers: { Authorization: "Bearer " + KV_TOKEN }
  });
}

async function kv_smembers(key) {
  var resp = await fetch(KV_URL + "/smembers/" + key, {
    headers: { Authorization: "Bearer " + KV_TOKEN }
  });
  if (!resp.ok) return [];
  var data = await resp.json();
  return data.result || [];
}

async function kv_srem(key, member) {
  await fetch(KV_URL + "/srem/" + key + "/" + encodeURIComponent(String(member)), {
    method: "POST",
    headers: { Authorization: "Bearer " + KV_TOKEN }
  });
}

async function kv_lpush(key, value) {
  await fetch(KV_URL + "/lpush/" + key, {
    method: "POST",
    headers: { Authorization: "Bearer " + KV_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ value: value })
  });
}

async function kv_lrange(key, start, stop) {
  var resp = await fetch(KV_URL + "/lrange/" + key + "/" + start + "/" + stop, {
    headers: { Authorization: "Bearer " + KV_TOKEN }
  });
  if (!resp.ok) return [];
  var data = await resp.json();
  return data.result || [];
}

function hashPw(pw) { return crypto.createHash("sha256").update(pw + "tp-salt-2024").digest("hex"); }
function requireAdmin(req, res, next) {
  if (req.headers.authorization === ADMIN_TOKEN) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// === Init ===
var initDone = false;
async function ensureInit() {
  if (initDone) return;
  var admin = await kv_get("admin:admin");
  if (!admin) {
    await kv_set("admin:admin", {
      username: "admin",
      password_hash: hashPw("admin123"),
      created_at: new Date().toISOString(),
      total_logins: 0
    });
  }
  initDone = true;
}

// === AUTH ===
app.post("/api/login", async (req, res) => {
  try {
    await ensureInit();
    const { username, password } = req.body;
    const admin = await kv_get("admin:" + username);
    if (!admin || hashPw(password) !== admin.password_hash) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    admin.total_logins = (admin.total_logins || 0) + 1;
    admin.last_login = new Date().toISOString();
    await kv_set("admin:" + username, admin);
    await kv_lpush("logs:" + username, JSON.stringify({
      username, time: new Date().toISOString(),
      ip: req.headers["x-forwarded-for"] || "local",
      agent: (req.headers["user-agent"] || "").substring(0, 200)
    }));
    res.json({ token: ADMIN_TOKEN, username });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// === PLANS ===
app.get("/api/plans", requireAdmin, async (req, res) => {
  try {
    var ids = await kv_smembers("plan_ids");
    var result = [];
    for (var id of ids) {
      var p = await kv_get("plan:" + id);
      if (p && p.id) {
        result.push({ id: p.id, title: p.title, original_name: p.original_name, access_key: p.access_key, created_at: p.created_at, views: p.views || 0, share_url: "/view/" + p.id + "?key=" + p.access_key });
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
    var nextId = await kv_incr("next_plan_id");
    var plan = {
      id: nextId,
      title: title || (filename || "untitled").replace(/\.html?$/, ""),
      original_name: filename || "travel-plan.html",
      access_key: crypto.randomBytes(4).toString("hex"),
      created_at: new Date().toISOString(),
      views: 0,
      file_content: content
    };
    await kv_set("plan:" + nextId, plan);
    await kv_sadd("plan_ids", String(nextId));
    res.json({ id: plan.id, title: plan.title, original_name: plan.original_name, access_key: plan.access_key, created_at: plan.created_at, views: 0, share_url: "/view/" + plan.id + "?key=" + plan.access_key });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/plans/:id", requireAdmin, async (req, res) => {
  try {
    var plan = await kv_get("plan:" + req.params.id);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    await kv_del("plan:" + req.params.id);
    await kv_srem("plan_ids", req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/plans/:id/regenerate-key", requireAdmin, async (req, res) => {
  try {
    var plan = await kv_get("plan:" + req.params.id);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    plan.access_key = crypto.randomBytes(4).toString("hex");
    await kv_set("plan:" + req.params.id, plan);
    res.json({ access_key: plan.access_key, share_url: "/view/" + req.params.id + "?key=" + plan.access_key });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// === USER ===
app.get("/api/user/info", requireAdmin, async (req, res) => {
  try {
    var username = req.query.username || "admin";
    var admin = await kv_get("admin:" + username);
    if (!admin) return res.status(404).json({ error: "User not found" });
    var rawLogs = await kv_lrange("logs:" + username, 0, 49);
    var history = rawLogs.map(l => { try { return JSON.parse(l); } catch(e) { return l; } });
    res.json({ username: admin.username, total_logins: admin.total_logins || 0, last_login: admin.last_login || null, created_at: admin.created_at || null, login_history: history });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/user/change-password", requireAdmin, async (req, res) => {
  try {
    const { old_password, new_password } = req.body;
    if (!old_password || !new_password || new_password.length < 4) return res.status(400).json({ error: "Invalid password" });
    var admin = await kv_get("admin:admin");
    if (!admin || hashPw(old_password) !== admin.password_hash) return res.status(401).json({ error: "Old password incorrect" });
    admin.password_hash = hashPw(new_password);
    await kv_set("admin:admin", admin);
    res.json({ success: true, message: "Password changed" });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// === VIEW ===
app.get("/api/plan-content/:id", async (req, res) => {
  try {
    var plan = await kv_get("plan:" + req.params.id);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    if (req.query.key !== plan.access_key && req.headers.authorization !== ADMIN_TOKEN) return res.status(403).json({ error: "Invalid access key" });
    plan.views = (plan.views || 0) + 1;
    await kv_set("plan:" + req.params.id, plan);
    var html = Buffer.from(plan.file_content, "base64").toString("utf-8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/plans/:id/download", async (req, res) => {
  try {
    var plan = await kv_get("plan:" + req.params.id);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    if (req.query.key !== plan.access_key && req.headers.authorization !== ADMIN_TOKEN) return res.status(403).json({ error: "Invalid access key" });
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
  try {
    var ids = await kv_smembers("plan_ids");
    res.json({ plans: ids.length, kv_url: KV_URL ? "set" : "missing", kv_token: KV_TOKEN ? "set" : "missing" });
  } catch(e) { res.json({ error: e.message }); }
});

module.exports = app;

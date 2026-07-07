
const express = require("express");
const crypto = require("crypto");

// === In-Memory Database ===
let admins = [];
let plans = [];
let logs = [];
let nextId = 1;

const ADMIN_TOKEN = "tp-admin-" + crypto.randomBytes(16).toString("hex");

function hashPw(pw) { return crypto.createHash("sha256").update(pw + "tp-salt-2024").digest("hex"); }

// === Express App ===
const app = express();
app.use(express.json({ limit: "10mb" }));

// Multer-like: parse multipart manually (simple base64 approach for Vercel)
// We'll accept JSON with { title, content (base64 HTML) } for uploads
// plus keep the multer version for local dev

// === Auth Middleware ===
function requireAdmin(req, res, next) {
  if (req.headers.authorization === ADMIN_TOKEN) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// === Init ===
(function init() {
  admins.push({
    username: "admin",
    password_hash: hashPw("admin123"),
    created_at: new Date().toISOString(),
    total_logins: 0
  });
})();

// === AUTH ===
app.post("/api/login", (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = admins.find(a => a.username === username);
    if (!admin || hashPw(password) !== admin.password_hash) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    admin.total_logins = (admin.total_logins || 0) + 1;
    admin.last_login = new Date().toISOString();
    logs.push({
      username, time: new Date().toISOString(),
      ip: req.headers["x-forwarded-for"] || "local",
      agent: (req.headers["user-agent"] || "").substring(0, 200)
    });
    res.json({ token: ADMIN_TOKEN, username: admin.username });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// === PLANS ===
app.get("/api/plans", requireAdmin, (req, res) => {
  const result = [...plans].reverse().map(p => ({
    id: p.id, title: p.title, original_name: p.original_name,
    access_key: p.access_key, created_at: p.created_at, views: p.views || 0,
    share_url: "/view/" + p.id + "?key=" + p.access_key
  }));
  res.json(result);
});

// Upload via JSON (base64 content)
app.post("/api/plans", requireAdmin, (req, res) => {
  try {
    const { title, content, filename } = req.body; // content = base64 HTML
    if (!content) return res.status(400).json({ error: "Missing HTML content" });
    
    const plan = {
      id: nextId++,
      title: title || (filename || "untitled").replace(/\.html?$/, ""),
      original_name: filename || "travel-plan.html",
      access_key: crypto.randomBytes(4).toString("hex"),
      created_at: new Date().toISOString(),
      views: 0,
      file_content: content // store base64 directly
    };
    plans.push(plan);
    
    res.json({
      id: plan.id, title: plan.title, original_name: plan.original_name,
      access_key: plan.access_key, created_at: plan.created_at, views: plan.views,
      share_url: "/view/" + plan.id + "?key=" + plan.access_key
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/plans/:id", requireAdmin, (req, res) => {
  const idx = plans.findIndex(p => p.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Plan not found" });
  plans.splice(idx, 1);
  res.json({ success: true });
});

app.post("/api/plans/:id/regenerate-key", requireAdmin, (req, res) => {
  const plan = plans.find(p => p.id === parseInt(req.params.id));
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  plan.access_key = crypto.randomBytes(4).toString("hex");
  res.json({ access_key: plan.access_key, share_url: "/view/" + plan.id + "?key=" + plan.access_key });
});

// === USER ===
app.get("/api/user/info", requireAdmin, (req, res) => {
  const username = req.query.username || "admin";
  const admin = admins.find(a => a.username === username);
  if (!admin) return res.status(404).json({ error: "User not found" });
  const userLogs = logs.filter(l => l.username === username).slice(0, 50);
  res.json({
    username: admin.username,
    total_logins: admin.total_logins || 0,
    last_login: admin.last_login || null,
    created_at: admin.created_at || null,
    login_history: userLogs
  });
});

app.post("/api/user/change-password", requireAdmin, (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password || new_password.length < 4)
    return res.status(400).json({ error: "Invalid password" });
  const admin = admins.find(a => a.username === "admin");
  if (!admin || hashPw(old_password) !== admin.password_hash)
    return res.status(401).json({ error: "Old password incorrect" });
  admin.password_hash = hashPw(new_password);
  res.json({ success: true, message: "Password changed" });
});

// === VIEW ===
app.get("/api/plan-content/:id", (req, res) => {
  const plan = plans.find(p => p.id === parseInt(req.params.id));
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  if (req.query.key !== plan.access_key && req.headers.authorization !== ADMIN_TOKEN)
    return res.status(403).json({ error: "Invalid access key" });
  plan.views = (plan.views || 0) + 1;
  const html = Buffer.from(plan.file_content, "base64").toString("utf-8");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

app.get("/api/plans/:id/download", (req, res) => {
  const plan = plans.find(p => p.id === parseInt(req.params.id));
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  if (req.query.key !== plan.access_key && req.headers.authorization !== ADMIN_TOKEN)
    return res.status(403).json({ error: "Invalid access key" });
  const html = Buffer.from(plan.file_content, "base64").toString("utf-8");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"" + encodeURIComponent(plan.original_name) + "\"");
  res.send(html);
});

// === Static Routes (serve public/ HTML) ===
const fs = require("fs");
const path = require("path");
const publicDir = path.join(__dirname, "public");

app.get("/view/:id", (req, res) => {
  const fp = path.join(publicDir, "viewer.html");
  if (fs.existsSync(fp)) return res.sendFile(fp);
  res.send("Viewer not found");
});

app.get("/admin", (req, res) => {
  const fp = path.join(publicDir, "index.html");
  if (fs.existsSync(fp)) return res.sendFile(fp);
  res.send("Admin not found");
});

app.get("/", (req, res) => res.redirect("/admin"));

// Catch-all
app.get("/api/debug", (req, res) => res.json({ plans: plans.length, admins: admins.length, logs: logs.length }));

module.exports = app;

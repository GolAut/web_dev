
const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
app.use(express.json({ limit: "10mb" }));

const ADMIN_TOKEN = "tp-admin-" + crypto.randomBytes(16).toString("hex");

// PG Pool - uses DATABASE_URL from Vercel env
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

function hashPw(pw) { return crypto.createHash("sha256").update(pw + "tp-salt-2024").digest("hex"); }
function requireAdmin(req, res, next) {
  if (req.headers.authorization === ADMIN_TOKEN) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// === Auto-create tables ===
async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at TEXT,
      total_logins INTEGER DEFAULT 0,
      last_login TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plans (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      original_name TEXT,
      access_key TEXT NOT NULL,
      created_at TEXT,
      views INTEGER DEFAULT 0,
      file_content TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_logs (
      id SERIAL PRIMARY KEY,
      username TEXT,
      time TEXT,
      ip TEXT,
      agent TEXT
    )
  `);
  // Seed admin
  var r = await pool.query("SELECT 1 FROM admins WHERE username = 'admin'");
  if (r.rows.length === 0) {
    await pool.query(
      "INSERT INTO admins (username, password_hash, created_at, total_logins) VALUES ('admin', $1, $2, 0)",
      [hashPw("admin123"), new Date().toISOString()]
    );
  }
}

var tablesReady = null;
function ready() {
  if (!tablesReady) tablesReady = ensureTables();
  return tablesReady;
}

// === AUTH ===
app.post("/api/login", async (req, res) => {
  try {
    await ready();
    const { username, password } = req.body;
    var r = await pool.query("SELECT * FROM admins WHERE username = $1", [username]);
    if (r.rows.length === 0 || hashPw(password) !== r.rows[0].password_hash)
      return res.status(401).json({ error: "Invalid credentials" });
    await pool.query("UPDATE admins SET total_logins = total_logins + 1, last_login = $1 WHERE username = $2",
      [new Date().toISOString(), username]);
    await pool.query("INSERT INTO login_logs (username, time, ip, agent) VALUES ($1,$2,$3,$4)",
      [username, new Date().toISOString(), req.headers["x-forwarded-for"] || "local",
       (req.headers["user-agent"] || "").substring(0, 200)]);
    res.json({ token: ADMIN_TOKEN, username });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// === PLANS ===
app.get("/api/plans", requireAdmin, async (req, res) => {
  try {
    await ready();
    var r = await pool.query("SELECT id, title, original_name, access_key, created_at, views FROM plans ORDER BY id DESC");
    var result = r.rows.map(p => ({
      ...p, share_url: "/view/" + p.id + "?key=" + p.access_key
    }));
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/plans", requireAdmin, async (req, res) => {
  try {
    await ready();
    const { title, content, filename } = req.body;
    if (!content) return res.status(400).json({ error: "Missing HTML content" });
    var key = crypto.randomBytes(4).toString("hex");
    var r = await pool.query(
      "INSERT INTO plans (title, original_name, access_key, created_at, views, file_content) VALUES ($1,$2,$3,$4,0,$5) RETURNING id",
      [title || (filename || "untitled").replace(/\.html?$/, ""), filename || "travel-plan.html",
       key, new Date().toISOString(), content]
    );
    res.json({
      id: r.rows[0].id, title: title || "untitled", original_name: filename || "travel-plan.html",
      access_key: key, created_at: new Date().toISOString(), views: 0,
      share_url: "/view/" + r.rows[0].id + "?key=" + key
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/plans/:id", requireAdmin, async (req, res) => {
  try {
    await ready();
    var r = await pool.query("DELETE FROM plans WHERE id = $1 RETURNING id", [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: "Plan not found" });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/plans/:id/regenerate-key", requireAdmin, async (req, res) => {
  try {
    await ready();
    var key = crypto.randomBytes(4).toString("hex");
    var r = await pool.query("UPDATE plans SET access_key = $1 WHERE id = $2 RETURNING id", [key, req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: "Plan not found" });
    res.json({ access_key: key, share_url: "/view/" + req.params.id + "?key=" + key });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// === USER ===
app.get("/api/user/info", requireAdmin, async (req, res) => {
  try {
    await ready();
    var username = req.query.username || "admin";
    var a = await pool.query("SELECT * FROM admins WHERE username = $1", [username]);
    if (a.rows.length === 0) return res.status(404).json({ error: "User not found" });
    var l = await pool.query("SELECT time, ip, agent FROM login_logs WHERE username = $1 ORDER BY time DESC LIMIT 50", [username]);
    res.json({
      username: a.rows[0].username, total_logins: a.rows[0].total_logins,
      last_login: a.rows[0].last_login, created_at: a.rows[0].created_at,
      login_history: l.rows
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/user/change-password", requireAdmin, async (req, res) => {
  try {
    await ready();
    var { old_password, new_password } = req.body;
    if (!old_password || !new_password || new_password.length < 4)
      return res.status(400).json({ error: "Invalid password" });
    var r = await pool.query("SELECT password_hash FROM admins WHERE username = 'admin'");
    if (r.rows.length === 0 || hashPw(old_password) !== r.rows[0].password_hash)
      return res.status(401).json({ error: "Old password incorrect" });
    await pool.query("UPDATE admins SET password_hash = $1 WHERE username = 'admin'", [hashPw(new_password)]);
    res.json({ success: true, message: "Password changed" });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// === VIEW ===
app.get("/api/plan-content/:id", async (req, res) => {
  try {
    await ready();
    var r = await pool.query("SELECT * FROM plans WHERE id = $1", [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: "Plan not found" });
    var plan = r.rows[0];
    if (req.query.key !== plan.access_key && req.headers.authorization !== ADMIN_TOKEN)
      return res.status(403).json({ error: "Invalid access key" });
    await pool.query("UPDATE plans SET views = views + 1 WHERE id = $1", [req.params.id]);
    var html = Buffer.from(plan.file_content, "base64").toString("utf-8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/plans/:id/download", async (req, res) => {
  try {
    await ready();
    var r = await pool.query("SELECT * FROM plans WHERE id = $1", [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: "Plan not found" });
    var plan = r.rows[0];
    if (req.query.key !== plan.access_key && req.headers.authorization !== ADMIN_TOKEN)
      return res.status(403).json({ error: "Invalid access key" });
    var html = Buffer.from(plan.file_content, "base64").toString("utf-8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"" + encodeURIComponent(plan.original_name || "plan.html") + "\"");
    res.send(html);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// === Static ===
app.get("/view/:id", (req, res) => {
  var qs = "?id=" + req.params.id + (req.query.key ? "&key=" + encodeURIComponent(req.query.key) : "");
  res.redirect("/viewer.html" + qs);
});
app.get("/admin", (req, res) => res.redirect("/index.html"));
app.get("/", (req, res) => res.redirect("/index.html"));
app.get("/api/debug", async (req, res) => {
  try {
    await ready();
    var r = await pool.query("SELECT count(*) as c FROM plans");
    res.json({ plans: parseInt(r.rows[0].c), db: "connected" });
  } catch(e) { res.json({ error: e.message }); }
});

module.exports = app;

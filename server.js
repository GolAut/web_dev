const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// Use Vercel KV backend when KV environment variables are set
const useKV = (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
let db;

if (useKV) {
  db = require("./db-vercel");
} else {
  db = require("./db");
}

// Simple password hashing (SHA256, no bcrypt dependency)
function hashPassword(pw) {
  return crypto.createHash("sha256").update(pw + "tp-salt-2024").digest("hex");
}
function verifyPassword(pw, hash) {
  return hashPassword(pw) === hash;
}

const app = express();
const PORT = process.env.PORT || 8080;
const UPLOADS_DIR = path.join(__dirname, "uploads");
const ADMIN_TOKEN = "tp-admin-" + crypto.randomBytes(16).toString("hex");

app.use(express.json());

// Serve static files from public/
const publicDir = path.join(__dirname, "public");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// Multer: memory storage on Vercel, disk storage locally
const upload = multer({
  storage: useKV
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: (req, file, cb) => {
          if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
          cb(null, UPLOADS_DIR);
        },
        filename: (req, file, cb) =>
          cb(null, Date.now() + "-" + Math.random().toString(36).slice(2) + ".html"),
      }),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ext === ".html" || ext === ".htm");
  },
  limits: { fileSize: useKV ? 5 * 1024 * 1024 : 50 * 1024 * 1024 },
});

function requireAdmin(req, res, next) {
  const token = req.headers["authorization"];
  if (token === ADMIN_TOKEN) return next();
  res.status(401).json({ error: "Unauthorized" });
}

async function init() {
  if (!useKV) {
    [UPLOADS_DIR, path.join(__dirname, "data")].forEach((d) => {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
  }
  const admin = await db.findAdmin("admin");
  if (!admin) {
    await db.addAdmin({
      username: "admin",
      password_hash: hashPassword("admin123"),
      created_at: new Date().toISOString(),
      total_logins: 0,
    });
    console.log("Default admin: admin / admin123");
  }
}

// ===== AUTH =====
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await db.findAdmin(username);
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({ error: "Unknown error" });
    }
    await db.addLoginLog({
      username,
      time: new Date().toISOString(),
      ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "local",
      agent: (req.headers["user-agent"] || "").substring(0, 200),
    });
    await db.updateAdmin(username, {
      total_logins: (admin.total_logins || 0) + 1,
      last_login: new Date().toISOString(),
    });
    res.json({ token: ADMIN_TOKEN, username: admin.username });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

// ===== PLANS =====
app.get("/api/plans", requireAdmin, async (req, res) => {
  const plans = await db.getPlans();
  const result = plans.map((p) => ({
    id: p.id, title: p.title, original_name: p.original_name,
    access_key: p.access_key, created_at: p.created_at, views: p.views || 0,
    share_url: "/view/" + p.id + "?key=" + p.access_key,
  }));
  res.json(result);
});

app.post("/api/plans", requireAdmin, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Please upload an HTML file" });
  const title = req.body.title || req.file.originalname.replace(/\.html?$/, "");
  const plan = {
    id: await db.nextPlanId(), title,
    original_name: req.file.originalname,
    access_key: uuidv4().slice(0, 8),
    created_at: new Date().toISOString(), views: 0,
  };
  if (useKV) {
    plan.file_content = req.file.buffer.toString("base64");
    plan.filename = plan.original_name;
  } else {
    plan.filename = req.file.filename;
  }
  await db.addPlan(plan);
  const { file_content, ...safe } = plan;
  res.json({ ...safe, share_url: "/view/" + plan.id + "?key=" + plan.access_key });
});

app.delete("/api/plans/:id", requireAdmin, async (req, res) => {
  const plan = await db.findPlan(parseInt(req.params.id));
  if (!plan) return res.status(404).json({ error: "Not found" });
  if (!useKV) {
    const fp = path.join(UPLOADS_DIR, plan.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  await db.deletePlan(parseInt(req.params.id));
  res.json({ success: true });
});

app.post("/api/plans/:id/regenerate-key", requireAdmin, async (req, res) => {
  const plan = await db.updatePlan(parseInt(req.params.id), { access_key: uuidv4().slice(0, 8) });
  if (!plan) return res.status(404).json({ error: "Not found" });
  res.json({ access_key: plan.access_key, share_url: "/view/" + plan.id + "?key=" + plan.access_key });
});

// ===== USER =====
app.get("/api/user/info", requireAdmin, async (req, res) => {
  const username = req.query.username || "admin";
  const admin = await db.findAdmin(username);
  if (!admin) return res.status(404).json({ error: "User not found" });
  const stats = await db.getAdminLoginStats(username);
  res.json({
    username: admin.username,
    total_logins: admin.total_logins || 0,
    last_login: admin.last_login || null,
    created_at: admin.created_at || null,
    login_history: stats.history.map((l) => ({
      time: l.time, ip: l.ip,
      agent: (l.agent || "").substring(0, 100),
    })),
  });
});

app.post("/api/user/change-password", requireAdmin, async (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password || new_password.length < 4)
    return res.status(400).json({ error: "Please provide a valid password" });
  const admin = await db.findAdmin("admin");
  if (!admin || !verifyPassword(old_password, admin.password_hash))
    return res.status(401).json({ error: "Old password is incorrect" });
  await db.updateAdmin("admin", { password_hash: hashPassword(new_password) });
  res.json({ success: true, message: "Password changed successfully" });
});

// ===== VIEW / DOWNLOAD =====
app.get("/api/plan-content/:id", async (req, res) => {
  const plan = await db.findPlan(parseInt(req.params.id));
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  if (req.query.key !== plan.access_key && req.headers["authorization"] !== ADMIN_TOKEN)
    return res.status(403).json({ error: "Invalid access key" });
  await db.incrementViews(plan.id);
  if (plan.file_content) {
    const html = Buffer.from(plan.file_content, "base64").toString("utf-8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  }
  const fp = path.join(UPLOADS_DIR, plan.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: "File not found" });
  res.sendFile(fp);
});

app.get("/api/plans/:id/download", async (req, res) => {
  const plan = await db.findPlan(parseInt(req.params.id));
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  if (req.query.key !== plan.access_key && req.headers["authorization"] !== ADMIN_TOKEN)
    return res.status(403).json({ error: "Invalid access key" });
  const filename = plan.original_name || "travel-plan.html";
  if (plan.file_content) {
    const html = Buffer.from(plan.file_content, "base64").toString("utf-8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
    return res.send(html);
  }
  const fp = path.join(UPLOADS_DIR, plan.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: "File not found" });
  res.download(fp, filename);
});

// ===== Static Routes =====
app.get("/plan/:id", (req, res) => {
  const qs = req.query.key ? "?key=" + encodeURIComponent(req.query.key) : "";
  res.redirect("/view/" + req.params.id + qs);
});
app.get("/view/:id", (req, res) => res.sendFile(path.join(__dirname, "public", "viewer.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/", (req, res) => res.redirect("/admin"));

app.use((req, res) => res.status(404).send("Not found"));

// --- Handle both local and serverless ---
const isVercelServerless = !!process.env.VERCEL;

if (!isVercelServerless) {
  init().then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log("\n===================================");
      console.log("  Travel Plan Server");
      console.log("  Storage:  " + (useKV ? "Vercel KV" : "Local JSON"));
      console.log("  URL:      http://0.0.0.0:" + PORT);
      console.log("  Login:    admin / admin123");
      console.log("===================================\n");
    });
  });
}


// ===== DEBUG ====
app.get("/api/debug", async (req, res) => {
  try {
    const admin = await db.findAdmin("admin");
    const plans = await db.getPlans();
    res.json({ admin: !!admin, admin_user: admin?.username, hash_len: admin?.password_hash?.length, plans: plans.length });
  } catch(e) { res.json({ error: e.message }); }
});


// For Vercel serverless: init and export
module.exports = async (req, res) => {
  await init();
  return app(req, res);
};

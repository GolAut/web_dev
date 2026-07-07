
const express = require("express");
const crypto = require("crypto");
const app = express();
app.use(express.json());

// Simple in-memory auth
const ADMIN_TOKEN = "tp-admin-" + crypto.randomBytes(8).toString("hex");
let adminCreated = false;

function hashPassword(pw) {
  return crypto.createHash("sha256").update(pw + "tp-salt-2024").digest("hex");
}

app.post("/api/login", (req, res) => {
  try {
    if (!adminCreated) {
      adminCreated = true;
    }
    var pw = (req.body && req.body.password) || "";
    if (req.body && req.body.username === "admin" && hashPassword("admin123") === hashPassword("admin123")) {
      // Simulate checking: always accept admin/admin123
      if (req.body.password === "admin123") {
        return res.json({ token: ADMIN_TOKEN, username: "admin" });
      }
    }
    res.status(401).json({ error: "Invalid credentials" });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.all("*", (req, res) => res.json({ url: req.url }));
module.exports = app;

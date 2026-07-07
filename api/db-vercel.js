const { kv } = require("@vercel/kv");

// Vercel KV-backed database layer (replaces JSON file storage)
// Uses environment variables: KV_REST_API_URL, KV_REST_API_TOKEN

function key(collection, id) {
  return `tp:${collection}:${id}`;
}
function keyList(collection) {
  return `tp:${collection}:list`;
}

// --- Admins ---
async function findAdmin(username) {
  const all = await kv.smembers(keyList("admins"));
  const ids = all || [];
  for (const id of ids) {
    const a = await kv.hgetall(key("admins", id));
    if (a && a.username === username) return { id, ...a };
  }
  return null;
}

async function addAdmin(admin) {
  const id = admin.username;
  await kv.sadd(keyList("admins"), id);
  await kv.hset(key("admins", id), admin);
  return admin;
}

async function updateAdmin(username, updates) {
  const a = await kv.hgetall(key("admins", username));
  if (!a || Object.keys(a).length === 0) return null;
  const merged = { ...a, ...updates };
  await kv.hset(key("admins", username), merged);
  return merged;
}

// --- Plans ---
async function getPlans() {
  const ids = await kv.smembers(keyList("plans"));
  if (!ids || ids.length === 0) return [];
  const plans = [];
  for (const id of ids) {
    const p = await kv.hgetall(key("plans", id));
    if (p && Object.keys(p).length > 0) {
      // Don't include file content in list queries
      const { file_content, ...rest } = p;
      plans.push({ id: parseInt(id), ...rest });
    }
  }
  plans.sort((a, b) => b.id - a.id);
  return plans;
}

async function findPlan(id) {
  const p = await kv.hgetall(key("plans", String(id)));
  if (!p || Object.keys(p).length === 0) return null;
  return { id: parseInt(id), ...p };
}

async function addPlan(plan) {
  const id = String(plan.id);
  await kv.sadd(keyList("plans"), id);
  await kv.hset(key("plans", id), plan);
  return plan;
}

async function updatePlan(id, updates) {
  const existing = await kv.hgetall(key("plans", String(id)));
  if (!existing || Object.keys(existing).length === 0) return null;
  const merged = { ...existing, ...updates };
  await kv.hset(key("plans", String(id)), merged);
  return { id: parseInt(id), ...merged };
}

async function deletePlan(id) {
  await kv.srem(keyList("plans"), String(id));
  await kv.del(key("plans", String(id)));
}

async function incrementViews(id) {
  const p = await kv.hgetall(key("plans", String(id)));
  if (!p || Object.keys(p).length === 0) return;
  await kv.hset(key("plans", String(id)), { ...p, views: String((parseInt(p.views) || 0) + 1) });
}

async function nextPlanId() {
  const ids = await kv.smembers(keyList("plans"));
  if (!ids || ids.length === 0) return 1;
  const nums = ids.map(Number).filter(n => !isNaN(n));
  return nums.length > 0 ? Math.max(...nums) + 1 : 1;
}

// --- Login Logs ---
async function addLoginLog(log) {
  const count = await kv.incr(key("stats", "login_log_count"));
  const logId = `log_${count}`;
  await kv.sadd(keyList("login_logs"), logId);
  await kv.hset(key("login_logs", logId), log);
  return log;
}

async function getLoginLogs(username) {
  const ids = await kv.smembers(keyList("login_logs"));
  if (!ids || ids.length === 0) return [];
  const logs = [];
  for (const id of ids) {
    const l = await kv.hgetall(key("login_logs", id));
    if (l && Object.keys(l).length > 0) {
      if (!username || l.username === username) logs.push(l);
    }
  }
  logs.sort((a, b) => new Date(b.time) - new Date(a.time));
  return logs;
}

async function getAdminLoginLogs(username) {
  return getLoginLogs(username);
}

async function getAdminLoginStats(username) {
  const logs = await getAdminLoginLogs(username);
  return { total: logs.length, lastLogin: logs.length > 0 ? logs[0].time : null, history: logs.slice(0, 50) };
}

// --- Stats ---
async function getPlansCount() {
  const plans = await getPlans();
  return plans.length;
}

async function getTotalViews() {
  const plans = await getPlans();
  return plans.reduce((sum, p) => sum + (parseInt(p.views) || 0), 0);
}

async function getTodayUploadsCount() {
  const plans = await getPlans();
  const today = new Date().toISOString().slice(0, 10);
  return plans.filter(p => p.created_at && String(p.created_at).slice(0, 10) === today).length;
}

async function getActiveKeysCount() {
  const plans = await getPlans();
  return plans.filter(p => (parseInt(p.views) || 0) > 0).length;
}

async function getLoginCountLast30Days(username) {
  const logs = await getLoginLogs(username);
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return logs.filter(l => new Date(l.time) >= thirtyDaysAgo).length;
}

module.exports = {
  findAdmin, addAdmin, updateAdmin,
  findPlan, addPlan, updatePlan, deletePlan, incrementViews, getPlans, nextPlanId,
  addLoginLog, getAdminLoginLogs, getAdminLoginStats, getLoginLogs,
  getPlansCount, getTotalViews, getTodayUploadsCount, getActiveKeysCount, getLoginCountLast30Days
};

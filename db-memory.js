// In-memory database for Vercel serverless (when KV is not configured)
// Data persists per-function-instance, resets on cold start

let admins = [];
let plans = [];
let logs = [];
let nextId = 1;

function findAdmin(u) { return admins.find(a => a.username === u) || null; }
function addAdmin(a) { admins.push(a); return a; }
function updateAdmin(username, updates) {
  const i = admins.findIndex(a => a.username === username);
  if (i === -1) return null;
  admins[i] = { ...admins[i], ...updates };
  return admins[i];
}

function getPlans() { return [...plans].reverse(); }
function findPlan(id) { return plans.find(p => p.id === id) || null; }
function addPlan(p) { plans.push(p); nextId = Math.max(nextId, p.id + 1); return p; }
function updatePlan(id, u) {
  const i = plans.findIndex(p => p.id === id);
  if (i === -1) return null;
  plans[i] = { ...plans[i], ...u };
  return plans[i];
}
function deletePlan(id) { plans = plans.filter(p => p.id !== id); }
function incrementViews(id) {
  const p = plans.find(p => p.id === id);
  if (p) p.views = (p.views || 0) + 1;
}
function nextPlanId() { return nextId++; }

function addLoginLog(log) { logs.push(log); return log; }
function getLoginLogs(username) {
  let all = [...logs];
  if (username) all = all.filter(l => l.username === username);
  all.sort((a, b) => new Date(b.time) - new Date(a.time));
  return all;
}
function getAdminLoginLogs(username) { return getLoginLogs(username); }
function getAdminLoginStats(username) {
  const history = getAdminLoginLogs(username);
  return { total: history.length, lastLogin: history.length > 0 ? history[0].time : null, history: history.slice(0, 50) };
}

function getPlansCount() { return plans.length; }
function getTotalViews() { return plans.reduce((sum, p) => sum + (p.views || 0), 0); }
function getTodayUploadsCount() {
  const today = new Date().toISOString().slice(0, 10);
  return plans.filter(p => p.created_at && String(p.created_at).slice(0, 10) === today).length;
}
function getActiveKeysCount() { return plans.filter(p => (p.views || 0) > 0).length; }
function getLoginCountLast30Days(username) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return logs.filter(l => l.username === username && new Date(l.time) >= thirtyDaysAgo).length;
}

module.exports = {
  findAdmin, addAdmin, updateAdmin,
  findPlan, addPlan, updatePlan, deletePlan, incrementViews, getPlans, nextPlanId,
  addLoginLog, getAdminLoginLogs, getAdminLoginStats, getLoginLogs,
  getPlansCount, getTotalViews, getTodayUploadsCount, getActiveKeysCount, getLoginCountLast30Days
};

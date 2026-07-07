const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, 'data');
const ADMINS_FILE = path.join(DATA_DIR, 'admins.json');
const PLANS_FILE = path.join(DATA_DIR, 'plans.json');
const LOGS_FILE = path.join(DATA_DIR, 'login_logs.json');

function init() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  [ADMINS_FILE, PLANS_FILE, LOGS_FILE].forEach(f => { if (!fs.existsSync(f)) fs.writeFileSync(f, '[]', 'utf-8'); });
}
function readJSON(f) { try { return JSON.parse(fs.readFileSync(f,'utf-8')); } catch(e) { return []; } }
function writeJSON(f,d) { fs.writeFileSync(f, JSON.stringify(d,null,2), 'utf-8'); }

// Admins
function getAdmins() { return readJSON(ADMINS_FILE); }
function saveAdmins(a) { writeJSON(ADMINS_FILE, a); }
function findAdmin(u) { return getAdmins().find(a => a.username === u); }
function addAdmin(a) { const d=getAdmins(); d.push(a); saveAdmins(d); }
function updateAdmin(username, updates) {
  const d = getAdmins(); const i = d.findIndex(a => a.username === username);
  if (i === -1) return null;
  d[i] = { ...d[i], ...updates }; saveAdmins(d); return d[i];
}

// Plans
function getPlans() { return readJSON(PLANS_FILE); }
function savePlans(p) { writeJSON(PLANS_FILE, p); }
function findPlan(id) { return getPlans().find(p => p.id === id); }
function findPlanByKey(k) { return getPlans().find(p => p.access_key === k); }
function addPlan(p) { const d=getPlans(); d.push(p); savePlans(d); return p; }
function updatePlan(id,u) { const d=getPlans(); const i=d.findIndex(p=>p.id===id); if(i===-1)return null; d[i]={...d[i],...u}; savePlans(d); return d[i]; }
function deletePlan(id) { let d=getPlans(); d=d.filter(p=>p.id!==id); savePlans(d); }
function incrementViews(id) { const d=getPlans(); const i=d.findIndex(p=>p.id===id); if(i===-1)return; d[i].views=(d[i].views||0)+1; savePlans(d); }
function nextPlanId() { const d=getPlans(); return d.length>0?Math.max(...d.map(p=>p.id))+1:1; }

// Login Logs
function getLoginLogs() { return readJSON(LOGS_FILE); }
function saveLoginLogs(l) { writeJSON(LOGS_FILE, l); }
function addLoginLog(log) { const d = getLoginLogs(); d.push(log); saveLoginLogs(d); }
function getAdminLoginLogs(username) {
  return getLoginLogs().filter(l => l.username === username).sort((a,b) => new Date(b.time) - new Date(a.time));
}
function getAdminLoginStats(username) {
  const logs = getAdminLoginLogs(username);
  return { total: logs.length, lastLogin: logs.length > 0 ? logs[0].time : null, history: logs.slice(0, 50) };
}

// Stats helpers
function getPlansCount() { return getPlans().length; }
function getTotalViews() { return getPlans().reduce((sum, p) => sum + (p.views || 0), 0); }
function getTodayUploadsCount() {
  const today = new Date().toISOString().slice(0, 10);
  return getPlans().filter(p => p.created_at && p.created_at.slice(0, 10) === today).length;
}
function getActiveKeysCount() {
  return getPlans().filter(p => (p.views || 0) > 0).length;
}
function getLoginCountLast30Days(username) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return getLoginLogs().filter(l =>
    l.username === username && new Date(l.time) >= thirtyDaysAgo
  ).length;
}

init();
module.exports = {
  findAdmin, addAdmin, getAdmins, updateAdmin,
  findPlan, findPlanByKey, addPlan, updatePlan, deletePlan, incrementViews, getPlans, nextPlanId,
  addLoginLog, getAdminLoginLogs, getAdminLoginStats, getLoginLogs,
  getPlansCount, getTotalViews, getTodayUploadsCount, getActiveKeysCount, getLoginCountLast30Days
};

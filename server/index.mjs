import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ControlStore } from "./lib/control-store.mjs";
import { readBody, resolveStaticFile, sendJson } from "./lib/http-utils.mjs";
import { fetchServerInfo, QueryProtocols } from "minestat-es/lib/index.js";
import { RconClient } from "@0x0c/rcon";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.DATA_DIR || path.join(ROOT, "data");
const WEB = path.join(ROOT, "..", "web");
fs.mkdirSync(DATA, { recursive: true });
const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
if (ADMIN_TOKEN.length < 16) throw new Error("ADMIN_TOKEN must contain at least 16 characters");
const LEGACY_ROOT_EXECUTOR = process.env.LEGACY_ROOT_EXECUTOR !== "0";
const ANDROID_CMD = "/system/bin/cmd";
const ROOT_CONTROL_ENABLED = process.env.ROOT_CONTROL_ENABLED === "1" || fs.existsSync(ANDROID_CMD);
const clients = new Set();
let previousCpu = null;
let profileTransition = null;
const profilesPath = path.join(DATA, "profiles.json");
const statePath = path.join(DATA, "state.json");
const auditPath = path.join(DATA, "audit.json");
const accessPath = path.join(DATA, "access.json");
const craftyLaunchLog = path.join(DATA, "crafty-launch.log");

const protectedPackages = [
  "android", "com.android.systemui", "com.android.phone", "com.android.settings",
  "com.android.launcher3", "com.google.android.inputmethod.latin", "com.android.externalstorage",
  "com.android.providers.media.module", "com.android.networkstack", "com.android.bluetooth",
  "com.android.nfc", "com.google.android.gms", "com.google.android.gsf", "com.google.android.webview",
  "com.google.android.documentsui", "com.google.android.verifier", "com.google.android.configupdater",
  "com.android.vending", "com.termux", "com.tailscale.ipn", "me.weishu.kernelsu"
];
const googleSuspendCandidates = [
  "com.google.android.youtube", "com.google.android.apps.youtube.music", "com.google.android.apps.photos",
  "com.google.android.videos", "com.google.android.apps.docs", "com.google.android.apps.magazines",
  "com.google.android.apps.tachyon", "com.google.android.apps.pixel.health", "com.google.android.feedback",
  "com.google.android.apps.internal.betterbug", "com.google.android.gms.location.history"
];
const defaultProfiles = [
  { id: "normal", name: "Normal", description: "Uso diario", freezeApps: [], stopApps: [], javaHeap: "256M", cpuMode: "balanced", services: [] },
  { id: "minecraft", name: "Servidor Minecraft", description: "Modo agresivo: conserva solo servidor, red y recuperación", freezeMode: "aggressive", freezeApps: ["com.google.android.youtube", "com.google.android.apps.youtube.music", "com.android.chrome", "com.google.android.apps.photos", "com.google.android.videos", "com.google.android.apps.docs", "com.google.android.apps.magazines", "com.roblox.client", "org.fossify.gallery", "com.android.music", "com.davidabel2.RappiGo", "com.grability.rappi", "com.pedidosya"], stopApps: [], javaHeap: "1536M", cpuMode: "performance", services: ["crafty", "minecraft", "tailscale", "ssh"] },
  { id: "web", name: "Servidor web", description: "Para nginx, Node y Python", freezeApps: ["com.google.android.youtube", "com.facebook.katana"], stopApps: [], javaHeap: "256M", cpuMode: "balanced", services: ["nginx", "node", "tailscale", "ssh"] },
  { id: "development", name: "Desarrollo", description: "Herramientas de desarrollo y acceso remoto", freezeApps: [], stopApps: [], javaHeap: "256M", cpuMode: "balanced", services: ["tailscale", "ssh"] },
  { id: "low-power", name: "Bajo consumo", description: "Reduce actividad en segundo plano", freezeApps: ["com.google.android.youtube", "com.google.android.chrome", "com.facebook.katana"], stopApps: [], javaHeap: "128M", cpuMode: "powersave", services: ["tailscale"] }
];

const store = new ControlStore(DATA, defaultProfiles);
function readJson(file, fallback) {
  if (file === profilesPath) return store.getProfiles(fallback);
  if (file === statePath) return store.getState(fallback);
  if (file === accessPath) return { devices: store.getDevices() };
  if (file === auditPath) return store.getAudit();
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, value) {
  if (file === profilesPath) return store.setProfiles(value);
  if (file === statePath) return store.setState(value);
  if (file === accessPath) return store.setDevices(value.devices || []);
  if (file === auditPath) return value.forEach(entry => store.prependAudit(entry));
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
const storedProfiles = readJson(profilesPath, defaultProfiles);
const minecraftProfile = storedProfiles.find(p => p.id === "minecraft");
if (minecraftProfile) {
  minecraftProfile.freezeMode = "aggressive";
  minecraftProfile.freezeApps = defaultProfiles.find(p => p.id === "minecraft").freezeApps;
  minecraftProfile.description = "Modo agresivo: conserva solo servidor, red y recuperación";
  minecraftProfile.javaHeap = "1536M";
  writeJson(profilesPath, storedProfiles);
}

function json(res, status, body) {
  sendJson(res, status, body);
}
function event(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) client.write(payload);
}
function audit(action, detail = {}) {
  const entry = { id: crypto.randomUUID(), action, detail, at: new Date().toISOString() };
  store.prependAudit(entry);
  event("audit", entry);
}
function requestToken(req) {
  return req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-control-token"] || "";
}
function sourceIp(req) {
  return (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
}
function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
function sameSecret(left, right) {
  return left.length === right.length && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map(part => part.trim().split("=")).filter(pair => pair.length === 2).map(([key, ...value]) => [key, decodeURIComponent(value.join("="))]));
}
function bearerIdentity(req) {
  const token = requestToken(req);
  if (!token) return null;
  if (sameSecret(token, ADMIN_TOKEN)) return { id: "bootstrap-owner", name: "Dispositivo local", role: "owner", sourceIp: sourceIp(req) };
  const hash = tokenHash(token);
  const device = readJson(accessPath, { devices: [] }).devices.find(item => !item.revoked && sameSecret(hash, item.tokenHash || ""));
  if (!device || (device.allowedIp && device.allowedIp !== sourceIp(req))) return null;
  return { id: device.id, name: device.name, role: device.role, sourceIp: sourceIp(req) };
}
function identity(req) {
  const sessionId = parseCookies(req).rc_session;
  if (sessionId) {
    const session = store.getSession(sessionId);
    if (session && session.expiresAt > Date.now()) return { ...session.actor, sessionId, csrfHash: session.csrfHash };
    if (session) store.deleteSession(sessionId);
  }
  return bearerIdentity(req);
}
function mutationAllowed(req, actor) {
  if (req.method === "GET" || !actor?.sessionId) return true;
  const origin = req.headers.origin;
  if (origin && !origin.endsWith(`://${req.headers.host}`)) return false;
  const csrf = req.headers["x-csrf-token"] || "";
  return sameSecret(tokenHash(csrf), actor.csrfHash || "");
}
function sessionCookie(id, maxAge) { return `rc_session=${encodeURIComponent(id)}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict; Path=/`; }
function csrfToken() { return crypto.randomBytes(24).toString("base64url"); }
const roleLevel = { viewer: 1, operator: 2, owner: 3 };
function hasRole(actor, minimum) {
  return Boolean(actor && (roleLevel[actor.role] || 0) >= roleLevel[minimum]);
}
function publicDevice(device) {
  const { tokenHash: _tokenHash, ...safe } = device;
  return safe;
}
function profilePlan(profile) {
  const requested = [...new Set([...(profile.freezeApps || []), ...(profile.stopApps || [])])];
  const blocked = requested.filter(pkg => protectedPackages.includes(pkg));
  const suspend = requested.filter(pkg => !protectedPackages.includes(pkg));
  return { mode: profile.freezeMode || "conservative", suspend, blocked, protectedPackages, rootScope: "profile-only" };
}
function rootAction(action, pkg) {
  if (!ROOT_CONTROL_ENABLED || !/^[A-Za-z0-9_.]{1,180}$/.test(pkg)) return { ok: false, error: "root_unavailable_or_invalid_package" };
  if (action === "suspend" && protectedPackages.includes(pkg)) return { ok: false, error: "protected_target" };
  const binary = ANDROID_CMD;
  const args = action === "force-stop" ? ["activity", "force-stop", "--user", "0", pkg] : ["package", action, "--user", "0", pkg];
  const result = spawnSync(binary, args, { encoding: "utf8", timeout: 5000 });
  return result.status === 0 ? { ok: true } : { ok: false, error: (result.stderr || result.stdout || "root_command_failed").trim() };
}
function linuxNumber(file) { try { return Number(fs.readFileSync(file, "utf8").trim()); } catch { return 0; } }
function memory() {
  if (process.platform !== "linux") return { total: Math.round(os.totalmem() / 1048576), available: Math.round(os.freemem() / 1048576), zramUsed: 0 };
  const lines = fs.existsSync("/proc/meminfo") ? fs.readFileSync("/proc/meminfo", "utf8") : "";
  const get = key => Number(lines.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1] || 0) / 1024;
  return { total: Math.round(get("MemTotal")), available: Math.round(get("MemAvailable")), zramUsed: Math.round(Math.max(0, get("SwapTotal") - get("SwapFree"))) };
}
function cpuTemperature() {
  if (process.platform !== "linux" || !fs.existsSync("/sys/class/thermal")) return null;
  for (const zone of fs.readdirSync("/sys/class/thermal").filter(x => x.startsWith("thermal_zone"))) {
    const raw = linuxNumber(`/sys/class/thermal/${zone}/temp`);
    if (raw > 0) return Math.round(raw / 1000);
  }
  return null;
}
function cpuUsage() {
  if (process.platform !== "linux" || !fs.existsSync("/proc/stat")) return 0;
  const fields = fs.readFileSync("/proc/stat", "utf8").match(/^cpu\s+(.*)$/m)?.[1]?.trim().split(/\s+/).map(Number) || [];
  const idle = (fields[3] || 0) + (fields[4] || 0); const total = fields.reduce((a, b) => a + b, 0);
  const current = { idle, total }; const result = previousCpu ? Math.round(100 * (1 - (idle - previousCpu.idle) / Math.max(1, total - previousCpu.total))) : 0; previousCpu = current; return Math.max(0, Math.min(100, result));
}
function tailscaleStatus() {
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4") continue;
      const [first, second] = entry.address.split(".").map(Number);
      if (first === 100 && second >= 64 && second <= 127) {
        return { status: "online", interface: name, ip: entry.address };
      }
    }
  }
  return { status: "offline", interface: null, ip: null };
}
function processSnapshot() {
  if (process.platform !== "linux" || !fs.existsSync("/proc")) return { javaPid: null, javaRss: 0 };
  let javaPid = null, javaRss = 0;
  for (const pid of fs.readdirSync("/proc").filter(x => /^\d+$/.test(x))) {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (cmd.includes("java") && (cmd.includes("server.jar") || cmd.includes("paper"))) {
        javaPid = Number(pid);
        const stat = fs.readFileSync(`/proc/${pid}/status`, "utf8");
        javaRss = Number(stat.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0) / 1024;
        break;
      }
    } catch {}
  }
  return { javaPid, javaRss: Math.round(javaRss) };
}
function processCommand(pid) {
  try { return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim(); } catch { return ""; }
}
function processCwd(pid) {
  try { return fs.readlinkSync(`/proc/${pid}/cwd`); } catch { return ""; }
}
function processExists(pid) { try { return fs.existsSync(`/proc/${pid}`); } catch { return false; } }
function findProcess(predicate) {
  if (process.platform !== "linux" || !fs.existsSync("/proc")) return [];
  return fs.readdirSync("/proc").filter(x => /^\d+$/.test(x)).map(Number).filter(pid => predicate(processCommand(pid), pid));
}
async function stopServerServices() {
  const javaPids = findProcess(cmd => cmd.includes("java") && (cmd.includes("server.jar") || cmd.includes("paper")));
  const craftyPids = findProcess((cmd, pid) => cmd.includes("main.py") && processCwd(pid).includes("/opt/crafty"));
  const result = { requested: true, java: { pids: javaPids, signal: null, stopped: true }, crafty: { pids: craftyPids, signal: null, stopped: true } };
  for (const pid of javaPids) {
    try { process.kill(pid, "SIGINT"); result.java.signal = "SIGINT"; } catch (error) { result.java.stopped = false; result.java.error = error.message; }
  }
  const waitForExit = async (pids, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (pids.some(processExists) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500));
    return !pids.some(processExists);
  };
  result.java.stopped = result.java.stopped && await waitForExit(javaPids, 10000);
  if (!result.java.stopped) {
    for (const pid of javaPids.filter(processExists)) { try { process.kill(pid, "SIGTERM"); } catch {} }
    result.java.signal = "SIGINT+SIGTERM";
    result.java.stopped = await waitForExit(javaPids, 5000);
  }
  for (const pid of craftyPids) {
    try { process.kill(pid, "SIGTERM"); result.crafty.signal = "SIGTERM"; } catch (error) { result.crafty.stopped = false; result.crafty.error = error.message; }
  }
  result.crafty.stopped = result.crafty.stopped && await waitForExit(craftyPids, 20000);
  result.ok = result.java.stopped && result.crafty.stopped;
  return result;
}
function recentCraftyError() {
  const log = craftyLaunchLog;
  try {
    return fs.readFileSync(log, "utf8").replace(/\0/g, "").split("\n").filter(line => /ERROR|Traceback|failed|exception/i.test(line)).slice(-8).join("\n").slice(-1600);
  } catch { return ""; }
}
async function startServerServices() {
  const before = await minecraftStatus();
  const craftyOnline = await portOpen("127.0.0.1", 8443);
  const javaRunning = Boolean(before.javaPid);
  const result = { requested: true, launchedCrafty: false, crafty: { ready: craftyOnline }, minecraft: { ready: javaRunning } };
  // Crafty autostarts the configured Paper server. Restarting it is required if
  // the controller is alive but its server process is missing.
  if (!craftyOnline || !javaRunning) {
    const craftyPids = findProcess((cmd, pid) => cmd.includes("main.py") && processCwd(pid).includes("/opt/crafty"));
    for (const pid of craftyPids) { try { process.kill(pid, "SIGTERM"); } catch {} }
    await new Promise(resolve => setTimeout(resolve, 1500));
    try {
      const output = fs.openSync(craftyLaunchLog, "w");
      const command = "cd /opt/crafty/crafty-4 && exec su crafty -s /bin/sh -c 'exec /opt/crafty/.venv/bin/python main.py --ignore --daemon'";
      const child = spawn("/bin/sh", ["-c", command], { detached: true, stdio: ["ignore", output, output] });
      child.unref();
      fs.closeSync(output);
      result.launchedCrafty = true;
    } catch (error) { result.error = `crafty_start_failed: ${error.message}`; }
  }
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    result.crafty.ready = await portOpen("127.0.0.1", 8443);
    const current = await minecraftStatus();
    result.minecraft.ready = current.portOpen || Boolean(current.javaPid);
    if (result.crafty.ready && current.portOpen) break;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  result.ok = result.crafty.ready && result.minecraft.ready;
  if (!result.ok && !result.error) result.error = result.crafty.ready ? "minecraft_start_timeout" : "crafty_start_timeout";
  if (!result.ok) result.detail = recentCraftyError() || "No hubo un error detallado en el registro de Crafty.";
  return result;
}
// Kept dependency-free: the monitor uses a short TCP probe when node is running on Linux/Android.
import net from "node:net";
function portOpen(host, port) { return new Promise(resolve => { const socket = net.createConnection({ host, port, timeout: 900 }, () => { socket.destroy(); resolve(true); }); socket.on("error", () => resolve(false)); socket.on("timeout", () => { socket.destroy(); resolve(false); }); }); }
async function minecraftStatus() {
  const proc = processSnapshot();
  const host = process.env.MC_HOST || "127.0.0.1";
  const port = Number(process.env.MC_PORT || 25565);
  const open = await portOpen(host, port);
  let ping = null;
  let pingError = null;
  try {
    if (open) ping = await fetchServerInfo({ address: host, port, timeout: 1200, protocol: QueryProtocols.Modern, ping: true });
  } catch (error) { pingError = error.message; }
  const rconConfigured = Boolean(process.env.RCON_PASSWORD_FILE || process.env.RCON_PASSWORD);
  const rcon = rconConfigured ? await minecraftRconCommand("list", { audit: false }).then(response => ({ online: true, response })).catch(error => ({ online: false, error: error.message })) : { online: false, error: "rcon_not_configured" };
  const log = process.env.MC_LOG || "/opt/crafty/crafty-4/servers/502e3b26-ea8a-4024-9dc7-84cd076e9df6/logs/latest.log";
  let logTail = "";
  const state = readJson(statePath, {});
  try {
    const startedAt = state.consoleStartedAt ? Date.parse(state.consoleStartedAt) : 0;
    if (!startedAt || fs.statSync(log).mtimeMs >= startedAt) logTail = fs.readFileSync(log, "utf8").slice(-12000);
  } catch {}
  const online = Boolean(ping?.online);
  return { status: online ? "online" : proc.javaPid || open ? "starting" : "offline", host: process.env.PUBLIC_HOST || "100.93.144.107", port, players: ping?.players || 0, maxPlayers: ping?.maxPlayers || 0, version: ping?.version || null, description: ping?.motd || null, latencyMs: ping?.pingMs ?? null, javaPid: proc.javaPid, javaRss: proc.javaRss, portOpen: open, checks: { pid: Boolean(proc.javaPid), port: open, ping: online, rcon: rcon.online, errors: { ping: pingError, rcon: rcon.error || null } }, rcon, consoleEpoch: state.consoleEpoch || 0, logTail: logTail.slice(-2000) };
}
async function minecraftRconCommand(command, options = {}) {
  const passwordFile = process.env.RCON_PASSWORD_FILE;
  const password = passwordFile ? fs.readFileSync(passwordFile, "utf8").trim() : process.env.RCON_PASSWORD;
  if (!password) throw new Error("rcon_not_configured");
  const client = new RconClient({ host: process.env.RCON_HOST || "127.0.0.1", port: Number(process.env.RCON_PORT || 25575), password, timeout: 2500 });
  try {
    await client.connect();
    const response = await client.send(command);
    if (options.audit !== false) audit("minecraft.rcon", { command, response: String(response).slice(0, 1000), actor: options.actor?.id || "system" });
    return response;
  } finally { if (client.connected) await client.disconnect().catch(() => {}); }
}
async function snapshot() {
  const state = readJson(statePath, { activeProfile: "normal", previous: null, audit: [] });
  const mc = await minecraftStatus();
  const ram = memory();
  const tailnet = tailscaleStatus();
  const services = { crafty: await portOpen("127.0.0.1", 8443) ? "online" : "offline", minecraft: mc.status, tailscale: tailnet.status, ssh: await portOpen("127.0.0.1", 22) ? "online" : "offline" };
  if (state.starting?.crafty) services.crafty = "starting";
  if (state.starting?.minecraft) services.minecraft = "starting";
  if (state.starting?.error) services.error = state.starting.error;
  const warnings = [];
  if (ram.available < 256) warnings.push({ id: "memory-critical", severity: "critical", message: `RAM disponible crítica: ${ram.available} MB` });
  else if (ram.available < 384) warnings.push({ id: "memory-pressure", severity: "warning", message: `Presión de RAM: ${ram.available} MB disponibles` });
  return { profile: state.activeProfile, ram, cpu: { usage: cpuUsage(), temperature: cpuTemperature() }, services, network: { tailscale: tailnet }, minecraft: mc, warnings, host: os.hostname(), rootControl: ROOT_CONTROL_ENABLED, at: new Date().toISOString() };
}
async function applyProfile(profile) {
  const state = readJson(statePath, { activeProfile: "normal", previous: null, audit: [] });
  const old = state.activeProfile;
  const profiles = readJson(profilesPath, defaultProfiles);
  const previous = profiles.find(p => p.id === old);
  let servicesStarted = null;
  if (profile.id === "minecraft" && (!previous?.services?.includes("minecraft") || !(await minecraftStatus()).portOpen)) {
    state.consoleEpoch = (state.consoleEpoch || 0) + 1;
    state.consoleStartedAt = new Date().toISOString();
    state.starting = { crafty: true, minecraft: true, startedAt: state.consoleStartedAt };
    writeJson(statePath, state);
    event("service.status", { crafty: "starting", minecraft: "starting" });
    servicesStarted = await startServerServices();
    state.starting = servicesStarted.ok ? null : { error: servicesStarted.error };
    writeJson(statePath, state);
    if (!servicesStarted.ok) {
      audit("profile.services_start_failed", { from: old, to: profile.id, servicesStarted });
      return { ...profile, transitionFailed: true, error: servicesStarted.error, detail: servicesStarted.detail, servicesStarted, rootApplied: ROOT_CONTROL_ENABLED };
    }
    audit("profile.services_started", { from: old, to: profile.id, servicesStarted });
  }
  let servicesStopped = null;
  if (profile.id === "normal") {
    servicesStopped = await stopServerServices();
    audit("profile.services_stop", { from: old, to: profile.id, servicesStopped });
    if (!servicesStopped.ok) return { ...profile, transitionFailed: true, error: "server_shutdown_incomplete", servicesStopped, rootApplied: ROOT_CONTROL_ENABLED };
  }
  const restored = (previous?.freezeApps || []).map(pkg => ({ package: pkg, action: "unsuspend", ...rootAction("unsuspend", pkg) }));
  // Stop managed apps before suspension so their processes release RAM immediately.
  const applied = profilePlan(profile).suspend.map(pkg => {
    const forceStopped = rootAction("force-stop", pkg);
    const suspended = rootAction("suspend", pkg);
    return { package: pkg, action: "force-stop+suspend", forceStopped, suspended, ok: forceStopped.ok && suspended.ok };
  });
  const stopped = (profile.stopApps || [])
    .filter(pkg => !(profile.freezeApps || []).includes(pkg))
    .map(pkg => ({ package: pkg, action: "force-stop", ...rootAction("force-stop", pkg) }));
  state.previous = old;
  state.activeProfile = profile.id;
  writeJson(statePath, state);
  const failures = [...restored, ...applied, ...stopped].filter(item => !item.ok).map(item => ({ package: item.package, error: item.error || item.suspended?.error || item.forceStopped?.error }));
  audit("profile.activate", { from: old, to: profile.id, restored: restored.length, suspended: applied.length, stopped: stopped.length, failures, rootApplied: ROOT_CONTROL_ENABLED });
  event("profile.changed", { profile: profile.id });
  return { ...profile, rootApplied: ROOT_CONTROL_ENABLED, protectedPackages: protectedPackages, restored, applied, stopped, servicesStarted, servicesStopped };
}
async function transitionTo(profile) {
  if (profileTransition) return { transitionFailed: true, error: "profile_transition_in_progress" };
  profileTransition = applyProfile(profile);
  try {
    return await profileTransition;
  } finally {
    profileTransition = null;
  }
}
async function route(req, res, url) {
  if (url.pathname === "/api/health") return json(res, 200, { status: "ok", version: "0.1.0" });
  if (req.method === "POST" && url.pathname === "/api/auth/session") {
    const actor = bearerIdentity(req);
    if (!actor) return json(res, 401, { error: "unauthorized" });
    store.purgeSessions();
    const id = crypto.randomBytes(32).toString("base64url");
    const csrf = csrfToken();
    store.createSession({ id, actor, csrfHash: tokenHash(csrf), expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
    res.setHeader("set-cookie", sessionCookie(id, 12 * 60 * 60));
    return json(res, 200, { actor, csrfToken: csrf, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const sessionId = parseCookies(req).rc_session;
    if (sessionId) store.deleteSession(sessionId);
    res.setHeader("set-cookie", sessionCookie("", 0));
    return json(res, 204, null);
  }
  if (url.pathname === "/api/events") {
    if (!identity(req)) return json(res, 401, { error: "unauthorized" });
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" }); res.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`); clients.add(res); req.on("close", () => clients.delete(res)); return;
  }
  const isBrokerRoute = url.pathname.startsWith("/internal/broker/");
  const brokerAuthorized = isBrokerRoute && sameSecret(requestToken(req), process.env.BROKER_TOKEN || ADMIN_TOKEN);
  const actor = isBrokerRoute ? (brokerAuthorized ? { id: "android-root-broker", role: "owner", sourceIp: sourceIp(req) } : null) : identity(req);
  if (!actor) return json(res, 401, { error: "unauthorized" });
  if (!isBrokerRoute && !mutationAllowed(req, actor)) return json(res, 403, { error: "csrf_or_origin_rejected" });
  if (!isBrokerRoute && req.method !== "GET" && !hasRole(actor, "operator")) return json(res, 403, { error: "insufficient_role" });
  if (req.method === "GET" && url.pathname === "/api/device") return json(res, 200, await snapshot());
  if (req.method === "GET" && url.pathname === "/api/stats/live") return json(res, 200, await snapshot());
  if (req.method === "GET" && url.pathname === "/api/minecraft/status") return json(res, 200, await minecraftStatus());
  if (req.method === "GET" && url.pathname === "/api/profiles") return json(res, 200, { data: readJson(profilesPath, defaultProfiles), active: readJson(statePath, {}).activeProfile });
  if (req.method === "GET" && url.pathname === "/api/apps") {
    const profiles = readJson(profilesPath, defaultProfiles);
    const packages = [...new Set(profiles.flatMap(p => [...(p.freezeApps || []), ...(p.stopApps || [])]))];
    return json(res, 200, { data: packages.map(pkg => ({ package: pkg, name: pkg.split(".").slice(-1)[0], status: protectedPackages.includes(pkg) ? "protected" : "available", google: pkg.startsWith("com.google.") })), protectedPackages, googleSuspendCandidates, policy: "whitelist" });
  }
  if (req.method === "GET" && url.pathname.match(/^\/api\/profiles\/[^/]+\/plan$/)) {
    const id = url.pathname.split("/")[3];
    const profile = readJson(profilesPath, defaultProfiles).find(p => p.id === id);
    if (!profile) return json(res, 404, { error: "profile_not_found" });
    return json(res, 200, { profile: profile.id, plan: profilePlan(profile) });
  }
  if (req.method === "POST" && url.pathname.match(/^\/api\/profiles\/[^/]+\/activate$/)) {
    const id = url.pathname.split("/")[3]; const profile = readJson(profilesPath, defaultProfiles).find(p => p.id === id);
    if (!profile) return json(res, 404, { error: "profile_not_found" });
    if (!LEGACY_ROOT_EXECUTOR) {
      const input = await readBody(req).catch(() => ({}));
      const key = req.headers["idempotency-key"] || input.idempotencyKey || `${actor.id}:${id}:${Math.floor(Date.now() / 30000)}`;
      const existing = store.findOperationByIdempotency(key);
      if (existing) return json(res, 202, { operationId: existing.id, status: existing.status });
      const operation = store.createOperation({ id: crypto.randomUUID(), type: "profile.activate", status: "queued", idempotencyKey: key, actor, payload: { profileId: id, profile } , expiresAt: Date.now() + 10 * 60 * 1000 });
      audit("operation.queued", { operationId: operation.id, type: operation.type, profileId: id, actor: actor.id });
      event("broker.command", { operationId: operation.id, type: operation.type });
      return json(res, 202, { operationId: operation.id, status: operation.status });
    }
    const result = await transitionTo(profile); return json(res, result.transitionFailed ? 409 : 200, { data: result });
  }
  if (req.method === "GET" && url.pathname.match(/^\/api\/operations\/[A-Za-z0-9-]+$/)) {
    const operation = store.getOperation(url.pathname.split("/")[3]);
    return operation ? json(res, 200, operation) : json(res, 404, { error: "operation_not_found" });
  }
  if (url.pathname === "/internal/broker/events") {
    if (!brokerAuthorized) return json(res, 401, { error: "broker_unauthorized" });
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`); clients.add(res); req.on("close", () => clients.delete(res)); return;
  }
  if (url.pathname === "/internal/broker/commands/next") {
    if (!brokerAuthorized) return json(res, 401, { error: "broker_unauthorized" });
    const operation = store.nextOperation();
    if (!operation || operation.expiresAt < Date.now()) return json(res, 204, null);
    return json(res, 200, operation);
  }
  if (req.method === "POST" && url.pathname.match(/^\/internal\/broker\/commands\/[A-Za-z0-9-]+\/(claim|result)$/)) {
    if (!brokerAuthorized) return json(res, 401, { error: "broker_unauthorized" });
    const id = url.pathname.split("/")[4]; const action = url.pathname.split("/")[5]; const input = await readBody(req);
    const operation = store.getOperation(id); if (!operation) return json(res, 404, { error: "operation_not_found" });
    if (action === "claim") return json(res, 200, store.updateOperation(id, { status: "running", claimedAt: new Date().toISOString(), brokerId: input.brokerId || "android" }));
    const success = input.status === "succeeded";
    const updated = store.updateOperation(id, { status: success ? "succeeded" : "failed", result: input.result || null, error: input.error || null });
    if (operation.type.startsWith("remote.") && operation.payload?.id) {
      const lease = store.getLease(operation.payload.id);
      if (lease) { lease.status = success ? "active" : "failed"; lease.error = updated.error || null; store.createLease(lease); }
    }
    if (success && operation.type === "profile.activate") {
      const profile = readJson(profilesPath, defaultProfiles).find(p => p.id === operation.payload.profileId);
      if (profile) { const state = readJson(statePath, {}); state.previous = state.activeProfile; state.activeProfile = profile.id; writeJson(statePath, state); event("profile.changed", { profile: profile.id }); }
    }
    audit(`operation.${updated.status}`, { operationId: id, actor: operation.actor?.id, error: updated.error || null });
    return json(res, 200, updated);
  }
  if (req.method === "POST" && url.pathname === "/api/profiles") { if (!hasRole(actor, "owner")) return json(res, 403, { error: "owner_required" }); const input = await readBody(req); const profiles = readJson(profilesPath, defaultProfiles); const profile = { id: input.id || crypto.randomUUID(), name: input.name || "Nuevo perfil", description: input.description || "", freezeMode: input.freezeMode || "conservative", freezeApps: input.freezeApps || [], stopApps: input.stopApps || [], javaHeap: input.javaHeap || "256M", cpuMode: input.cpuMode || "balanced", services: input.services || [] }; profiles.push(profile); writeJson(profilesPath, profiles); audit("profile.create", { id: profile.id, actor: actor.id }); return json(res, 201, { data: profile }); }
  if (req.method === "POST" && url.pathname === "/api/profiles/restore") { const state = readJson(statePath, { activeProfile: "normal", previous: null, audit: [] }); const restore = state.previous || "normal"; const profile = readJson(profilesPath, defaultProfiles).find(p => p.id === restore) || defaultProfiles[0]; const result = await transitionTo(profile); if (result.transitionFailed) return json(res, 409, { error: result.error, result }); const next = readJson(statePath, { activeProfile: restore, previous: null, audit: [] }); next.previous = null; writeJson(statePath, next); audit("profile.restore", { profile: restore, rootApplied: ROOT_CONTROL_ENABLED }); return json(res, 200, { profile: restore, result }); }
  if (req.method === "GET" && url.pathname === "/api/audit") return json(res, 200, { data: readJson(auditPath, []) });
  if (req.method === "GET" && url.pathname === "/api/access/devices") {
    if (!hasRole(actor, "owner")) return json(res, 403, { error: "owner_required" });
    return json(res, 200, { data: readJson(accessPath, { devices: [] }).devices.map(publicDevice), current: actor });
  }
  if (req.method === "POST" && url.pathname === "/api/access/devices") {
    if (!hasRole(actor, "owner")) return json(res, 403, { error: "owner_required" });
    const input = await readBody(req);
    if (!/^[A-Za-z0-9 ._-]{1,48}$/.test(input.name || "")) return json(res, 400, { error: "invalid_device_name" });
    if (!["viewer", "operator", "owner"].includes(input.role)) return json(res, 400, { error: "invalid_role" });
    if (input.allowedIp && !/^[0-9a-fA-F:.]{2,64}$/.test(input.allowedIp)) return json(res, 400, { error: "invalid_allowed_ip" });
    const token = crypto.randomBytes(32).toString("base64url");
    const access = readJson(accessPath, { devices: [] });
    const device = { id: crypto.randomUUID(), name: input.name, role: input.role, allowedIp: input.allowedIp || null, tokenHash: tokenHash(token), createdAt: new Date().toISOString(), lastUsedAt: null, revoked: false };
    access.devices.push(device); writeJson(accessPath, access);
    audit("access.device_created", { deviceId: device.id, name: device.name, role: device.role, allowedIp: device.allowedIp, actor: actor.id });
    return json(res, 201, { data: publicDevice(device), token });
  }
  if (req.method === "DELETE" && /^\/api\/access\/devices\/[^/]+$/.test(url.pathname)) {
    if (!hasRole(actor, "owner")) return json(res, 403, { error: "owner_required" });
    const id = url.pathname.split("/")[4]; const access = readJson(accessPath, { devices: [] }); const device = access.devices.find(item => item.id === id);
    if (!device) return json(res, 404, { error: "device_not_found" });
    device.revoked = true; device.revokedAt = new Date().toISOString(); writeJson(accessPath, access);
    audit("access.device_revoked", { deviceId: id, actor: actor.id }); return json(res, 200, { data: publicDevice(device) });
  }
  if (req.method === "GET" && url.pathname === "/api/remote/leases") {
    return json(res, 200, { data: store.listLeases().filter(lease => lease.expiresAt > Date.now()) });
  }
  if (req.method === "POST" && /^\/api\/remote\/(ssh|adb)\/leases$/.test(url.pathname)) {
    if (!hasRole(actor, "owner")) return json(res, 403, { error: "owner_required" });
    const kind = url.pathname.split("/")[3]; const input = await readBody(req).catch(() => ({}));
    const max = kind === "ssh" ? 8 * 60 * 60 * 1000 : 60 * 60 * 1000;
    const requested = Math.max(1, Number(input.minutes || (kind === "ssh" ? 30 : 15))) * 60 * 1000;
    if (requested > max) return json(res, 400, { error: "lease_too_long", maxMinutes: max / 60000 });
    const tailnet = tailscaleStatus(); if (tailnet.status !== "online") return json(res, 409, { error: "tailscale_required" });
    const lease = { id: crypto.randomUUID(), kind, actor: actor.id, createdAt: new Date().toISOString(), expiresAt: Date.now() + requested, status: "queued", allowedNetwork: "tailscale" };
    store.createLease(lease);
    const operation = store.createOperation({ id: crypto.randomUUID(), type: `remote.${kind}.lease`, status: "queued", actor, payload: lease, expiresAt: lease.expiresAt });
    audit("remote.lease.queued", { leaseId: lease.id, kind, operationId: operation.id, actor: actor.id });
    event("remote.lease", { lease, operationId: operation.id });
    return json(res, 202, { lease, operationId: operation.id });
  }
  if (req.method === "DELETE" && /^\/api\/remote\/leases\/[A-Za-z0-9-]+$/.test(url.pathname)) {
    if (!hasRole(actor, "owner")) return json(res, 403, { error: "owner_required" });
    const id = url.pathname.split("/")[4]; const lease = store.getLease(id); if (!lease) return json(res, 404, { error: "lease_not_found" });
    store.revokeLease(id); audit("remote.lease.revoked", { leaseId: id, actor: actor.id }); event("remote.lease.revoked", { leaseId: id });
    return json(res, 200, { revoked: true, id });
  }
  if (req.method === "GET" && url.pathname === "/api/services") {
    const mc = await minecraftStatus();
    const crafty = await portOpen("127.0.0.1", 8443);
    const ssh = await portOpen("127.0.0.1", 22);
    const tailscale = tailscaleStatus();
    const state = readJson(statePath, {});
    const data = [{ id: "crafty", name: "Crafty Controller", status: crafty ? "online" : state.starting?.crafty ? "starting" : "offline", port: 8443 }, { id: "minecraft", name: "Minecraft Paper", status: state.starting?.minecraft ? "starting" : mc.status, port: 25565 }, { id: "tailscale", name: "Tailscale", status: tailscale.status, detail: tailscale.ip ? `${tailscale.interface}: ${tailscale.ip}` : "Sin dirección de tailnet" }, { id: "ssh", name: "SSH", status: ssh ? "online" : "offline", port: 22 }];
    if (state.starting?.error) data.push({ id: "startup-error", name: "Error de arranque", status: "error", detail: state.starting.error });
    const ram = memory();
    if (ram.available < 384) data.push({ id: "memory-pressure", name: "Presión de memoria", status: "error", detail: `${ram.available} MB disponibles; zRAM en uso: ${ram.zramUsed} MB` });
    return json(res, 200, { data });
  }
  if (req.method === "POST" && url.pathname === "/api/minecraft/command") {
    const input = await readBody(req); const command = String(input.command || "").replace(/^\//, "").trim();
    if (!/^[a-zA-Z0-9 _:/.-]{1,120}$/.test(command)) return json(res, 400, { error: "invalid_command" });
    const destructive = /^(stop|restart|op |deop |ban |pardon |whitelist remove |kill|save-all)\b/i.test(command);
    if (destructive && !hasRole(actor, "owner")) return json(res, 403, { error: "owner_required_for_destructive_command" });
    if (destructive && req.headers["x-confirm-destructive"] !== "1") return json(res, 409, { error: "destructive_confirmation_required" });
    try { return json(res, 200, { command, response: await minecraftRconCommand(command, { actor }) }); }
    catch (error) { return json(res, 503, { error: "minecraft_rcon_unavailable", detail: error.message }); }
  }
  return json(res, 404, { error: "not_found" });
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/internal/broker/")) return await route(req, res, url);
    const file = resolveStaticFile(WEB, url.pathname);
    if (!file) return json(res, 403, { error: "forbidden" });
    if (!fs.existsSync(file)) return json(res, 404, { error: "not_found" });
    const ext = path.extname(file); const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" }[ext] || "application/octet-stream";
    res.writeHead(200, { "content-type": `${type}; charset=utf-8` }); fs.createReadStream(file).pipe(res);
  } catch (error) { json(res, error.statusCode || 500, { error: error.statusCode ? error.message : "internal_error", detail: error.message }); }
});
server.listen(PORT, "0.0.0.0", () => console.log(`Control plane listening on http://0.0.0.0:${PORT}`));
setInterval(async () => { const data = await snapshot(); event("device.stats", data); }, 5000);

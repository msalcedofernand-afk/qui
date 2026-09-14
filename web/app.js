let bearer = "";
let csrf = "";
const headers = {};
let lastLive = 0;
let consoleEpoch = null;

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const statusClass = value => ["online", "offline", "starting", "error"].includes(value) ? value : "unknown";
const destructiveCommand = command => /^(stop|restart|op |deop |ban |pardon |whitelist remove |kill|save-all)\b/i.test(command.trim());

async function controlPlaneLogin(token) {
  if (!token) return false;
  const response = await fetch("/api/auth/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { Authorization: "Bearer " + token }
  });
  if (!response.ok) return false;
  const result = await response.json();
  csrf = result.csrfToken || "";
  bearer = "";
  return true;
}

window.controlPlaneLogin = controlPlaneLogin;

async function ensureSession() {
  if (csrf) return true;
  const token = prompt("Token del panel");
  return controlPlaneLogin(token);
}

async function api(path, options = {}) {
  const requestHeaders = { ...headers, ...(options.headers || {}) };
  if (csrf && options.method && options.method !== "GET") requestHeaders["x-csrf-token"] = csrf;
  if (bearer) requestHeaders.Authorization = "Bearer " + bearer;
  const response = await fetch(path, { ...options, credentials: "same-origin", headers: requestHeaders });
  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      const body = await response.json();
      detail = body.error || detail;
    } catch {}
    throw new Error(detail);
  }
  return response.status === 204 ? null : response.json();
}

function setConnection(ok) {
  $("connectionDot").parentElement.classList.toggle("online", ok);
  $("connectionText").textContent = ok ? "Conectado" : "Desconectado";
}

function statusLabel(s) {
  return s === "online" ? "Online" : s === "starting" ? "Iniciando" : s === "offline" ? "Offline" : "Desconocido";
}

function renderAccessAddresses(host) {
  const localHost = location.hostname || "localhost";
  const panelPort = location.port || "3000";
  const externalHost = host || localHost;
  $("localPanelAddress").textContent = `http://${localHost}:${panelPort}`;
  $("externalPanelAddress").textContent = `http://${externalHost}:${panelPort}`;
  $("craftyAddress").textContent = `https://${externalHost}:8443`;
}

async function refresh() {
  try {
    const [device, profiles, services, audit, apps] = await Promise.all([
      api("/api/stats/live"),
      api("/api/profiles"),
      api("/api/services"),
      api("/api/audit"),
      api("/api/apps")
    ]);
    renderDevice(device);
    renderProfiles(profiles);
    renderServices(services.data);
    renderApps(apps.data);
    renderAudit(audit.data);
    api("/api/access/devices").then(result => renderDevices(result.data)).catch(() => renderDevices(null));
    lastLive = Date.now();
    setConnection(true);
  } catch (error) {
    if (!lastLive || Date.now() - lastLive > 10000) setConnection(false);
    console.error(error);
  }
}

function renderDevice(device) {
  $("activeProfile").textContent = device.profile;
  $("ram").textContent = `${device.ram.available} MB`;
  $("zram").textContent = `zRAM ${device.ram.zramUsed} MB`;
  $("cpu").textContent = device.cpu.usage ? `${device.cpu.usage}%` : "n/d";
  $("temp").textContent = device.cpu.temperature ? `${device.cpu.temperature} °C` : "Temperatura no disponible";
  $("mcState").textContent = statusLabel(device.minecraft.status);
  $("mcAddress").textContent = `${device.minecraft.host}:${device.minecraft.port}`;
  $("root").textContent = device.rootControl ? "Activo" : "Protegido";
  $("updated").textContent = new Date(device.at).toLocaleTimeString();
  $("minecraftBadge").textContent = statusLabel(device.minecraft.status);
  $("minecraftBadge").className = `badge ${device.minecraft.status}`;
  $("serverAddress").textContent = `${device.minecraft.host}:${device.minecraft.port}`;
  renderAccessAddresses(device.minecraft.host);
  if (consoleEpoch !== device.minecraft.consoleEpoch) {
    consoleEpoch = device.minecraft.consoleEpoch;
    $("log").textContent = "Nueva sesión: esperando salida de Paper...";
  }
  if (device.minecraft.logTail) $("log").textContent = device.minecraft.logTail;
  else if (device.minecraft.status === "offline") $("log").textContent = "Servidor detenido. La consola se limpiará en el próximo arranque.";
}

function renderProfiles(result) {
  $("profilesList").innerHTML = result.data.map(profile => `<div class="profile ${profile.id === result.active ? "active" : ""}"><div><div class="profile-name">${escapeHtml(profile.name)}</div><div class="profile-desc">${escapeHtml(profile.description)}</div></div><button class="button secondary" data-profile="${escapeHtml(profile.id)}">${profile.id === result.active ? "Activo" : "Activar"}</button></div>`).join("");
  document.querySelectorAll("[data-profile]").forEach(button => {
    button.onclick = async () => {
      const target = result.data.find(profile => profile.id === button.dataset.profile);
      if (result.active === "minecraft" && target?.id === "normal" && !window.confirm("Se detendrán Minecraft y Crafty de forma segura; después se restaurarán las aplicaciones. ¿Continuar?")) return;
      try {
        await api(`/api/profiles/${encodeURIComponent(button.dataset.profile)}/activate`, { method: "POST" });
        refresh();
      } catch (error) {
        window.alert(`No se pudo cambiar el perfil: ${error.message}`);
      }
    };
  });
}

function renderServices(items) {
  $("servicesList").innerHTML = items.map(service => `<div class="service"><div><div class="service-name">${escapeHtml(service.name)}</div><div class="service-meta">${escapeHtml(service.detail || (service.port ? `Puerto ${service.port}` : "Servicio local"))}</div></div><span class="status ${statusClass(service.status)}">${service.status === "error" ? "Error" : statusLabel(service.status)}</span></div>`).join("");
}

function renderApps(items) {
  $("appsList").innerHTML = items.map(app => `<div class="service"><div><div class="service-name">${escapeHtml(app.name)}</div><div class="service-meta">${escapeHtml(app.package)}</div></div><span class="status ${statusClass(app.status)}">${app.status === "protected" ? "Protegida" : "Disponible"}</span></div>`).join("");
}

function renderAudit(items = []) {
  $("audit").innerHTML = items.slice(0, 40).map(item => `<div class="audit"><time>${escapeHtml(new Date(item.at).toLocaleString())}</time><strong>${escapeHtml(item.action)}</strong><br><span>${escapeHtml(JSON.stringify(item.detail))}</span></div>`).join("") || '<div class="empty">Sin actividad todavía.</div>';
}

function renderDevices(items) {
  const list = $("devicesList");
  if (!items) {
    list.innerHTML = '<div class="empty">La gestión de dispositivos requiere rol propietario.</div>';
    $("deviceForm").hidden = true;
    return;
  }
  $("deviceForm").hidden = false;
  list.innerHTML = items.map(device => `<div class="service"><div><div class="service-name">${escapeHtml(device.name)}</div><div class="service-meta">${escapeHtml(device.role)}${device.allowedIp ? ` · ${escapeHtml(device.allowedIp)}` : " · cualquier IP de la tailnet"}</div></div><button class="button secondary" data-revoke="${escapeHtml(device.id)}" ${device.revoked ? "disabled" : ""}>${device.revoked ? "Revocado" : "Revocar"}</button></div>`).join("") || '<div class="empty">No hay dispositivos adicionales.</div>';
  document.querySelectorAll("[data-revoke]").forEach(button => {
    button.onclick = async () => {
      if (!confirm("Este dispositivo perderá el acceso inmediatamente. ¿Continuar?")) return;
      await api(`/api/access/devices/${encodeURIComponent(button.dataset.revoke)}`, { method: "DELETE" });
      refresh();
    };
  });
}

$("refresh").onclick = refresh;
$("restoreButton").onclick = async () => {
  await api("/api/profiles/restore", { method: "POST" });
  refresh();
};

$("copyAddress").onclick = () => navigator.clipboard.writeText($("serverAddress").textContent);

$("sendCommand").onclick = async () => {
  const input = $("commandInput");
  const output = $("commandResponse");
  const raw = input.value.trim();
  if (!raw) return;
  const command = raw.replace(/^\//, "").trim();
  const sendDestructive = destructiveCommand(command);
  if (sendDestructive && !window.confirm("Este comando puede detener o afectar el servidor. ¿Deseas enviarlo?")) return;
  const commandHeaders = { "content-type": "application/json" };
  if (sendDestructive) commandHeaders["x-confirm-destructive"] = "1";
  try {
    const result = await api("/api/minecraft/command", {
      method: "POST",
      headers: commandHeaders,
      body: JSON.stringify({ command: raw })
    });
    output.textContent = `> ${result.command}\n${String(result.response || "OK")}`;
    input.value = "";
    refresh();
  } catch (error) {
    output.textContent = `Error: ${error.message}`;
    window.alert(`Comando no enviado: ${error.message}`);
  }
};

document.querySelectorAll(".copy-access").forEach(button => {
  button.onclick = async () => {
    const targetId = button.dataset.target;
    const value = targetId ? $(targetId)?.textContent : "";
    if (!value || value === "--") return;
    await navigator.clipboard.writeText(value);
    button.textContent = "Copiado";
    setTimeout(() => {
      button.textContent = "Copiar";
    }, 1200);
  };
});

$("deviceForm").onsubmit = async event => {
  event.preventDefault();
  const result = await api("/api/access/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: $("deviceName").value,
      role: $("deviceRole").value,
      allowedIp: $("deviceIp").value.trim() || null
    })
  });
  const box = $("issuedToken");
  box.hidden = false;
  box.textContent = `Token (se muestra una sola vez): ${result.token}`;
  $("deviceName").value = "";
  refresh();
};

async function streamEvents() {
  while (true) {
    try {
      const response = await fetch("/api/events", { headers });
      if (!response.ok || !response.body) throw new Error(`events_${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";
        for (const frame of frames) {
          const type = frame.match(/^event:\s*(.+)$/m)?.[1];
          const data = frame.match(/^data:\s*(.+)$/m)?.[1];
          if (type === "device.stats" && data) {
            renderDevice(JSON.parse(data));
            lastLive = Date.now();
            setConnection(true);
          }
        }
      }
    } catch {
      if (!lastLive || Date.now() - lastLive > 10000) setConnection(false);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

ensureSession().then(ok => {
  if (ok) {
    refresh();
    streamEvents();
    setInterval(refresh, 10000);
  } else setConnection(false);
});

export function initMinecraftTerminal({ api, refresh, get, operation }) {
  const input = get("commandInput");
  const button = get("sendCommand");
  if (!input || !button) return;
  const send = async () => {
    const command = input.value.trim();
    if (!command) return;
    button.disabled = true;
    const task = async () => { await api("/api/minecraft/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command }) }); input.value = ""; };
    try { if (operation) await operation("Enviando comando Minecraft", "Esperando respuesta real de RCON", task); else { await task(); refresh(); } } catch (error) { if (!operation) window.alert(`Comando no enviado: ${error.message}`); } finally { button.disabled = false; }
  };
  button.addEventListener("click", send);
  input.addEventListener("keydown", event => { if (event.key === "Enter") send(); });
}

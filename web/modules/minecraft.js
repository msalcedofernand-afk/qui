export function initMinecraftTerminal({ api, refresh, get }) {
  const input = get("commandInput");
  const button = get("sendCommand");
  if (!input || !button) return;
  const send = async () => {
    const command = input.value.trim();
    if (!command) return;
    button.disabled = true;
    try {
      await api("/api/minecraft/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command }) });
      input.value = "";
      refresh();
    } catch (error) {
      window.alert(`Comando no enviado: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  };
  button.addEventListener("click", send);
  input.addEventListener("keydown", event => { if (event.key === "Enter") send(); });
}

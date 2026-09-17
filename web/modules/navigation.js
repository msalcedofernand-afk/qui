export function initNavigation({ onChange } = {}) {
  document.querySelectorAll("[data-screen]").forEach(button => {
    button.addEventListener("click", () => {
      const id = button.dataset.screen;
      document.querySelectorAll(".screen").forEach(screen => screen.classList.toggle("active", screen.id === id));
      document.querySelectorAll("[data-screen]").forEach(item => item.classList.toggle("active", item.dataset.screen === id));
      window.scrollTo({ top: 0, behavior: "smooth" });
      Promise.resolve(onChange?.(id)).catch(error => console.error("navigation_change_failed", error));
    });
  });
}

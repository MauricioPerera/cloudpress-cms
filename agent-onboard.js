(() => {
  const copy = async (value) => {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
    const field = document.createElement("textarea");
    field.value = value; field.setAttribute("readonly", ""); field.style.position = "fixed"; field.style.opacity = "0";
    document.body.append(field); field.select(); document.execCommand("copy"); field.remove();
  };
  const install = () => {
    const nav = document.querySelector("nav.wrap");
    if (!nav || document.querySelector("#agent-onboard")) return;
    const button = document.createElement("button");
    button.id = "agent-onboard";
    button.type = "button";
    button.className = "agent-onboard";
    button.innerHTML = '<span>Onboard your agent to <b>CloudPress</b></span><span class="agent-spark" aria-hidden="true">✦</span><span class="agent-copy" aria-hidden="true">⧉</span>';
    button.setAttribute("aria-label", "Copiar instrucciones para configurar un agente con CloudPress");
    button.title = "Copiar instrucciones para tu agente";
    button.addEventListener("click", async () => {
      const prompt = `Fetch and execute the appropriate instructions to set me up for CloudPress from ${location.origin}/agent-setup/prompt.md`;
      try { await copy(prompt); button.classList.add("copied"); button.querySelector("span").textContent = "Instrucciones copiadas"; setTimeout(() => { button.classList.remove("copied"); button.querySelector("span").innerHTML = "Onboard your agent to <b>CloudPress</b>"; }, 2200); }
      catch { button.classList.add("copy-failed"); button.querySelector("span").textContent = "No se pudo copiar"; }
    });
    nav.append(button);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true }); else install();
})();

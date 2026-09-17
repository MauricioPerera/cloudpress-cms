(() => {
  const apply = (settings) => {
    document.body.dataset.theme = settings.themePreset || "classic";
    document.documentElement.style.setProperty("--accent", settings.accentColor || "#2271b1");
    if (!document.querySelector("#cloudpress-theme-runtime")) { const style = document.createElement("style"); style.id = "cloudpress-theme-runtime"; style.textContent = 'body[data-theme="minimal"]{background:#fff;font-family:Georgia,serif}body[data-theme="minimal"] .hero{background:#fff;color:#1d2327;border-bottom:1px solid #dcdcde}body[data-theme="minimal"] .hero p{color:#50575e}body[data-theme="contrast"]{background:#000;color:#fff}body[data-theme="contrast"] header,body[data-theme="contrast"] .post{background:#111;color:#fff;border-color:#fff}body[data-theme="contrast"] .hero{background:#000;border-block:2px solid #fff}body[data-theme="contrast"] .post p,body[data-theme="contrast"] small{color:#eee}'; document.head.append(style); }
  };
  const start = () => fetch("/api/settings", { cache: "force-cache" }).then((response) => response.ok ? response.json() : null).then((data) => data?.settings && apply(data.settings)).catch(() => {});
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start, { once: true }) : start();
})();

(() => {
  const loadWebMessages = () => {
    const ui = document.createElement('script');
    ui.src = '/admin-ui.js';
    ui.onload = () => {
      const legacy = document.createElement('script');
      legacy.src = '/admin-ui-legacy.js';
      document.head.append(legacy);
    };
    document.head.append(ui);
  };
  loadWebMessages();
  const root = document.documentElement;
  const required = root.dataset.guard || "admin";
  fetch("/api/me").then(async (response) => {
    const data = await response.json().catch(() => ({}));
    const allowed = response.ok && data.user && (required === "session" || data.user.role === "admin");
    if (!allowed) throw new Error("unauthorized");
    root.classList.add("authenticated");
  }).catch(() => {
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`/login.html?redirect=${next}`);
  });
})();

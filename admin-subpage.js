(() => {
  const view = document.documentElement.dataset.adminView;
  if (window.top === window && view) {
    location.replace(`/wp-admin.html?view=${encodeURIComponent(view)}`);
    return;
  }
  const account = document.querySelector('#account-name');
  fetch('/api/me').then(response => response.ok ? response.json() : null).then(data => {
    if (account && data?.user) account.textContent = data.user.username;
  }).catch(() => {});
  document.querySelector('#logout')?.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.assign('/');
  });
})();

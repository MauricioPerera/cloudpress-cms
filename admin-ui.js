(() => {
  const ensure = () => {
    if (document.querySelector('#cloudpress-ui')) return;
    const style = document.createElement('style');
    style.textContent = `#cloudpress-ui{position:fixed;inset:0;z-index:9999;pointer-events:none;font:15px system-ui,sans-serif;color:#1d2327}.cp-toasts{position:fixed;right:20px;bottom:20px;width:min(420px,calc(100vw - 40px));display:grid;gap:10px}.cp-toast{background:#fff;border-left:4px solid #2271b1;box-shadow:0 5px 18px #0003;padding:13px 16px;pointer-events:auto}.cp-toast.error{border-color:#d63638}.cp-dialog-backdrop{position:fixed;inset:0;background:#0008;display:grid;place-items:center;padding:20px;pointer-events:auto}.cp-dialog{width:min(460px,100%);background:#fff;box-shadow:0 12px 40px #0005;padding:24px}.cp-dialog h2{font-size:20px;margin:0 0 10px}.cp-dialog p{line-height:1.5;margin:0 0 20px}.cp-dialog label{display:grid;gap:7px;margin-bottom:20px}.cp-dialog input{font:inherit;padding:9px;border:1px solid #8c8f94;width:100%;box-sizing:border-box}.cp-actions{display:flex;justify-content:flex-end;gap:8px}.cp-actions button{font:inherit;padding:8px 14px;border:1px solid #2271b1;background:#2271b1;color:#fff}.cp-actions .secondary{background:#fff;color:#2271b1}.cp-actions .danger{background:#d63638;border-color:#d63638}`;
    document.head.append(style);
    const ui = document.createElement('div');
    ui.id = 'cloudpress-ui';
    ui.innerHTML = '<div class="cp-toasts" aria-live="polite" aria-atomic="true"></div>';
    document.body.append(ui);
  };
  const toast = (message, type = 'info') => {
    ensure();
    const item = document.createElement('div');
    item.className = `cp-toast ${type === 'error' ? 'error' : ''}`;
    item.setAttribute('role', type === 'error' ? 'alert' : 'status');
    item.textContent = message;
    document.querySelector('.cp-toasts').append(item);
    setTimeout(() => item.remove(), 5500);
  };
  const ask = ({ title, message, label, value = '', kind = 'confirm', confirmLabel = 'Continuar', destructive = false }) => new Promise(resolve => {
    ensure();
    const backdrop = document.createElement('div');
    backdrop.className = 'cp-dialog-backdrop';
    const input = kind === 'prompt' ? `<label>${label || 'Valor'}<input id="cp-dialog-input" value="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></label>` : '';
    backdrop.innerHTML = `<section class="cp-dialog" role="dialog" aria-modal="true" aria-labelledby="cp-dialog-title"><h2 id="cp-dialog-title"></h2><p></p>${input}<div class="cp-actions"><button class="secondary" type="button">Cancelar</button><button class="${destructive ? 'danger' : ''}" type="button">${confirmLabel}</button></div></section>`;
    const panel = backdrop.querySelector('.cp-dialog');
    panel.querySelector('h2').textContent = title;
    panel.querySelector('p').textContent = message;
    const [cancel, accept] = panel.querySelectorAll('button');
    const finish = result => { backdrop.remove(); resolve(result); };
    cancel.onclick = () => finish(kind === 'prompt' ? null : false);
    accept.onclick = () => finish(kind === 'prompt' ? panel.querySelector('input').value : true);
    backdrop.onclick = e => { if (e.target === backdrop) cancel.click(); };
    document.body.append(backdrop);
    const field = panel.querySelector('input');
    if (field) { field.focus(); field.select(); field.onkeydown = e => { if (e.key === 'Enter') accept.click(); if (e.key === 'Escape') cancel.click(); }; } else accept.focus();
  });
  window.CloudPressUI = { toast, confirm: options => ask({ title: 'Confirmar acción', ...options, kind: 'confirm' }), prompt: options => ask({ title: 'Añadir información', ...options, kind: 'prompt', confirmLabel: 'Aceptar' }) };
})();

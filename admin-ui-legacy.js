(() => {
  let approved = false;
  window.alert = message => CloudPressUI.toast(String(message), 'error');
  window.confirm = () => approved;
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || approved || button.classList.contains('del')) return;
    const label = button.textContent.trim();
    const destructive = /^(Eliminar|Desinstalar|Restaurar ahora|Enviar a papelera)/i.test(label);
    if (!destructive) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const message = /Restaurar ahora/i.test(label)
      ? 'Se aplicará el respaldo seleccionado. El contenido actual se conservará, pero los ajustes incluidos se reemplazarán.'
      : `¿Confirmas la acción “${label}”?`;
    CloudPressUI.confirm({ title: label, message, confirmLabel: label, destructive: /Eliminar|Desinstalar/i.test(label) }).then(ok => {
      if (!ok) return;
      approved = true;
      button.click();
      approved = false;
    });
  }, true);
})();

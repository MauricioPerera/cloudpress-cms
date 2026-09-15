function initializeTotpQr() {
  const uri = document.querySelector("#otpauth-uri");
  if (!uri) return;
  const slot = document.createElement("div");
  slot.id = "totp-qr";
  slot.setAttribute("aria-label", "Código QR para Google Authenticator");
  uri.parentElement.before(slot);
  let rendered = "";
  const render = async () => {
    if (!uri.value || uri.value === rendered || !window.CloudPressQRCode) return;
    rendered = uri.value;
    try {
      slot.innerHTML = await window.CloudPressQRCode.toSvg(uri.value);
      slot.querySelector("svg")?.setAttribute("aria-label", "Escanea este código QR con Google Authenticator");
    } catch { slot.textContent = "No se pudo generar el código QR."; }
  };
  setInterval(render, 150);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeTotpQr, { once: true });
else initializeTotpQr();

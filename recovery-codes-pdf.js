function escapePdf(value) {
  return String(value).replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");
}

export function buildRecoveryCodesPdf(codes) {
  if (!Array.isArray(codes) || codes.length !== 10 || codes.some((code) => !/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){2}$/.test(code))) throw new Error("Códigos de respaldo inválidos");
  const lines = [
    ["CloudPress - Codigos de respaldo", 20, 72, 720],
    ["Guarda este documento fuera de tu navegador.", 11, 72, 684],
    ["Cada codigo permite recuperar tu cuenta una sola vez.", 11, 72, 666],
    ["No lo compartas por chat, correo o capturas de pantalla.", 11, 72, 648],
    ...codes.map((code, index) => [code, 16, 92, 608 - index * 34]),
  ];
  const stream = lines.map(([text, size, x, y]) => `BT /F1 ${size} Tf ${x} ${y} Td (${escapePdf(text)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  const encoder = new TextEncoder();
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return encoder.encode(pdf);
}

function initializeRecoveryCodeDownload() {
  const codesElement = document.querySelector("#codes");
  const card = document.querySelector("#recovery-codes");
  if (!codesElement || !card) return;
  const button = document.createElement("button");
  button.type = "button";
  button.hidden = true;
  button.textContent = "Descargar codigos de respaldo en PDF";
  button.addEventListener("click", () => {
    const codes = codesElement.textContent.trim().split(/\s+/);
    const url = URL.createObjectURL(new Blob([buildRecoveryCodesPdf(codes)], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "cloudpress-codigos-de-respaldo.pdf";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  card.append(button);
  setInterval(() => { button.hidden = !codesElement.textContent.trim(); }, 150);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeRecoveryCodeDownload, { once: true });
  else initializeRecoveryCodeDownload();
}

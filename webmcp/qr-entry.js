import QRCode from "qrcode";

window.CloudPressQRCode = {
  toSvg(value) {
    return QRCode.toString(value, { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 240 });
  },
};

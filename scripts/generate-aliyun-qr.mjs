import QRCode from 'qrcode';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const qrUrl = String(process.env.QR_URL || '').trim();
if (!qrUrl) {
  throw new Error('QR_URL is required, for example: QR_URL=https://credit.xxx.com/?v=pr22 npm run qr:aliyun');
}

const outputDir = process.env.QR_OUTPUT_DIR || 'release';
const outputFile = process.env.QR_OUTPUT_FILE || 'medical-credit-assessment-pr22-qr.png';
const outputPath = join(process.cwd(), outputDir, outputFile);

await mkdir(join(process.cwd(), outputDir), { recursive: true });
await QRCode.toFile(outputPath, qrUrl, {
  width: Number(process.env.QR_WIDTH || 480),
  margin: Number(process.env.QR_MARGIN || 2),
  color: {
    dark: process.env.QR_DARK || '#33245a',
    light: process.env.QR_LIGHT || '#ffffff'
  }
});

console.log(JSON.stringify({
  url: qrUrl,
  outputPath
}, null, 2));

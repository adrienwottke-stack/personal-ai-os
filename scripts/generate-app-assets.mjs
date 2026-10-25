import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import QRCode from 'qrcode';

const liveUrl = 'https://ai-os.127.0.0.1.sslip.io/';
const paths = ['public/icons'];
await Promise.all(paths.map(path => mkdir(path, { recursive: true })));

// Keep the mark within the central safe zone of Android's masked icons.
const mark = `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M176 330V182L336 330V182" stroke="#ffffff" stroke-width="32"/><path d="M174 158H278Q310 158 310 126" stroke="#62cfba" stroke-width="15"/><circle cx="310" cy="116" r="17" fill="#62cfba" stroke="none"/><circle cx="174" cy="158" r="13" fill="#62cfba" stroke="none"/></g>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#17283b"/>${mark}</svg>`;
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#17283b"/>${mark}</svg>`;
await writeFile('public/icons/app.svg', svg);
for (const size of [32, 180, 192, 512]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icons/app-${size}.png`);
}
await sharp(Buffer.from(maskable)).png().toFile('public/icons/app-maskable-512.png');
await QRCode.toFile('public/install-qr.svg', liveUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#17283b', light: '#ffffff' } });
console.log('App icons and a QR code for the public live URL generated.');

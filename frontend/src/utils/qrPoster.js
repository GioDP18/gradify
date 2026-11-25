import logoSrc from '../assets/brand/gradify-logo-clear.webp';

/**
 * Draws the downloadable QR enrollment poster: the class on an EVSU maroon band, the QR code on a
 * white card, and three short steps for the student. Made to be printed or shown on a projector.
 */
const W = 1080;
const H = 1620;
const MAROON = '#8a1218';
const MAROON_DEEP = '#63050d';
const GOLD = '#f0b738';
const INK = '#2c2629';
const INK_SOFT = '#5d5659';
const CREAM = '#fbf8f4';
const SERIF = "'Lora', Georgia, 'Times New Roman', serif";
const SANS = "'Lato', system-ui, 'Segoe UI', Roboto, sans-serif";

const STEPS = ['Open your\nphone camera', 'Scan the\nQR code', 'Fill in\nyour details'];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image failed to load'));
    image.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Centered text that shrinks until it fits maxWidth. */
function fitText(ctx, text, { x, y, size, weight = 700, family = SANS, maxWidth, color, spacing = 0 }) {
  let px = size;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  do {
    ctx.font = `${weight} ${px}px ${family}`;
    px -= 2;
  } while (ctx.measureText(text).width > maxWidth && px > 18);
  // Trailing letter spacing would push the text off-centre by half a gap.
  ctx.fillText(text, x + spacing / 2, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

/** The lower edge of the maroon band: a soft curve, as on the sign-in and enrollment pages. */
function bandEdge(ctx) {
  ctx.moveTo(W, 560);
  ctx.bezierCurveTo(760, 500, 300, 690, 0, 610);
}

/**
 * @param {{ qrDataUrl: string, cls: { subjectCode: string, section: string, subjectTitle?: string }, term?: string }} input
 * @returns {Promise<string>} PNG data URL
 */
export async function buildQrPoster({ qrDataUrl, cls, term }) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');

  // The page's fonts may not be loaded yet (the dialog can open before any Lora text is shown).
  await Promise.all([`700 80px ${SERIF}`, `700 30px ${SANS}`, `400 30px ${SANS}`].map((f) => document.fonts?.load(f).catch(() => null)));
  const [qr, logo] = await Promise.all([loadImage(qrDataUrl), loadImage(logoSrc).catch(() => null)]);

  // Page
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(140, 1250, 0, 140, 1250, 620);
  glow.addColorStop(0, 'rgba(240, 183, 56, 0.16)');
  glow.addColorStop(1, 'rgba(240, 183, 56, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Maroon band
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, 560);
  ctx.bezierCurveTo(760, 500, 300, 690, 0, 610);
  ctx.closePath();
  ctx.clip();
  const band = ctx.createLinearGradient(0, 0, 0, 660);
  band.addColorStop(0, '#9a1820');
  band.addColorStop(1, MAROON_DEEP);
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, W, 700);
  const warm = ctx.createRadialGradient(120, 0, 0, 120, 0, 640);
  warm.addColorStop(0, 'rgba(255, 206, 128, 0.38)');
  warm.addColorStop(1, 'rgba(255, 206, 128, 0)');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, W, 700);
  // Faint rings, top right
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 3;
  for (const r of [150, 230, 310]) {
    ctx.beginPath();
    ctx.arc(W - 40, 30, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  // Gold ribbon along the band's edge, with a thin maroon echo below it
  ctx.beginPath();
  bandEdge(ctx);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 9;
  ctx.stroke();
  ctx.save();
  ctx.translate(0, 20);
  ctx.beginPath();
  bandEdge(ctx);
  ctx.strokeStyle = 'rgba(138, 18, 24, 0.22)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  // Logo medallion
  ctx.save();
  ctx.shadowColor = 'rgba(40, 6, 10, 0.5)';
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 14;
  ctx.beginPath();
  ctx.arc(W / 2, 142, 88, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(W / 2, 142, 91, 0, Math.PI * 2);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 7;
  ctx.stroke();
  if (logo) ctx.drawImage(logo, W / 2 - 72, 142 - 72, 144, 144);

  // The class
  fitText(ctx, 'SCAN TO ENROLL', { x: W / 2, y: 304, size: 32, family: SANS, maxWidth: 900, color: GOLD, spacing: 9 });
  fitText(ctx, `${cls.subjectCode} · ${cls.section}`, { x: W / 2, y: 398, size: 88, family: SERIF, maxWidth: 940, color: '#ffffff' });
  if (cls.subjectTitle) {
    fitText(ctx, cls.subjectTitle, { x: W / 2, y: 456, size: 38, weight: 400, maxWidth: 900, color: 'rgba(255, 255, 255, 0.9)' });
  }

  // QR card
  const card = { x: 210, y: 520, size: 660 };
  ctx.save();
  ctx.shadowColor = 'rgba(70, 14, 18, 0.38)';
  ctx.shadowBlur = 70;
  ctx.shadowOffsetY = 34;
  roundRect(ctx, card.x, card.y, card.size, card.size, 44);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  ctx.imageSmoothingEnabled = false; // keep the modules crisp
  ctx.drawImage(qr, card.x + 30, card.y + 30, card.size - 60, card.size - 60);
  ctx.imageSmoothingEnabled = true;
  // Gold corner brackets around the card
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const gap = 26;
  const arm = 74;
  const [l, t, r, b] = [card.x - gap, card.y - gap, card.x + card.size + gap, card.y + card.size + gap];
  for (const [cx, cy, dx, dy] of [[l, t, 1, 1], [r, t, -1, 1], [l, b, 1, -1], [r, b, -1, -1]]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * arm, cy);
    ctx.lineTo(cx + dx * 22, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy + dy * 22);
    ctx.lineTo(cx, cy + dy * arm);
    ctx.stroke();
  }

  // Three steps
  const stepY = 1318;
  const columns = [210, 540, 870];
  ctx.strokeStyle = 'rgba(138, 18, 24, 0.25)';
  ctx.lineWidth = 3;
  ctx.setLineDash([2, 14]);
  ctx.beginPath();
  ctx.moveTo(columns[0] + 58, stepY);
  ctx.lineTo(columns[2] - 58, stepY);
  ctx.stroke();
  ctx.setLineDash([]);
  STEPS.forEach((text, i) => {
    const x = columns[i];
    ctx.beginPath();
    ctx.arc(x, stepY, 40, 0, Math.PI * 2);
    ctx.fillStyle = CREAM;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, stepY, 36, 0, Math.PI * 2);
    ctx.fillStyle = MAROON;
    ctx.fill();
    fitText(ctx, String(i + 1), { x, y: stepY + 13, size: 40, family: SERIF, maxWidth: 60, color: '#ffffff' });
    text.split('\n').forEach((line, n) => {
      fitText(ctx, line, { x, y: stepY + 90 + n * 40, size: 32, weight: n === 0 ? 700 : 400, maxWidth: 300, color: n === 0 ? INK : INK_SOFT });
    });
  });

  // Footer
  ctx.fillStyle = MAROON_DEEP;
  ctx.fillRect(0, H - 96, W, 96);
  ctx.fillStyle = GOLD;
  ctx.fillRect(0, H - 96, W, 7);
  const footer = [term, 'Gradify · EVSU Grading System'].filter(Boolean).join('   |   ');
  fitText(ctx, footer, { x: W / 2, y: H - 36, size: 28, weight: 400, maxWidth: 980, color: 'rgba(255, 255, 255, 0.92)', spacing: 1 });

  return canvas.toDataURL('image/png');
}

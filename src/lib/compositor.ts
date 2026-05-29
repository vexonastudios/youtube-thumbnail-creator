/**
 * Thumbnail compositor — sharp-based, 1280×720
 *
 * Layer order (with cutout):
 *   1. Background image  (original crop, contrast-boosted)
 *   2. Gradient SVG      (text-zone colour)
 *   3. Speaker cutout    (transparent PNG — sits IN FRONT of gradient)
 *   4. Text SVG          (title + name — always on top)
 *   5. Logo
 *
 * Layer order (no cutout, original behaviour):
 *   1. Image (contrast-boosted)
 *   2. Full overlay SVG (gradient + text)
 *   3. Logo
 */
import sharp from "sharp";
import path from "path";
import fs from "fs";
import { ThumbnailConfig, GRADIENT_PRESETS, FontStyle, FONT_STYLES } from "./types";

const W = 1280;
const H = 720;

// ─── Font embedding ───────────────────────────────────────────────────────────
// Fonts are stored in public/fonts/ as TTF files.
// We embed them as base64 @font-face so librsvg always finds them.

const FONTS_DIR = path.join(process.cwd(), "public", "fonts");

const FONT_FILES: Record<Exclude<FontStyle, "impact">, string> = {
  oswald:     "Oswald-Bold.ttf",
  bebas:      "BebasNeue-Regular.ttf",
  montserrat: "Montserrat-ExtraBold.ttf",
  teko:       "Teko-SemiBold.ttf",
};

// Cache to avoid re-reading from disk on every render
const fontB64Cache: Partial<Record<FontStyle, string>> = {};

function getFontFaceCSS(style: FontStyle): string {
  if (style === "impact") return ""; // system font, no embedding needed

  if (!fontB64Cache[style]) {
    const file = path.join(FONTS_DIR, FONT_FILES[style as Exclude<FontStyle, "impact">]);
    try {
      const buf = fs.readFileSync(file);
      fontB64Cache[style] = buf.toString("base64");
    } catch (e) {
      console.warn(`[compositor] Could not load font file ${file}:`, e);
      return "";
    }
  }

  const { family } = FONT_STYLES[style];
  const b64 = fontB64Cache[style]!;
  return `@font-face {
    font-family: '${family}';
    src: url('data:font/truetype;base64,${b64}') format('truetype');
  }`;
}

// ─── Auto-fitting text layout ─────────────────────────────────────────────────
// We have W/2 = 640px for the text zone; leave ~40px padding each side → 560px.
const TEXT_ZONE_PX = 560;
const FONT_SIZES   = [70, 62, 54, 48, 42, 36];

function wordWrap(title: string, maxChars: number): string[] {
  const words = title.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? cur + " " + w : w;
    if (candidate.length <= maxChars) { cur = candidate; }
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function autoFitText(title: string, charWidth: number, sizeOverride?: number): { lines: string[]; fs: number } {
  if (sizeOverride && sizeOverride > 0) {
    const charsPerLine = Math.floor(TEXT_ZONE_PX / (sizeOverride * charWidth));
    return { lines: wordWrap(title, charsPerLine).slice(0, 4), fs: sizeOverride };
  }
  for (const fs of FONT_SIZES) {
    const charsPerLine = Math.floor(TEXT_ZONE_PX / (fs * charWidth));
    const lines = wordWrap(title, charsPerLine);
    if (lines.length <= 4) return { lines, fs };
  }
  const charsPerLine = Math.floor(TEXT_ZONE_PX / (36 * charWidth));
  return { lines: wordWrap(title, charsPerLine).slice(0, 4), fs: 36 };
}

function escapeXml(s: string) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
          .replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}

// ─── geometry helpers ─────────────────────────────────────────────────────────
function getGeometry(config: ThumbnailConfig) {
  const isRight = config.layoutSide === "right";
  const textX   = isRight ? 0       : W / 2;
  const textW   = W / 2;
  const titleX  = isRight ? textW / 2 : W - textW / 2;
  const g1      = isRight ? "0%"   : "100%";
  const g2      = isRight ? "100%" : "0%";
  return { isRight, textX, textW, titleX, g1, g2 };
}

// ─── SVG: gradient-only (no text) ────────────────────────────────────────────
function buildGradientSvg(config: ThumbnailConfig): string {
  const preset = GRADIENT_PRESETS[config.gradientPreset];
  const [c1, c2] = config.gradientColors || preset.colors;
  const { textX, textW, g1, g2 } = getGeometry(config);
  const isClean = config.gradientStyle === "clean";

  const filterDef = isClean ? "" : `
    <filter id="rough" x="-15%" y="-5%" width="130%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.018 0.09"
        numOctaves="4" seed="7" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise"
        scale="38" xChannelSelector="R" yChannelSelector="G"/>
    </filter>`;

  const filterAttr = isClean ? "" : ` filter="url(#rough)"`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="g" x1="${g1}" y1="0%" x2="${g2}" y2="0%">
      <stop offset="0%"   stop-color="${c1}" stop-opacity="0.97"/>
      <stop offset="50%"  stop-color="${c2}" stop-opacity="0.90"/>
      <stop offset="80%"  stop-color="${c2}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
    </linearGradient>${filterDef}
  </defs>
  <rect x="${textX - 60}" y="-80" width="${textW + 240}" height="${H + 160}"
    fill="url(#g)"${filterAttr}/>
  <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(0,0,0,0.10)"/>
</svg>`;
}

// ─── SVG: text-only (no gradient, transparent background) ────────────────────
function buildTextSvg(config: ThumbnailConfig): string {
  const fontStyle = config.fontStyle ?? "impact";
  const fontInfo  = FONT_STYLES[fontStyle];
  const fontFaceCSS = getFontFaceCSS(fontStyle);
  const { titleX } = getGeometry(config);
  const { lines: dLines, fs } = autoFitText(config.title, fontInfo.charWidth, config.fontSizeOverride);
  const lh     = fs * 1.22;
  const startY = H * 0.40 - (dLines.length * lh) / 2;

  const textEls = dLines.map((line, i) => `
    <text x="${titleX}" y="${startY + i * lh + fs}"
      font-family="${fontInfo.family}" font-size="${fs}" font-weight="900"
      fill="white" text-anchor="middle" filter="url(#ts)">${escapeXml(line)}</text>`).join("");

  const nameEl = config.preacherName ? `
    <text x="${titleX}" y="${startY + dLines.length * lh + fs + 26}"
      font-family="${fontInfo.family}" font-size="30" font-weight="400"
      fill="rgba(255,255,255,0.88)" text-anchor="middle">${escapeXml(config.preacherName)}</text>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <style>${fontFaceCSS}</style>
    <filter id="ts">
      <feDropShadow dx="2" dy="4" stdDeviation="5" flood-color="rgba(0,0,0,0.85)"/>
    </filter>
  </defs>
  ${textEls}
  ${nameEl}
</svg>`;
}

// ─── SVG: full overlay (gradient + text, original behaviour) ─────────────────
function buildFullOverlaySvg(config: ThumbnailConfig): string {
  const fontStyle = config.fontStyle ?? "impact";
  const fontInfo  = FONT_STYLES[fontStyle];
  const fontFaceCSS = getFontFaceCSS(fontStyle);
  const preset = GRADIENT_PRESETS[config.gradientPreset];
  const [c1, c2] = config.gradientColors || preset.colors;
  const { textX, textW, titleX, g1, g2 } = getGeometry(config);
  const { lines: dLines, fs } = autoFitText(config.title, fontInfo.charWidth, config.fontSizeOverride);
  const lh     = fs * 1.22;
  const startY = H * 0.40 - (dLines.length * lh) / 2;
  const isClean = config.gradientStyle === "clean";

  const textEls = dLines.map((line, i) => `
    <text x="${titleX}" y="${startY + i * lh + fs}"
      font-family="${fontInfo.family}" font-size="${fs}" font-weight="900"
      fill="white" text-anchor="middle" filter="url(#ts)">${escapeXml(line)}</text>`).join("");

  const nameEl = config.preacherName ? `
    <text x="${titleX}" y="${startY + dLines.length * lh + fs + 26}"
      font-family="${fontInfo.family}" font-size="30" font-weight="400"
      fill="rgba(255,255,255,0.88)" text-anchor="middle">${escapeXml(config.preacherName)}</text>` : "";

  const filterDef = isClean ? "" : `
    <filter id="rough" x="-15%" y="-5%" width="130%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.018 0.09"
        numOctaves="4" seed="7" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise"
        scale="38" xChannelSelector="R" yChannelSelector="G"/>
    </filter>`;
  const filterAttr = isClean ? "" : ` filter="url(#rough)"`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <style>${fontFaceCSS}</style>
    <linearGradient id="g" x1="${g1}" y1="0%" x2="${g2}" y2="0%">
      <stop offset="0%"   stop-color="${c1}" stop-opacity="0.97"/>
      <stop offset="50%"  stop-color="${c2}" stop-opacity="0.90"/>
      <stop offset="80%"  stop-color="${c2}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
    </linearGradient>${filterDef}
    <filter id="ts">
      <feDropShadow dx="2" dy="4" stdDeviation="5" flood-color="rgba(0,0,0,0.85)"/>
    </filter>
  </defs>
  <rect x="${textX - 60}" y="-80" width="${textW + 240}" height="${H + 160}"
    fill="url(#g)"${filterAttr}/>
  <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(0,0,0,0.10)"/>
  ${textEls}
  ${nameEl}
</svg>`;
}

// ─── contrast/sharpen helper ──────────────────────────────────────────────────
async function enhance(buf: Buffer, w: number, h: number): Promise<Buffer> {
  return sharp(buf)
    .resize(w, h, { fit: "fill" })
    .linear(1.15, -(128 * 0.15))
    .modulate({ saturation: 1.20, brightness: 1.04 })
    .sharpen({ sigma: 1.1, m1: 0.4, m2: 0.3 })
    .jpeg({ quality: 95 })
    .toBuffer();
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function generateThumbnail(
  config:              ThumbnailConfig,
  preacherImageBuffer: Buffer,   // cutout PNG (transparent) or plain JPEG crop
  logoBuffer?:         Buffer | null,
  backgroundBuffer?:   Buffer | null  // original crop used as BG when cutout provided
): Promise<Buffer> {

  let out: Buffer;

  if (backgroundBuffer) {
    // ── Layered mode: blurred bg → gradient → cutout → text → logo ──────────
    // backgroundBuffer here is the BLURRED original crop (not the raw original).
    // Transparent areas of the cutout show the blurred bokeh + gradient beneath.

    // 1. Blurred background (resize to canvas — already blurred by the blur-bg API)
    const bg = await sharp(backgroundBuffer)
      .resize(W, H, { fit: "fill" })
      .jpeg({ quality: 95 })
      .toBuffer();

    // 2. Gradient over blurred background
    const gradientSvg = Buffer.from(buildGradientSvg(config));
    let step = await sharp(bg)
      .composite([{ input: gradientSvg, top: 0, left: 0 }])
      .jpeg({ quality: 95 })
      .toBuffer();

    // 3. Speaker cutout on top of gradient (ensure it's 1280×720 PNG with alpha)
    const cutout = await sharp(preacherImageBuffer)
      .resize(W, H, { fit: "fill" })
      .ensureAlpha()
      .png()
      .toBuffer();

    step = await sharp(step)
      .composite([{ input: cutout, top: 0, left: 0, blend: "over" }])
      .jpeg({ quality: 95 })
      .toBuffer();

    // 4. Text on top of everything
    const textSvg = Buffer.from(buildTextSvg(config));
    out = await sharp(step)
      .composite([{ input: textSvg, top: 0, left: 0 }])
      .jpeg({ quality: 95 })
      .toBuffer();

  } else if (/* plain remove-bg: dark fill base */ true) {
    // ── Dark-fill mode: cutout over dark+gradient (no background image) ──────
    // Used when BG was removed but NOT blurred — gives a clean dark studio look.

    // 1. Solid dark background
    const base = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 10, g: 13, b: 20 } },
    })
      .jpeg({ quality: 95 })
      .toBuffer();

    // 2. Gradient over dark base
    const gradientSvg = Buffer.from(buildGradientSvg(config));
    let step = await sharp(base)
      .composite([{ input: gradientSvg, top: 0, left: 0 }])
      .jpeg({ quality: 95 })
      .toBuffer();

    // 3. Speaker cutout on top of gradient
    const cutout = await sharp(preacherImageBuffer)
      .resize(W, H, { fit: "fill" })
      .ensureAlpha()
      .png()
      .toBuffer();

    step = await sharp(step)
      .composite([{ input: cutout, top: 0, left: 0, blend: "over" }])
      .jpeg({ quality: 95 })
      .toBuffer();

    // 4. Text on top of everything
    const textSvg = Buffer.from(buildTextSvg(config));
    out = await sharp(step)
      .composite([{ input: textSvg, top: 0, left: 0 }])
      .jpeg({ quality: 95 })
      .toBuffer();

  } else {
    // ── Original single-layer mode ───────────────────────────────────────────
    const bg = await enhance(preacherImageBuffer, W, H);
    out = await sharp(bg)
      .composite([{ input: Buffer.from(buildFullOverlaySvg(config)), top: 0, left: 0 }])
      .jpeg({ quality: 95 })
      .toBuffer();
  }

  // 5. Logo (always on top) — tinted white so it works on any gradient
  if (logoBuffer) {
    const sz = 160;

    // Step 1: Resize and get the alpha mask from the original PNG
    const resized = await sharp(logoBuffer)
      .resize(sz, sz, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .png()
      .toBuffer();

    // Step 2: Extract just the alpha channel as a mask
    const alphaMask = await sharp(resized)
      .extractChannel("alpha")
      .toBuffer();

    // Step 3: Create a solid white canvas the same size
    const whiteFill = await sharp({
      create: { width: sz, height: sz, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();

    // Step 4: Re-apply the alpha mask to the white fill → white silhouette logo
    const logoTinted = await sharp(whiteFill)
      .ensureAlpha()
      .joinChannel(alphaMask)
      .png()
      .toBuffer();

    const isRight = config.layoutSide === "right";
    const lx = isRight ? 44 : W - sz - 44;
    const ly = H - sz - 18;

    out = await sharp(out)
      .composite([{ input: logoTinted, left: lx, top: ly, blend: "over" }])
      .jpeg({ quality: 95 })
      .toBuffer();
  }

  return out;
}

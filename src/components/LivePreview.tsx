"use client";

import { useEffect, useRef } from "react";
import { ThumbnailConfig, GRADIENT_PRESETS, FONT_STYLES } from "@/lib/types";

interface Props {
  config: ThumbnailConfig;
  croppedBase64: string | null;
  bgCutout: boolean;             // true when BG was removed → transparent PNG
  blurredBgBase64: string | null; // blurred JPEG background for the combined mode
  originalCroppedBase64: string | null; // original JPEG before BG removal (unused now, kept for compat)
  logoBase64: string | null;
}

// ── Font loading (module-level cache, loaded once per session) ────────────────
const FONT_CACHE = new Map<string, Promise<void>>();

async function ensureFont(style: string): Promise<void> {
  if (style === "impact") return; // system font
  if (FONT_CACHE.has(style)) return FONT_CACHE.get(style)!;

  const FONT_MAP: Record<string, { family: string; url: string }> = {
    oswald:     { family: "Oswald",      url: "/fonts/Oswald-Bold.ttf"          },
    bebas:      { family: "Bebas Neue",  url: "/fonts/BebasNeue-Regular.ttf"    },
    montserrat: { family: "Montserrat",  url: "/fonts/Montserrat-ExtraBold.ttf" },
    teko:       { family: "Teko",        url: "/fonts/Teko-SemiBold.ttf"        },
  };

  const info = FONT_MAP[style];
  if (!info) return;

  const p = new FontFace(info.family, `url(${info.url})`).load().then(face => {
    document.fonts.add(face);
  });
  FONT_CACHE.set(style, p);
  return p;
}

// ── Canvas dimensions (internal) ──────────────────────────────────────────────
const CW = 1280;
const CH = 720;

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Word wrap — mirrors compositor's char-count logic exactly ────────────────
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
  const TEXT_ZONE_PX = 560; // same constant as compositor
  const FONT_SIZES   = [70, 62, 54, 48, 42, 36];
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

function fontFamily(style: string): string {
  switch (style) {
    case "oswald":     return "Oswald";
    case "bebas":      return "'Bebas Neue'";
    case "montserrat": return "Montserrat";
    case "teko":       return "Teko";
    default:           return "Impact, Arial Black";
  }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LivePreview({ config, croppedBase64, bgCutout, blurredBgBase64, originalCroppedBase64, logoBase64 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Track whether the current draw is still valid (avoid stale image loads)
  const drawIdRef = useRef(0);

  useEffect(() => {
    const id = ++drawIdRef.current;

    async function draw() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // ── Load font first so measureText is accurate ──────────────────────
      const fontStyle = config.fontStyle ?? "impact";
      await ensureFont(fontStyle);
      if (drawIdRef.current !== id) return; // aborted

      // ── Background fill ─────────────────────────────────────────────────
      ctx.clearRect(0, 0, CW, CH);
      ctx.fillStyle = "#111118";
      ctx.fillRect(0, 0, CW, CH);

      // ── 1. Background layer ───────────────────────────────────────────────────
      // • bgCutout + blurredBgBase64: draw blurred JPEG as background (mirrors
      //   the combined Remove+Blur server compositor path)
      // • bgCutout only (plain remove-bg): canvas dark fill IS the background
      // • No cutout: draw the processed JPEG (blur or plain crop)
      const bgSrc = bgCutout
        ? (blurredBgBase64 ?? null)   // blurred bg or nothing (dark fill)
        : croppedBase64;               // normal JPEG (plain crop or blur-only)
      if (bgSrc) {
        await new Promise<void>(res => {
          const img = new Image();
          img.onload  = () => { if (drawIdRef.current === id) ctx.drawImage(img, 0, 0, CW, CH); res(); };
          img.onerror = () => res();
          img.src = `data:image/jpeg;base64,${bgSrc}`;
        });
        if (drawIdRef.current !== id) return;
      }

      // ── 2. Gradient overlay ─────────────────────────────────────────────
      const isRight = config.layoutSide === "right";
      const preset  = GRADIENT_PRESETS[config.gradientPreset];
      const [c1, c2] = config.gradientColors ?? preset.colors;

      // Gradient covers the half of the canvas where the text will be
      const gx1 = isRight ? 0       : CW;
      const gx2 = isRight ? CW * 0.72 : CW * 0.28;
      const grad = ctx.createLinearGradient(gx1, 0, gx2, 0);

      if (isRight) {
        grad.addColorStop(0.00, hexToRgba(c1, 0.97));
        grad.addColorStop(0.50, hexToRgba(c2, 0.90));
        grad.addColorStop(0.80, hexToRgba(c2, 0.35));
        grad.addColorStop(1.00, hexToRgba(c2, 0.00));
      } else {
        grad.addColorStop(0.00, hexToRgba(c2, 0.00));
        grad.addColorStop(0.20, hexToRgba(c2, 0.35));
        grad.addColorStop(0.50, hexToRgba(c2, 0.90));
        grad.addColorStop(1.00, hexToRgba(c1, 0.97));
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, CW, CH);

      // Subtle global dark veil
      ctx.fillStyle = "rgba(0,0,0,0.10)";
      ctx.fillRect(0, 0, CW, CH);

      // ── 2b. Cutout — transparent PNG stretched to fill full canvas ────────
      // This exactly mirrors the server compositor: sharp resizes the cutout to
      // 1280×720 (fit:fill) then composites it "over" the gradient. Transparent
      // pixels let the gradient show through; opaque pixels (the preacher) win.
      if (croppedBase64 && bgCutout) {
        await new Promise<void>(res => {
          const img = new Image();
          img.onload = () => {
            if (drawIdRef.current !== id) return res();
            ctx.drawImage(img, 0, 0, CW, CH); // fill entire canvas — same as sharp fit:fill
            res();
          };
          img.onerror = () => res();
          img.src = `data:image/png;base64,${croppedBase64}`; // PNG to preserve alpha
        });
        if (drawIdRef.current !== id) return;
      }

      // ── 3. Title text ───────────────────────────────────────────────────
      const titleX    = isRight ? CW * 0.25 : CW * 0.75;
      const ff        = fontFamily(fontStyle);

      // Auto-fit using same char-count logic as compositor
      const fontInfo = FONT_STYLES[fontStyle as keyof typeof FONT_STYLES];
      const { lines, fs } = autoFitText(config.title, fontInfo.charWidth, config.fontSizeOverride);

      const lh     = fs * 1.22;
      const startY = CH * 0.40 - (lines.length * lh) / 2;

      ctx.font        = `900 ${fs}px ${ff}`;
      ctx.fillStyle   = "white";
      ctx.textAlign   = "center";
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur  = 10;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 4;

      lines.forEach((line, i) => {
        ctx.fillText(line, titleX, startY + i * lh + fs);
      });

      // Speaker name
      if (config.preacherName) {
        ctx.font      = `400 30px ${ff}`;
        ctx.fillStyle = "rgba(255,255,255,0.88)";
        ctx.shadowBlur = 6;
        ctx.fillText(
          config.preacherName,
          titleX,
          startY + lines.length * lh + fs + 30
        );
      }

      // Reset shadow
      ctx.shadowColor = "transparent";
      ctx.shadowBlur  = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // ── 4. Logo — white-tinted to match server compositor ─────────────────
      if (logoBase64) {
        await new Promise<void>(res => {
          const img = new Image();
          img.onload = () => {
            if (drawIdRef.current !== id) return res();
            const sz  = 160;
            const lx  = isRight ? 44 : CW - sz - 44;
            const ly  = CH - sz - 18;
            const sc  = Math.min(sz / img.width, sz / img.height);
            const dw  = img.width  * sc;
            const dh  = img.height * sc;
            const dx  = lx + (sz - dw) / 2;
            const dy  = ly + (sz - dh) / 2;

            // Draw logo normally first
            ctx.drawImage(img, dx, dy, dw, dh);

            // White-tint: fill white over the logo using source-atop blend
            // so only the opaque pixels of the logo get painted white
            ctx.save();
            ctx.globalCompositeOperation = "source-atop";
            // Clip to logo bounding box so we only paint over the logo area
            ctx.beginPath();
            ctx.rect(dx, dy, dw, dh);
            ctx.clip();
            ctx.fillStyle = "white";
            ctx.fillRect(dx, dy, dw, dh);
            ctx.restore();

            res();
          };
          img.onerror = () => res();
          img.src = `data:image/png;base64,${logoBase64}`;
        });
      }
    }

    draw();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    croppedBase64, bgCutout, blurredBgBase64, originalCroppedBase64, logoBase64,
    config.layoutSide, config.gradientPreset, config.gradientColors,
    config.fontStyle, config.fontSizeOverride,
    config.title, config.preacherName,
  ]);

  return (
    <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
      {/* Badge */}
      <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)", borderRadius: 6, padding: "3px 10px", fontSize: "0.7rem", fontWeight: 700, color: "rgba(255,255,255,0.8)", letterSpacing: "0.05em", zIndex: 2 }}>
        LIVE PREVIEW
      </div>
      <canvas
        ref={canvasRef}
        width={CW}
        height={CH}
        style={{ width: "100%", display: "block" }}
      />
    </div>
  );
}

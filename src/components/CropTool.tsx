"use client";

import { useRef, useState, useCallback } from "react";

interface CropToolProps {
  imageBase64: string;
  mimeType: string;
  layoutSide: "left" | "right";
  onCrop: (croppedBase64: string) => void;
  onBack: () => void;
}

export default function CropTool({ imageBase64, mimeType, layoutSide, onCrop, onBack }: CropToolProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef       = useRef<HTMLImageElement>(null);

  const [naturalSize, setNaturalSize] = useState({ w: 1, h: 1 });
  const [zoom,        setZoom]        = useState(1);
  const [panX,        setPanX]        = useState(0);
  const [panY,        setPanY]        = useState(0);
  const [dragging,    setDragging]    = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });

  // On image load: fit to container width by default
  const handleLoad = useCallback(() => {
    const img = imgRef.current;
    const box = containerRef.current;
    if (!img || !box) return;
    const { naturalWidth: w, naturalHeight: h } = img;
    setNaturalSize({ w, h });
    const rect = box.getBoundingClientRect();
    // Fit to fill (cover) by default
    setZoom(Math.max(rect.width / w, rect.height / h));
    setPanX(0);
    setPanY(0);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setPanX(p => p + dx);
    setPanY(p => p + dy);
  }, [dragging]);

  const onMouseUp = useCallback(() => setDragging(false), []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.max(0.1, Math.min(z * (1 - e.deltaY * 0.001), 12)));
  }, []);

  const changeZoom = (factor: number) =>
    setZoom(z => Math.max(0.1, Math.min(z * factor, 12)));

  /**
   * Capture the visible 16:9 region to a 1280×720 canvas.
   * Any area not covered by the image is filled with mirror-reflected
   * copies of the image (horizontal + vertical flip as needed),
   * creating a seamless, natural-looking background extension.
   */
  const applyCrop = useCallback(() => {
    const img = imgRef.current;
    const box = containerRef.current;
    if (!img || !box) return;

    const { width: cW, height: cH } = box.getBoundingClientRect();
    const sx = 1280 / cW;
    const sy = 720  / cH;

    // Position of the main image in canvas coords
    const iW = naturalSize.w * zoom * sx;
    const iH = naturalSize.h * zoom * sy;
    const iX = (cW / 2 - naturalSize.w * zoom / 2 + panX) * sx;
    const iY = (cH / 2 - naturalSize.h * zoom / 2 + panY) * sy;

    const canvas = document.createElement("canvas");
    canvas.width  = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d")!;

    /**
     * Draw the image (or its mirror) at a given tile position.
     * Each tile is drawn 2px larger on every side to eliminate
     * the sub-pixel seam that appears at tile boundaries.
     */
    const OV = 2; // overlap in canvas pixels
    const drawTile = (tx: number, ty: number, flipX: boolean, flipY: boolean) => {
      ctx.save();
      // Shift origin so the tile starts OV px before its nominal position
      ctx.translate(
        tx + (flipX ? iW + OV : -OV),
        ty + (flipY ? iH + OV : -OV)
      );
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.drawImage(img, 0, 0, iW + OV * 2, iH + OV * 2);
      ctx.restore();
    };

    // Draw a 3×3 grid of mirror tiles to cover all possible gap areas.
    // col -1: mirror left, col 0: original, col +1: mirror right
    // row -1: mirror above, row 0: original, row +1: mirror below
    for (let row = -1; row <= 1; row++) {
      for (let col = -1; col <= 1; col++) {
        drawTile(iX + col * iW, iY + row * iH, col % 2 !== 0, row % 2 !== 0);
      }
    }

    onCrop(canvas.toDataURL("image/jpeg", 0.95).split(",")[1]);
  }, [naturalSize, zoom, panX, panY, onCrop]);

  const textSide     = layoutSide === "left" ? "right" : "left";
  const preacherSide = layoutSide;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
        <strong style={{ color: "var(--text-primary)" }}>Drag</strong> to pan &nbsp;·&nbsp;
        <strong style={{ color: "var(--text-primary)" }}>Scroll</strong> to zoom &nbsp;·&nbsp;
        Frame the preacher in the <strong style={{ color: "var(--accent)" }}>{preacherSide}</strong> half.
        Gaps fill automatically with a mirrored reflection.
      </p>

      {/* 16:9 crop canvas */}
      <div
        ref={containerRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        style={{
          position: "relative", width: "100%", aspectRatio: "16/9",
          overflow: "hidden", borderRadius: 10,
          border: "2px solid var(--border-hover)", background: "#0a0d14",
          cursor: dragging ? "grabbing" : "grab", userSelect: "none",
        }}
      >
        {/* Live preview using CSS — mirrors via box-shadow hack isn't trivial,
            so we just show the image panned/zoomed; canvas handles the mirror on apply */}
        <img
          ref={imgRef}
          src={`data:${mimeType};base64,${imageBase64}`}
          onLoad={handleLoad}
          draggable={false}
          alt="crop preview"
          style={{
            position: "absolute", left: "50%", top: "50%",
            transform: `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${zoom})`,
            transformOrigin: "center center",
            pointerEvents: "none", maxWidth: "none", userSelect: "none",
          }}
        />

        {/* Mirror fill hint — shown in gaps */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
          background: "repeating-linear-gradient(45deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 8px)",
          zIndex: 0 }} />

        {/* Text side guide overlay */}
        <div style={{
          position: "absolute", top: 0, bottom: 0, pointerEvents: "none", zIndex: 2,
          ...(textSide === "left" ? { left: 0, width: "50%" } : { right: 0, width: "50%" }),
          background: "rgba(88,101,242,0.18)",
          borderRight: textSide === "left" ? "2px dashed rgba(255,255,255,0.3)" : undefined,
          borderLeft:  textSide === "right" ? "2px dashed rgba(255,255,255,0.3)" : undefined,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.08em", transform: "rotate(-90deg)", whiteSpace: "nowrap" }}>
            TEXT + GRADIENT
          </span>
        </div>

        {/* Preacher zone label */}
        <div style={{ position: "absolute", bottom: 8, pointerEvents: "none", zIndex: 3,
          ...(preacherSide === "left" ? { left: 8 } : { right: 8 }) }}>
          <span style={{ background: "rgba(0,0,0,0.6)", color: "rgba(255,255,255,0.75)", fontSize: "0.68rem", padding: "3px 8px", borderRadius: 4, fontWeight: 600 }}>
            👤 PREACHER ZONE
          </span>
        </div>
      </div>

      {/* Zoom controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={() => changeZoom(0.85)}
          style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, width: 32, height: 32, color: "var(--text-primary)", cursor: "pointer", fontSize: 18 }}>−</button>
        <input type="range" min={0.1} max={5} step={0.005} value={zoom}
          onChange={e => setZoom(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: "var(--accent)" }} />
        <button onClick={() => changeZoom(1.15)}
          style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, width: 32, height: 32, color: "var(--text-primary)", cursor: "pointer", fontSize: 18 }}>+</button>
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", minWidth: 44, textAlign: "right" }}>{Math.round(zoom * 100)}%</span>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onBack}
          style={{ flex: 1, padding: "10px", background: "transparent", border: "1px solid var(--border)", borderRadius: 9, color: "var(--text-secondary)", cursor: "pointer" }}>
          ← Back
        </button>
        <button onClick={applyCrop}
          style={{ flex: 2, padding: "10px", background: "linear-gradient(135deg,#5865f2,#7c3aed)", border: "none", borderRadius: 9, color: "white", fontWeight: 800, cursor: "pointer", fontSize: "0.95rem" }}>
          ✓ Use This Crop
        </button>
      </div>
    </div>
  );
}

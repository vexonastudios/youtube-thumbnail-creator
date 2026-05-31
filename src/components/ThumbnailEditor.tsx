"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { YouTubeVideo, ThumbnailConfig, GradientPreset, GRADIENT_PRESETS, FontStyle, FONT_STYLES } from "@/lib/types";
import { loadSettingsFromServer, saveSettings, buildApiHeaders, buildApiHeadersAsync, AppSettings } from "@/lib/settings";
import CropTool from "./CropTool";
import LivePreview from "./LivePreview";

interface Props {
  video: YouTubeVideo;
  logoBase64: string | null;
  onClose: () => void;
  onUploaded: (thumbnailBase64?: string) => void;
}

type Step = "upload" | "crop" | "customize" | "preview" | "done";

export default function ThumbnailEditor({ video, logoBase64, onClose, onUploaded }: Props) {
  const [step,               setStep]               = useState<Step>("upload");
  const [rawImageBase64,     setRawImageBase64]      = useState<string | null>(null);
  const [rawMime,            setRawMime]             = useState<"image/jpeg"|"image/png">("image/jpeg");
  const [croppedBase64,      setCroppedBase64]       = useState<string | null>(null);
  const [originalCroppedBase64, setOriginalCroppedBase64] = useState<string | null>(null);
  const [thumbnailBase64,    setThumbnailBase64]     = useState<string | null>(null);
  const [generating,         setGenerating]          = useState(false);
  const [uploading,          setUploading]           = useState(false);
  const [analyzing,          setAnalyzing]           = useState(false);
  const [removingBg,         setRemovingBg]          = useState(false);
  const [bgRemoved,          setBgRemoved]            = useState(false);
  const [bgCutout,           setBgCutout]             = useState(false); // true only for transparent PNG cutouts
  const [blurredBgBase64,    setBlurredBgBase64]      = useState<string | null>(null); // blurred JPEG used as background in combined mode
  const [blurringBg,         setBlurringBg]           = useState(false);
  const [removingAndBlurring,setRemovingAndBlurring]  = useState(false);
  const [blurAmount,         setBlurAmount]           = useState(18);
  const [enhancing,          setEnhancing]            = useState(false);
  const [preEnhanceBase64,   setPreEnhanceBase64]     = useState<string | null>(null);
  const [statusMsg,          setStatusMsg]            = useState("");
  const [error,              setError]               = useState<string | null>(null);
  const [settings,           setSettings]            = useState<AppSettings | null>(null);
  const [ytFrames,           setYtFrames]            = useState<{ b64: string; mimeType: string }[] | null>(null);
  const [loadingFrames,      setLoadingFrames]       = useState(false);
  const [customSpeaker,      setCustomSpeaker]        = useState(false);
  const [extraSpeakers,      setExtraSpeakers]        = useState<string[]>([]);
  // Clothing color match
  const [matchingColor,      setMatchingColor]        = useState(false);
  const [matchedColors,      setMatchedColors]        = useState<{ dark: string; accent: string; label: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsRef  = useRef<AppSettings | null>(null);

  const [config, setConfig] = useState<ThumbnailConfig>({
    videoId:        video.id,
    title:          video.title,
    preacherImageUrl: "",
    faceDirection:  "right",
    layoutSide:     "left",
    gradientColors: GRADIENT_PRESETS.slate.colors,
    gradientPreset: "slate",
    gradientStyle:  "grungy",
    fontStyle:      "impact",
    preacherName:   "",
  });

  useEffect(() => {
    loadSettingsFromServer().then(s => {
      setSettings(s);
      settingsRef.current = s;
      setExtraSpeakers(s.customSpeakerNames || []);
      // Restore persisted font defaults
      if (s.defaultFontStyle)    setConfig(c => ({ ...c, fontStyle: s.defaultFontStyle as FontStyle }));
      if (s.defaultFontSize)     setConfig(c => ({ ...c, fontSizeOverride: s.defaultFontSize as number }));
    });
  }, []);

  // ── Escape key to close modal ────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // ── Image selection ───────────────────────────────────────────────────────
  const pickFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setRawImageBase64(dataUrl.split(",")[1]);
      setRawMime(file.type === "image/png" ? "image/png" : "image/jpeg");
      setBgRemoved(false);
      setStep("crop");
    };
    reader.readAsDataURL(file);
  }, []);

  const loadYtFrames = useCallback(async () => {
    setLoadingFrames(true);
    try {
      // Pass the video's existing thumbnail as a fallback for private/unlisted videos
      const url = video.thumbnailUrl
        ? `/api/youtube-frames/${video.id}?fallbackUrl=${encodeURIComponent(video.thumbnailUrl)}`
        : `/api/youtube-frames/${video.id}`;
      const res  = await fetch(url);
      const data = await res.json();
      let frames: { b64: string; mimeType: string }[] = data.frames || [];

      // If no high-res frames found, fall back to the video's existing thumbnail
      if (frames.length === 0 && video.thumbnailUrl) {
        try {
          const fallback = await fetch(video.thumbnailUrl);
          if (fallback.ok) {
            const buf = await fallback.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = "";
            for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
            frames = [{
              b64:      window.btoa(binary),
              mimeType: "image/jpeg",
            }];
          }
        } catch { /* ignore */ }
      }

      setYtFrames(frames);
    } catch { setYtFrames([]); }
    finally  { setLoadingFrames(false); }
  }, [video.id, video.thumbnailUrl]);

  const selectYtFrame = useCallback((b64: string, mime: string) => {
    setRawImageBase64(b64);
    setRawMime(mime as "image/jpeg"|"image/png");
    setBgRemoved(false);
    // Don't clear ytFrames — keep them so going back still shows the grid
    setStep("crop");
  }, []);

  // ── Crop applied ──────────────────────────────────────────────────────────
  const handleCrop = useCallback((b64: string) => {
    setCroppedBase64(b64);
    setOriginalCroppedBase64(b64); // save original before any BG processing
    setStep("customize");
  }, []);

  // ── Gemini analysis (optional, in customize step) ──────────────────────
  const runAnalysis = useCallback(async () => {
    if (!rawImageBase64) return;
    setAnalyzing(true); setError(null);
    setStatusMsg("Analyzing face direction…");
    try {
      const res  = await fetch("/api/analyze", {
        method: "POST",
        headers: await buildApiHeadersAsync(),
        body:    JSON.stringify({ imageBase64: rawImageBase64, mimeType: rawMime }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      const dir: "left"|"right"|"center" = data.analysis.faceDirection;
      const side: "left"|"right" = dir === "left" ? "right" : "left";
      setConfig(c => ({ ...c, faceDirection: dir, layoutSide: side }));
      setStatusMsg(`Detected: facing ${dir} → preacher on ${side}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally { setAnalyzing(false); }
  }, [rawImageBase64, rawMime, settings]);

  // ── Background removal ────────────────────────────────────────────────────
  const handleRemoveBg = useCallback(async () => {
    if (!croppedBase64) return;
    setRemovingBg(true); setError(null);
    setStatusMsg("Removing background…");
    try {
      const blob = b64ToBlob(croppedBase64, "image/jpeg");
      const form = new FormData();
      form.append("image", blob, "image.jpg");
      const hdrs = await buildApiHeadersAsync();
      delete hdrs["Content-Type"];
      const res = await fetch("/api/remove-bg", { method: "POST", headers: hdrs, body: form });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "BG removal failed"); }
      const resultBlob = await res.blob();
      const reader     = new FileReader();
      reader.onload = (e) => {
        setCroppedBase64((e.target?.result as string).split(",")[1]);
        setBgRemoved(true);
        setBgCutout(true); // real transparent PNG cutout — enables layered compositor
        setBlurredBgBase64(null); // plain remove-bg — no blurred background
        setStatusMsg("Background removed ✓");
      };
      reader.readAsDataURL(resultBlob);
    } catch (e) {
      setError(e instanceof Error ? e.message : "BG removal failed");
    } finally { setRemovingBg(false); }
  }, [croppedBase64, settings]);

  // ── Background blur ────────────────────────────────────────────────────────
  const handleBlurBg = useCallback(async () => {
    if (!croppedBase64) return;
    setBlurringBg(true); setError(null);
    setStatusMsg(`Blurring background (${blurAmount}%)…`);
    try {
      const blob = b64ToBlob(croppedBase64, "image/jpeg");
      const form = new FormData();
      form.append("image",       blob, "image.jpg");
      form.append("blurAmount",  String(blurAmount));
      const hdrs = await buildApiHeadersAsync();
      delete hdrs["Content-Type"];
      const res = await fetch("/api/blur-bg", { method: "POST", headers: hdrs, body: form });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Blur failed"); }
      const resultBlob = await res.blob();
      const reader     = new FileReader();
      reader.onload = (e) => {
        setCroppedBase64((e.target?.result as string).split(",")[1]);
        setBgRemoved(true);
        setStatusMsg("Background blurred ✓");
      };
      reader.readAsDataURL(resultBlob);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Blur failed");
    } finally { setBlurringBg(false); }
  }, [croppedBase64, blurAmount, settings]);

  // ── Remove BG + Blur BG combined ──────────────────────────────────────────
  // Step 1: blur the original JPEG → save as blurredBgBase64 (background layer)
  // Step 2: remove BG from the original JPEG → transparent PNG cutout
  // Result: preacher sharp on blurred-bokeh bg + gradient on text side
  const handleRemoveAndBlurBg = useCallback(async () => {
    if (!croppedBase64) return;
    setRemovingAndBlurring(true); setError(null);
    setStatusMsg("Blurring background…");
    try {
      const hdrs = await buildApiHeadersAsync();
      delete hdrs["Content-Type"];

      // Step 1: Blur the original JPEG
      const blurBlob = b64ToBlob(croppedBase64, "image/jpeg");
      const blurForm = new FormData();
      blurForm.append("image",      blurBlob, "image.jpg");
      blurForm.append("blurAmount", String(blurAmount));
      const blurRes = await fetch("/api/blur-bg", { method: "POST", headers: hdrs, body: blurForm });
      if (!blurRes.ok) { const d = await blurRes.json(); throw new Error(d.error || "Blur failed"); }
      const blurredB64 = await blobToB64(await blurRes.blob());

      // Step 2: Remove BG from the original JPEG
      setStatusMsg("Removing background…");
      const hdrs2 = await buildApiHeadersAsync();
      delete hdrs2["Content-Type"];
      const removeBlob = b64ToBlob(croppedBase64, "image/jpeg");
      const removeForm = new FormData();
      removeForm.append("image", removeBlob, "image.jpg");
      const removeRes = await fetch("/api/remove-bg", { method: "POST", headers: hdrs2, body: removeForm });
      if (!removeRes.ok) { const d = await removeRes.json(); throw new Error(d.error || "BG removal failed"); }
      const cutoutB64 = await blobToB64(await removeRes.blob());

      setCroppedBase64(cutoutB64);
      setBlurredBgBase64(blurredB64);
      setBgRemoved(true);
      setBgCutout(true);
      setStatusMsg("Remove + Blur done ✓");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove + Blur failed");
    } finally { setRemovingAndBlurring(false); }
  }, [croppedBase64, blurAmount, settings]);

  // ── AI Enhance ────────────────────────────────────────────────────────
  const handleEnhance = useCallback(async () => {
    if (!croppedBase64) return;
    setPreEnhanceBase64(croppedBase64); // save for undo
    setEnhancing(true); setError(null);
    setStatusMsg("Enhancing image…");
    try {
      // When BG was removed, croppedBase64 is a PNG with transparency.
      // Send it as PNG so the enhance API preserves the alpha channel.
      const mime = bgCutout ? "image/png" : "image/jpeg";
      const ext  = bgCutout ? "image.png" : "image.jpg";
      const blob = b64ToBlob(croppedBase64, mime);
      const form = new FormData();
      form.append("image", blob, ext);
      const res = await fetch("/api/enhance", { method: "POST", body: form });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Enhance failed"); }
      const resultBlob = await res.blob();
      const reader = new FileReader();
      reader.onload = (e) => {
        setCroppedBase64((e.target?.result as string).split(",")[1]);
        // bgCutout stays true — the returned PNG still has alpha
        setStatusMsg("Image enhanced ✓");
      };
      reader.readAsDataURL(resultBlob);
    } catch (e) {
      setPreEnhanceBase64(null); // clear on failure
      setError(e instanceof Error ? e.message : "Enhance failed");
    } finally { setEnhancing(false); }
  }, [croppedBase64, bgCutout]);

  // ── Generate thumbnail ────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!croppedBase64) return;
    setGenerating(true); setError(null);
    setStatusMsg("Compositing…");

    // Persist any new custom speaker name for future reuse, and persist font choices
    const PRESETS = ["Jeff Peterson", "James Jennings", "Craig Mussulman"];
    const name = config.preacherName?.trim();
    const isNewSpeaker = customSpeaker && name && !PRESETS.includes(name) && !extraSpeakers.includes(name);
    
    if (isNewSpeaker || config.fontStyle !== settingsRef.current?.defaultFontStyle || config.fontSizeOverride !== settingsRef.current?.defaultFontSize) {
      const updatedSpeakers = isNewSpeaker ? [...extraSpeakers, name] : extraSpeakers;
      if (isNewSpeaker) setExtraSpeakers(updatedSpeakers);
      
      const updates: Partial<AppSettings> = {
        defaultFontStyle: config.fontStyle,
        defaultFontSize: config.fontSizeOverride
      };
      if (isNewSpeaker) updates.customSpeakerNames = updatedSpeakers;
      
      saveSettings(updates).catch(() => {});
      if (settingsRef.current) {
        settingsRef.current = { ...settingsRef.current, ...updates };
      }
    }

    try {
      const res  = await fetch("/api/generate", {
        method:  "POST",
        headers: await buildApiHeadersAsync(),
        body:    JSON.stringify({
          config,
          preacherImageBase64: croppedBase64,
          // Only send backgroundImageBase64 in the combined Remove+Blur mode.
          // blurredBgBase64 is the pre-blurred JPEG that becomes layer 1.
          // For plain remove-bg, no background is sent → compositor uses dark fill.
          ...(bgCutout && blurredBgBase64
            ? { backgroundImageBase64: blurredBgBase64 }
            : {}),
          logoBase64: logoBase64 || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setThumbnailBase64(data.thumbnailBase64);
      setStep("preview");
      setStatusMsg("Ready!");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally { setGenerating(false); }
  }, [croppedBase64, config, logoBase64, settings, customSpeaker, extraSpeakers, bgCutout, blurredBgBase64]);

  // ── Upload to YouTube ─────────────────────────────────────────────────────
  const handleUpload = useCallback(async () => {
    if (!thumbnailBase64) return;
    setUploading(true); setError(null);
    try {
      const res  = await fetch("/api/upload", {
        method:  "POST",
        headers: await buildApiHeadersAsync(),
        body:    JSON.stringify({ videoId: video.id, thumbnailBase64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setStep("done");
      setTimeout(() => onUploaded(thumbnailBase64), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally { setUploading(false); }
  }, [thumbnailBase64, video.id, settings, onUploaded]);

  const handleDownload = () => {
    if (!thumbnailBase64) return;
    const a   = document.createElement("a");
    a.href     = `data:image/jpeg;base64,${thumbnailBase64}`;
    a.download = `thumbnail-${video.id}.jpg`;
    a.click();
  };

  // ── Step labels ───────────────────────────────────────────────────────────
  const STEPS: { key: Step; label: string }[] = [
    { key: "upload",    label: "1. Image"     },
    { key: "crop",      label: "2. Crop"      },
    { key: "customize", label: "3. Customize" },
    { key: "preview",   label: "4. Preview"   },
  ];
  const stepOrder: Step[] = ["upload","crop","customize","preview","done"];
  const stepIdx = (s: Step) => stepOrder.indexOf(s);

  return (
    <div style={{ position:"fixed", inset:0, zIndex:1000, background:"rgba(0,0,0,0.75)", backdropFilter:"blur(8px)", display:"flex", alignItems:"center", justifyContent:"center", padding:"1rem" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background:"var(--bg-secondary)", border:"1px solid var(--border)", borderRadius:16, width:"100%", maxWidth:1100, maxHeight:"92vh", overflowY:"auto", display:"flex", flexDirection:"column" }}>

        {/* Header */}
        <div style={{ padding:"1.25rem 1.5rem", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
          <div>
            <h2 style={{ fontWeight:800, fontSize:"1.1rem" }}>Generate Thumbnail</h2>
            <p style={{ fontSize:"0.8rem", color:"var(--text-secondary)", marginTop:2, maxWidth:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{video.title}</p>
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"none", color:"var(--text-muted)", fontSize:22, cursor:"pointer" }}>✕</button>
        </div>

        {/* Step indicator */}
        <div style={{ padding:"0.85rem 1.5rem", borderBottom:"1px solid var(--border)", display:"flex", gap:6 }}>
          {STEPS.map(({ key, label }) => {
            const active = stepIdx(step) >= stepIdx(key);
            return (
              <div key={key} style={{ fontSize:"0.75rem", fontWeight: active ? 700 : 400, color: active ? "var(--accent)" : "var(--text-muted)", padding:"3px 10px", borderRadius:6, background: active ? "rgba(88,101,242,0.12)" : "transparent" }}>
                {label}
              </div>
            );
          })}
        </div>

        <div style={{ padding:"1.5rem", flex:1 }}>

          {/* ── STEP 1: Upload ─────────────────────────────────────────── */}
          {step === "upload" && (
            <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
              <p style={{ color:"var(--text-secondary)", fontSize:"0.9rem" }}>Upload a photo of the preacher, or pick one of YouTube&apos;s auto-generated frames.</p>

              <div onDrop={e => { e.preventDefault(); const f=e.dataTransfer.files[0]; if(f?.type.startsWith("image/")) pickFile(f); }}
                onDragOver={e => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                style={{ border:"2px dashed var(--border-hover)", borderRadius:12, padding:"2rem", textAlign:"center", cursor:"pointer", transition:"border-color 0.2s" }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor="var(--accent)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor="var(--border-hover)"}>
                <div style={{ fontSize:36, marginBottom:8 }}>📸</div>
                <p style={{ fontWeight:700, marginBottom:4 }}>Drop image here or click to browse</p>
                <p style={{ fontSize:"0.82rem", color:"var(--text-muted)" }}>JPG or PNG — any size, you&apos;ll crop it next</p>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display:"none" }}
                onChange={e => { const f=e.target.files?.[0]; if(f) pickFile(f); }} />

              <div style={{ borderTop:"1px solid var(--border)", paddingTop:"0.75rem", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <span style={{ fontSize:"0.85rem", color:"var(--text-secondary)", fontWeight:600 }}>Or pick a YouTube frame:</span>
                {!ytFrames && (
                  <button id="load-yt-frames-btn" onClick={loadYtFrames} disabled={loadingFrames}
                    style={{ background:"transparent", border:"1px solid var(--border-hover)", borderRadius:7, padding:"6px 14px", color:"var(--text-secondary)", fontSize:"0.82rem", cursor: loadingFrames ? "not-allowed":"pointer" }}>
                    {loadingFrames ? "Loading…" : "🎬 Browse YouTube Frames"}
                  </button>
                )}
              </div>
              {ytFrames && ytFrames.length === 0 && <p style={{ fontSize:"0.8rem", color:"var(--text-muted)" }}>No frames available.</p>}
              {ytFrames && ytFrames.length > 0 && (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:10 }}>
                  {ytFrames.map((f, i) => (
                    <button key={i} onClick={() => selectYtFrame(f.b64, f.mimeType)}
                      style={{ padding:0, border:"2px solid var(--border)", borderRadius:8, overflow:"hidden", cursor:"pointer", background:"transparent", transition:"border-color 0.15s" }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor="var(--accent)"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor="var(--border)"}>
                      <img src={`data:${f.mimeType};base64,${f.b64}`} alt={`Frame ${i+1}`} style={{ width:"100%", display:"block" }} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Crop ───────────────────────────────────────────── */}
          {step === "crop" && rawImageBase64 && (
            <CropTool
              imageBase64={rawImageBase64}
              mimeType={rawMime}
              layoutSide={config.layoutSide}
              onCrop={handleCrop}
              onBack={() => setStep("upload")}
            />
          )}

          {/* ── STEP 3: Customize ──────────────────────────────────────── */}
          {step === "customize" && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1.5rem", alignItems:"start" }}>

              {/* ── LEFT column: all controls ── */}
              <div style={{ display:"flex", flexDirection:"column", gap:"1.1rem" }}>

              {/* Crop preview + BG controls */}
              {croppedBase64 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ position: "relative" }}>
                    <img src={`data:image/jpeg;base64,${croppedBase64}`} alt="Crop preview"
                      style={{ width: "100%", borderRadius: 10, border: "1px solid var(--border)", display: "block" }} />
                    {/* Top-right action buttons */}
                    <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
                      {preEnhanceBase64 && (
                        <button onClick={() => { setCroppedBase64(preEnhanceBase64); setPreEnhanceBase64(null); setStatusMsg("Enhance undone"); }}
                          style={{ background: "rgba(239,68,68,0.85)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 7, padding: "5px 12px", color: "white", fontSize: "0.78rem", cursor: "pointer", whiteSpace: "nowrap" }}>
                          ↩ Undo Enhance
                        </button>
                      )}
                      <button onClick={handleEnhance} disabled={enhancing || !!preEnhanceBase64}
                        title="Auto-enhance: contrast, saturation & sharpness"
                        style={{ background: enhancing ? "rgba(245,158,11,0.85)" : "rgba(0,0,0,0.65)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 7, padding: "5px 12px", color: "white", fontSize: "0.78rem", cursor: enhancing || !!preEnhanceBase64 ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
                        {enhancing ? "Enhancing…" : "✨ Enhance"}
                      </button>
                      <button onClick={() => setStep("crop")}
                        style={{ background: "rgba(0,0,0,0.65)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 7, padding: "5px 12px", color: "white", fontSize: "0.78rem", cursor: "pointer" }}>
                        ✏️ Re-crop
                      </button>
                    </div>
                    {bgRemoved && (
                      <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(34,197,94,0.85)", borderRadius: 7, padding: "5px 12px", color: "white", fontSize: "0.78rem", fontWeight: 700 }}>
                        ✓ BG Processed
                      </div>
                    )}
                  </div>

                  {/* BG options row */}
                  {!bgRemoved && (
                    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                      <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Background Options</p>

                      {/* Row 1: Remove BG | Blur BG + slider */}
                      <div style={{ display: "flex", gap: 8 }}>
                        {/* Remove BG */}
                        <button id="remove-bg-btn" onClick={handleRemoveBg} disabled={removingBg || blurringBg || removingAndBlurring}
                          style={{ flex: 1, padding: "9px 12px", background: "transparent", border: "1px solid var(--border-hover)", borderRadius: 8, color: "var(--text-primary)", fontSize: "0.83rem", cursor: removingBg ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                          {removingBg ? "Removing…" : "✂️ Remove BG"}
                        </button>

                        {/* Blur BG */}
                        <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <button id="blur-bg-btn" onClick={handleBlurBg} disabled={blurringBg || removingBg || removingAndBlurring}
                              style={{ flex: 1, padding: "9px 12px", background: "transparent", border: "1px solid var(--border-hover)", borderRadius: 8, color: "var(--text-primary)", fontSize: "0.83rem", cursor: blurringBg ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                              {blurringBg ? "Blurring…" : "🌫️ Blur BG"}
                            </button>
                            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", minWidth: 32, textAlign: "right" }}>{blurAmount}%</span>
                          </div>
                          <input type="range" min={1} max={100} value={blurAmount}
                            onChange={e => setBlurAmount(parseInt(e.target.value))}
                            style={{ width: "100%", accentColor: "var(--accent)" }} />
                        </div>
                      </div>

                      {/* Row 2: Combined Remove + Blur */}
                      <button id="remove-and-blur-bg-btn" onClick={handleRemoveAndBlurBg}
                        disabled={removingAndBlurring || removingBg || blurringBg}
                        style={{
                          padding: "10px 12px",
                          background: removingAndBlurring
                            ? "rgba(139,92,246,0.3)"
                            : "linear-gradient(135deg, rgba(88,101,242,0.18), rgba(139,92,246,0.18))",
                          border: "1px solid rgba(139,92,246,0.5)",
                          borderRadius: 8, color: removingAndBlurring ? "var(--text-muted)" : "#c4b5fd",
                          fontSize: "0.83rem", fontWeight: 700,
                          cursor: removingAndBlurring ? "not-allowed" : "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        }}>
                        {removingAndBlurring
                          ? <><div className="spinner" style={{ width:14, height:14, borderWidth:2 }} /> {statusMsg || "Working…"}</>
                          : "✂️🌫️ Remove BG + Keep Blurred BG"}
                      </button>
                      <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: 0 }}>
                        Cuts out the preacher and keeps a blurred version of the original as the background layer.
                      </p>
                    </div>
                  )}

                  {bgRemoved && (
                    <button onClick={() => { setBgRemoved(false); setBgCutout(false); setBlurredBgBase64(null); setCroppedBase64(originalCroppedBase64); }}
                      style={{ alignSelf: "flex-start", background: "transparent", border: "1px solid var(--border)", borderRadius: 7, padding: "5px 12px", color: "var(--text-muted)", fontSize: "0.78rem", cursor: "pointer" }}>
                      ↩ Reset BG
                    </button>
                  )}
                </div>
              )}


              {/* Gemini detect button */}
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <button id="analyze-btn" onClick={runAnalysis} disabled={analyzing}
                  style={{ background: analyzing ? "rgba(88,101,242,0.5)" : "var(--bg-card)", border:"1px solid var(--border)", borderRadius:8, padding:"8px 16px", color:"var(--text-primary)", fontSize:"0.84rem", cursor: analyzing ? "not-allowed":"pointer", display:"flex", gap:6, alignItems:"center" }}>
                  {analyzing ? "Analyzing…" : "🤖 Auto-detect layout (Gemini)"}
                </button>
              </div>

              {/* Layout side */}
              <div>
                <label style={{ fontSize:"0.78rem", fontWeight:700, color:"var(--text-secondary)", display:"block", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.04em" }}>Preacher Side</label>
                <div style={{ display:"flex", gap:8 }}>
                  {(["left","right"] as const).map(side => (
                    <button key={side} onClick={() => setConfig(c => ({ ...c, layoutSide: side }))}
                      style={{ flex:1, padding:"10px", borderRadius:8, border:`1px solid ${config.layoutSide===side ? "var(--accent)" : "var(--border)"}`, background: config.layoutSide===side ? "rgba(88,101,242,0.15)" : "var(--bg-card)", color: config.layoutSide===side ? "var(--accent)" : "var(--text-secondary)", fontWeight:700, cursor:"pointer" }}>
                      {side === "left" ? "⬅ Preacher Left" : "Preacher Right ➡"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Title */}
              <div>
                <label style={{ fontSize:"0.78rem", fontWeight:700, color:"var(--text-secondary)", display:"block", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.04em" }}>Title Text</label>
                <textarea value={config.title} onChange={e => setConfig(c => ({ ...c, title: e.target.value }))} rows={3}
                  style={{ width:"100%", background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text-primary)", fontSize:"0.9rem", resize:"vertical", outline:"none", fontFamily:"inherit" }} />
              </div>

              {/* Speaker name */}
              <div>
                <label style={{ fontSize:"0.78rem", fontWeight:700, color:"var(--text-secondary)", display:"block", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.04em" }}>Speaker Name</label>
                <div style={{ display:"flex", gap:8 }}>
                  <select
                    value={customSpeaker ? "__custom__" : (config.preacherName || "")}
                    onChange={e => {
                      if (e.target.value === "__custom__") {
                        setCustomSpeaker(true);
                        setConfig(c => ({ ...c, preacherName: "" }));
                      } else {
                        setCustomSpeaker(false);
                        setConfig(c => ({ ...c, preacherName: e.target.value }));
                      }
                    }}
                    style={{ flex:1, background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text-primary)", fontSize:"0.9rem", outline:"none", cursor:"pointer" }}>
                    <option value="Jeff Peterson">Jeff Peterson</option>
                    <option value="James Jennings">James Jennings</option>
                    <option value="Craig Mussulman">Craig Mussulman</option>
                    {extraSpeakers.map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                    <option value="">— None —</option>
                    <option value="__custom__">Custom…</option>
                  </select>
                  {customSpeaker && (
                    <input
                      autoFocus
                      value={config.preacherName || ""}
                      onChange={e => setConfig(c => ({ ...c, preacherName: e.target.value }))}
                      placeholder="Type speaker name…"
                      style={{ flex:1, background:"var(--bg-card)", border:"1px solid var(--accent)", borderRadius:8, padding:"10px 12px", color:"var(--text-primary)", fontSize:"0.9rem", outline:"none" }} />
                  )}
                </div>
              </div>

              {/* Font Style */}
              <div>
                <label style={{ fontSize:"0.78rem", fontWeight:700, color:"var(--text-secondary)", display:"block", marginBottom:8, textTransform:"uppercase", letterSpacing:"0.04em" }}>Title Font</label>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6 }}>
                  {(Object.entries(FONT_STYLES) as [FontStyle, typeof FONT_STYLES[FontStyle]][]).map(([key, val]) => {
                    const active = (config.fontStyle ?? "impact") === key;
                    return (
                      <button
                        key={key}
                        id={`font-${key}`}
                        onClick={() => setConfig(c => ({ ...c, fontStyle: key }))}
                        style={{
                          padding: "10px 6px",
                          borderRadius: 8,
                          border: `2px solid ${active ? "var(--accent)" : "var(--border)"}`,
                          background: active ? "rgba(88,101,242,0.15)" : "var(--bg-card)",
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 4,
                          transition: "all 0.15s",
                        }}
                        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.borderColor = "var(--border-hover)"; }}
                        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}
                      >
                        <span style={{
                          fontSize: "1.05rem",
                          fontWeight: 900,
                          color: active ? "var(--accent)" : "var(--text-primary)",
                          lineHeight: 1,
                          fontFamily: key === "impact"     ? "Impact, Arial Black, sans-serif"
                            : key === "oswald"     ? "var(--font-oswald), sans-serif"
                            : key === "bebas"      ? "var(--font-bebas), sans-serif"
                            : key === "montserrat" ? "var(--font-montserrat), sans-serif"
                            : "var(--font-teko), sans-serif",
                        }}>Aa</span>
                        <span style={{ fontSize: "0.65rem", color: active ? "var(--accent)" : "var(--text-secondary)", fontWeight: active ? 700 : 400, textAlign: "center", lineHeight: 1.2 }}>{val.label}</span>
                        <span style={{ fontSize: "0.58rem", color: "var(--text-muted)", textAlign: "center", lineHeight: 1.1 }}>{val.weightLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Gradient */}
              <div>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                  <label style={{ fontSize:"0.78rem", fontWeight:700, color:"var(--text-secondary)", textTransform:"uppercase", letterSpacing:"0.04em" }}>Color Gradient</label>
                  <button
                    id="match-clothing-color-btn"
                    onClick={() => {
                      if (!croppedBase64) return;
                      setMatchingColor(true);
                      setError(null);
                      extractClothingColor(croppedBase64)
                        .then(matched => {
                          setMatchedColors(matched);
                          setConfig(c => ({ ...c, gradientPreset: "slate" as GradientPreset, gradientColors: [matched.dark, matched.accent] }));
                        })
                        .catch(e => setError(e instanceof Error ? e.message : "Color extraction failed"))
                        .finally(() => setMatchingColor(false));
                    }}
                    disabled={matchingColor || !croppedBase64}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      background: matchingColor ? "rgba(88,101,242,0.4)" : "linear-gradient(135deg,rgba(88,101,242,0.25),rgba(236,72,153,0.25))",
                      border: "1px solid rgba(88,101,242,0.5)",
                      borderRadius: 8, padding: "5px 12px",
                      color: matchingColor ? "var(--text-muted)" : "#c4b5fd",
                      fontSize: "0.78rem", fontWeight: 700, cursor: matchingColor ? "not-allowed" : "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    {matchingColor ? <><div className="spinner" style={{ width:12, height:12, borderWidth:2 }} /> Scanning…</> : "🎨 Match Clothing Color"}
                  </button>
                </div>

                {/* Matched color result banner */}
                {matchedColors && (
                  <div style={{ marginBottom:8, padding:"8px 12px", borderRadius:9, border:"1px solid rgba(255,255,255,0.12)", background:`linear-gradient(135deg,${matchedColors.dark},${matchedColors.accent})`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <span style={{ fontSize:"0.78rem", fontWeight:700, color:"rgba(255,255,255,0.9)" }}>✓ Matched: {matchedColors.label}</span>
                    <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                      <span style={{ fontSize:"0.7rem", color:"rgba(255,255,255,0.6)", fontFamily:"monospace" }}>{matchedColors.dark}</span>
                      <span style={{ fontSize:"0.7rem", color:"rgba(255,255,255,0.6)" }}>→</span>
                      <span style={{ fontSize:"0.7rem", color:"rgba(255,255,255,0.6)", fontFamily:"monospace" }}>{matchedColors.accent}</span>
                    </div>
                  </div>
                )}

                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
                  {(Object.entries(GRADIENT_PRESETS) as [GradientPreset, { colors:[string,string]; label:string }][]).map(([key, val]) => {
                    const isActive = config.gradientPreset === key && !matchedColors;
                    return (
                      <button key={key} id={`gradient-${key}`}
                        onClick={() => { setMatchedColors(null); setConfig(c => ({ ...c, gradientPreset:key, gradientColors:val.colors })); }}
                        style={{ padding:"8px 4px", borderRadius:8, border:`2px solid ${isActive ? "white" : "transparent"}`, background:`linear-gradient(135deg,${val.colors[0]},${val.colors[1]})`, cursor:"pointer", fontSize:"0.72rem", color:"white", fontWeight:700 }}>
                        {val.label}
                      </button>
                    );
                  })}
                </div>

                {/* Gradient style: Grungy vs Clean */}
                <div style={{ display:"flex", gap:6, marginTop:4 }}>
                  {(["grungy", "clean"] as const).map(style => {
                    const active = (config.gradientStyle ?? "grungy") === style;
                    return (
                      <button key={style} id={`gradient-style-${style}`}
                        onClick={() => setConfig(c => ({ ...c, gradientStyle: style }))}
                        style={{ flex:1, padding:"7px 8px", borderRadius:8, border:`1px solid ${active ? "var(--accent)" : "var(--border)"}`, background: active ? "rgba(88,101,242,0.15)" : "var(--bg-card)", color: active ? "var(--accent)" : "var(--text-secondary)", fontWeight: active ? 700 : 400, fontSize:"0.8rem", cursor:"pointer" }}>
                        {style === "grungy" ? "🎨 Grungy" : "✨ Clean"}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Generate button at bottom of left col */}
              <button id="generate-thumb-btn" onClick={handleGenerate} disabled={generating}
                style={{ padding:"13px", background: generating ? "rgba(88,101,242,0.5)" : "linear-gradient(135deg,#5865f2,#7c3aed)", border:"none", borderRadius:10, color:"white", fontWeight:800, fontSize:"1rem", cursor: generating ? "not-allowed":"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                {generating ? "Compositing…" : "✨ Generate Thumbnail"}
              </button>
              </div>{/* end left column */}

              {/* ── RIGHT column: live preview + font size ── */}
              <div style={{ display:"flex", flexDirection:"column", gap:"1rem", position:"sticky", top:0 }}>
                <LivePreview config={config} croppedBase64={croppedBase64} bgCutout={bgCutout} blurredBgBase64={blurredBgBase64} originalCroppedBase64={originalCroppedBase64} logoBase64={logoBase64} />

                {/* Font size control */}
                <div style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:10, padding:"12px 14px" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                    <label style={{ fontSize:"0.78rem", fontWeight:700, color:"var(--text-secondary)", textTransform:"uppercase", letterSpacing:"0.04em" }}>Font Size</label>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      {config.fontSizeOverride && (
                        <button onClick={() => setConfig(c => ({ ...c, fontSizeOverride: undefined }))}
                          style={{ background:"rgba(88,101,242,0.15)", border:"1px solid rgba(88,101,242,0.4)", borderRadius:6, padding:"2px 8px", color:"#a5b4fc", fontSize:"0.7rem", cursor:"pointer", fontWeight:700 }}>
                          Auto
                        </button>
                      )}
                      <span style={{ fontSize:"0.88rem", fontWeight:700, color:"var(--text-primary)", minWidth:32, textAlign:"right" }}>
                        {config.fontSizeOverride ?? "Auto"}
                      </span>
                    </div>
                  </div>
                  <input type="range" min={24} max={80} step={2}
                    value={config.fontSizeOverride ?? 0}
                    onChange={e => {
                      const v = parseInt(e.target.value);
                      setConfig(c => ({ ...c, fontSizeOverride: v > 0 ? v : undefined }));
                    }}
                    style={{ width:"100%", accentColor:"var(--accent)" }} />
                  <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
                    <span style={{ fontSize:"0.65rem", color:"var(--text-muted)" }}>Auto</span>
                    <span style={{ fontSize:"0.65rem", color:"var(--text-muted)" }}>Small ← → Large</span>
                    <span style={{ fontSize:"0.65rem", color:"var(--text-muted)" }}>80px</span>
                  </div>
                </div>

                {/* Error/status */}
                {statusMsg && <span style={{ fontSize:"0.8rem", color:"var(--success)" }}>{statusMsg}</span>}
                {error && <p style={{ fontSize:"0.82rem", color:"#fc8181", margin:0 }}>⚠️ {error}</p>}
              </div>{/* end right column */}

            </div>
          )}

          {/* ── STEP 4: Preview ────────────────────────────────────────── */}
          {(step === "preview" || step === "done") && thumbnailBase64 && (
            <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>
              <img src={`data:image/jpeg;base64,${thumbnailBase64}`} alt="Generated Thumbnail"
                style={{ width:"100%", borderRadius:10, border:"1px solid var(--border)" }} />

              {step === "done" ? (
                <div style={{ textAlign:"center", padding:"1.5rem", background:"rgba(34,197,94,0.1)", border:"1px solid rgba(34,197,94,0.3)", borderRadius:10 }}>
                  <div style={{ fontSize:48, marginBottom:8 }}>🎉</div>
                  <p style={{ fontWeight:800, fontSize:"1.1rem", color:"var(--success)" }}>Thumbnail Uploaded!</p>
                </div>
              ) : (
                <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                  <button onClick={() => setStep("customize")} style={{ flex:1, padding:"11px", background:"transparent", border:"1px solid var(--border)", borderRadius:9, color:"var(--text-secondary)", fontWeight:600, cursor:"pointer" }}>← Edit</button>
                  <button id="download-thumb-btn" onClick={handleDownload} style={{ flex:1, padding:"11px", background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:9, color:"var(--text-primary)", fontWeight:600, cursor:"pointer" }}>⬇ Download</button>
                  <button id="upload-thumb-btn" onClick={handleUpload} disabled={uploading}
                    style={{ flex:2, padding:"11px", background: uploading ? "rgba(88,101,242,0.5)" : "linear-gradient(135deg,#5865f2,#7c3aed)", border:"none", borderRadius:9, color:"white", fontWeight:800, cursor: uploading ? "not-allowed":"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                    {uploading ? "Uploading…" : "📤 Upload to YouTube"}
                  </button>
                </div>
              )}
              {error && <p style={{ fontSize:"0.82rem", color:"#fc8181" }}>⚠️ {error}</p>}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

function b64ToBlob(b64: string, mime: string): Blob {
  const bytes = atob(b64);
  const arr   = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** Promise-based Blob → raw base64 string (no data-URL prefix). */
function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve((e.target?.result as string).split(",")[1]);
    reader.onerror = () => reject(new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}

// ── Client-side clothing color extraction ─────────────────────────────────
// Uses Canvas pixel sampling — no API call needed.

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if      (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else                h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const HUE_LABELS = [
  "red", "red-orange", "orange", "amber", "yellow", "yellow-green",
  "lime", "green", "teal-green", "teal", "cyan-teal", "cyan",
  "sky blue", "blue", "blue-indigo", "indigo", "violet", "purple",
  "pink-purple", "pink", "rose", "crimson", "deep red", "red",
];

function extractClothingColor(
  base64: string,
  mimeType = "image/jpeg"
): Promise<{ dark: string; accent: string; label: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      // Downsample for speed — 200px longest edge is plenty
      const scale = Math.min(1, 200 / Math.max(img.width, img.height, 1));
      canvas.width  = Math.max(1, Math.floor(img.width  * scale));
      canvas.height = Math.max(1, Math.floor(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas unavailable"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Sample the middle band of the image where clothing usually lives
      // Horizontally: center 80% | Vertically: 15%–85% of frame
      const x0 = Math.floor(canvas.width  * 0.10);
      const y0 = Math.floor(canvas.height * 0.15);
      const w  = Math.floor(canvas.width  * 0.80);
      const h  = Math.floor(canvas.height * 0.70);
      const { data } = ctx.getImageData(x0, y0, Math.max(1, w), Math.max(1, h));

      // 24 hue buckets × 15° each
      const buckets   = new Array<number>(24).fill(0);
      const bucketHue = new Array<number>(24).fill(0);
      const bucketSat = new Array<number>(24).fill(0);

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const [hue, sat, lit] = rgbToHsl(r, g, b);

        // ── Skip unwanted pixel types ──────────────────────────────────
        // White / near-white: lightness too high OR barely saturated
        if (lit > 0.80 || sat < 0.18) continue;
        // Black / very dark
        if (lit < 0.10) continue;
        // Skin tones (hue 0–40°, moderate saturation, mid lightness)
        if (hue >= 0 && hue <= 40 && sat >= 0.20 && sat <= 0.85 && lit >= 0.35 && lit <= 0.75) continue;

        const bucket = Math.floor(hue / 15) % 24;
        buckets[bucket]++;
        bucketHue[bucket] += hue;
        bucketSat[bucket] += sat;
      }

      // Find the bucket with the most votes
      let best = -1, bestCount = 0;
      for (let i = 0; i < 24; i++) {
        if (buckets[i] > bestCount) { bestCount = buckets[i]; best = i; }
      }

      if (best === -1 || bestCount === 0) {
        // Fallback: deep indigo
        return resolve({ dark: "#0f0a2e", accent: "#4338ca", label: "color" });
      }

      // Average hue & saturation within the winning bucket for accuracy
      const avgHue = bucketHue[best] / bestCount;
      const avgSat = Math.min(1, (bucketSat[best] / bestCount) * 1.15); // boost saturation slightly

      const dark   = hslToHex(avgHue, Math.min(1, avgSat * 0.95), 0.10);
      const accent = hslToHex(avgHue, Math.min(1, avgSat * 1.05), 0.52);
      const label  = HUE_LABELS[best] || "color";

      resolve({ dark, accent, label });
    };
    img.onerror = () => reject(new Error("Failed to load image for color extraction"));
    img.src = `data:${mimeType};base64,${base64}`;
  });
}

import { NextRequest, NextResponse } from "next/server";

/**
 * Fetches the highest-quality available thumbnails for a YouTube video.
 *
 * Priority order (highest → lowest quality):
 *   maxresdefault  1280×720  (custom or auto, always try first)
 *   maxres1/2/3    1280×720  (alternate frames, often exist)
 *   sddefault      640×480
 *   hqdefault      480×360
 *   mqdefault      320×180
 *
 * If all img.youtube.com candidates fail (private/unlisted video),
 * falls back to ?fallbackUrl= — the API-thumbnail URL from the video list.
 */

const CANDIDATE_URLS = (id: string) => [
  `https://img.youtube.com/vi/${id}/maxresdefault.jpg`,
  `https://img.youtube.com/vi/${id}/maxres1.jpg`,
  `https://img.youtube.com/vi/${id}/maxres2.jpg`,
  `https://img.youtube.com/vi/${id}/maxres3.jpg`,
  `https://img.youtube.com/vi/${id}/sddefault.jpg`,
  `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
  `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
];

/** Minimum byte size to reject YouTube's grey 120×90 placeholder stub */
const MIN_BYTES = 4000;

async function fetchFrame(url: string, minBytes = MIN_BYTES) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength < minBytes) return null;
    return {
      url,
      b64:      Buffer.from(buffer).toString("base64"),
      mimeType: "image/jpeg",
      bytes:    buffer.byteLength,
    };
  } catch { return null; }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  if (!videoId) {
    return NextResponse.json({ error: "videoId required" }, { status: 400 });
  }

  const fallbackUrl = request.nextUrl.searchParams.get("fallbackUrl");

  // Try all public img.youtube.com candidates in parallel
  const results = await Promise.all(CANDIDATE_URLS(videoId).map(u => fetchFrame(u)));
  const frames  = results.filter(Boolean) as { url: string; b64: string; mimeType: string; bytes: number }[];

  const hasMaxres = frames.some(f => f.url.includes("maxres"));
  const filtered  = hasMaxres
    ? frames.filter(f => f.url.includes("maxres"))
    : frames;

  if (filtered.length > 0) {
    return NextResponse.json({ frames: filtered });
  }

  // Nothing from img.youtube.com — try the fallback URL (works for private/unlisted)
  if (fallbackUrl) {
    const frame = await fetchFrame(fallbackUrl, 1000);
    if (frame) return NextResponse.json({ frames: [frame] });
  }

  return NextResponse.json({ frames: [] });
}

/**
 * Background removal via fal.ai (BiRefNet model — best quality for people)
 * Uses fal.ai REST API directly — no extra package needed.
 * 
 * Model: fal-ai/birefnet  (best for portraits/people)
 * Alt:   fal-ai/bria/background/remove  (commercial-safe)
 * Alt:   fal-ai/imageutils/rembg         (fast, lightweight)
 */

const FAL_MODEL = "fal-ai/birefnet";

/**
 * Upload a Buffer to fal.ai storage and get a URL back
 * fal.ai needs a public URL or base64 data URI — we use data URI directly
 */
function bufferToDataUri(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

/**
 * Remove background using fal.ai BiRefNet model.
 * Returns a PNG Buffer with transparent background.
 */
export async function removeBackgroundFal(
  imageBuffer: Buffer,
  apiKey: string,
  mimeType: "image/jpeg" | "image/png" = "image/jpeg"
): Promise<Buffer> {
  const imageUrl = bufferToDataUri(imageBuffer, mimeType);

  // Submit to fal.ai queue
  const submitRes = await fetch(`https://queue.fal.run/${FAL_MODEL}`, {
    method: "POST",
    headers: {
      "Authorization": `Key ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      image_url: imageUrl,
    }),
  });

  if (!submitRes.ok) {
    const err = await submitRes.text();
    throw new Error(`fal.ai submit error ${submitRes.status}: ${err}`);
  }

  const { request_id } = await submitRes.json() as { request_id: string };

  // Poll for result
  let result: { images?: { url: string }[]; image?: { url: string } } | null = null;
  const start = Date.now();
  const timeout = 60_000;

  while (Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 1500));

    const statusRes = await fetch(
      `https://queue.fal.run/${FAL_MODEL}/requests/${request_id}`,
      { headers: { Authorization: `Key ${apiKey}` } }
    );

    if (!statusRes.ok) continue;

    const status = await statusRes.json() as {
      status?: string;
      images?: { url: string }[];
      image?:  { url: string };
    };

    if (status.status === "COMPLETED" || status.images || status.image) {
      result = status;
      break;
    }
    if (status.status === "FAILED") {
      throw new Error("fal.ai background removal failed");
    }
  }

  if (!result) throw new Error("fal.ai timed out");

  // Get result image URL (different models use different output shapes)
  const resultUrl =
    result.image?.url ||
    result.images?.[0]?.url;

  if (!resultUrl) throw new Error("No output image from fal.ai");

  // Download the result PNG
  const imgRes = await fetch(resultUrl);
  if (!imgRes.ok) throw new Error(`Failed to download fal.ai result: ${imgRes.status}`);

  const arrayBuffer = await imgRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Fallback: blur the background using sharp only (no external API needed)
 */
export async function blurBackground(
  imageBuffer: Buffer,
  blurRadius = 18
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp(imageBuffer).blur(blurRadius).toBuffer();
}

// Keep old exports so existing code doesn't break
export { removeBackgroundFal as removeBackground };

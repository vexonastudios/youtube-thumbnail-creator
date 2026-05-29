import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { removeBackgroundFal } from "@/lib/background";

/**
 * POST /api/blur-bg
 * Form data: image (File), blurAmount (0-100, default 12)
 *
 * Flow:
 * 1. Send image to fal.ai BiRefNet → get subject as RGBA PNG (transparent bg)
 * 2. Apply Gaussian blur to the ORIGINAL image
 * 3. Composite: blurred_original (background) + sharp_subject (foreground)
 * 4. Return the result JPEG
 */
export async function POST(request: NextRequest) {
  try {
    const formData  = await request.formData();
    const imageFile = formData.get("image") as File | null;
    const blurStr   = formData.get("blurAmount") as string | null;
    const blurAmount = Math.min(100, Math.max(0, parseFloat(blurStr || "12")));

    if (!imageFile) {
      return NextResponse.json({ error: "image file is required" }, { status: 400 });
    }

    const falKey = request.headers.get("x-falai-key") || process.env.FAL_API_KEY;
    if (!falKey) {
      return NextResponse.json({ error: "No fal.ai API key set. Add it in Settings." }, { status: 500 });
    }

    const mimeType    = imageFile.type === "image/png" ? "image/png" : "image/jpeg";
    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());

    // 1. Get subject with transparent background from fal.ai
    const subjectPng = await removeBackgroundFal(imageBuffer, falKey, mimeType);

    // 2. Blur the original image — sigma scales from 0 (no blur) to ~40 (heavy blur)
    const sigma = (blurAmount / 100) * 40;
    const blurredBg = await sharp(imageBuffer)
      .blur(Math.max(0.3, sigma))
      .toBuffer();

    // Get dimensions from original
    const { width, height } = await sharp(imageBuffer).metadata();

    // 3. Composite: blurred background + sharp subject on top
    const result = await sharp(blurredBg)
      .resize(width, height, { fit: "fill" })
      .composite([{
        input: subjectPng,
        blend: "over",   // respect alpha → sharp subject over blurred bg
      }])
      .jpeg({ quality: 95 })
      .toBuffer();

    return new NextResponse(result, {
      headers: {
        "Content-Type":   "image/jpeg",
        "Content-Length": result.length.toString(),
      },
    });
  } catch (err) {
    console.error("Blur background error:", err);
    return NextResponse.json(
      { error: `Failed to blur background: ${err instanceof Error ? err.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}

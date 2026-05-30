import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

/**
 * POST /api/enhance
 * Body: FormData { image: File }
 *
 * Enhancement pipeline (all server-side via sharp, no external API):
 *  1. Normalize   — stretch histogram for full dynamic range
 *  2. Modulate    — saturation +15%, slight brightness bump
 *  3. Sharpen     — unsharp mask for crisp edges
 *
 * When the input is a PNG (e.g. a background-removed cutout), the alpha
 * channel is preserved and returned as PNG so transparency is not lost.
 * JPEG inputs are returned as JPEG as before.
 */
export async function POST(request: NextRequest) {
  try {
    const formData  = await request.formData();
    const imageFile = formData.get("image") as File | null;
    if (!imageFile) {
      return NextResponse.json({ error: "image file is required" }, { status: 400 });
    }

    const isPng       = imageFile.type === "image/png" || imageFile.name?.endsWith(".png");
    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());

    const pipeline = sharp(imageBuffer)
      .normalize({ lower: 2, upper: 98 })
      .modulate({ saturation: 1.15, brightness: 1.02 })
      .sharpen({ sigma: 0.8, m1: 0.5, m2: 2.0 });

    let result: Buffer;
    let contentType: string;

    if (isPng) {
      // Preserve alpha — keep as PNG so BG removal is not undone
      result      = await pipeline.ensureAlpha().png({ quality: 95 }).toBuffer();
      contentType = "image/png";
    } else {
      result      = await pipeline.jpeg({ quality: 96 }).toBuffer();
      contentType = "image/jpeg";
    }

    return new NextResponse(new Uint8Array(result), {
      headers: {
        "Content-Type":   contentType,
        "Content-Length": result.length.toString(),
      },
    });
  } catch (err) {
    console.error("Enhance error:", err);
    return NextResponse.json(
      { error: `Failed to enhance image: ${err instanceof Error ? err.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}

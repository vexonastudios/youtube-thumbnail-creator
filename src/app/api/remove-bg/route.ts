import { NextRequest, NextResponse } from "next/server";
import { removeBackgroundFal } from "@/lib/background";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const imageFile = formData.get("image") as File | null;

    if (!imageFile) {
      return NextResponse.json({ error: "image file is required" }, { status: 400 });
    }

    // fal.ai key — from localStorage header first, then env var
    const falKey =
      request.headers.get("x-falai-key") ||
      process.env.FAL_API_KEY;

    if (!falKey) {
      return NextResponse.json(
        { error: "No fal.ai API key set. Add it in Settings." },
        { status: 500 }
      );
    }

    const mimeType = imageFile.type === "image/png" ? "image/png" : "image/jpeg";
    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());

    const resultBuffer = await removeBackgroundFal(imageBuffer, falKey, mimeType);

    return new NextResponse(resultBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": resultBuffer.length.toString(),
      },
    });
  } catch (err) {
    console.error("Remove background error:", err);
    return NextResponse.json(
      { error: `Failed to remove background: ${err instanceof Error ? err.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}

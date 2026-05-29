import { NextRequest, NextResponse } from "next/server";
import { analyzePreacherImage } from "@/lib/gemini";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageBase64, mimeType = "image/jpeg" } = body;

    if (!imageBase64) {
      return NextResponse.json({ error: "imageBase64 is required" }, { status: 400 });
    }

    // Key from localStorage (via header) takes priority over env var
    const geminiKey =
      request.headers.get("x-gemini-key") || process.env.GEMINI_API_KEY;

    if (!geminiKey) {
      return NextResponse.json(
        { error: "Gemini API key not set. Go to Settings to add it." },
        { status: 500 }
      );
    }

    const analysis = await analyzePreacherImage(imageBase64, mimeType, geminiKey);
    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("Analyze image error:", err);
    return NextResponse.json({ error: "Failed to analyze image" }, { status: 500 });
  }
}

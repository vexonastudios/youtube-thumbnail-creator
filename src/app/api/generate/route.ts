import { NextRequest, NextResponse } from "next/server";
import { generateThumbnail } from "@/lib/compositor";
import { ThumbnailConfig, GRADIENT_PRESETS } from "@/lib/types";
import { fetchImageBuffer } from "@/lib/frames";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      config,
      preacherImageBase64,
      preacherImageUrl,
      backgroundImageBase64,
      logoBase64,
      logoUrl,
    }: {
      config: ThumbnailConfig;
      preacherImageBase64?: string;
      preacherImageUrl?: string;
      backgroundImageBase64?: string;  // original crop used as BG when cutout provided
      logoBase64?: string;
      logoUrl?: string;
    } = body;

    if (!config) {
      return NextResponse.json(
        { error: "config is required" },
        { status: 400 }
      );
    }

    // Validate gradient preset
    if (!GRADIENT_PRESETS[config.gradientPreset]) {
      config.gradientPreset = "slate";
    }

    // Get preacher image buffer
    let preacherBuffer: Buffer;
    if (preacherImageBase64) {
      preacherBuffer = Buffer.from(preacherImageBase64, "base64");
    } else if (preacherImageUrl) {
      preacherBuffer = await fetchImageBuffer(preacherImageUrl);
    } else {
      return NextResponse.json(
        { error: "preacherImageBase64 or preacherImageUrl is required" },
        { status: 400 }
      );
    }

    // Get logo buffer (optional)
    let logoBuffer: Buffer | null = null;
    if (logoBase64) {
      logoBuffer = Buffer.from(logoBase64, "base64");
    } else if (logoUrl) {
      try {
        logoBuffer = await fetchImageBuffer(logoUrl);
      } catch {
        console.warn("Failed to fetch logo, skipping");
      }
    }

    // Get background buffer (used when a cutout is provided)
    const backgroundBuffer = backgroundImageBase64
      ? Buffer.from(backgroundImageBase64, "base64")
      : null;

    // Generate the thumbnail
    const thumbnailBuffer = await generateThumbnail(
      config,
      preacherBuffer,
      logoBuffer,
      backgroundBuffer
    );

    // Return as base64 for preview
    const base64 = thumbnailBuffer.toString("base64");

    return NextResponse.json({
      thumbnailBase64: base64,
      mimeType: "image/jpeg",
      size: thumbnailBuffer.length,
    });
  } catch (err) {
    console.error("Generate thumbnail error:", err);
    return NextResponse.json(
      { error: `Failed to generate thumbnail: ${err instanceof Error ? err.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}

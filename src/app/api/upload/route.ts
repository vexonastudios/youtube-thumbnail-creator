import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { uploadThumbnail } from "@/lib/youtube";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const accessToken  = cookieStore.get("yt_access_token")?.value;
  const refreshToken = cookieStore.get("yt_refresh_token")?.value;
  const clientId     = cookieStore.get("yt_client_id")?.value;
  const clientSecret = cookieStore.get("yt_client_secret")?.value;
  const redirectUri  = cookieStore.get("yt_redirect_uri")?.value;
  const creds = { clientId: clientId || "", clientSecret: clientSecret || "", redirectUri: redirectUri || "" };

  if (!accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { videoId, thumbnailBase64 } = body;

    if (!videoId || !thumbnailBase64) {
      return NextResponse.json(
        { error: "videoId and thumbnailBase64 are required" },
        { status: 400 }
      );
    }

    const thumbnailBuffer = Buffer.from(thumbnailBase64, "base64");

    await uploadThumbnail(
      accessToken,
      refreshToken,
      videoId,
      thumbnailBuffer,
      "image/jpeg",
      (tokens) => {
        if (tokens.access_token) {
          cookieStore.set("yt_access_token", tokens.access_token, {
            httpOnly: true, secure: process.env.NODE_ENV === "production", path: "/",
            maxAge: tokens.expiry_date ? Math.floor((tokens.expiry_date - Date.now()) / 1000) : 3600
          });
        }
        if (tokens.refresh_token) {
          cookieStore.set("yt_refresh_token", tokens.refresh_token, {
            httpOnly: true, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30
          });
        }
      },
      creds
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Upload thumbnail error:", err);
    return NextResponse.json(
      {
        error: `Failed to upload thumbnail: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      },
      { status: 500 }
    );
  }
}

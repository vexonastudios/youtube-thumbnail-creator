import { NextRequest, NextResponse } from "next/server";
import { createOAuth2Client, getYouTubeCreds } from "@/lib/youtube";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(error)}`, request.url));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?error=no_code", request.url));
  }

  const cookieStore = await cookies();

  // Read the creds that were stashed by the login route
  const creds = getYouTubeCreds({
    "x-yt-client-id":     cookieStore.get("yt_client_id")?.value,
    "x-yt-client-secret": cookieStore.get("yt_client_secret")?.value,
    "x-yt-redirect-uri":  cookieStore.get("yt_redirect_uri")?.value,
  });

  try {
    const oauth2Client = createOAuth2Client(creds);
    const { tokens } = await oauth2Client.getToken(code);

    cookieStore.set("yt_access_token", tokens.access_token || "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: tokens.expiry_date ? Math.floor((tokens.expiry_date - Date.now()) / 1000) : 3600,
      path: "/",
    });
    if (tokens.refresh_token) {
      cookieStore.set("yt_refresh_token", tokens.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
      });
    }
    // Persist creds long-term for future refresh calls
    cookieStore.set("yt_client_id",     creds.clientId,     { httpOnly: true, maxAge: 60*60*24*30, path: "/" });
    cookieStore.set("yt_client_secret", creds.clientSecret, { httpOnly: true, maxAge: 60*60*24*30, path: "/" });
    cookieStore.set("yt_redirect_uri",  creds.redirectUri,  { httpOnly: true, maxAge: 60*60*24*30, path: "/" });

    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch (err) {
    console.error("OAuth callback error:", err);
    return NextResponse.redirect(new URL("/?error=token_exchange_failed", request.url));
  }
}

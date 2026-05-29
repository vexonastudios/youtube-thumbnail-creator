import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";

/** Read creds from request headers (from localStorage) or fall back to env vars */
export function getYouTubeCreds(headers?: Record<string, string | undefined>) {
  return {
    clientId:     (headers?.["x-yt-client-id"]      ?? process.env.YOUTUBE_CLIENT_ID)    || "",
    clientSecret: (headers?.["x-yt-client-secret"]   ?? process.env.YOUTUBE_CLIENT_SECRET) || "",
    redirectUri:  (headers?.["x-yt-redirect-uri"]    ?? process.env.YOUTUBE_REDIRECT_URI)  || "",
  };
}

export function createOAuth2Client(creds?: ReturnType<typeof getYouTubeCreds>): OAuth2Client {
  const c = creds || getYouTubeCreds();
  return new google.auth.OAuth2(c.clientId, c.clientSecret, c.redirectUri);
}

export function getAuthUrl(oauth2Client: OAuth2Client): string {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/youtube",
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ],
    prompt: "consent",
  });
}

export function createYouTubeClient(
  accessToken: string,
  refreshToken?: string,
  onTokenRefresh?: (tokens: any) => void,
  creds?: ReturnType<typeof getYouTubeCreds>
) {
  const auth = createOAuth2Client(creds);
  auth.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  
  if (onTokenRefresh) {
    auth.on("tokens", (tokens) => {
      onTokenRefresh(tokens);
    });
  }
  
  return google.youtube({ version: "v3", auth });
}

export async function getChannelVideos(
  accessToken: string,
  refreshToken?: string,
  maxResults = 50,
  onTokenRefresh?: (tokens: any) => void,
  creds?: ReturnType<typeof getYouTubeCreds>
) {
  const youtube = createYouTubeClient(accessToken, refreshToken, onTokenRefresh, creds);

  // Get the authenticated user's channel
  const channelRes = await youtube.channels.list({
    part: ["id", "snippet", "contentDetails"],
    mine: true,
  });

  const channel = channelRes.data.items?.[0];
  if (!channel) throw new Error("No channel found");

  const uploadsPlaylistId =
    channel.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) throw new Error("No uploads playlist found");

  // Get all videos from uploads playlist
  const allVideos = [];
  let pageToken: string | undefined;

  do {
    const playlistRes = await youtube.playlistItems.list({
      part: ["snippet", "contentDetails"],
      playlistId: uploadsPlaylistId,
      maxResults: 50,
      pageToken,
    });

    const items = playlistRes.data.items || [];
    allVideos.push(...items);
    pageToken = playlistRes.data.nextPageToken || undefined;
  } while (pageToken && allVideos.length < maxResults);

  // Deduplicate IDs — playlist pages can occasionally repeat the same video
  const uniqueIds = [...new Set(
    allVideos
      .map((item) => item.contentDetails?.videoId)
      .filter(Boolean) as string[]
  )];

  if (uniqueIds.length === 0) return { videos: [], channel };

  // Batch fetch in groups of 50
  const videoDetails = [];
  for (let i = 0; i < uniqueIds.length; i += 50) {
    const batch = uniqueIds.slice(i, i + 50);
    const detailsRes = await youtube.videos.list({
      part: ["snippet", "contentDetails", "statistics"],
      id: batch,
    });
    videoDetails.push(...(detailsRes.data.items || []));
  }

  // Supplemental: search for upcoming scheduled videos that may not yet
  // be in the uploads playlist. NOTE: eventType + forMine is invalid;
  // use channelId instead.
  try {
    const channelId = channel.id;
    if (channelId) {
      const searchRes = await youtube.search.list({
        part: ["id"],
        channelId,
        type: ["video"],
        eventType: "upcoming",
        maxResults: 50,
      });
      const upcomingIds = (searchRes.data.items || [])
        .map(i => i.id?.videoId)
        .filter(Boolean) as string[];

      const existingIds = new Set(uniqueIds);
      const newIds = upcomingIds.filter(id => !existingIds.has(id));
      if (newIds.length > 0) {
        for (let i = 0; i < newIds.length; i += 50) {
          const batch = newIds.slice(i, i + 50);
          const detailsRes = await youtube.videos.list({
            part: ["snippet", "contentDetails", "statistics"],
            id: batch,
          });
          videoDetails.push(...(detailsRes.data.items || []));
        }
      }
    }
  } catch (e) {
    console.warn("[videos] search for upcoming failed:", e);
  }

  return { videos: videoDetails, channel };
}

export async function uploadThumbnail(
  accessToken: string,
  refreshToken: string | undefined,
  videoId: string,
  thumbnailBuffer: Buffer,
  mimeType = "image/jpeg",
  onTokenRefresh?: (tokens: any) => void,
  creds?: ReturnType<typeof getYouTubeCreds>
): Promise<boolean> {
  const auth = createOAuth2Client(creds);
  auth.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  
  if (onTokenRefresh) {
    auth.on("tokens", (tokens) => {
      onTokenRefresh(tokens);
    });
  }

  const youtube = google.youtube({ version: "v3", auth });

  const { Readable } = await import("stream");
  const stream = new Readable();
  stream.push(thumbnailBuffer);
  stream.push(null);

  await youtube.thumbnails.set({
    videoId,
    media: {
      mimeType,
      body: stream,
    },
  });

  return true;
}

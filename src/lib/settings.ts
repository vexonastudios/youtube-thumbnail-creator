"use client";

/**
 * Settings are persisted to disk via /api/settings (a JSON file).
 * localStorage is used as a fast in-memory cache only.
 * This means settings survive Electron relaunches and session resets.
 */

export interface AppSettings {
  youtubeClientId: string;
  youtubeClientSecret: string;
  youtubeRedirectUri: string;
  geminiApiKey: string;
  falAiApiKey: string;
  defaultGradient: string;
  channelLogoBase64: string;
  /** Video IDs that have had a thumbnail uploaded via ThumbGen */
  completedVideoIds: string[];
  /** Custom speaker names added by the user */
  customSpeakerNames: string[];
  /** Persisted font selections */
  defaultFontStyle?: string;
  defaultFontSize?: number;
}

const LS_KEY = "thumbgen_settings";

export const DEFAULT_SETTINGS: AppSettings = {
  youtubeClientId: "",
  youtubeClientSecret: "",
  youtubeRedirectUri: "http://localhost:3001/api/auth/callback",
  geminiApiKey: "",
  falAiApiKey: "",
  defaultGradient: "slate",
  channelLogoBase64: "",
  completedVideoIds: [],
  customSpeakerNames: [],
};

// ─── localStorage cache (fast, session-only) ──────────────────────────────────
export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function cacheSettings(settings: AppSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify(settings));
}

// ─── Server-persisted (survives Electron relaunches) ─────────────────────────
export async function loadSettingsFromServer(): Promise<AppSettings> {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) return DEFAULT_SETTINGS;
    const data = await res.json();
    const merged = { ...DEFAULT_SETTINGS, ...data };
    cacheSettings(merged);   // warm the localStorage cache
    return merged;
  } catch {
    return loadSettings();   // fall back to localStorage if server unreachable
  }
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  // Only update localStorage with the keys we're actually changing,
  // merged on top of whatever is already cached (not DEFAULT_SETTINGS).
  const current = loadSettings();
  const merged = { ...current, ...settings };
  cacheSettings(merged as AppSettings);

  // Strip undefined values and empty-string overrides for sensitive fields
  // so a partial save (e.g. saving font prefs) never clobbers API keys on disk.
  const SENSITIVE: (keyof AppSettings)[] = [
    "youtubeClientId", "youtubeClientSecret", "geminiApiKey",
    "falAiApiKey", "channelLogoBase64", "youtubeRedirectUri",
  ];
  const payload: Partial<AppSettings> = {};
  for (const [k, v] of Object.entries(settings) as [keyof AppSettings, unknown][]) {
    // Skip sensitive keys if the value being saved is empty — don't overwrite
    // a real value on disk with an empty string from a stale in-memory state.
    if (SENSITIVE.includes(k) && (v === "" || v === undefined || v === null)) continue;
    if (v !== undefined) (payload as Record<string, unknown>)[k] = v;
  }

  if (Object.keys(payload).length === 0) return; // nothing safe to write

  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Server returned ${res.status}: ${text}`);
    }
  } catch (err) {
    console.error("Failed to persist settings to disk:", err);
    // Re-throw so the UI can catch it and show an error to the user
    throw err;
  }
}

export function clearSettings(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LS_KEY);
  fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }).catch(() => {});
}

/** Build headers to attach API keys to server requests */
export function buildApiHeaders(settings?: AppSettings): Record<string, string> {
  // If a settings object was passed in, use it — but if any sensitive key is
  // missing, try to fill the gap from the localStorage cache (server-warmed).
  const cached = loadSettings();
  const s: AppSettings = settings
    ? {
        ...settings,
        // Fall back to cached value if the passed-in value is empty
        geminiApiKey:        settings.geminiApiKey        || cached.geminiApiKey,
        falAiApiKey:         settings.falAiApiKey         || cached.falAiApiKey,
        youtubeClientId:     settings.youtubeClientId     || cached.youtubeClientId,
        youtubeClientSecret: settings.youtubeClientSecret || cached.youtubeClientSecret,
        youtubeRedirectUri:  settings.youtubeRedirectUri  || cached.youtubeRedirectUri,
        channelLogoBase64:   settings.channelLogoBase64   || cached.channelLogoBase64,
      }
    : cached;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (s.geminiApiKey)        headers["x-gemini-key"]       = s.geminiApiKey;
  if (s.falAiApiKey)         headers["x-falai-key"]        = s.falAiApiKey;
  if (s.youtubeClientId)     headers["x-yt-client-id"]     = s.youtubeClientId;
  if (s.youtubeClientSecret) headers["x-yt-client-secret"] = s.youtubeClientSecret;
  if (s.youtubeRedirectUri)  headers["x-yt-redirect-uri"]  = s.youtubeRedirectUri;
  return headers;
}

/**
 * Async version — re-fetches from the server to guarantee fresh API keys.
 * Use this in any flow where keys might not be in localStorage yet.
 */
export async function buildApiHeadersAsync(): Promise<Record<string, string>> {
  const settings = await loadSettingsFromServer();
  return buildApiHeaders(settings);
}

/** Check which services are configured */
export function getSettingsStatus(settings: AppSettings) {
  return {
    hasYouTube:  !!(settings.youtubeClientId && settings.youtubeClientSecret),
    hasGemini:   !!settings.geminiApiKey,
    hasRemoveBg: !!settings.falAiApiKey,
    hasLogo:     !!settings.channelLogoBase64,
  };
}

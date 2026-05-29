// Shared types for the YouTube Thumbnail Generator

export interface YouTubeVideo {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  duration: string;
  thumbnailUrl: string | null;
  hasThumbnail: boolean;
  channelTitle: string;
  viewCount?: string;
  likeCount?: string;
}

export interface ThumbnailConfig {
  videoId: string;
  title: string;
  preacherImageUrl: string; // URL or base64 of extracted frame
  faceDirection: "left" | "right" | "center";
  layoutSide: "left" | "right"; // which side the preacher is on
  gradientColors: [string, string]; // [start, end]
  gradientPreset: GradientPreset;
  gradientStyle?: "grungy" | "clean"; // distorted edges or smooth (default: "grungy")
  fontStyle?: FontStyle;        // which title font to use (default: "impact")
  fontSizeOverride?: number;    // pin a specific px size; undefined = auto-fit
  logoUrl?: string;
  preacherName?: string;
  processedImageBase64?: string; // background removed/blurred version
}

export type FontStyle =
  | "impact"      // system Impact — bold, condensed classic
  | "oswald"      // Oswald Bold — modern condensed
  | "bebas"       // Bebas Neue — tall all-caps cinematic
  | "montserrat"  // Montserrat ExtraBold — clean geometric
  | "teko";       // Teko SemiBold — angular, editorial

export const FONT_STYLES: Record<FontStyle, { label: string; family: string; weightLabel: string; charWidth: number }> = {
  impact:      { label: "Impact",      family: "Impact,Arial Black,sans-serif", weightLabel: "Bold Condensed",  charWidth: 0.55 },
  oswald:      { label: "Oswald",      family: "Oswald",                        weightLabel: "Bold Condensed",  charWidth: 0.58 },
  bebas:       { label: "Bebas Neue",  family: "Bebas Neue",                    weightLabel: "Tall All-Caps",   charWidth: 0.52 },
  montserrat:  { label: "Montserrat",  family: "Montserrat",                    weightLabel: "Extra Bold",      charWidth: 0.65 },
  teko:        { label: "Teko",        family: "Teko",                          weightLabel: "Angular",         charWidth: 0.50 },
};


export type GradientPreset = 
  | "ocean"      // teal → cyan
  | "forest"     // deep green → lime
  | "royal"      // navy → royal blue
  | "sunset"     // deep orange → amber
  | "crimson"    // dark red → rose
  | "midnight"   // dark navy → indigo
  | "slate";     // dark slate → steel blue

export const GRADIENT_PRESETS: Record<GradientPreset, { colors: [string, string]; label: string }> = {
  ocean:    { colors: ["#0a4a6b", "#1ad6c8"], label: "Ocean" },
  forest:   { colors: ["#0d3b1e", "#2dd96b"], label: "Lord's Supper" },
  royal:    { colors: ["#0d1b5e", "#3b6fe8"], label: "Sermon" },
  sunset:   { colors: ["#7a2000", "#f59e0b"], label: "Exhortation" },
  crimson:  { colors: ["#4a0d1a", "#e53e6e"], label: "Crimson" },
  midnight: { colors: ["#0a0e2a", "#4338ca"], label: "Midnight" },
  slate:    { colors: ["#1e2a3a", "#4a90b8"], label: "Slate" },
};

export interface GeminiAnalysis {
  faceDirection: "left" | "right" | "center";
  confidence: number;
  description: string;
  suggestedTitle?: string;
}

export interface GenerationResult {
  thumbnailBase64: string;
  config: ThumbnailConfig;
}

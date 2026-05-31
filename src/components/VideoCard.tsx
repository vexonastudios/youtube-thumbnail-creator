"use client";

import { YouTubeVideo } from "@/lib/types";
import Image from "next/image";

interface VideoCardProps {
  video: YouTubeVideo;
  isCompleted: boolean;
  onGenerate: () => void;
  onToggleComplete: () => void;
}

function formatDuration(iso: string): string {
  if (!iso) return "";
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "";
  const h = parseInt(match[1] || "0");
  const m = parseInt(match[2] || "0");
  const s = parseInt(match[3] || "0");
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function VideoCard({ video, isCompleted, onGenerate, onToggleComplete }: VideoCardProps) {

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: `1px solid ${isCompleted ? "rgba(34,197,94,0.25)" : "rgba(245,158,11,0.25)"}`,
        borderRadius: 12,
        overflow: "hidden",
        display: "flex",
        gap: 0,
        transition: "all 0.2s",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = isCompleted
          ? "rgba(34,197,94,0.5)"
          : "rgba(245,158,11,0.5)";
        (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
        (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(0,0,0,0.3)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = isCompleted
          ? "rgba(34,197,94,0.25)"
          : "rgba(245,158,11,0.25)";
        (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
      }}
    >
      {/* Thumbnail Preview */}
      <div
        style={{
          width: 200,
          flexShrink: 0,
          background: "var(--bg-secondary)",
          position: "relative",
          overflow: "hidden",
          aspectRatio: "16/9",
        }}
      >
        {video.thumbnailUrl ? (
          <Image
            src={video.thumbnailUrl}
            alt={video.title}
            fill
            style={{ objectFit: "cover" }}
            unoptimized
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              minHeight: 90,
            }}
          >
            <span style={{ fontSize: 28 }}>📸</span>
            <span
              style={{
                fontSize: "0.65rem",
                color: "var(--text-muted)",
                textAlign: "center",
                padding: "0 8px",
              }}
            >
              No thumb
            </span>
          </div>
        )}

        {/* Duration Badge */}
        {video.duration && (
          <div
            style={{
              position: "absolute",
              bottom: 4,
              right: 4,
              background: "rgba(0,0,0,0.85)",
              borderRadius: 4,
              padding: "2px 6px",
              fontSize: "0.7rem",
              fontWeight: 600,
              color: "white",
            }}
          >
            {formatDuration(video.duration)}
          </div>
        )}

        {/* Status Badge */}
        {isCompleted ? (
          <div style={{ position: "absolute", top: 4, left: 4, background: "rgba(34,197,94,0.9)", borderRadius: 4, padding: "2px 6px", fontSize: "0.65rem", fontWeight: 700, color: "white" }}>
            ✓ DONE
          </div>
        ) : (
          <div style={{ position: "absolute", top: 4, left: 4, background: "rgba(245,158,11,0.9)", borderRadius: 4, padding: "2px 6px", fontSize: "0.65rem", fontWeight: 700, color: "white" }}>
            NEEDS THUMB
          </div>
        )}
      </div>

      {/* Info */}
      <div
        style={{
          flex: 1,
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          minWidth: 0,
        }}
      >
        <div>
          <h3
            style={{
              fontSize: "0.88rem",
              fontWeight: 700,
              lineHeight: 1.3,
              color: "var(--text-primary)",
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              marginBottom: 6,
            }}
          >
            {video.title}
          </h3>
          <p
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted)",
            }}
          >
            {formatDate(video.publishedAt)}
            {video.viewCount &&
              ` · ${parseInt(video.viewCount).toLocaleString()} views`}
          </p>
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button
            id={`generate-btn-${video.id}`}
            onClick={onGenerate}
            style={{
              flex: 1,
              background: isCompleted ? "var(--bg-secondary)" : "linear-gradient(135deg, #d97706, #f59e0b)",
              border: isCompleted ? "1px solid var(--border)" : "none",
              borderRadius: 7,
              padding: "7px 12px",
              color: isCompleted ? "var(--text-secondary)" : "white",
              fontSize: "0.78rem",
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.15s",
              textAlign: "center",
            }}
          >
            {isCompleted ? "🔄 Regenerate" : "✨ Generate Thumbnail"}
          </button>
          {/* Mark Done / Undo toggle */}
          <button
            id={`toggle-done-${video.id}`}
            onClick={onToggleComplete}
            title={isCompleted ? "Mark as needs thumbnail" : "Mark as done (already has thumbnail)"}
            style={{
              background: isCompleted ? "rgba(34,197,94,0.15)" : "var(--bg-secondary)",
              border: `1px solid ${isCompleted ? "rgba(34,197,94,0.4)" : "var(--border)"}`,
              borderRadius: 7,
              padding: "7px 10px",
              color: isCompleted ? "#4ade80" : "var(--text-muted)",
              fontSize: "0.82rem",
              cursor: "pointer",
              transition: "all 0.15s",
              flexShrink: 0,
            }}
          >
            {isCompleted ? "✓" : "○"}
          </button>
        </div>
      </div>
    </div>
  );
}

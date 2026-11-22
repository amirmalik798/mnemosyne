"use client";

import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";

export function TopicImageDownload({
  topicId,
  topicTitle,
  imageCount,
}: {
  topicId: string;
  topicTitle: string;
  imageCount: number;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  async function downloadImages() {
    if (downloading || imageCount === 0) return;
    setDownloading(true);
    setError("");

    try {
      const response = await fetch("/api/topics/" + topicId + "/images", {
        method: "GET",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Could not download this topic's images.");
      }

      const blob = await response.blob();
      if (blob.size === 0) throw new Error("The image archive was empty.");
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const safeTitle = topicTitle
        .trim()
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
        .replace(/\s+/g, "-")
        .slice(0, 80) || "topic";
      anchor.href = objectUrl;
      anchor.download = safeTitle + "-images.zip";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not download this topic's images.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div style={{ display: "grid", justifyItems: "end", gap: 5 }}>
      <button
        type="button"
        className="secondary-btn"
        onClick={() => void downloadImages()}
        disabled={downloading || imageCount === 0}
        title={imageCount === 0 ? "This topic has no images to download yet." : "Download all images from this topic"}
      >
        {downloading ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />}
        {downloading ? "Preparing ZIP…" : "Download images (" + imageCount + ")"}
      </button>
      {error && <span role="alert" style={{ maxWidth: 260, color: "var(--danger, #c66)", fontSize: 11, textAlign: "right" }}>{error}</span>}
    </div>
  );
}

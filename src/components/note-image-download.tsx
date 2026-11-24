import { Download } from "lucide-react";

export function NoteImageDownload({
  noteId,
  imageCount,
  showLabel = false,
}: {
  noteId: string;
  imageCount: number;
  showLabel?: boolean;
}) {
  if (imageCount === 0) {
    return (
      <button
        type="button"
        className={showLabel ? "secondary-btn reader-action-button" : "secondary-btn icon-only-btn"}
        disabled
        aria-label="No note images to download"
        title="This note has no images to download yet."
        style={{ opacity: 0.5, cursor: "not-allowed" }}
      >
        <Download size={14} />
        <span className={showLabel ? "" : "sr-only"}>{showLabel ? "No images" : "Download images (0)"}</span>
      </button>
    );
  }

  return (
    <a
      href={"/api/notes/" + noteId + "/images"}
      className={showLabel ? "secondary-btn reader-action-button" : "secondary-btn icon-only-btn"}
      aria-label={"Download " + imageCount + " images from this note as a ZIP file"}
      title="Download all images from this note"
    >
      <Download size={14} />
      <span className={showLabel ? "" : "sr-only"}>Download images</span>
    </a>
  );
}

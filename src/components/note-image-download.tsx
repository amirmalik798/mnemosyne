import { Download } from "lucide-react";

export function NoteImageDownload({
  noteId,
  imageCount,
}: {
  noteId: string;
  imageCount: number;
}) {
  if (imageCount === 0) {
    return (
      <button
        type="button"
        className="secondary-btn"
        disabled
        title="This note has no images to download yet."
        style={{ opacity: 0.5, cursor: "not-allowed" }}
      >
        <Download size={14} />
        Download images (0)
      </button>
    );
  }

  return (
    <a
      href={"/api/notes/" + noteId + "/images"}
      className="secondary-btn"
      aria-label={"Download " + imageCount + " images from this note as a ZIP file"}
      title="Download all images from this note"
    >
      <Download size={14} />
      Download images ({imageCount})
    </a>
  );
}

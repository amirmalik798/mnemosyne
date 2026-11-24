import { Download, ImageOff } from "lucide-react";

export function TopicImageDownload({
  topicId,
  imageCount,
}: {
  topicId: string;
  imageCount: number;
}) {
  if (imageCount === 0) {
    return (
      <span
        className="topic-image-empty"
        role="status"
        aria-label="No images in this topic yet"
        title="Images added to notes in this topic can be downloaded here."
      >
        <ImageOff size={15} aria-hidden="true" />
        <span>No images yet</span>
      </span>
    );
  }

  return (
    <a
      href={"/api/topics/" + topicId + "/images"}
      className="secondary-btn topic-action-button"
      aria-label={"Download " + imageCount + " images from this topic as a ZIP file"}
      title="Download all images from this topic"
    >
      <Download size={14} />
      <span>Download images</span>
    </a>
  );
}

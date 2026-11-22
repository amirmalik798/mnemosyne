import { Download } from "lucide-react";

export function TopicImageDownload({
  topicId,
  imageCount,
}: {
  topicId: string;
  imageCount: number;
}) {
  if (imageCount === 0) {
    return (
      <button type="button" className="secondary-btn topic-action-button" disabled aria-label="No topic images to download" title="This topic has no images to download yet.">
        <Download size={14} />
        <span>No images</span>
      </button>
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

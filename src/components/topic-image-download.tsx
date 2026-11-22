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
      <button type="button" className="secondary-btn" disabled title="This topic has no images to download yet.">
        <Download size={14} />
        Download images (0)
      </button>
    );
  }

  return (
    <a
      href={"/api/topics/" + topicId + "/images"}
      className="secondary-btn"
      aria-label={"Download " + imageCount + " images from this topic as a ZIP file"}
      title="Download all images from this topic"
    >
      <Download size={14} />
      Download images ({imageCount})
    </a>
  );
}

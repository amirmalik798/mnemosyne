"use client";

import { FolderPlus, Plus } from "lucide-react";

export function OpenTopicDialogButton({
  className = "secondary-btn",
  label = "New topic",
  icon = "folder",
}: {
  className?: string;
  label?: string;
  icon?: "folder" | "plus";
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event("mnemosyne:open-topic-dialog"))}
    >
      {icon === "plus" ? <Plus size={21} aria-hidden="true" /> : <FolderPlus size={16} aria-hidden="true" />}
      <span>{label}</span>
    </button>
  );
}

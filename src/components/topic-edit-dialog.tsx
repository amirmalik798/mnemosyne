"use client";

import { useState } from "react";
import { Edit3 } from "lucide-react";
import { TopicDialog, type TopicDialogTopic } from "@/components/topic-dialog";

export function TopicEditDialog({ topic }: { topic: TopicDialogTopic }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="secondary-btn topic-action-button"
        aria-label="Edit topic"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Edit3 size={16} aria-hidden="true" />
        <span>Edit topic</span>
      </button>
      {open && <TopicDialog mode="edit" topic={topic} onClose={() => setOpen(false)} />}
    </>
  );
}

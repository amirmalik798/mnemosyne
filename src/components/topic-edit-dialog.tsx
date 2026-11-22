"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Edit3 } from "lucide-react";
import { TopicEditForm, type EditableTopic } from "@/components/topic-edit-form";

export function TopicEditDialog({ topic }: { topic: EditableTopic }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function close() {
    setOpen(false);
    // The form can remove a saved cover without saving other fields.
    // Refresh the server-rendered topic after every close to reflect that state.
    router.refresh();
  }

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
      {open && <TopicEditForm topic={topic} presentation="dialog" onClose={close} />}
    </>
  );
}

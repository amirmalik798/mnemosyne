"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Trash2 } from "lucide-react";

export function NoteImageNodeView({ node, deleteNode }: NodeViewProps) {
  const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "Note image";

  return (
    <NodeViewWrapper className="note-image-node" contentEditable={false}>
      <img
        className="note-editor-image"
        src={src}
        alt={alt}
        draggable={false}
        loading="lazy"
        decoding="async"
      />
      <button
        type="button"
        className="note-image-delete"
        aria-label={`Delete image: ${alt}`}
        title="Delete image from this note"
        onMouseDown={(event) => {
          // Keep the ProseMirror selection in place while the control is used.
          event.preventDefault();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          deleteNode();
        }}
      >
        <Trash2 size={14} />
        <span>Delete</span>
      </button>
    </NodeViewWrapper>
  );
}

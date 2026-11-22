import assert from "node:assert/strict";
import test from "node:test";
import { noteToMarkdown } from "../src/lib/markdown-export";

test("preserves ordered numbering and nested list structure", () => {
  const content = {
    type: "doc",
    content: [{
      type: "orderedList",
      attrs: { start: 3 },
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "First step" }] },
            {
              type: "bulletList",
              content: [{
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Supporting detail" }] }],
              }],
            },
          ],
        },
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Second step" }] }],
        },
      ],
    }],
  };

  assert.equal(
    noteToMarkdown("Plan", content, "https://archive.example"),
    "# Plan\n\n3. First step\n  - Supporting detail\n4. Second step\n",
  );
});

test("exports valid image references as absolute Markdown links", () => {
  const content = {
    type: "doc",
    content: [{
      type: "image",
      attrs: { src: "/api/assets/123e4567-e89b-12d3-a456-426614174000", alt: "Archive image" },
    }],
  };
  assert.match(
    noteToMarkdown("Images", content, "https://archive.example"),
    /!\[Archive image\]\(https:\/\/archive\.example\/api\/assets\//,
  );
});

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

test("exports web, email, and telephone hyperlinks", () => {
  const content = {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "Website", marks: [{ type: "link", attrs: { href: "https://example.com/docs" } }] },
        { type: "text", text: " · " },
        { type: "text", text: "Email", marks: [{ type: "link", attrs: { href: "mailto:hello@example.com" } }] },
        { type: "text", text: " · " },
        { type: "text", text: "Call", marks: [{ type: "link", attrs: { href: "tel:+15551234567" } }] },
      ],
    }],
  };

  assert.equal(
    noteToMarkdown("Links", content, "https://archive.example"),
    "# Links\n\n[Website](https://example.com/docs) · [Email](mailto:hello@example.com) · [Call](tel:+15551234567)\n",
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

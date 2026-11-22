import assert from "node:assert/strict";
import test from "node:test";
import { extractNotePreview } from "../src/lib/note-preview";

test("extracts text from paragraphs and headings without exposing editor structure", () => {
  const content = {
    type: "doc",
    content: [
      { type: "heading", content: [{ type: "text", text: "Network theory" }] },
      { type: "paragraph", content: [{ type: "text", text: "A study of connected systems." }] },
    ],
  };
  assert.equal(extractNotePreview(content), "Network theory A study of connected systems.");
});

test("handles marks split across inline text nodes and hard breaks", () => {
  const content = {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "Keep " },
        { type: "text", text: "thinking" },
        { type: "hardBreak" },
        { type: "text", text: "clearly." },
      ],
    }],
  };
  assert.equal(extractNotePreview(content), "Keep thinking clearly.");
});

test("returns an empty preview for empty or invalid document values", () => {
  assert.equal(extractNotePreview(null), "");
  assert.equal(extractNotePreview({ type: "doc", content: [] }), "");
  assert.equal(extractNotePreview("not a document"), "");
});

test("truncates by Unicode characters without splitting surrogate pairs", () => {
  assert.equal(extractNotePreview({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "A😀BCDEFGHI" }] }] }, 8), "A😀BCDE…");
});

import assert from "node:assert/strict";
import test from "node:test";
import { getNoteTextDirection } from "../src/lib/text-direction";

test("uses the first text block direction for the editor toggle state", () => {
  assert.equal(getNoteTextDirection({
    type: "doc",
    content: [
      { type: "paragraph", attrs: { dir: "rtl" }, content: [{ type: "text", text: "مرحبا" }] },
      { type: "paragraph", attrs: { dir: "ltr" } },
    ],
  }), "rtl");
});

test("defaults to left-to-right when the document has no directional text block", () => {
  assert.equal(getNoteTextDirection({ type: "doc", content: [{ type: "image" }] }), "ltr");
  assert.equal(getNoteTextDirection(null), "ltr");
});

import assert from "node:assert/strict";
import test from "node:test";
import { collectNoteAssetIds, parseNoteAssetId } from "../src/lib/asset-references";

const id = "550e8400-e29b-41d4-a716-446655440000";

test("parses canonical asset URLs and normalizes UUID casing", () => {
  assert.equal(parseNoteAssetId("/api/assets/" + id), id);
  assert.equal(parseNoteAssetId("/api/assets/" + id.toUpperCase()), id);
});

test("rejects non-local, malformed, and non-canonical asset URLs", () => {
  assert.equal(parseNoteAssetId("https://example.com/api/assets/" + id), null);
  assert.equal(parseNoteAssetId("/api/assets/" + id + "/extra"), null);
  assert.equal(parseNoteAssetId("/api/assets/not-a-uuid"), null);
});

test("collects nested image references once and normalizes their IDs", () => {
  const content = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "image", attrs: { src: "/api/assets/" + id.toUpperCase() } }] },
      { type: "image", attrs: { src: "/api/assets/" + id } },
    ],
  };
  assert.deepEqual([...collectNoteAssetIds(content)], [id]);
});

test("ignores external image URLs and non-image attributes", () => {
  assert.equal(collectNoteAssetIds({
    type: "doc",
    content: [
      { type: "image", attrs: { src: "https://example.com/image.png" } },
      { type: "paragraph", attrs: { src: "/api/assets/" + id } },
    ],
  }).size, 0);
});

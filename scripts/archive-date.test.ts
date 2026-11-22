import assert from "node:assert/strict";
import test from "node:test";
import { formatArchiveDate, formatArchiveDateTime } from "../src/lib/date-format";

test("formats topic dates consistently without locale-dependent ordering", () => {
  assert.equal(formatArchiveDate("2026-11-22T14:46:00.000Z"), "22 Nov");
});

test("formats note dates with the year", () => {
  assert.equal(formatArchiveDate(new Date("2026-11-22T14:46:00.000Z"), true), "22 Nov 2026");
});

test("returns a stable fallback for invalid dates", () => {
  assert.equal(formatArchiveDate("not-a-date"), "—");
});

test("formats archive timestamps in an explicit UTC timezone", () => {
  assert.equal(formatArchiveDateTime("2026-11-22T14:46:00.000Z"), "22 Nov 2026, 14:46 UTC");
});

test("returns a stable fallback for invalid timestamps", () => {
  assert.equal(formatArchiveDateTime("not-a-date"), "—");
});

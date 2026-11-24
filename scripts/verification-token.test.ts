import assert from "node:assert/strict";
import test from "node:test";
import { readVerificationToken } from "../src/lib/verification-token";

const token = "AbCdEf0123456789_-";

test("reads the token query parameter from an email URL fragment", () => {
  assert.equal(readVerificationToken("#token=" + token), token);
});

test("supports a raw legacy fragment", () => {
  assert.equal(readVerificationToken("#" + token), token);
});

test("decodes an encoded token and handles missing values", () => {
  assert.equal(readVerificationToken("#token=" + encodeURIComponent(token)), token);
  assert.equal(readVerificationToken(""), "");
  assert.equal(readVerificationToken("#token="), "");
});

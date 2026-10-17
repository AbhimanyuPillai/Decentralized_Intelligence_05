import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.SELLER_DATABASE_PATH = path.join(mkdtempSync(path.join(tmpdir(), "seller-replay-test-")), "seller.sqlite");

const { claimPayment, finishPayment } = await import("../src/sellers/shared/replayStore.js");

test("a receipt is bound to its first service and cannot be claimed by another service", () => {
  const fingerprint = "a".repeat(64);
  assert.deepEqual(claimPayment(fingerprint, "service-a"), { claimed: true });
  assert.deepEqual(claimPayment(fingerprint, "service-b"), { claimed: false, reason: "wrong_service" });
  assert.deepEqual(claimPayment(fingerprint, "service-a"), { claimed: false, reason: "in_progress" });
});

test("only a confirmed uncharged failure can retry at the original service", () => {
  const fingerprint = "b".repeat(64);
  assert.deepEqual(claimPayment(fingerprint, "service-a"), { claimed: true });
  finishPayment(fingerprint, "service-a", "failed", 500, null, 10);
  assert.deepEqual(claimPayment(fingerprint, "service-a"), { claimed: true });
  assert.deepEqual(claimPayment(fingerprint, "service-b"), { claimed: false, reason: "wrong_service" });
});

test("settled and uncertain receipts can never be reused", () => {
  const settledFingerprint = "c".repeat(64);
  assert.deepEqual(claimPayment(settledFingerprint, "service-a"), { claimed: true });
  finishPayment(settledFingerprint, "service-a", "settled", 200, `0x${"1".repeat(64)}`, 10);
  assert.deepEqual(claimPayment(settledFingerprint, "service-a"), { claimed: false, reason: "already_used" });

  const uncertainFingerprint = "d".repeat(64);
  assert.deepEqual(claimPayment(uncertainFingerprint, "service-a"), { claimed: true });
  finishPayment(uncertainFingerprint, "service-a", "unknown", 500, null, 10);
  assert.deepEqual(claimPayment(uncertainFingerprint, "service-a"), { claimed: false, reason: "settlement_unknown" });
});

test("concurrent claims for one receipt allow only one service request", () => {
  const fingerprint = "e".repeat(64);
  const results = Array.from({ length: 5 }, () => claimPayment(fingerprint, "service-a"));
  assert.equal(results.filter((result) => result.claimed).length, 1);
  assert.deepEqual(results.slice(1), Array.from({ length: 4 }, () => ({ claimed: false, reason: "in_progress" })));
});

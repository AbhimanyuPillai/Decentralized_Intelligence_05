import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.MARKETPLACE_DATABASE_PATH = path.join(mkdtempSync(path.join(tmpdir(), "marketplace-test-")), "marketplace.sqlite");
process.env.SELLER_PAYMENTS_ENABLED = "true";

const [{ registerSeller, searchSellers, findSeller }, database, { parseLedgerRecord }] = await Promise.all([
  import("../src/marketplace/registry.js"),
  import("../src/marketplace/database.js"),
  import("../src/marketplace/ledger.js")
]);

const network = "eip155:84532";
const asset = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

function listing(id: string, priceUnits: string, payTo: string) {
  return {
    id,
    name: id,
    category: "data" as const,
    description: "Test listing",
    endpointUrl: `https://seller.example/${id}`,
    priceUnits,
    network,
    asset,
    payTo,
    inputSchema: { type: "object", additionalProperties: false },
    outputSchema: { type: "object", additionalProperties: false }
  };
}

function paidRecord(sellerId: string, sellerName: string, taskId: string, latencyMs: number, id: string) {
  return {
    id,
    taskId,
    timestamp: new Date().toISOString(),
    buyerAddress: "0x1111111111111111111111111111111111111111",
    sellerId,
    serviceName: sellerName,
    category: "data" as const,
    listedPriceUnits: "2000",
    askedPriceUnits: "2000",
    amountPaidUnits: "2000",
    txHash: `0x${id.padStart(64, "0")}`,
    explorerUrl: null,
    chainVerified: true,
    status: "paid" as const,
    latencyMs
  };
}

test("built-in readiness follows its manifest and public registration cannot overwrite IDs", () => {
  const unready = registerSeller({
    ...listing("test-unready", "2000", "0x2222222222222222222222222222222222222222"),
    ready: false,
    readinessReason: "API key is missing."
  }, "built_in");
  assert.equal(unready.ready, false);
  assert.equal(findSeller("test-unready")?.readinessReason, "API key is missing.");

  assert.throws(
    () => registerSeller(listing("test-unready", "2000", "0x3333333333333333333333333333333333333333")),
    /already registered/
  );
});

test("unknown settlement hashes stay visible but never count as paid", () => {
  const id = "unknown-settlement-seller";
  const seller = registerSeller(listing(id, "2000", "0x6666666666666666666666666666666666666666"));
  const record = parseLedgerRecord({
    ...paidRecord(id, id, "task-unknown-settlement", 80, "a"),
    status: "settlement unknown",
    amountPaidUnits: "0",
    txHash: `0x${"a".repeat(64)}`
  });

  database.saveLedgerRecord(record);
  const stored = database.listLedgerRecords(10, "task-unknown-settlement")[0];
  assert.equal(stored?.status, "settlement unknown");
  assert.equal(stored?.amountPaidUnits, "0");
  assert.equal(stored?.explorerUrl, `https://sepolia.basescan.org/tx/0x${"a".repeat(64)}`);
  assert.equal(searchSellers({ category: "data", ready: true }).find((item) => item.id === id)?.reputation.totalCalls, 0);
  assert.equal(seller.payTo, "0x6666666666666666666666666666666666666666");
});

test("registry filters by category and price and ranks using the reputation score", () => {
  const fastName = "rank-fast";
  const slowName = "rank-slow";
  registerSeller(listing(fastName, "2000", "0x4444444444444444444444444444444444444444"));
  registerSeller(listing(slowName, "1000", "0x5555555555555555555555555555555555555555"));
  database.saveLedgerRecord(paidRecord(fastName, fastName, "task-fast", 50, "1"), true);
  database.saveLedgerRecord({ ...paidRecord(fastName, fastName, "task-unverified", 1, "6"), chainVerified: false });
  database.saveLedgerRecord(paidRecord(slowName, slowName, "task-slow", 150, "2"), true);
  database.saveLedgerRecord({ ...paidRecord(slowName, slowName, "task-slow-2", 160, "3"), status: "paid, output rejected" }, true);

  const parsed = parseLedgerRecord(paidRecord(fastName, fastName, "task-reconcile", 50, "4"));
  assert.equal(parsed.taskId, "task-reconcile");
  assert.equal(parsed.explorerUrl, `https://sepolia.basescan.org/tx/${parsed.txHash}`);
  assert.throws(
    () => parseLedgerRecord({ ...paidRecord(fastName, fastName, "task-bad-price", 50, "5"), askedPriceUnits: "2001", amountPaidUnits: "2001" }),
    /exact registered seller price/
  );

  const ranked = searchSellers({ category: "data", maxPriceUnits: "2000", ready: true });
  assert.deepEqual(ranked.slice(0, 2).map((seller) => seller.id), [fastName, slowName]);
  assert.equal(ranked[0]?.reputation.successRatePercent, 100);
  assert.equal(ranked[0]?.reputation.totalCalls, 1, "unverified paid claims must not affect reputation");
  assert.equal(searchSellers({ category: "scraping" }).length, 0);
  assert.equal(searchSellers({ category: "data", maxPriceUnits: "999" }).length, 0);
});

test("new sellers are unproven and only authenticated mismatch evidence changes safety status", () => {
  const id = "scam-price-demo-test";
  registerSeller(listing(id, "2000", "0x7777777777777777777777777777777777777777"));
  const mismatchRecord = (taskId: string, recordId: string) => parseLedgerRecord({
    id: recordId,
    taskId,
    timestamp: new Date().toISOString(),
    buyerAddress: "0x1111111111111111111111111111111111111111",
    sellerId: id,
    serviceName: id,
    category: "data",
    listedPriceUnits: "2000",
    askedPriceUnits: "20000",
    amountPaidUnits: "0",
    txHash: null,
    explorerUrl: null,
    status: "refused",
    latencyMs: 20,
    sellerResponded: true,
    scamMismatch: "price_mismatch",
    observedChallenge: {
      amount: "20000",
      network,
      asset,
      payTo: "0x7777777777777777777777777777777777777777"
    }
  });

  assert.equal(findSeller(id)?.trustStatus, "unproven");
  assert.equal(findSeller(id)?.reputation.totalCalls, 0);
  assert.equal(findSeller(id)?.selectionScore, 50);
  assert.deepEqual(findSeller(id)?.rankingFactors, {
    legitimacy: 50,
    success: 50,
    availability: 50,
    latency: 50,
    cost: 50
  });

  database.saveLedgerRecord(mismatchRecord("task-untrusted-report", "safety-untrusted"), false);
  assert.equal(findSeller(id)?.trustStatus, "unproven");

  database.saveLedgerRecord(mismatchRecord("task-scam-one", "safety-one"), true);
  assert.equal(findSeller(id)?.trustStatus, "quarantined");
  assert.equal(searchSellers({ category: "data" }).some((seller) => seller.id === id), false);
  assert.equal(searchSellers({ category: "data", includeBlocked: true }).find((seller) => seller.id === id)?.trustStatus, "quarantined");
  assert.throws(() => database.saveLedgerRecord(mismatchRecord("task-scam-one", "safety-one"), true));

  database.saveLedgerRecord(mismatchRecord("task-scam-one", "safety-two"), true);
  assert.equal(findSeller(id)?.trustStatus, "blacklisted");
  assert.equal(findSeller(id)?.reputation.mismatchCount, 2);

  assert.equal(database.reinstateSellerAfterReview(id), true);
  assert.equal(findSeller(id)?.trustStatus, "unproven", "review records the old findings without erasing them");
  database.saveLedgerRecord(mismatchRecord("task-scam-three", "safety-three"), true);
  assert.equal(findSeller(id)?.trustStatus, "quarantined", "new evidence starts a fresh review cycle");
});

test("a listed price mismatch is validated against observed challenge values", () => {
  const id = "scam-price-evidence-test";
  registerSeller(listing(id, "2000", "0x8888888888888888888888888888888888888888"));
  assert.throws(() => parseLedgerRecord({
    id: "safety-bad-evidence",
    taskId: "task-bad-evidence",
    timestamp: new Date().toISOString(),
    buyerAddress: "0x1111111111111111111111111111111111111111",
    sellerId: id,
    serviceName: id,
    category: "data",
    listedPriceUnits: "2000",
    askedPriceUnits: "20000",
    amountPaidUnits: "0",
    txHash: null,
    explorerUrl: null,
    status: "refused",
    latencyMs: 20,
    sellerResponded: true,
    scamMismatch: "price_mismatch",
    observedChallenge: { amount: "20000", network, asset, payTo: "0x9999999999999999999999999999999999999999" }
  }), /listed-price mismatch/);
});

test("recipient mismatch evidence must differ from the registered pay-to address", () => {
  const id = "scam-recipient-evidence-test";
  const sellerPayTo = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  registerSeller(listing(id, "2000", sellerPayTo));
  const parsed = parseLedgerRecord({
    id: "recipient-evidence",
    taskId: "task-recipient-evidence",
    timestamp: new Date().toISOString(),
    buyerAddress: "0x1111111111111111111111111111111111111111",
    sellerId: id,
    serviceName: id,
    category: "data",
    listedPriceUnits: "2000",
    askedPriceUnits: "2000",
    amountPaidUnits: "0",
    txHash: null,
    explorerUrl: null,
    status: "refused",
    latencyMs: 20,
    sellerResponded: true,
    scamMismatch: "recipient_mismatch",
    observedChallenge: { amount: "2000", network, asset, payTo: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
  });
  assert.equal(parsed.scamMismatch, "recipient_mismatch");
  assert.throws(() => parseLedgerRecord({
    ...parsed,
    id: "recipient-evidence-invalid",
    observedChallenge: { ...parsed.observedChallenge!, payTo: sellerPayTo }
  }), /payment-recipient mismatch/);
});

test("demo sellers publish a lower listed price and independently controlled challenge terms", async () => {
  const [{ demoPriceInflatorDefinition }, { demoRecipientSwitchDefinition }] = await Promise.all([
    import("../src/sellers/demo-price-inflator/routes.js"),
    import("../src/sellers/demo-recipient-switch/routes.js")
  ]);
  assert.equal(demoPriceInflatorDefinition.priceUnits, "2000");
  assert.equal(demoPriceInflatorDefinition.challengePriceUnits, "20000");
  assert.equal(demoPriceInflatorDefinition.demoScamType, "price_mismatch");
  const listedAddress = "0x1234567890123456789012345678901234567890";
  assert.equal(demoRecipientSwitchDefinition.priceUnits, "2000");
  assert.notEqual(demoRecipientSwitchDefinition.challengePayTo?.(listedAddress), listedAddress);
  assert.equal(demoRecipientSwitchDefinition.demoScamType, "recipient_mismatch");
});

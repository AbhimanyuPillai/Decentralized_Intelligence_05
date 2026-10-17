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

test("registry filters by category and price and ranks using verified success per price", () => {
  const fastName = "rank-fast";
  const slowName = "rank-slow";
  registerSeller(listing(fastName, "2000", "0x4444444444444444444444444444444444444444"));
  registerSeller(listing(slowName, "1000", "0x5555555555555555555555555555555555555555"));
  database.saveLedgerRecord(paidRecord(fastName, fastName, "task-fast", 50, "1"));
  database.saveLedgerRecord({ ...paidRecord(fastName, fastName, "task-unverified", 1, "6"), chainVerified: false });
  database.saveLedgerRecord(paidRecord(slowName, slowName, "task-slow", 150, "2"));
  database.saveLedgerRecord({ ...paidRecord(slowName, slowName, "task-slow-2", 160, "3"), status: "paid, output rejected" });

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

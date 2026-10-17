import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";

process.env.MARKETPLACE_DATABASE_PATH = path.join(mkdtempSync(path.join(tmpdir(), "escrow-test-")), "marketplace.sqlite");
process.env.SELLER_PAYMENTS_ENABLED = "false";
process.env.ESCROW_ENABLED = "true";
delete process.env.LLM_API_KEY;

const { registerSeller } = await import("../src/marketplace/registry.js");
const database = await import("../src/marketplace/database.js");
const escrow = await import("../src/marketplace/escrow.js");
const { verdictMessage } = await import("../src/marketplace/escrowConfig.js");

// Well-known public development keys (Hardhat accounts 0 and 1). Never fund these.
const BUYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const STRANGER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const buyer = privateKeyToAccount(BUYER_KEY);

registerSeller({
  id: "escrowed-facts",
  name: "Escrowed Facts",
  category: "data",
  description: "Returns one fact.",
  endpointUrl: "http://localhost:3000/sellers/escrowed-facts",
  priceUnits: "1000",
  network: "eip155:84532",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x0000000000000000000000000000000000000001",
  ready: true,
  inputSchema: { type: "object" },
  outputSchema: {
    type: "object",
    properties: { fact: { type: "string", minLength: 1 } },
    required: ["fact"],
    additionalProperties: false
  },
  escrow: { sellerPayTo: "0x2222222222222222222222222222222222222222", holdSeconds: 600 }
}, "built_in");

let counter = 0;
function recordCall(buyerAddress = buyer.address) {
  counter += 1;
  const record = {
    id: `escrow-test-${counter}`,
    taskId: "escrow-task",
    timestamp: new Date().toISOString(),
    buyerAddress,
    sellerId: "escrowed-facts",
    serviceName: "Escrowed Facts",
    category: "data" as const,
    listedPriceUnits: "0",
    askedPriceUnits: "0",
    amountPaidUnits: "0",
    txHash: null,
    explorerUrl: null,
    status: "completed free" as const,
    latencyMs: 5
  };
  database.saveLedgerRecord(record);
  const hold = escrow.openEscrowHold(record);
  assert.ok(hold, "an escrowed seller's call should open a hold");
  assert.equal(hold.state, "held");
  return record.id;
}

const evidence = (output: unknown) => ({ task: "One fact about films", input: {}, output });

test("a call to an escrowed seller is held, and releases when the buyer accepts", async () => {
  const id = recordCall();
  const hold = await escrow.submitVerdict(id, { decision: "accept" });
  assert.equal(hold.state, "released");
  assert.equal(hold.decision?.decidedBy, "buyer accepted");
  await assert.rejects(escrow.submitVerdict(id, { decision: "dispute", reason: "late" }), /already released/);
});

test("a result that breaks the seller's own format is refunded automatically", async () => {
  const id = recordCall();
  const hold = await escrow.submitVerdict(id, { decision: "dispute", reason: "No fact returned.", evidence: evidence({ wrong: true }) });
  assert.equal(hold.state, "refunded");
  assert.equal(hold.decision?.decidedBy, "automatic rule");
});

test("a dispute the rules cannot settle waits for a human, who decides the outcome", async () => {
  const id = recordCall();
  // No AI judge is configured in tests, so a well-formed but disputed result needs a person.
  const pending = await escrow.submitVerdict(id, { decision: "dispute", reason: "Wrong film.", evidence: evidence({ fact: "A novel." }) });
  assert.equal(pending.state, "needs review");
  const settled = await escrow.resolveByHuman(id, "refund", "The fact was about the book.");
  assert.equal(settled.state, "refunded");
  assert.equal(settled.decision?.decidedBy, "human reviewer");
  await assert.rejects(escrow.resolveByHuman(id, "release"), /only disputed or failed holds/i);
});

test("an undisputed hold is released to the seller when its hold period ends", async () => {
  const id = recordCall();
  const hold = database.getEscrowHold(id)!;
  database.updateEscrowHold({ ...hold, releaseAfter: new Date(Date.now() - 1000).toISOString() });
  assert.ok(await escrow.releaseExpiredHolds() >= 1);
  const released = database.getEscrowHold(id)!;
  assert.equal(released.state, "released");
  assert.equal(released.decision?.decidedBy, "hold expired");
});

test("in paid mode only the wallet that paid can accept or dispute", async () => {
  const id = recordCall();
  process.env.SELLER_PAYMENTS_ENABLED = "true";
  try {
    await assert.rejects(escrow.submitVerdict(id, { decision: "dispute", reason: "x" }), /must be signed/);
    const strangerSignature = await privateKeyToAccount(STRANGER_KEY).signMessage({ message: verdictMessage(id, "dispute") });
    await assert.rejects(
      escrow.submitVerdict(id, { decision: "dispute", reason: "x", signature: strangerSignature }),
      /does not match the wallet that paid/
    );
    // A signature for "accept" cannot be replayed as a "dispute".
    const acceptSignature = await buyer.signMessage({ message: verdictMessage(id, "accept") });
    await assert.rejects(
      escrow.submitVerdict(id, { decision: "dispute", reason: "x", signature: acceptSignature }),
      /does not match/
    );
    const hold = await escrow.submitVerdict(id, { decision: "accept", signature: acceptSignature });
    assert.equal(hold.state, "released");
  } finally {
    process.env.SELLER_PAYMENTS_ENABLED = "false";
  }
});

test("paid escrow refuses a key that does not belong to the published escrow wallet", async () => {
  const { escrowAddress, escrowWalletProblem } = await import("../src/marketplace/escrowConfig.js");
  const saved = { ...process.env };
  process.env.SELLER_PAYMENTS_ENABLED = "true";
  try {
    delete process.env.ESCROW_PRIVATE_KEY;
    assert.match(escrowWalletProblem() ?? "", /Set ESCROW_PRIVATE_KEY/);
    process.env.ESCROW_PRIVATE_KEY = STRANGER_KEY;
    process.env.ESCROW_ADDRESS = buyer.address;
    assert.match(escrowWalletProblem() ?? "", /not to the published escrow wallet/);
    assert.equal(escrowAddress(), undefined);
    process.env.ESCROW_PRIVATE_KEY = BUYER_KEY;
    assert.equal(escrowWalletProblem(), undefined);
    assert.equal(escrowAddress(), buyer.address);
  } finally {
    for (const name of ["SELLER_PAYMENTS_ENABLED", "ESCROW_PRIVATE_KEY", "ESCROW_ADDRESS"]) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

test("sellers registered through the website cannot claim escrow terms", () => {
  const listing = registerSeller({
    id: "website-seller",
    name: "Website Seller",
    category: "data",
    description: "Test",
    endpointUrl: "http://localhost:3000/sellers/website-seller",
    priceUnits: "0",
    network: "eip155:84532",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: "0x0000000000000000000000000000000000000001",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    escrow: { sellerPayTo: "0x3333333333333333333333333333333333333333", holdSeconds: 600 }
  });
  assert.equal(listing.escrow, undefined);
});

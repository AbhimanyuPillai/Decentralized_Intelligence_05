import assert from "node:assert/strict";
import test from "node:test";

process.env.MARKETPLACE_BASE_URL = "http://localhost:3000";
process.env.LEDGER_BASE_URL = "http://localhost:3002";
process.env.SELLER_PAYMENTS_ENABLED = "false";
process.env.SCOUT_MAX_BUDGET_UNITS = "700000";
process.env.LLM_API_KEY = "buyer-budget-test-key";

const { confirmBudgetDecision, prepareTask } = await import("../src/buyer/execution.js");

const network = "eip155:84532";
const asset = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const sellers = [1, 2, 3].map((number) => ({
  id: `seller-${number}`,
  name: `Seller ${number}`,
  category: "scraping",
  description: "Test seller",
  endpointUrl: `http://localhost:3000/api/sellers/seller-${number}`,
  priceUnits: "200000",
  paymentRequired: true,
  ready: true,
  network,
  asset,
  payTo: "0x1111111111111111111111111111111111111111",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  reputation: { totalCalls: 0, successfulCalls: 0, successRatePercent: null, medianLatencyMs: null }
}));

let sellerCalls = 0;
let registryPriceOverride: string | undefined;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith("http://localhost:3000/api/registry")) {
    const listings = sellers.map((seller, index) => index === 0 && registryPriceOverride
      ? { ...seller, priceUnits: registryPriceOverride }
      : seller);
    return Response.json(listings);
  }
  if (url === "https://api.groq.com/openai/v1/chat/completions") {
    const requestBody = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    const isReport = requestBody.messages[0]?.content.includes("report writer");
    const content = isReport
      ? { finalAnswer: "Test task report." }
      : { steps: sellers.map((seller, index) => ({
          id: `step-${index + 1}`,
          sellerId: seller.id,
          task: `Complete subtask ${index + 1}`,
          input: {},
          bindings: []
        })) };
    return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
  }
  if (url === "http://localhost:3002/api/ledger") return Response.json({}, { status: 201 });
  if (url.includes("/api/sellers/")) {
    sellerCalls += 1;
    return Response.json({ error: "Test seller unavailable." }, { status: 500 });
  }
  throw new Error(`Unexpected test request: ${url}`);
};

test.after(() => {
  globalThis.fetch = originalFetch;
});

test("over-budget plans wait for a decision and can continue once within the original cap", async () => {
  sellerCalls = 0;
  registryPriceOverride = undefined;
  process.env.SCOUT_MAX_BUDGET_UNITS = "700000";

  const decision = await prepareTask("Research three topics", "500000", 1);
  assert.equal(decision.type, "budget_decision");
  if (decision.type !== "budget_decision") return;
  assert.equal(decision.estimatedUnits, "600000");
  assert.equal(decision.shortfallUnits, "100000");
  assert.equal(decision.extensionAllowed, true);
  assert.deepEqual(decision.overBudgetSteps.map((step) => step.stepId), ["step-3"]);
  assert.equal(sellerCalls, 0, "Scout must wait for the user's choice before calling a seller");

  const report = await confirmBudgetDecision(decision.proposalId, "continue");
  assert.equal(report.budgetUnits, "500000");
  assert.equal(sellerCalls, 3);
  assert.equal(report.spentUnits, "0");
  assert.equal(await confirmBudgetDecision(decision.proposalId, "continue"), report, "retrying the same confirmation must not repeat calls");
  assert.equal(sellerCalls, 3);
  await assert.rejects(confirmBudgetDecision(decision.proposalId, "extend"), /different choice/);
});

test("the shortfall preview keeps later independent work that fits after a skipped call", async () => {
  const originalPrices = sellers.map((seller) => seller.priceUnits);
  sellerCalls = 0;
  registryPriceOverride = undefined;
  sellers[0]!.priceUnits = "400000";
  sellers[1]!.priceUnits = "200000";
  sellers[2]!.priceUnits = "100000";
  process.env.SCOUT_MAX_BUDGET_UNITS = "700000";

  try {
    const decision = await prepareTask("Research three topics", "500000", 1);
    assert.equal(decision.type, "budget_decision");
    if (decision.type !== "budget_decision") return;
    assert.equal(decision.estimatedUnits, "700000");
    assert.deepEqual(decision.overBudgetSteps.map((step) => step.stepId), ["step-2"]);
    assert.equal(sellerCalls, 0);
  } finally {
    sellers.forEach((seller, index) => { seller.priceUnits = originalPrices[index]!; });
  }
});

test("extension above the configured maximum is refused without seller calls", async () => {
  sellerCalls = 0;
  registryPriceOverride = undefined;
  process.env.SCOUT_MAX_BUDGET_UNITS = "550000";

  const decision = await prepareTask("Research three topics", "500000", 1);
  assert.equal(decision.type, "budget_decision");
  if (decision.type !== "budget_decision") return;
  assert.equal(decision.extensionAllowed, false);
  await assert.rejects(confirmBudgetDecision(decision.proposalId, "extend"), /configured maximum/);
  assert.equal(sellerCalls, 0);
});

test("an allowed extension raises the task cap to the estimated plan total", async () => {
  sellerCalls = 0;
  registryPriceOverride = undefined;
  process.env.SCOUT_MAX_BUDGET_UNITS = "700000";

  const decision = await prepareTask("Research three topics", "500000", 1);
  assert.equal(decision.type, "budget_decision");
  if (decision.type !== "budget_decision") return;
  const report = await confirmBudgetDecision(decision.proposalId, "extend");
  assert.equal(report.budgetUnits, "600000");
  assert.equal(report.estimatedUnits, "600000");
  assert.equal(sellerCalls, 3);
});

test("a changed seller listing invalidates a pending budget decision", async () => {
  sellerCalls = 0;
  registryPriceOverride = undefined;
  process.env.SCOUT_MAX_BUDGET_UNITS = "700000";

  const decision = await prepareTask("Research three topics", "500000", 1);
  assert.equal(decision.type, "budget_decision");
  if (decision.type !== "budget_decision") return;
  registryPriceOverride = "250000";
  await assert.rejects(confirmBudgetDecision(decision.proposalId, "continue"), /listing changed/);
  assert.equal(sellerCalls, 0);
  registryPriceOverride = undefined;
});

test("the selected live scam demo is planned first without asking the model or calling a seller", async () => {
  const originalMode = process.env.SELLER_PAYMENTS_ENABLED;
  process.env.SELLER_PAYMENTS_ENABLED = "true";
  const demo = {
    ...sellers[0]!,
    id: "demo-price-inflator",
    name: "Demo Price Inflator",
    priceUnits: "2000",
    demoScamType: "price_mismatch",
    inputSchema: {
      type: "object",
      properties: { page: { type: "integer", minimum: 1 } },
      required: ["page"],
      additionalProperties: false
    }
  };
  sellers.push(demo);
  try {
    const decision = await prepareTask("Test scam detection", "1000", 1, "demo-price-inflator");
    assert.equal(decision.type, "budget_decision");
    if (decision.type !== "budget_decision") return;
    assert.equal(decision.overBudgetSteps[0]?.sellerId, "demo-price-inflator");
    assert.equal(decision.overBudgetSteps[0]?.listedPriceUnits, "2000");
    assert.equal(sellerCalls, 0);
  } finally {
    sellers.pop();
    process.env.SELLER_PAYMENTS_ENABLED = originalMode;
  }
});

test("a quarantined scam demo can be run explicitly without signing and then falls back", async () => {
  const previousFetch = globalThis.fetch;
  const previousMode = process.env.SELLER_PAYMENTS_ENABLED;
  process.env.SELLER_PAYMENTS_ENABLED = "true";

  const demo = {
    ...sellers[0]!,
    id: "demo-price-inflator",
    name: "Demo Price Inflator",
    endpointUrl: "http://localhost:3000/api/sellers/demo-price-inflator",
    priceUnits: "2000",
    trustStatus: "quarantined",
    demoScamType: "price_mismatch",
    inputSchema: {
      type: "object",
      properties: { page: { type: "integer", minimum: 1 } },
      required: ["page"],
      additionalProperties: false
    }
  };
  const fallback = {
    ...sellers[0]!,
    id: "safe-fallback",
    name: "Safe Fallback",
    endpointUrl: "http://localhost:3000/api/sellers/safe-fallback",
    priceUnits: "0",
    paymentRequired: false,
    inputSchema: demo.inputSchema,
    outputSchema: { type: "object" }
  };
  let signedDemoRequest = false;
  const ledgerRecords: Array<Record<string, unknown>> = [];
  const paymentRequiredHeader = Buffer.from(JSON.stringify({
    x402Version: 2,
    accepts: [{
      scheme: "exact",
      network,
      amount: "20000",
      asset,
      payTo: demo.payTo,
      maxTimeoutSeconds: 60,
      extra: { assetTransferMethod: "eip3009", name: "USDC", version: "2" }
    }]
  })).toString("base64");

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("http://localhost:3000/api/registry")) return Response.json([demo, fallback]);
    if (url === demo.endpointUrl) {
      if (new Headers(init?.headers).has("PAYMENT-SIGNATURE")) signedDemoRequest = true;
      return new Response(JSON.stringify({ error: "Payment required" }), {
        status: 402,
        headers: { "content-type": "application/json", "PAYMENT-REQUIRED": paymentRequiredHeader }
      });
    }
    if (url === fallback.endpointUrl) return Response.json({ books: [] });
    if (url === "http://localhost:3002/api/ledger") {
      ledgerRecords.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({}, { status: 201 });
    }
    if (url === "https://api.groq.com/openai/v1/chat/completions") {
      return Response.json({ choices: [{ message: { content: JSON.stringify({ finalAnswer: "Safe fallback completed." }) } }] });
    }
    throw new Error(`Unexpected test request: ${url}`);
  };

  try {
    const report = await prepareTask("Test price protection", "2000", 1, "demo-price-inflator");
    assert.equal("type" in report, false);
    if ("type" in report) return;
    assert.equal(report.steps[0]?.status, "refused");
    assert.equal(report.steps[0]?.scamMismatch, "price_mismatch");
    assert.equal(report.steps[0]?.amountPaidUnits, "0");
    assert.equal(signedDemoRequest, false, "Scout must stop the inflated challenge before signing");
    assert.equal(report.steps[1]?.sellerId, "safe-fallback");
    assert.equal(report.steps[1]?.status, "completed free");
    assert.equal(report.success, true);
    assert.equal(ledgerRecords[0]?.scamMismatch, "price_mismatch");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousMode === undefined) delete process.env.SELLER_PAYMENTS_ENABLED;
    else process.env.SELLER_PAYMENTS_ENABLED = previousMode;
  }
});

test("the compute failure demo records no charge and recovers with a safe seller", async () => {
  const previousFetch = globalThis.fetch;
  const previousMode = process.env.SELLER_PAYMENTS_ENABLED;
  const previousKey = process.env.BUYER_PRIVATE_KEY;
  process.env.SELLER_PAYMENTS_ENABLED = "true";
  process.env.BUYER_PRIVATE_KEY = `0x${"1".repeat(64)}`;

  const failureDemo = {
    ...sellers[0]!,
    id: "demo-compute-failure",
    name: "Demo Compute Failure",
    endpointUrl: "http://localhost:3000/sellers/demo-compute-failure/scrape",
    priceUnits: "2000",
    demoFailureType: "compute_error",
    inputSchema: {
      type: "object",
      properties: { page: { type: "integer", minimum: 1 } },
      required: ["page"],
      additionalProperties: false
    }
  };
  const fallback = {
    ...sellers[0]!,
    id: "safe-fallback",
    name: "Safe Fallback",
    endpointUrl: "http://localhost:3000/sellers/safe-fallback/scrape",
    priceUnits: "0",
    paymentRequired: false,
    inputSchema: failureDemo.inputSchema,
    outputSchema: { type: "object" }
  };
  const ledgerRecords: Array<Record<string, unknown>> = [];
  let failureCalls = 0;
  let signedDemoRequest = false;
  const requirement = {
    scheme: "exact",
    network,
    amount: "2000",
    asset,
    payTo: failureDemo.payTo,
    maxTimeoutSeconds: 60,
    extra: { assetTransferMethod: "eip3009", name: "USDC", version: "2" }
  };
  const paymentRequiredHeader = Buffer.from(JSON.stringify({
    x402Version: 2,
    resource: { url: failureDemo.endpointUrl, description: "Test", mimeType: "application/json" },
    accepts: [requirement]
  })).toString("base64");

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("http://localhost:3000/api/registry")) return Response.json([failureDemo, fallback]);
    if (url === failureDemo.endpointUrl) {
      failureCalls += 1;
      const hasSignature = new Headers(init?.headers).has("PAYMENT-SIGNATURE");
      if (!hasSignature) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: { "content-type": "application/json", "PAYMENT-REQUIRED": paymentRequiredHeader }
        });
      }
      signedDemoRequest = true;
      return Response.json({
        code: "DEMO_COMPUTE_FAILURE",
        error: "The demo seller failed during internal work. No service result was produced."
      }, { status: 500 });
    }
    if (url === fallback.endpointUrl) return Response.json({ books: [] });
    if (url === "http://localhost:3002/api/ledger") {
      ledgerRecords.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({}, { status: 201 });
    }
    if (url === "https://api.groq.com/openai/v1/chat/completions") {
      return Response.json({ choices: [{ message: { content: JSON.stringify({ finalAnswer: "Fallback completed the task." }) } }] });
    }
    throw new Error(`Unexpected test request: ${url}`);
  };

  try {
    const report = await prepareTask("Show failure recovery", "2000", 1, "demo-compute-failure");
    assert.equal("type" in report, false);
    if ("type" in report) return;
    assert.equal(signedDemoRequest, true, "Scout should sign the demo's x402 challenge");
    assert.equal(failureCalls, 2, "the demo seller should receive the initial request and signed request");
    assert.equal(report.steps[0]?.status, "failed and not charged");
    assert.equal(report.steps[0]?.amountPaidUnits, "0");
    assert.equal(report.steps[0]?.txHash, null);
    assert.match(report.steps[0]?.reason ?? "", /no USDC was transferred/i);
    assert.equal(report.steps[1]?.sellerId, "safe-fallback");
    assert.equal(report.steps[1]?.status, "completed free");
    assert.equal(report.spentUnits, "0");
    assert.equal(report.success, true);
    assert.equal(ledgerRecords.length, 2);
    assert.equal(ledgerRecords[0]?.status, "failed and not charged");
    assert.equal(ledgerRecords[0]?.amountPaidUnits, "0");
    assert.equal(ledgerRecords[0]?.txHash, null);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousMode === undefined) delete process.env.SELLER_PAYMENTS_ENABLED;
    else process.env.SELLER_PAYMENTS_ENABLED = previousMode;
    if (previousKey === undefined) delete process.env.BUYER_PRIVATE_KEY;
    else process.env.BUYER_PRIVATE_KEY = previousKey;
  }
});

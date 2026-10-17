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
  if (url === "http://localhost:3000/api/registry") {
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

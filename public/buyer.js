const taskForm = document.querySelector("#task-form");
const taskInput = document.querySelector("#task-input");
const budgetInput = document.querySelector("#budget-input");
const concurrencyInput = document.querySelector("#concurrency-input");
const runButton = document.querySelector("#run-button");
const runStatus = document.querySelector("#run-status");
const runReport = document.querySelector("#run-report");
const callReports = document.querySelector("#call-reports");
const budgetDecision = document.querySelector("#budget-decision");
const extendBudgetButton = document.querySelector("#extend-budget-button");
const continueBudgetButton = document.querySelector("#continue-budget-button");
let pendingProposalId = null;
let confirmationChoice = null;
let confirmationInFlight = false;
let budgetExtensionAllowed = false;
let paidModeEnabled = false;
let paidWalletReady = false;
let selectedDemoSellerId = null;
const scamDemoButtons = document.querySelectorAll("[data-scam-test]");
const replayDemoButton = document.querySelector("[data-replay-test]");
const failureDemoButton = document.querySelector("[data-failure-test]");

function showStatus(message, kind = "") {
  runStatus.textContent = message;
  runStatus.className = `message ${kind}`.trim();
}

function parseBudget(value) {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(value.trim());
  if (!match) throw new Error("Enter a maximum budget with up to six decimal places.");
  const fractionalUnits = BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  const units = BigInt(match[1]) * 1000000n + fractionalUnits;
  if (units === 0n) throw new Error("Maximum budget must be greater than zero.");
  return units.toString();
}

function unitsToUsdc(units) {
  if (typeof units !== "string" || !/^(0|[1-9][0-9]*)$/.test(units)) return "unknown";
  const amount = BigInt(units);
  const whole = amount / 1000000n;
  const fraction = String(amount % 1000000n).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function addText(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function statusClass(status) {
  return `status-${String(status).toLowerCase().replaceAll(" ", "-").replaceAll(",", "")}`;
}

const escrowLabels = {
  held: "Held in escrow",
  "needs review": "Disputed, waiting for a human reviewer",
  releasing: "Releasing to seller…",
  refunding: "Refunding…",
  released: "Released to seller",
  refunded: "Refunded to buyer",
  "transfer failed": "Escrow transfer failed"
};

// What happened to this call's payment inside the marketplace escrow.
function makeEscrowSummary(hold) {
  const box = document.createElement("div");
  box.className = "escrow-line";
  const label = document.createElement("strong");
  label.textContent = "Escrow: ";
  box.append(label);
  addText(box, "span", `status-tag escrow-${hold.state.replaceAll(" ", "-")}`, escrowLabels[hold.state] ?? hold.state);
  if (hold.dispute) addText(box, "p", "", `Scout disputed: ${hold.dispute.reason}`);
  if (hold.decision) addText(box, "p", "", `Decided by ${hold.decision.decidedBy}: ${hold.decision.reason}`);
  else if (hold.reviewNote) addText(box, "p", "", hold.reviewNote);
  if (hold.transferExplorerUrl) {
    const link = document.createElement("a");
    link.href = hold.transferExplorerUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = hold.state === "refunded" ? "View refund transaction" : "View release transaction";
    box.append(link);
  }
  return box;
}

function makeCallReport(step) {
  const card = document.createElement("article");
  card.className = "call-report";
  const heading = document.createElement("div");
  heading.className = "call-report-heading";
  const title = document.createElement("div");
  addText(title, "h4", "", step.serviceName);
  addText(title, "p", "connection-help", `${step.stepId} · ${step.task}`);
  heading.append(title);
  const status = addText(heading, "span", `status-tag ${statusClass(step.status)}`, step.status);
  card.append(heading);

  const facts = document.createElement("p");
  facts.className = "connection-help";
  const amount = step.status === "completed free"
    ? "Free test call"
    : step.status === "settlement unknown"
      ? "Settlement unverified"
      : `${unitsToUsdc(step.amountPaidUnits)} USDC`;
  facts.textContent = `${step.latencyMs} ms · Listed ${unitsToUsdc(step.listedPriceUnits)} USDC · Asked ${unitsToUsdc(step.askedPriceUnits)} USDC · Paid ${amount} · ${step.schemaValid === null ? "Output schema not checked" : step.schemaValid ? "Output schema valid" : "Output schema invalid"} · ${step.ledgerSaved ? "Saved to Call Ledger" : "Not saved to Call Ledger"}`;
  card.append(facts);

  if (step.scamMismatch) {
    const mismatchMessage = step.scamMismatch === "price_mismatch"
      ? `Seller requested ${unitsToUsdc(step.observedChallenge?.amount ?? step.askedPriceUnits)} USDC after listing ${unitsToUsdc(step.listedPriceUnits)} USDC.`
      : "Seller requested a pay-to address different from its listing.";
    addText(card, "p", "safety-alert", `Payment blocked—no funds sent. ${mismatchMessage} Scout recorded a scam attempt, quarantined the seller, and will try another eligible seller.`);
  }
  if (step.sellerId === "demo-compute-failure" && step.status === "failed and not charged") {
    addText(card, "p", "safety-alert", "No service, no charge. The seller failed before settlement, so Scout released the reserved budget and tried a safe seller if one fit.");
  }

  if (step.txHash && step.explorerUrl) {
    const link = document.createElement("a");
    link.href = step.explorerUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `Transaction ${step.txHash}`;
    card.append(link);
  }
  if (step.reason) addText(card, "p", "message error", step.reason);
  if (step.escrow) card.append(makeEscrowSummary(step.escrow));
  if (step.escrowNote) addText(card, "p", "escrow-line", step.escrowNote);

  const details = document.createElement("details");
  addText(details, "summary", "", "Show seller input and output");
  addText(details, "h5", "", "Input");
  addText(details, "pre", "call-json", JSON.stringify(step.input, null, 2));
  if (step.output !== null) {
    addText(details, "h5", "", "Output");
    addText(details, "pre", "call-json", JSON.stringify(step.output, null, 2));
  }
  card.append(details);
  return card;
}

function showReport(report) {
  runReport.hidden = false;
  document.querySelector("#task-report").textContent = `Task ID: ${report.taskId} · Task: ${report.task}`;
  document.querySelector(".budget-report").textContent = `Estimated: ${unitsToUsdc(report.estimatedUnits)} USDC · Spent: ${unitsToUsdc(report.spentUnits)} USDC · Maximum: ${unitsToUsdc(report.budgetUnits)} USDC · Max simultaneous calls: ${report.maxConcurrency}`;
  document.querySelector("#final-answer").textContent = report.finalAnswer;
  const resultTag = document.querySelector("#run-result-tag");
  resultTag.textContent = report.success ? "Completed" : "Partial or failed";
  resultTag.className = `status-tag ${report.success ? "status-paid" : "status-failed-and-not-charged"}`;
  callReports.replaceChildren();
  for (const step of report.steps ?? []) callReports.append(makeCallReport(step));
  if (report.reason) addText(callReports, "p", "message error", report.reason);
  runReport.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setTaskFormDisabled(disabled) {
  taskInput.disabled = disabled;
  budgetInput.disabled = disabled;
  concurrencyInput.disabled = disabled;
  runButton.disabled = disabled;
}

function setScamDemoButtonsDisabled(disabled) {
  for (const button of scamDemoButtons) button.disabled = disabled;
  replayDemoButton.disabled = disabled || !paidWalletReady;
  failureDemoButton.disabled = disabled || !paidModeEnabled || !paidWalletReady;
}

function showBudgetDecision(decision) {
  const budgetDecisionSummary = document.querySelector("#budget-decision-summary");
  const extensionNote = document.querySelector("#budget-extension-note");
  const shortfallSteps = document.querySelector("#budget-shortfall-steps");
  budgetDecisionSummary.textContent = `Scout estimates this plan at ${unitsToUsdc(decision.estimatedUnits)} USDC, which is ${unitsToUsdc(decision.shortfallUnits)} USDC over your ${unitsToUsdc(decision.budgetUnits)} USDC budget. No seller calls have started.`;
  extensionNote.textContent = decision.extensionAllowed
    ? `You can raise the task cap to ${unitsToUsdc(decision.estimatedUnits)} USDC. Scout's configured maximum is ${unitsToUsdc(decision.configuredMaximumUnits)} USDC.`
    : `${decision.extensionReason ?? "The estimate is above Scout's configured maximum."} You can continue with the current budget.`;
  shortfallSteps.replaceChildren();
  for (const step of decision.overBudgetSteps) {
    const item = document.createElement("li");
    item.append(document.createTextNode(`${step.serviceName}: ${step.task}`));
    const detail = document.createElement("span");
    detail.className = "budget-step-cost";
    detail.textContent = `Listed ${unitsToUsdc(step.listedPriceUnits)} USDC · ${unitsToUsdc(step.remainingUnitsAtThatPoint)} USDC would remain at this point. ${step.reason}`;
    item.append(detail);
    shortfallSteps.append(item);
  }
  budgetExtensionAllowed = decision.extensionAllowed;
  extendBudgetButton.disabled = !budgetExtensionAllowed;
  budgetDecision.hidden = false;
  budgetDecision.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function confirmBudget(choice) {
  if (!pendingProposalId || confirmationInFlight || (confirmationChoice && confirmationChoice !== choice)) return;
  confirmationChoice = choice;
  confirmationInFlight = true;
  extendBudgetButton.disabled = true;
  continueBudgetButton.disabled = true;
  showStatus(choice === "extend" ? "Extending the task cap and starting the planned calls…" : "Continuing with the current cap and starting affordable calls…");
  try {
    const response = await fetch("/api/execute/confirm", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ proposalId: pendingProposalId, choice }),
      signal: AbortSignal.timeout(600_000)
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) {
        pendingProposalId = null;
        confirmationChoice = null;
        budgetDecision.hidden = true;
        setTaskFormDisabled(false);
        setScamDemoButtonsDisabled(!paidModeEnabled);
      }
      throw new Error(result.error ?? `Could not confirm the budget (${response.status}).`);
    }
    pendingProposalId = null;
    confirmationChoice = null;
    budgetDecision.hidden = true;
    showReport(result);
    showStatus(result.success ? "Task completed. Review the call report below." : "Scout stopped early. Review completed work and failures below.", result.success ? "success" : "error");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    confirmationInFlight = false;
    if (pendingProposalId) {
      extendBudgetButton.disabled = confirmationChoice === "continue" || !budgetExtensionAllowed;
      continueBudgetButton.disabled = confirmationChoice === "extend";
    }
    if (!pendingProposalId) {
      setTaskFormDisabled(false);
      setScamDemoButtonsDisabled(!paidModeEnabled);
    }
  }
}

extendBudgetButton.addEventListener("click", () => confirmBudget("extend"));
continueBudgetButton.addEventListener("click", () => confirmBudget("continue"));

async function loadConfig() {
  try {
    const response = await fetch("/api/config", { headers: { accept: "application/json" } });
    const config = await response.json();
    if (!response.ok) throw new Error(config.error ?? "Buyer configuration is unavailable.");
    document.querySelector("#marketplace-status").textContent = `Scout will use ${config.marketplaceBaseUrl}. Task limit: ${unitsToUsdc(config.maxBudgetUnits)} USDC.`;
    document.querySelector("#mode-pill").textContent = config.paidMode ? "Base Sepolia paid mode" : "Local free test mode";
    paidModeEnabled = config.paidMode === true;
    paidWalletReady = config.paidReady === true;
    setScamDemoButtonsDisabled(!paidModeEnabled);
    replayDemoButton.disabled = !paidModeEnabled || !paidWalletReady;
    if (!paidModeEnabled) {
      document.querySelector("#scam-demo-help").textContent = "Turn on paid mode to run these live tests. Scout needs to receive the demo seller's x402 payment request before it can detect the mismatch.";
    } else if (!config.paidReady) {
      document.querySelector("#scam-demo-help").textContent = "Receipt replay and seller failure tests need a configured Base Sepolia buyer wallet. Scam checks need paid mode; fallback calls may also use test USDC.";
    }
  } catch (error) {
    document.querySelector("#marketplace-status").textContent = error.message;
  }
}

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const task = taskInput.value.trim();
  if (!task) return;
  let budgetUnits;
  try {
    budgetUnits = parseBudget(budgetInput.value);
  } catch (error) {
    showStatus(error.message, "error");
    budgetInput.focus();
    return;
  }

  pendingProposalId = null;
  const demoSellerId = selectedDemoSellerId;
  selectedDemoSellerId = null;
  confirmationChoice = null;
  budgetExtensionAllowed = false;
  setTaskFormDisabled(true);
  setScamDemoButtonsDisabled(true);
  budgetDecision.hidden = true;
  runReport.hidden = true;
  showStatus(demoSellerId === "demo-compute-failure"
    ? "Scout is sending the test request to a seller that will fail before settlement, then trying a safe fallback if it can."
    : demoSellerId
    ? "Scout is contacting the selected scam demo, checking its payment request, and trying a safe fallback if it can."
    : "Scout is checking the Marketplace, planning seller calls, and running the task…");
  try {
    const response = await fetch("/api/execute", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ task, budgetUnits, maxConcurrency: Number(concurrencyInput.value), ...(demoSellerId ? { demoSellerId } : {}) }),
      signal: AbortSignal.timeout(600_000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? `Task failed (${response.status}).`);
    if (result.type === "budget_decision") {
      pendingProposalId = result.proposalId;
      showBudgetDecision(result);
      showStatus("Review the estimate and choose how Scout should continue.");
      return;
    }
    showReport(result);
    showStatus(result.success ? "Task completed. Review the call report below." : "Scout stopped early. Review completed work and failures below.", result.success ? "success" : "error");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    if (!pendingProposalId) {
      setTaskFormDisabled(false);
      setScamDemoButtonsDisabled(!paidModeEnabled);
    }
  }
});

for (const button of scamDemoButtons) {
  button.addEventListener("click", () => {
    selectedDemoSellerId = button.dataset.scamTest;
    const sellerName = selectedDemoSellerId === "demo-price-inflator" ? "price scam" : "different pay-to scam";
    taskInput.value = `Test Scout's safety checks with the ${sellerName} demo on books page 1, then try a safe seller if the budget allows.`;
    taskForm.requestSubmit();
  });
}

failureDemoButton.addEventListener("click", () => {
  selectedDemoSellerId = "demo-compute-failure";
  taskInput.value = "Test Scout's no-service/no-charge handling when a seller fails during internal work, then try a safe seller if the budget allows.";
  taskForm.requestSubmit();
});

replayDemoButton.addEventListener("click", async () => {
  setScamDemoButtonsDisabled(true);
  replayDemoButton.disabled = true;
  budgetDecision.hidden = true;
  runReport.hidden = true;
  showStatus("Scout is paying Service A once, then testing whether Service B rejects the same receipt…");
  try {
    const response = await fetch("/api/demo/receipt-replay", {
      method: "POST",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(600_000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? `Receipt replay demo failed (${response.status}).`);
    showReport(result);
    showStatus(result.success ? "Receipt replay blocked. Only Service A was paid." : "Receipt replay demo needs review. See the call report.", result.success ? "success" : "error");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setScamDemoButtonsDisabled(!paidModeEnabled);
    replayDemoButton.disabled = !paidModeEnabled || !paidWalletReady;
  }
});

loadConfig();

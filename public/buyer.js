const taskForm = document.querySelector("#task-form");
const taskInput = document.querySelector("#task-input");
const budgetInput = document.querySelector("#budget-input");
const concurrencyInput = document.querySelector("#concurrency-input");
const runButton = document.querySelector("#run-button");
const runStatus = document.querySelector("#run-status");
const runReport = document.querySelector("#run-report");
const callReports = document.querySelector("#call-reports");

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
  facts.textContent = `${step.latencyMs} ms · Listed ${unitsToUsdc(step.listedPriceUnits)} USDC · Asked ${unitsToUsdc(step.askedPriceUnits)} USDC · Paid ${amount} · ${step.schemaValid === null ? "Input not sent" : step.schemaValid ? "Output schema valid" : "Output schema invalid"} · ${step.ledgerSaved ? "Saved to Marketplace ledger" : "Not saved to Marketplace ledger"}`;
  card.append(facts);

  if (step.txHash && step.explorerUrl) {
    const link = document.createElement("a");
    link.href = step.explorerUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `Transaction ${step.txHash}`;
    card.append(link);
  }
  if (step.reason) addText(card, "p", "message error", step.reason);

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

async function loadConfig() {
  try {
    const response = await fetch("/api/config", { headers: { accept: "application/json" } });
    const config = await response.json();
    if (!response.ok) throw new Error(config.error ?? "Buyer configuration is unavailable.");
    document.querySelector("#marketplace-status").textContent = `Scout will use ${config.marketplaceBaseUrl}. Task limit: ${unitsToUsdc(config.maxBudgetUnits)} USDC.`;
    document.querySelector("#mode-pill").textContent = config.paidMode ? "Base Sepolia paid mode" : "Local free test mode";
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

  runButton.disabled = true;
  taskInput.disabled = true;
  budgetInput.disabled = true;
  concurrencyInput.disabled = true;
  runReport.hidden = true;
  showStatus("Scout is checking the Marketplace, planning seller calls, and running the task…");
  try {
    const response = await fetch("/api/execute", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ task, budgetUnits, maxConcurrency: Number(concurrencyInput.value) }),
      signal: AbortSignal.timeout(600_000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? `Task failed (${response.status}).`);
    showReport(result);
    showStatus(result.success ? "Task completed. Review the call report below." : "Scout stopped early. Review completed work and failures below.", result.success ? "success" : "error");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    runButton.disabled = false;
    taskInput.disabled = false;
    budgetInput.disabled = false;
    concurrencyInput.disabled = false;
  }
});

loadConfig();

const rows = document.querySelector("#ledger-rows");
const message = document.querySelector("#ledger-message");

function unitsToUsdc(units) {
  const amount = BigInt(units);
  const whole = amount / 1000000n;
  const fraction = String(amount % 1000000n).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function showMessage(text, kind = "") {
  message.textContent = text;
  message.className = `message ${kind}`.trim();
}

function addCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  row.append(cell);
  return cell;
}

function makeRow(record) {
  const row = document.createElement("tr");
  addCell(row, new Date(record.timestamp).toLocaleString());
  addCell(row, record.taskId || "Older call");
  addCell(row, `${record.buyerAddress.slice(0, 6)}…${record.buyerAddress.slice(-4)}`);
  addCell(row, record.serviceName);
  addCell(row, `${unitsToUsdc(record.listedPriceUnits)} USDC`);
  addCell(row, `${unitsToUsdc(record.askedPriceUnits)} USDC`);
  addCell(row, `${unitsToUsdc(record.amountPaidUnits)} USDC`);

  const isPaid = record.status === "paid" || record.status === "paid, output rejected";
  const isUnverifiedPaid = isPaid && record.chainVerified !== true;
  const visibleStatus = isUnverifiedPaid ? `${record.status} · not verified` : record.status;
  const statusCell = addCell(row, "");
  const tag = document.createElement("span");
  tag.className = `status-tag ${isUnverifiedPaid ? "status-unverified-paid" : `status-${record.status.replaceAll(" ", "-").replaceAll(",", "")}`}`;
  tag.textContent = visibleStatus;
  statusCell.append(tag);

  makeEscrowCell(row, record);
  addCell(row, record.reason || "—");
  addCell(row, `${record.latencyMs} ms`);
  const receipt = document.createElement("td");
  if (record.explorerUrl) {
    const link = document.createElement("a");
    link.href = record.explorerUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "View tx";
    receipt.append(link);
  } else receipt.textContent = "—";
  row.append(receipt);
  return row;
}

function addText(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

const escrowLabels = {
  held: "Held in escrow",
  "needs review": "Needs human review",
  releasing: "Releasing…",
  refunding: "Refunding…",
  released: "Released to seller",
  refunded: "Refunded to buyer",
  "transfer failed": "Transfer failed"
};

function readReviewerToken() {
  try {
    return sessionStorage.getItem("escrowReviewerToken") || "";
  } catch {
    return "";
  }
}

function saveReviewerToken(token) {
  try {
    sessionStorage.setItem("escrowReviewerToken", token);
  } catch {
    // The token is only a convenience for this tab.
  }
}

// A human reviewer settles a dispute the rules and AI judge could not decide.
async function resolveEscrow(recordId, outcome, button) {
  const cell = button.closest("td");
  for (const control of cell.querySelectorAll("button")) control.disabled = true;
  const send = (token) => fetch(`/api/escrow/${encodeURIComponent(recordId)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "x-admin-token": token } : {}) },
    body: JSON.stringify({ outcome })
  });
  try {
    let response = await send(readReviewerToken());
    if (response.status === 403) {
      const token = window.prompt("Enter the escrow reviewer token (ESCROW_ADMIN_TOKEN):") || "";
      if (token) {
        saveReviewerToken(token);
        response = await send(token);
      }
    }
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
    await loadLedger();
  } catch (error) {
    showMessage(error.message, "error");
    for (const control of cell.querySelectorAll("button")) control.disabled = false;
  }
}

function makeEscrowCell(row, record) {
  const cell = document.createElement("td");
  cell.className = "escrow-cell";
  row.append(cell);
  const hold = record.escrow;
  if (!hold) {
    cell.textContent = "—";
    return;
  }
  addText(cell, "span", `status-tag escrow-${hold.state.replaceAll(" ", "-")}`, escrowLabels[hold.state] ?? hold.state);
  if (hold.dispute) addText(cell, "p", "escrow-note", `Dispute: ${hold.dispute.reason}`);
  if (hold.decision) {
    addText(cell, "p", "escrow-note", `Decided by ${hold.decision.decidedBy}: ${hold.decision.reason}`);
  } else if (hold.state === "needs review" && hold.reviewNote) {
    addText(cell, "p", "escrow-note", hold.reviewNote);
  } else if (hold.state === "held") {
    addText(cell, "p", "escrow-note", `Releases to the seller at ${new Date(hold.releaseAfter).toLocaleTimeString()} unless disputed.`);
  }
  if (hold.transferError) addText(cell, "p", "escrow-note error", hold.transferError);
  if (hold.transferExplorerUrl) {
    const link = document.createElement("a");
    link.href = hold.transferExplorerUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = hold.state === "refunded" ? "View refund tx" : "View release tx";
    cell.append(link);
  }
  const awaitingHuman = (hold.state === "needs review" && hold.reviewNote !== "The AI judge is reviewing this dispute.") ||
    hold.state === "transfer failed";
  if (awaitingHuman) {
    const actions = document.createElement("div");
    actions.className = "escrow-actions";
    for (const [outcome, label] of [["release", "Release to seller"], ["refund", "Refund buyer"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button button-light button-small";
      button.textContent = label;
      button.addEventListener("click", () => resolveEscrow(record.id, outcome, button));
      actions.append(button);
    }
    cell.append(actions);
  }
}

async function loadLedger() {
  showMessage("Loading call records…");
  rows.replaceChildren();
  try {
    const response = await fetch("/api/ledger?limit=100", { headers: { accept: "application/json" } });
    const records = await response.json();
    if (!response.ok) throw new Error(records.error || `Request failed (${response.status}).`);
    if (!records.length) {
      showMessage("No calls have been recorded yet.");
      return;
    }
    for (const record of records) rows.append(makeRow(record));
    const verifiedPaid = records.filter((record) =>
      (record.status === "paid" || record.status === "paid, output rejected") && record.chainVerified === true
    );
    const total = verifiedPaid.reduce((sum, record) => sum + BigInt(record.amountPaidUnits), 0n);
    showMessage(`${records.length} recent call${records.length === 1 ? "" : "s"}. Verified spend in these records: ${unitsToUsdc(total.toString())} USDC.`);
  } catch (error) {
    showMessage(error.message, "error");
  }
}

document.querySelector("#refresh-ledger").addEventListener("click", loadLedger);
fetch("/api/config", { headers: { accept: "application/json" } })
  .then((response) => response.json())
  .then((config) => {
    if (typeof config.marketplaceBaseUrl === "string") {
      document.querySelector("#marketplace-link").href = new URL("/", config.marketplaceBaseUrl).toString();
    }
  })
  .catch(() => {});
loadLedger();

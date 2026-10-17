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

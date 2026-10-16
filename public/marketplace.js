const defaultNetwork = "eip155:84532";
const defaultAsset = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const serviceList = document.querySelector("#service-list");
const servicesMessage = document.querySelector("#services-message");
const ledgerRows = document.querySelector("#ledger-rows");
const ledgerMessage = document.querySelector("#ledger-message");
const registerMessage = document.querySelector("#register-message");

function showMessage(element, text, kind = "") {
  element.textContent = text;
  element.className = `message ${kind}`.trim();
}

function showTab(tabName) {
  for (const button of document.querySelectorAll("[data-tab]")) {
    const isActive = button.dataset.tab === tabName;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  }

  for (const panel of document.querySelectorAll(".tab-panel")) {
    panel.hidden = panel.id !== tabName;
  }
}

function unitsToUsdc(units) {
  const amount = BigInt(units);
  const whole = amount / 1000000n;
  const fraction = String(amount % 1000000n).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function usdcToUnits(value) {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(value.trim());
  if (!match) throw new Error("Enter a price with up to six decimal places.");
  const fraction = (match[2] ?? "").padEnd(6, "0");
  return String(BigInt(match[1]) * 1000000n + BigInt(fraction || "0"));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body;
}

function addText(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function makeSchemaDetails(seller) {
  const details = document.createElement("details");
  addText(details, "summary", "", "View input and output schemas");
  addText(details, "h4", "", "Input");
  addText(details, "pre", "", JSON.stringify(seller.inputSchema, null, 2));
  addText(details, "h4", "", "Output");
  addText(details, "pre", "", JSON.stringify(seller.outputSchema, null, 2));
  return details;
}

function makeServiceCard(seller) {
  const card = document.createElement("article");
  card.className = "service-card";

  const top = document.createElement("div");
  top.className = "card-top";
  const titleGroup = document.createElement("div");
  addText(titleGroup, "h3", "", seller.name);
  addText(titleGroup, "span", "category-tag", seller.category);
  top.append(titleGroup);
  addText(top, "span", "price", `${unitsToUsdc(seller.priceUnits)} USDC`);
  card.append(top);

  addText(card, "p", "service-description", seller.description);
  const meta = document.createElement("div");
  meta.className = "service-meta";
  const reputation = seller.reputation;
  const success = reputation.successRatePercent === null
    ? "No call history"
    : `${reputation.successRatePercent.toFixed(0)}% success`;
  const latency = reputation.medianLatencyMs === null
    ? "No latency data"
    : `${Math.round(reputation.medianLatencyMs)} ms median`;
  addText(meta, "span", "", success);
  addText(meta, "span", "", latency);
  card.append(meta, makeSchemaDetails(seller));
  return card;
}

async function loadServices() {
  showMessage(servicesMessage, "Loading services…");
  serviceList.replaceChildren();

  const query = new URLSearchParams();
  const category = document.querySelector("#category-filter").value;
  const maxPrice = document.querySelector("#max-price-filter").value.trim();
  if (category) query.set("category", category);
  if (maxPrice) query.set("maxPriceUnits", usdcToUnits(maxPrice));

  try {
    const sellers = await requestJson(`/api/registry?${query.toString()}`);
    if (sellers.length === 0) {
      showMessage(servicesMessage, "No services are registered yet.");
      return;
    }
    for (const seller of sellers) serviceList.append(makeServiceCard(seller));
    showMessage(servicesMessage, `${sellers.length} service${sellers.length === 1 ? "" : "s"} found.`);
  } catch (error) {
    showMessage(servicesMessage, error.message, "error");
  }
}

function statusClass(status) {
  return `status-${status.replaceAll(" ", "-").replaceAll(",", "")}`;
}

function makeLedgerCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  row.append(cell);
  return cell;
}

function makeLedgerRow(record) {
  const row = document.createElement("tr");
  const date = new Date(record.timestamp).toLocaleString();
  makeLedgerCell(row, date);
  makeLedgerCell(row, `${record.buyerAddress.slice(0, 6)}…${record.buyerAddress.slice(-4)}`);
  makeLedgerCell(row, record.serviceName);
  makeLedgerCell(row, `${unitsToUsdc(record.listedPriceUnits)} USDC`);
  makeLedgerCell(row, `${unitsToUsdc(record.askedPriceUnits)} USDC`);
  makeLedgerCell(row, `${unitsToUsdc(record.amountPaidUnits)} USDC`);
  const status = makeLedgerCell(row, record.status);
  status.innerHTML = "";
  const tag = document.createElement("span");
  tag.className = `status-tag ${statusClass(record.status)}`;
  tag.textContent = record.status;
  status.append(tag);
  makeLedgerCell(row, `${record.latencyMs} ms`);
  const receipt = document.createElement("td");
  if (record.explorerUrl) {
    const link = document.createElement("a");
    link.href = record.explorerUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "View tx";
    receipt.append(link);
  } else {
    receipt.textContent = "—";
  }
  row.append(receipt);
  return row;
}

async function loadLedger() {
  showMessage(ledgerMessage, "Loading call records…");
  ledgerRows.replaceChildren();
  try {
    const records = await requestJson("/api/ledger?limit=100");
    if (records.length === 0) {
      showMessage(ledgerMessage, "No calls have been recorded yet.");
      return;
    }
    for (const record of records) ledgerRows.append(makeLedgerRow(record));
    showMessage(ledgerMessage, `${records.length} recent call${records.length === 1 ? "" : "s"}.`);
  } catch (error) {
    showMessage(ledgerMessage, error.message, "error");
  }
}

document.querySelector("#search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  loadServices();
});
document.querySelector("#refresh-services").addEventListener("click", loadServices);
document.querySelector("#refresh-ledger").addEventListener("click", loadLedger);
document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => showTab(button.dataset.tab));
});

document.querySelector("#seller-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);

  try {
    const listing = {
      id: String(values.get("id")).trim(),
      name: String(values.get("name")).trim(),
      category: String(values.get("category")),
      description: String(values.get("description")).trim(),
      endpointUrl: String(values.get("endpointUrl")).trim(),
      priceUnits: usdcToUnits(String(values.get("priceUsdc"))),
      network: defaultNetwork,
      asset: defaultAsset,
      payTo: String(values.get("payTo")).trim(),
      inputSchema: JSON.parse(String(values.get("inputSchema"))),
      outputSchema: JSON.parse(String(values.get("outputSchema")))
    };

    await requestJson("/api/registry", {
      method: "POST",
      body: JSON.stringify(listing)
    });
    form.reset();
    showMessage(registerMessage, "Service registered.", "success");
    await loadServices();
  } catch (error) {
    showMessage(registerMessage, error.message, "error");
  }
});

document.querySelector('[name="inputSchema"]').value = JSON.stringify({
  type: "object",
  properties: { query: { type: "string" } },
  required: ["query"],
  additionalProperties: false
}, null, 2);
document.querySelector('[name="outputSchema"]').value = JSON.stringify({
  type: "object",
  properties: { result: { type: "string" } },
  required: ["result"],
  additionalProperties: false
}, null, 2);

loadServices();
loadLedger();

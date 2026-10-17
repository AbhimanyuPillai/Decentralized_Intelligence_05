const defaultNetwork = "eip155:84532";
const defaultAsset = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const serviceList = document.querySelector("#service-list");
const servicesMessage = document.querySelector("#services-message");
const registerMessage = document.querySelector("#register-message");
const sellerForm = document.querySelector("#seller-form");
const sellerPriceField = document.querySelector("#price-field");
const sellerWalletField = document.querySelector("#wallet-field");
const sellerPriceInput = sellerForm.elements.namedItem("priceUsdc");
const sellerWalletInput = sellerForm.elements.namedItem("payTo");
let paymentsEnabled = false;
let registrationConfigLoaded = false;
const freeTestPayTo = "0x0000000000000000000000000000000000000001";

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
  const trustNames = {
    unproven: "Unproven",
    active: "Active",
    quarantined: "Quarantined",
    blacklisted: "Blacklisted"
  };
  addText(titleGroup, "span", `trust-tag trust-${seller.trustStatus || "unproven"}`, trustNames[seller.trustStatus] || "Unproven");
  top.append(titleGroup);
  addText(top, "span", "price", seller.paymentRequired === false ? "Free (test mode)" : `${unitsToUsdc(seller.priceUnits)} USDC`);
  card.append(top);

  addText(card, "p", "service-description", seller.description);
  if (seller.demoScamType) addText(card, "p", "demo-warning", "Unsafe test seller. Use Scout's scam test buttons to see how it handles this seller.");
  if (seller.demoReplayRole) addText(card, "p", "demo-warning", "Demo only. Used by Scout's receipt replay test; do not select for normal work.");
  if (seller.trustStatus === "quarantined" || seller.trustStatus === "blacklisted") {
    addText(card, "p", "message error", seller.trustStatus === "blacklisted"
      ? "Blocked from Scout: this seller repeated a verified payment mismatch."
      : "Blocked from Scout: this seller made a verified payment mismatch request.");
  }
  if (seller.ready === false) addText(card, "p", "message error", seller.readinessReason || "Configuration required before this service can accept requests.");
  const meta = document.createElement("div");
  meta.className = "service-meta";
  const reputation = seller.reputation;
  const success = reputation.successRatePercent === null
    ? "0 completed calls · no score yet"
    : `${reputation.successfulCalls}/${reputation.totalCalls} successful calls (${reputation.successRatePercent.toFixed(0)}%)`;
  const latency = reputation.medianLatencyMs === null
    ? "No latency data"
    : `${Math.round(reputation.medianLatencyMs)} ms median`;
  addText(meta, "span", "", `${trustNames[seller.trustStatus] || "Unproven"} · ${success}`);
  addText(meta, "span", "", `${latency} · ${reputation.availabilityPercent === null ? "No availability history" : `${reputation.availabilityPercent.toFixed(0)}% availability`}`);
  addText(meta, "span", "", `Trust score: ${seller.selectionScore?.toFixed(1) ?? "—"}/100`);
  const factors = seller.rankingFactors;
  if (factors) addText(meta, "span", "", `Legitimacy ${factors.legitimacy.toFixed(0)} · Success ${factors.success.toFixed(0)} · Availability ${factors.availability.toFixed(0)} · Speed ${factors.latency.toFixed(0)} · Cost ${factors.cost.toFixed(0)}`);
  addText(meta, "span", "", `${reputation.mismatchCount} verified mismatch${reputation.mismatchCount === 1 ? "" : "es"}`);
  card.append(meta, makeSchemaDetails(seller));
  return card;
}

async function loadServices() {
  showMessage(servicesMessage, "Loading services…");
  serviceList.replaceChildren();

  const query = new URLSearchParams();
  try {
    const category = document.querySelector("#category-filter").value;
    const maxPrice = document.querySelector("#max-price-filter").value.trim();
    const queryText = document.querySelector("#service-query-filter").value.trim();
    const ready = document.querySelector("#ready-filter").value;
    if (category) query.set("category", category);
    if (maxPrice) query.set("maxPriceUnits", usdcToUnits(maxPrice));
    if (queryText) query.set("q", queryText);
    if (ready) query.set("ready", ready);
    query.set("includeBlocked", "true");

    const sellers = await requestJson(`/api/registry?${query.toString()}`);
    if (sellers.length === 0) {
      showMessage(servicesMessage, "No services match these filters. Try a higher price limit or a different category.");
      return;
    }
    for (const seller of sellers) serviceList.append(makeServiceCard(seller));
    showMessage(servicesMessage, `${sellers.length} service${sellers.length === 1 ? "" : "s"} found.`);
  } catch (error) {
    showMessage(servicesMessage, error.message, "error");
  }
}

document.querySelector("#search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  loadServices();
});
for (const filter of document.querySelectorAll("#category-filter, #ready-filter, #max-price-filter")) {
  filter.addEventListener("change", loadServices);
}
document.querySelector("#service-query-filter").addEventListener("input", () => {
  clearTimeout(window.serviceSearchTimer);
  window.serviceSearchTimer = setTimeout(loadServices, 250);
});
document.querySelector("#refresh-services").addEventListener("click", loadServices);
document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => showTab(button.dataset.tab));
});

sellerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!registrationConfigLoaded) {
    showMessage(registerMessage, "Marketplace registration settings have not loaded yet. Refresh the page and try again.", "error");
    return;
  }
  const form = event.currentTarget;
  const values = new FormData(form);

  try {
    const listing = {
      id: String(values.get("id")).trim(),
      name: String(values.get("name")).trim(),
      category: String(values.get("category")),
      description: String(values.get("description")).trim(),
      endpointUrl: String(values.get("endpointUrl")).trim(),
      priceUnits: paymentsEnabled ? usdcToUnits(String(values.get("priceUsdc"))) : "0",
      network: defaultNetwork,
      asset: defaultAsset,
      payTo: paymentsEnabled ? String(values.get("payTo")).trim() : freeTestPayTo,
      inputSchema: JSON.parse(String(values.get("inputSchema"))),
      outputSchema: JSON.parse(String(values.get("outputSchema")))
    };

    const registered = await requestJson("/api/registry", {
      method: "POST",
      body: JSON.stringify(listing)
    });
    form.reset();
    updateRegistrationFields();
    showMessage(registerMessage, registered.ready === false
      ? "Service registered, but it needs configuration before it can accept requests."
      : "Service registered and added to Browse services.", registered.ready === false ? "error" : "success");
    await loadServices();
  } catch (error) {
    showMessage(registerMessage, error.message, "error");
  }
});

function updateRegistrationFields() {
  sellerPriceInput.readOnly = !paymentsEnabled;
  sellerPriceInput.value = paymentsEnabled ? "" : "0";
  sellerPriceInput.placeholder = paymentsEnabled ? "0.005" : "Free test mode";
  sellerPriceField.classList.toggle("field-disabled", !paymentsEnabled);
  sellerWalletField.hidden = !paymentsEnabled;
  sellerWalletInput.required = paymentsEnabled;
  document.querySelector("#registration-help").textContent = paymentsEnabled
    ? "Paid mode is enabled. Use an HTTPS service URL, a positive price, and a Base Sepolia receiving wallet."
    : "Free test mode is enabled. Use a local service URL such as http://localhost:3000/sellers/movie-scraper/scrape; no wallet is needed.";
}

async function loadRegistrationConfig() {
  try {
    const config = await requestJson("/api/config");
    paymentsEnabled = config.paymentsEnabled === true;
    registrationConfigLoaded = true;
    updateRegistrationFields();
  } catch (error) {
    sellerForm.querySelector("button[type=submit]").disabled = true;
    showMessage(registerMessage, `Could not load registration settings: ${error.message}`, "error");
  }
}

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
loadRegistrationConfig();

// Keep displayed seller reputation fresh while the marketplace tab is open.
window.setInterval(() => {
  if (!document.hidden && !document.querySelector("#services").hidden) loadServices();
}, 10_000);

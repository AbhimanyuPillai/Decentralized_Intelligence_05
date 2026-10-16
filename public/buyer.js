const conversationLog = document.querySelector("#conversation-log");
const chatStatus = document.querySelector("#chat-status");
const chatInput = document.querySelector("#chat-input");
const budgetInput = document.querySelector("#budget-input");
const confirmationCard = document.querySelector("#confirmation-card");
const proposedTaskInput = document.querySelector("#proposed-task");
const marketplaceInput = document.querySelector("#marketplace-url");
const chatHistory = [];

function showStatus(message, kind = "") {
  chatStatus.textContent = message;
  chatStatus.className = `message ${kind}`.trim();
}

function appendBubble(role, content, listings = []) {
  const bubble = document.createElement("article");
  bubble.className = `chat-bubble ${role}`;
  bubble.textContent = content;

  if (listings.length > 0) {
    const list = document.createElement("ul");
    list.className = "listing-summary";
    for (const listing of listings.slice(0, 8)) {
      const item = document.createElement("li");
      item.textContent = `${listing.name} · ${listing.category} · ${unitsToUsdc(listing.priceUnits)} USDC per call`;
      list.append(item);
    }
    bubble.append(list);
    if (listings.length > 8) {
      const more = document.createElement("p");
      more.className = "connection-help";
      more.textContent = `And ${listings.length - 8} more listing${listings.length === 9 ? "" : "s"}.`;
      bubble.append(more);
    }
  }

  conversationLog.append(bubble);
  conversationLog.scrollTop = conversationLog.scrollHeight;
}

function unitsToUsdc(units) {
  if (typeof units !== "string" || !/^(0|[1-9][0-9]*)$/.test(units)) return "unknown price";
  const amount = BigInt(units);
  const whole = amount / 1000000n;
  const fraction = String(amount % 1000000n).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function parseBudget(value) {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(value.trim());
  if (!match) throw new Error("Enter a maximum budget with up to six decimal places.");
  const fractionalUnits = BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  const units = BigInt(match[1]) * 1000000n + fractionalUnits;
  if (units === 0n) throw new Error("Maximum budget must be greater than zero.");
  return units.toString();
}

function getRegistryUrl() {
  const url = new URL(marketplaceInput.value.trim());
  if (url.protocol !== "https:") throw new Error("Marketplace address must use HTTPS.");
  if (url.username || url.password) throw new Error("Do not put credentials in the Marketplace address.");
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/api/registry")) url.pathname = `${url.pathname}/api/registry`;
  return url;
}

async function askScout(messages) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal: AbortSignal.timeout(65000)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `Scout request failed (${response.status}).`);
  return payload;
}

document.querySelector("#chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  let budgetUnits;
  try {
    budgetUnits = parseBudget(budgetInput.value);
  } catch (error) {
    showStatus(error.message, "error");
    budgetInput.focus();
    return;
  }

  confirmationCard.hidden = true;
  appendBubble("user", message);
  chatInput.value = "";
  chatInput.disabled = true;
  document.querySelector("#send-button").disabled = true;
  showStatus("Scout is thinking…");

  const modelMessage = `${message}\n\nMaximum budget currently set by buyer: ${budgetUnits} atomic USDC units (${budgetInput.value.trim()} USDC).`;
  const nextMessages = [...chatHistory, { role: "user", content: modelMessage }].slice(-20);
  try {
    const result = await askScout(nextMessages);
    chatHistory.push({ role: "user", content: modelMessage });
    chatHistory.push({ role: "assistant", content: result.reply });
    appendBubble("assistant", result.reply);
    if (result.readyToConfirm && typeof result.proposedTask === "string" && result.proposedTask.trim()) {
      proposedTaskInput.value = result.proposedTask.trim();
      document.querySelector("#budget-summary").textContent = `Current maximum budget: ${budgetInput.value.trim()} USDC. You can adjust it before confirming.`;
      confirmationCard.hidden = false;
      showStatus("Scout has a draft. Review it below; nothing has been sent to the Marketplace yet.", "success");
      confirmationCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      showStatus(`Conversation with Scout · ${result.model}`);
    }
  } catch (error) {
    appendBubble("assistant", `I couldn’t reach the conversation service: ${error.message}`);
    showStatus(error.message, "error");
  } finally {
    chatInput.disabled = false;
    document.querySelector("#send-button").disabled = false;
    chatInput.focus();
  }
});

document.querySelector("#confirm-task").addEventListener("click", async () => {
  let endpoint;
  let budgetUnits;
  const task = proposedTaskInput.value.trim();
  try {
    endpoint = getRegistryUrl();
    budgetUnits = parseBudget(budgetInput.value);
    if (!task) throw new Error("Review and enter the task summary before confirming.");
  } catch (error) {
    showStatus(error.message, "error");
    return;
  }

  const button = document.querySelector("#confirm-task");
  button.disabled = true;
  showStatus("Task confirmed. Scout is checking the Marketplace registry over HTTPS…");
  appendBubble("user", `Confirmed task: ${task}\nMaximum budget: ${budgetInput.value.trim()} USDC`);

  const startedAt = performance.now();
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      mode: "cors",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(15000)
    });
    if (!response.url.startsWith("https:")) throw new Error("Marketplace connection did not remain on HTTPS.");
    const listings = await response.json();
    if (!response.ok) throw new Error(listings.error ?? `Registry request failed (${response.status}).`);
    if (!Array.isArray(listings)) throw new Error("Marketplace registry did not return a seller list.");

    const latencyMs = Math.round(performance.now() - startedAt);
    appendBubble(
      "assistant",
      `Marketplace registry responded over HTTPS in ${latencyMs} ms. I found ${listings.length} listing${listings.length === 1 ? "" : "s"}. This stage does not select or call sellers, validate their task output, write a ledger entry, or make a payment. Budget available for later stages: ${budgetUnits} atomic USDC units.`,
      listings
    );
    showStatus(`HTTPS registry connected · ${latencyMs} ms · no seller call or payment made`, "success");
    confirmationCard.hidden = true;
  } catch (error) {
    appendBubble("assistant", `I couldn’t reach the Marketplace registry over HTTPS: ${error.message}\nNo seller call or payment was made.`);
    showStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

marketplaceInput.addEventListener("change", () => {
  try {
    const endpoint = getRegistryUrl();
    marketplaceInput.setCustomValidity("");
    localStorage.setItem("scoutMarketplaceUrl", endpoint.origin);
  } catch (error) {
    marketplaceInput.setCustomValidity(error.message);
  }
});

marketplaceInput.value = localStorage.getItem("scoutMarketplaceUrl") ?? marketplaceInput.value;

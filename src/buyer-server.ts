import express from "express";
import path from "node:path";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { confirmBudgetDecision, prepareTask } from "./buyer/execution.js";
import { loadLocalEnvironment, readLocalTlsFiles } from "./config.js";

loadLocalEnvironment();

const app = express();
const port = Number(process.env.BUYER_PORT ?? 3001);
const useLocalHttp = process.env.NODE_ENV !== "production" && process.env.SELLER_PAYMENTS_ENABLED !== "true";
const protocol = useLocalHttp ? "http" : "https";
const host = process.env.HOST ?? (useLocalHttp ? "::1" : "0.0.0.0");
const publicDirectory = path.join(process.cwd(), "public");

app.use(express.json({ limit: "16kb" }));
app.use(express.static(publicDirectory, { index: false }));

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "scout-buyer" });
});

app.get("/", (_request, response) => {
  response.sendFile(path.join(publicDirectory, "buyer.html"));
});

app.get("/api/config", (_request, response) => {
  const defaultProtocol = process.env.SELLER_PAYMENTS_ENABLED === "true" ? "https" : "http";
  const marketplaceBaseUrl = process.env.MARKETPLACE_BASE_URL?.trim() || `${defaultProtocol}://localhost:3000`;
  response.json({
    marketplaceBaseUrl,
    paidMode: process.env.SELLER_PAYMENTS_ENABLED === "true",
    paidReady: /^(0x)?[a-fA-F0-9]{64}$/.test(
      process.env.BUYER_PRIVATE_KEY?.trim() || process.env.SCOUT_BUYER_PRIVATE_KEY?.trim() || ""
    ),
    maxBudgetUnits: process.env.SCOUT_MAX_BUDGET_UNITS?.trim() || "100000"
  });
});

app.post("/api/execute", async (request, response) => {
  try {
    const result = await prepareTask(request.body?.task, request.body?.budgetUnits, request.body?.maxConcurrency, request.body?.demoSellerId);
    response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scout could not start this task.";
    response.status(400).json({ error: message });
  }
});

app.post("/api/execute/confirm", async (request, response) => {
  try {
    const report = await confirmBudgetDecision(request.body?.proposalId, request.body?.choice);
    response.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scout could not confirm this budget decision.";
    const status = /expired|changed|already been confirmed/i.test(message) ? 409 : 400;
    response.status(status).json({ error: message });
  }
});

const server = useLocalHttp
  ? createHttpServer(app)
  : createHttpsServer(readLocalTlsFiles(), app);

server.listen(port, host, () => {
  console.log(`Scout buyer ${protocol.toUpperCase()} listening on ${host}:${port}`);
});

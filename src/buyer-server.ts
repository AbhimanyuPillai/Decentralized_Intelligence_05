import express from "express";
import path from "node:path";
import { createServer } from "node:https";
import { loadLocalEnvironment, readLocalTlsFiles } from "./config.js";

loadLocalEnvironment();

const app = express();
const port = Number(process.env.BUYER_PORT ?? 3001);
const publicDirectory = path.join(process.cwd(), "public");

app.use(express.json({ limit: "256kb" }));
app.use(express.static(publicDirectory, { index: false }));

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "scout-buyer" });
});

app.get("/", (_request, response) => {
  response.sendFile(path.join(publicDirectory, "buyer.html"));
});

app.post("/api/chat", async (request, response) => {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    response.status(503).json({ error: "LLM_API_KEY is missing from the server environment." });
    return;
  }

  const messages = request.body?.messages;
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > 20 ||
    messages.some((message) =>
      !message ||
      !["user", "assistant"].includes(message.role) ||
      typeof message.content !== "string" ||
      message.content.length > 5000
    )
  ) {
    response.status(400).json({ error: "Provide 1–20 user/assistant messages of up to 5000 characters each." });
    return;
  }

  try {
    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are Scout, a friendly research buyer assistant. Have a natural conversation and ask short clarifying questions about the user's goal, scope, location, time range, and desired output when needed. Do not contact the Marketplace, select a seller, or start work. Return only a JSON object with keys: reply (string), readyToConfirm (boolean), proposedTask (string or null). Set readyToConfirm true only when you can summarize a concrete task and the user has supplied a positive maximum budget in their messages. When ready, summarize the proposed task and tell the user they must review and confirm it before Scout contacts the Marketplace. Do not claim that any task is confirmed, seller hired, call made, schema validated, payment sent, or result produced."
          },
          ...messages
        ],
        temperature: 0.6,
        max_tokens: 1024
      }),
      signal: AbortSignal.timeout(60000)
    });
    const payload = await upstream.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (!upstream.ok) {
      response.status(502).json({ error: payload.error?.message ?? `Model API request failed (${upstream.status}).` });
      return;
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      response.status(502).json({ error: "Model API returned an empty response." });
      return;
    }
    const result = JSON.parse(content) as {
      reply?: unknown;
      readyToConfirm?: unknown;
      proposedTask?: unknown;
    };
    if (
      typeof result.reply !== "string" ||
      typeof result.readyToConfirm !== "boolean" ||
      !(typeof result.proposedTask === "string" || result.proposedTask === null)
    ) {
      response.status(502).json({ error: "Scout returned an invalid conversation response." });
      return;
    }
    response.json({ ...result, model: "openai/gpt-oss-120b" });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "Model API request timed out."
      : "Could not reach the model API or parse Scout's response.";
    response.status(502).json({ error: message });
  }
});

createServer(readLocalTlsFiles(), app).listen(port, "127.0.0.1", () => {
  console.log(`Scout buyer HTTPS listening on https://localhost:${port}`);
});

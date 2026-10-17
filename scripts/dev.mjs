import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
} catch {
  // The two services can also receive their settings from the environment.
}

// Scout and the separate ledger service share this private report token.
process.env.SCOUT_MARKETPLACE_REPORT_TOKEN ||= randomBytes(32).toString("hex");

const useLocalHttp = process.env.NODE_ENV !== "production" && process.env.SELLER_PAYMENTS_ENABLED !== "true";
const protocol = useLocalHttp ? "http" : "https";
const localHost = useLocalHttp ? "[::1]" : "127.0.0.1";
const buyerPort = process.env.BUYER_PORT ?? "3001";
const expectedBuyerOrigin = useLocalHttp
  ? `http://localhost:${buyerPort}`
  : process.env.BUYER_ORIGIN ?? `${protocol}://localhost:${buyerPort}`;

if (!useLocalHttp) {
  const tlsSetup = spawnSync(process.execPath, ["scripts/setup-local-tls.mjs"], { stdio: "inherit" });
  if (tlsSetup.error || tlsSetup.status !== 0) {
    throw new Error("Local HTTPS certificate setup failed.");
  }
}

const services = [
  { name: "Marketplace", entry: "src/server.ts", portName: "MARKETPLACE_PORT", fallbackPort: "3000" },
  { name: "Scout buyer", entry: "src/buyer-server.ts", portName: "BUYER_PORT", fallbackPort: "3001" },
  { name: "Marketplace ledger", entry: "src/ledger-server.ts", portName: "LEDGER_PORT", fallbackPort: "3002" }
];
const children = services.map((service) => {
  const port = process.env[service.portName] ?? service.fallbackPort;
  const child = spawn(process.execPath, ["--watch", "--watch-path=src", "--import", "tsx", service.entry], {
    env: { ...process.env, PORT: port },
    stdio: "inherit"
  });
  child.on("error", (error) => {
    console.error(`${service.name} failed to start: ${error.message}`);
    shutdown(1);
  });
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`${service.name} stopped${code === null ? "" : ` with exit code ${code}`}.`);
      shutdown(code ?? 1);
    }
  });
  return child;
});

let stopping = false;
const marketplacePort = process.env.MARKETPLACE_PORT ?? "3000";
const ledgerPort = process.env.LEDGER_PORT ?? "3002";
function requestUrl(url, headers = {}) {
  const transport = url.startsWith("https:") ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.get(url, {
      ...(url.startsWith("https:") ? { rejectUnauthorized: false } : {}),
      headers
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    request.on("error", reject);
    request.setTimeout(3000, () => request.destroy(new Error("Local service request timed out.")));
  });
}

function waitForHealth(port, name, attempts = 30) {
  return new Promise((resolve, reject) => {
    let remaining = attempts;
    const tryRequest = () => {
      requestUrl(`${protocol}://${localHost}:${port}/health`).then((response) => {
        try {
          if (response.status !== 200 || JSON.parse(response.body).status !== "ok") throw new Error("Health check failed.");
          resolve();
        } catch {
          retry();
        }
      }, retry);
    };
    const retry = () => {
      if (--remaining <= 0) {
        reject(new Error(`${name} did not become healthy at ${protocol}://${localHost}:${port}.`));
        return;
      }
      setTimeout(tryRequest, 500);
    };
    tryRequest();
  });
}

Promise.all([
  waitForHealth(marketplacePort, "Marketplace"),
  waitForHealth(buyerPort, "Scout buyer"),
  waitForHealth(ledgerPort, "Marketplace ledger")
]).then(() => {
  return Promise.all([
    requestUrl(`${protocol}://${localHost}:${marketplacePort}/api/registry`, {
    Origin: expectedBuyerOrigin
    }),
    requestUrl(`${protocol}://${localHost}:${buyerPort}/buyer.html`),
    requestUrl(`${protocol}://${localHost}:${ledgerPort}/`)
  ]);
}).then(([registryResponse, buyerPageResponse, ledgerPageResponse]) => {
  const expectedOrigin = expectedBuyerOrigin;
  if (
    registryResponse.status !== 200 ||
    registryResponse.headers["access-control-allow-origin"] !== expectedOrigin ||
    !Array.isArray(JSON.parse(registryResponse.body)) ||
    buyerPageResponse.status !== 200 ||
    !buyerPageResponse.body.includes("Scout Buyer Dashboard") ||
    ledgerPageResponse.status !== 200 ||
    !ledgerPageResponse.body.includes("Call ledger")
  ) {
    throw new Error("Marketplace, buyer, or ledger readiness check failed.");
  }
  console.log(`All ${protocol.toUpperCase()} services are healthy: Marketplace :${marketplacePort}, Scout buyer :${buyerPort}, Call ledger :${ledgerPort}.`);
  console.log(`Registry access, buyer-origin CORS, and the separate ledger page are verified over ${protocol.toUpperCase()}.`);
}).catch((error) => {
  console.error(error.message);
  shutdown(1);
});

function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 500).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

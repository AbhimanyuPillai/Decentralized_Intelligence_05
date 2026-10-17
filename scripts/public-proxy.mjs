import "dotenv/config";
import http from "node:http";
import https from "node:https";

// One public URL can serve all three local apps. Page paths and the browser
// referrer tell this small proxy which app should receive each request.
const marketplacePort = Number(process.env.MARKETPLACE_PORT ?? 3100);
const buyerPort = Number(process.env.BUYER_PORT ?? 3101);
const ledgerPort = Number(process.env.LEDGER_PORT ?? 3102);
const proxyPort = Number(process.env.PUBLIC_PROXY_PORT ?? 3103);
const useHttps = process.env.SELLER_PAYMENTS_ENABLED === "true";
const protocol = useHttps ? "https:" : "http:";
const localHost = process.env.HOST ?? (useHttps ? "127.0.0.1" : "::1");

function pageService(pathname) {
  if (pathname === "/scout" || pathname === "/scout/" || pathname === "/buyer.html") return "buyer";
  if (pathname === "/ledger" || pathname === "/ledger/" || pathname === "/ledger.html") return "ledger";
  return null;
}

function serviceFromReferrer(request) {
  const referer = request.headers.referer;
  if (!referer) return null;

  try {
    const pathname = new URL(referer).pathname;
    if (pathname === "/scout" || pathname.startsWith("/scout/") || pathname === "/buyer.html") return "buyer";
    if (pathname === "/ledger" || pathname.startsWith("/ledger/") || pathname === "/ledger.html") return "ledger";
  } catch {
    // An invalid referrer is ignored; the request will use the default route.
  }

  return null;
}

function chooseService(request, pathname) {
  const directPage = pageService(pathname);
  if (directPage) return directPage;

  // Scout posts each call record to the Ledger using this exact route.
  if (pathname === "/api/ledger" && request.method === "POST") return "ledger";

  // Scout reports ledger entries server-to-server. This header is only used
  // to route the request; the Ledger still checks its configured secret.
  if (request.headers["x-scout-report-token"]) return "ledger";

  return serviceFromReferrer(request) ?? "marketplace";
}

function targetPort(service) {
  if (service === "buyer") return buyerPort;
  if (service === "ledger") return ledgerPort;
  return marketplacePort;
}

function upstreamPath(pathname, service) {
  if ((pathname === "/scout" || pathname === "/scout/") && service === "buyer") return "/";
  if ((pathname === "/ledger" || pathname === "/ledger/") && service === "ledger") return "/";
  return pathname;
}

const proxy = http.createServer((request, response) => {
  const incomingUrl = new URL(request.url ?? "/", "http://localhost");
  const service = chooseService(request, incomingUrl.pathname);
  const transport = useHttps ? https : http;
  const hostHeader = localHost.includes(":") ? `[${localHost}]:${targetPort(service)}` : `${localHost}:${targetPort(service)}`;
  const headers = { ...request.headers, host: hostHeader };

  const upstream = transport.request({
    protocol,
    hostname: localHost,
    port: targetPort(service),
    method: request.method,
    path: `${upstreamPath(incomingUrl.pathname, service)}${incomingUrl.search}`,
    headers,
    // The local paid-mode HTTPS servers use a self-signed development cert.
    rejectUnauthorized: !useHttps
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });

  upstream.on("error", (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    response.end(`The ${service} service is not reachable on port ${targetPort(service)}.`);
  });

  request.pipe(upstream);
});

proxy.listen(proxyPort, "0.0.0.0", () => {
  console.log(`Public routing proxy listening on http://localhost:${proxyPort}`);
  console.log(`Marketplace ${marketplacePort} · Scout ${buyerPort} · Ledger ${ledgerPort}`);
  console.log("Expose this proxy port with ngrok; keep all three app servers running.");
});

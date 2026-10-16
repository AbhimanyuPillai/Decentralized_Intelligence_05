import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

if (process.env.NODE_ENV !== "production" && process.env.SELLER_PAYMENTS_ENABLED !== "true") process.exit(0);

if (process.env.TLS_KEY_FILE && process.env.TLS_CERT_FILE) process.exit(0);
if (process.env.TLS_KEY_FILE || process.env.TLS_CERT_FILE) {
  console.error("Set both TLS_KEY_FILE and TLS_CERT_FILE, or leave both unset for local development.");
  process.exit(1);
}

const keyPath = path.join("certs", "localhost-key.pem");
const certPath = path.join("certs", "localhost-cert.pem");
if (existsSync(keyPath) && existsSync(certPath)) process.exit(0);

mkdirSync("certs", { recursive: true });
const result = spawnSync("openssl", [
  "req", "-x509", "-nodes", "-days", "365", "-newkey", "rsa:2048",
  "-keyout", keyPath,
  "-out", certPath,
  "-config", path.join("certs", "localhost.cnf")
], { stdio: "inherit" });

if (result.error || result.status !== 0) {
  console.error("Could not create local HTTPS certificates. Install OpenSSL or set TLS_KEY_FILE and TLS_CERT_FILE.");
  process.exit(1);
}

console.log("Created local HTTPS certificates in certs/.");

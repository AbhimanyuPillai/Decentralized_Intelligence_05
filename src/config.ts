import { readFileSync } from "node:fs";
import path from "node:path";

export function loadLocalEnvironment(): void {
  try {
    const envFile = readFileSync(path.join(process.cwd(), ".env"), "utf8");
    for (const line of envFile.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match || process.env[match[1]] !== undefined) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
      process.env[match[1]] = value;
    }
  } catch {
    // Environment variables may be provided by the hosting environment.
  }
}

export function readLocalTlsFiles() {
  const keyPath = path.resolve(process.env.TLS_KEY_FILE ?? "certs/localhost-key.pem");
  const certPath = path.resolve(process.env.TLS_CERT_FILE ?? "certs/localhost-cert.pem");
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

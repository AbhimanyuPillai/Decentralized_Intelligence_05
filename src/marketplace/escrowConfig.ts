// Escrow settings shared by sellers (where buyers pay), the marketplace (which holds
// and releases money) and buyers (which sign their accept/dispute verdicts).
import { privateKeyToAccount } from "viem/accounts";

/** Free test mode has no wallet; this placeholder marks escrowed listings. */
export const FREE_MODE_ESCROW_ADDRESS = "0x000000000000000000000000000000000000e5c0";
const DEFAULT_HOLD_SECONDS = 600;

export function escrowEnabled(): boolean {
  return process.env.ESCROW_ENABLED === "true";
}

function paymentsEnabled(): boolean {
  return process.env.SELLER_PAYMENTS_ENABLED === "true";
}

export function escrowPrivateKey(): `0x${string}` | undefined {
  const configured = process.env.ESCROW_PRIVATE_KEY?.trim();
  if (!configured || !/^(0x)?[a-fA-F0-9]{64}$/.test(configured)) return undefined;
  return (configured.startsWith("0x") ? configured : `0x${configured}`) as `0x${string}`;
}

function derivedEscrowAddress(): string | undefined {
  const privateKey = escrowPrivateKey();
  if (!privateKey) return undefined;
  try {
    return privateKeyToAccount(privateKey).address;
  } catch {
    return undefined;
  }
}

/** Why paid escrow cannot run, or undefined when its wallet is configured correctly. */
export function escrowWalletProblem(): string | undefined {
  if (!escrowEnabled() || !paymentsEnabled()) return undefined;
  const derived = derivedEscrowAddress();
  if (!derived) return "Set ESCROW_PRIVATE_KEY to the marketplace escrow wallet to enable escrowed paid calls.";
  // ESCROW_ADDRESS is the published escrow wallet (also in marketplace-contract.json).
  // A key for any other wallet would send buyers' money somewhere unexpected, so refuse it.
  const expected = process.env.ESCROW_ADDRESS?.trim();
  if (expected && expected.toLowerCase() !== derived.toLowerCase()) {
    return `ESCROW_PRIVATE_KEY belongs to ${derived}, not to the published escrow wallet ESCROW_ADDRESS (${expected}).`;
  }
  return undefined;
}

/** The wallet buyers pay when escrow is on, or undefined when escrow is off or not configured. */
export function escrowAddress(): string | undefined {
  if (!escrowEnabled()) return undefined;
  if (!paymentsEnabled()) return FREE_MODE_ESCROW_ADDRESS;
  return escrowWalletProblem() ? undefined : derivedEscrowAddress();
}

export function escrowHoldSeconds(): number {
  const configured = Number(process.env.ESCROW_HOLD_SECONDS ?? DEFAULT_HOLD_SECONDS);
  return Number.isInteger(configured) && configured >= 10 && configured <= 86_400 ? configured : DEFAULT_HOLD_SECONDS;
}

/** The exact text a buyer signs so only the paying wallet can accept or dispute its own call. */
export function verdictMessage(recordId: string, decision: "accept" | "dispute"): string {
  return `PPC Agent Marketplace escrow verdict\nrecord: ${recordId}\ndecision: ${decision}`;
}

import type { LedgerRecord, ServiceCategory } from "../types.js";
import { findSeller } from "./registry.js";
import { createPublicClient, decodeEventLog, http, parseAbiItem } from "viem";
import { baseSepolia } from "viem/chains";

const categories: ServiceCategory[] = ["scraping", "data", "inference"];
const statuses: LedgerRecord["status"][] = [
  "paid",
  "paid, output rejected",
  "completed free",
  "settlement unknown",
  "refused",
  "failed and not charged"
];
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL?.trim() || "https://sepolia.base.org";
const chainClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl, { timeout: 12_000 }) });

export class LedgerVerificationUnavailableError extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnitAmount(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
}

export function parseLedgerRecord(value: unknown): LedgerRecord {
  if (!isObject(value)) throw new Error("Call record must be a JSON object.");

  const record = value;
  const isPaid = record.status === "paid" || record.status === "paid, output rejected";

  if (typeof record.id !== "string" || record.id.length === 0) {
    throw new Error("id must be a non-empty string.");
  }
  if (typeof record.taskId !== "string" || record.taskId.length === 0 || record.taskId.length > 100) {
    throw new Error("taskId must be a non-empty string of at most 100 characters.");
  }
  if (typeof record.timestamp !== "string" || Number.isNaN(Date.parse(record.timestamp))) {
    throw new Error("timestamp must be a valid ISO date-time string.");
  }
  if (typeof record.buyerAddress !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(record.buyerAddress)) {
    throw new Error("buyerAddress must be a valid EVM address.");
  }
  if (typeof record.sellerId !== "string" || record.sellerId.length === 0) {
    throw new Error("sellerId must be a non-empty string.");
  }
  if (typeof record.serviceName !== "string" || record.serviceName.length === 0) {
    throw new Error("serviceName must be a non-empty string.");
  }
  if (typeof record.category !== "string" || !categories.includes(record.category as ServiceCategory)) {
    throw new Error("category must be scraping, data, or inference.");
  }
  if (!isUnitAmount(record.listedPriceUnits) || !isUnitAmount(record.askedPriceUnits) || !isUnitAmount(record.amountPaidUnits)) {
    throw new Error("Price and payment amounts must be integer strings in USDC units.");
  }
  if (typeof record.status !== "string" || !statuses.includes(record.status as LedgerRecord["status"])) {
    throw new Error("status is not supported.");
  }
  if (!Number.isInteger(record.latencyMs) || Number(record.latencyMs) < 0) {
    throw new Error("latencyMs must be a non-negative integer.");
  }
  if (record.reason !== undefined && typeof record.reason !== "string") {
    throw new Error("reason must be a string when provided.");
  }
  if (record.sellerResponded !== undefined && typeof record.sellerResponded !== "boolean") {
    throw new Error("sellerResponded must be a boolean when provided.");
  }

  const seller = findSeller(record.sellerId);
  if (!seller) throw new Error("sellerId is not registered in the Marketplace.");
  if (record.category !== seller.category || record.serviceName !== seller.name) {
    throw new Error("serviceName and category must match the registered seller.");
  }
  if (record.status === "completed free" && seller.paymentRequired !== false) {
    throw new Error("completed free is only valid for a listing that does not require payment.");
  }
  if (record.status === "settlement unknown" && seller.paymentRequired !== true) {
    throw new Error("settlement unknown is only valid for a paid listing.");
  }

  let scamMismatch: LedgerRecord["scamMismatch"];
  let observedChallenge: LedgerRecord["observedChallenge"];
  if (record.scamMismatch !== undefined) {
    if (record.status !== "refused" || record.amountPaidUnits !== "0" || record.txHash !== null || record.sellerResponded !== true) {
      throw new Error("A seller safety finding must be a refused, uncharged call with a seller response.");
    }
    if (!isObject(record.observedChallenge) ||
      !isUnitAmount(record.observedChallenge.amount) ||
      typeof record.observedChallenge.network !== "string" ||
      typeof record.observedChallenge.asset !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(record.observedChallenge.asset) ||
      typeof record.observedChallenge.payTo !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(record.observedChallenge.payTo)) {
      throw new Error("A seller safety finding must include the observed payment challenge.");
    }
    if (record.listedPriceUnits !== seller.priceUnits || record.askedPriceUnits !== record.observedChallenge.amount) {
      throw new Error("The reported price evidence must match the seller's current listing and observed challenge.");
    }
    if (record.scamMismatch === "price_mismatch") {
      if (record.observedChallenge.amount === seller.priceUnits ||
        record.observedChallenge.payTo.toLowerCase() !== seller.payTo.toLowerCase()) {
        throw new Error("The observed challenge does not prove a listed-price mismatch.");
      }
    } else if (record.scamMismatch === "recipient_mismatch") {
      if (record.observedChallenge.amount !== seller.priceUnits ||
        record.observedChallenge.payTo.toLowerCase() === seller.payTo.toLowerCase()) {
        throw new Error("The observed challenge does not prove a payment-recipient mismatch.");
      }
    } else {
      throw new Error("scamMismatch is not supported.");
    }
    if (record.observedChallenge.network !== seller.network ||
      record.observedChallenge.asset.toLowerCase() !== seller.asset.toLowerCase()) {
      throw new Error("The observed challenge network and asset must match the seller listing.");
    }
    scamMismatch = record.scamMismatch as LedgerRecord["scamMismatch"];
    observedChallenge = {
      amount: record.observedChallenge.amount,
      network: record.observedChallenge.network,
      asset: record.observedChallenge.asset,
      payTo: record.observedChallenge.payTo
    };
  } else if (record.observedChallenge !== undefined) {
    throw new Error("observedChallenge requires a supported scamMismatch.");
  }

  let txHash: string | null = null;
  let explorerUrl: string | null = null;

  if (isPaid) {
    if (typeof record.txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(record.txHash)) {
      throw new Error("A settled call must include a valid transaction hash.");
    }
    if (BigInt(record.amountPaidUnits) <= 0n || record.amountPaidUnits !== record.askedPriceUnits) {
      throw new Error("A settled call's paid amount must equal its asked amount and be greater than zero.");
    }
    if (record.askedPriceUnits !== seller.priceUnits || record.listedPriceUnits !== seller.priceUnits) {
      throw new Error("A settled call must use the exact registered seller price.");
    }
    if (seller.paymentRequired !== true || seller.network !== "eip155:84532") {
      throw new Error("A paid record requires a paid Base Sepolia seller listing.");
    }
    if (record.buyerAddress.toLowerCase() === seller.payTo.toLowerCase()) {
      throw new Error("Buyer and seller payment addresses must be different.");
    }

    txHash = record.txHash.toLowerCase();
    explorerUrl = `https://sepolia.basescan.org/tx/${txHash}`;
  } else if (record.status === "settlement unknown") {
    if (record.amountPaidUnits !== "0") {
      throw new Error("A settlement with unknown outcome must not be counted as paid.");
    }
    if (record.txHash !== null && record.txHash !== undefined) {
      if (typeof record.txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(record.txHash)) {
        throw new Error("An unknown settlement transaction hash must be a valid EVM hash.");
      }
      if (seller.network !== "eip155:84532" || record.askedPriceUnits !== seller.priceUnits || record.listedPriceUnits !== seller.priceUnits) {
        throw new Error("An unknown settlement hash must match the registered Base Sepolia seller and price.");
      }
      if (record.buyerAddress.toLowerCase() === seller.payTo.toLowerCase()) {
        throw new Error("Buyer and seller payment addresses must be different.");
      }
      txHash = record.txHash.toLowerCase();
      explorerUrl = `https://sepolia.basescan.org/tx/${txHash}`;
    }
  } else if (record.amountPaidUnits !== "0" || (record.txHash !== null && record.txHash !== undefined)) {
    throw new Error("An uncharged or unverified call must have amountPaidUnits 0 and no transaction hash.");
  }

  return {
    id: record.id,
    taskId: record.taskId,
    timestamp: record.timestamp,
    buyerAddress: record.buyerAddress,
    sellerId: seller.id,
    serviceName: seller.name,
    category: seller.category,
    listedPriceUnits: record.listedPriceUnits,
    askedPriceUnits: record.askedPriceUnits,
    amountPaidUnits: record.amountPaidUnits,
    txHash,
    explorerUrl,
    status: record.status as LedgerRecord["status"],
    latencyMs: Number(record.latencyMs),
    ...(record.reason === undefined ? {} : { reason: record.reason }),
    ...(record.sellerResponded === undefined ? {} : { sellerResponded: record.sellerResponded }),
    ...(scamMismatch ? { scamMismatch, observedChallenge } : {})
  };
}

// A transaction hash counts as paid only if Base Sepolia shows the expected USDC transfer.
export async function verifyPaidLedgerRecord(record: LedgerRecord): Promise<void> {
  if (record.status !== "paid" && record.status !== "paid, output rejected") return;
  const seller = findSeller(record.sellerId);
  if (!seller) throw new Error("Seller is no longer registered.");

  let receipt;
  try {
    const chainId = await chainClient.getChainId();
    if (chainId !== 84532) throw new LedgerVerificationUnavailableError("The configured RPC endpoint is not connected to Base Sepolia.");
    receipt = await chainClient.getTransactionReceipt({ hash: record.txHash as `0x${string}` });
  } catch (error) {
    if (error instanceof LedgerVerificationUnavailableError) throw error;
    throw new LedgerVerificationUnavailableError("Could not verify the transaction receipt on Base Sepolia. Try again after the transaction is indexed.");
  }
  if (receipt.status !== "success") throw new Error("The payment transaction did not succeed.");

  const transfers = receipt.logs.flatMap((log) => {
    if (log.address.toLowerCase() !== seller.asset.toLowerCase()) return [];
    try {
      const decoded = importTransferLog(log);
      return [decoded];
    } catch {
      return [];
    }
  });
  const buyerTransfers = transfers.filter((transfer) => transfer.from.toLowerCase() === record.buyerAddress.toLowerCase());
  if (
    buyerTransfers.length !== 1 ||
    buyerTransfers[0]?.to.toLowerCase() !== seller.payTo.toLowerCase() ||
    buyerTransfers[0]?.value !== BigInt(record.amountPaidUnits)
  ) {
    throw new Error("The transaction must contain exactly one USDC transfer out of the buyer wallet, for the listed amount, to the registered seller.");
  }
}

function importTransferLog(log: { topics: readonly `0x${string}`[]; data: `0x${string}` }) {
  const decoded = decodeEventLog({
    abi: [transferEvent],
    data: log.data,
    topics: log.topics as [`0x${string}`, ...`0x${string}`[]]
  });
  return decoded.args as { from: `0x${string}`; to: `0x${string}`; value: bigint };
}

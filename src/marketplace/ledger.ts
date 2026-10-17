import type { LedgerRecord, ServiceCategory } from "../types.js";
import { findSeller } from "./registry.js";

const categories: ServiceCategory[] = ["scraping", "data", "inference"];
const statuses: LedgerRecord["status"][] = [
  "paid",
  "paid, output rejected",
  "completed free",
  "settlement unknown",
  "refused",
  "failed and not charged"
];

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

  let txHash: string | null = null;
  let explorerUrl: string | null = null;

  if (isPaid) {
    if (typeof record.txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(record.txHash)) {
      throw new Error("A settled call must include a valid transaction hash.");
    }
    if (BigInt(record.amountPaidUnits) <= 0n || record.amountPaidUnits !== record.askedPriceUnits) {
      throw new Error("A settled call's paid amount must equal its asked amount and be greater than zero.");
    }
    if (BigInt(record.askedPriceUnits) > BigInt(record.listedPriceUnits)) {
      throw new Error("A settled call cannot exceed the registered listing price.");
    }

    txHash = record.txHash;
    explorerUrl = `https://sepolia.basescan.org/tx/${txHash}`;
  } else if (record.amountPaidUnits !== "0" || (record.txHash !== null && record.txHash !== undefined)) {
    throw new Error("An uncharged or unverified call must have amountPaidUnits 0 and no transaction hash.");
  }

  return {
    id: record.id,
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
    ...(record.reason === undefined ? {} : { reason: record.reason })
  };
}

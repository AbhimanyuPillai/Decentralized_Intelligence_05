export type ServiceCategory = "scraping" | "data" | "inference";

export interface Reputation {
  totalCalls: number;
  successfulCalls: number;
  successRatePercent: number | null;
  medianLatencyMs: number | null;
}

export interface SellerListing {
  id: string;
  name: string;
  category: ServiceCategory;
  description: string;
  endpointUrl: string;
  priceUnits: string;
  paymentRequired?: boolean;
  ready?: boolean;
  network: string;
  asset: string;
  payTo: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  reputation: Reputation;
}

export interface SellerRegistration extends Omit<SellerListing, "reputation"> {
  reputation?: Reputation;
}

export type CallStatus =
  | "paid"
  | "paid, output rejected"
  | "completed free"
  | "settlement unknown"
  | "refused"
  | "failed and not charged";

export interface LedgerRecord {
  id: string;
  timestamp: string;
  buyerAddress: string;
  sellerId: string;
  serviceName: string;
  category: ServiceCategory;
  listedPriceUnits: string;
  askedPriceUnits: string;
  amountPaidUnits: string;
  txHash: string | null;
  explorerUrl: string | null;
  status: CallStatus;
  latencyMs: number;
  reason?: string;
}

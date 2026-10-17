export type ServiceCategory = "scraping" | "data" | "inference";

export type SellerTrustStatus = "unproven" | "active" | "quarantined" | "blacklisted";
export type ScamMismatch = "price_mismatch" | "recipient_mismatch";

export interface RankingFactors {
  legitimacy: number;
  success: number;
  availability: number;
  latency: number;
  cost: number;
}

export interface Reputation {
  totalCalls: number;
  successfulCalls: number;
  successRatePercent: number | null;
  medianLatencyMs: number | null;
  availabilityPercent: number | null;
  mismatchCount: number;
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
  readinessReason?: string;
  selectionScore?: number;
  trustStatus: SellerTrustStatus;
  rankingFactors: RankingFactors;
  demoScamType?: ScamMismatch;
  network: string;
  asset: string;
  payTo: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  reputation: Reputation;
}

export interface SellerRegistration extends Omit<SellerListing, "reputation" | "trustStatus" | "rankingFactors" | "selectionScore"> {
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
  taskId: string;
  timestamp: string;
  buyerAddress: string;
  sellerId: string;
  serviceName: string;
  category: ServiceCategory;
  listedPriceUnits: string;
  askedPriceUnits: string;
  amountPaidUnits: string;
  txHash: string | null;
  chainVerified?: boolean;
  explorerUrl: string | null;
  status: CallStatus;
  latencyMs: number;
  reason?: string;
  sellerResponded?: boolean;
  scamMismatch?: ScamMismatch;
  observedChallenge?: {
    amount: string;
    network: string;
    asset: string;
    payTo: string;
  };
}

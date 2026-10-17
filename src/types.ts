export type ServiceCategory = "scraping" | "data" | "inference";

export type SellerTrustStatus = "unproven" | "active" | "quarantined" | "blacklisted";
export type ScamMismatch = "price_mismatch" | "recipient_mismatch";
export type DemoReplayRole = "first" | "second";
export type DemoFailureType = "compute_error";

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
  demoReplayRole?: DemoReplayRole;
  demoFailureType?: DemoFailureType;
  network: string;
  asset: string;
  payTo: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  reputation: Reputation;
  /** Present when buyers pay the marketplace escrow wallet instead of the seller directly. */
  escrow?: EscrowTerms;
}

export interface EscrowTerms {
  /** The seller wallet that receives the money once the escrow releases it. */
  sellerPayTo: string;
  /** How long the money is held before it is released automatically if nobody disputes. */
  holdSeconds: number;
}

export type EscrowState =
  | "held"
  | "needs review"
  | "releasing"
  | "refunding"
  | "released"
  | "refunded"
  | "transfer failed";

export type EscrowDecider = "buyer accepted" | "hold expired" | "automatic rule" | "AI judge" | "human reviewer";

export interface EscrowHold {
  recordId: string;
  taskId: string;
  sellerId: string;
  serviceName: string;
  buyerAddress: string;
  sellerPayTo: string;
  asset: string;
  amountUnits: string;
  paymentTxHash: string | null;
  state: EscrowState;
  createdAt: string;
  releaseAfter: string;
  dispute?: { reason: string; at: string };
  /** Why a disputed hold is waiting for a human reviewer. */
  reviewNote?: string;
  decision?: { outcome: "release" | "refund"; decidedBy: EscrowDecider; reason: string; at: string };
  transferTxHash?: string;
  transferExplorerUrl?: string;
  transferError?: string;
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
  /** Added to ledger API responses when the call's payment went through escrow. */
  escrow?: EscrowHold;
}

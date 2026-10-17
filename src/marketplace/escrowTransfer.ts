// Sends USDC out of the escrow wallet on Base Sepolia: to the seller on release,
// back to the buyer on refund.
//
// The escrow wallet never needs ETH. It signs a one-time USDC transfer authorization
// (EIP-3009, the same "exact" x402 scheme buyers use), and the x402 facilitator puts it
// on chain and pays the gas. The escrow wallet only ever holds USDC from buyers' payments.
import { x402Client } from "@x402/core/client";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { escrowPrivateKey } from "./escrowConfig.js";

const NETWORK = "eip155:84532" as const;
const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL?.trim() || "https://sepolia.base.org";
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl, { timeout: 20_000 }) });
const facilitator = new HTTPFacilitatorClient({
  url: process.env.X402_FACILITATOR_URL?.trim() || process.env.FACILITATOR_URL?.trim() || "https://x402.org/facilitator"
});

// One transfer at a time, so payouts are easy to follow in the logs and on chain.
let queue: Promise<unknown> = Promise.resolve();

export function sendEscrowTransfer(asset: string, to: string, amountUnits: string): Promise<`0x${string}`> {
  const run = async () => {
    const privateKey = escrowPrivateKey();
    if (!privateKey) throw new Error("ESCROW_PRIVATE_KEY is not configured.");
    const account = privateKeyToAccount(privateKey);
    const requirements = {
      scheme: "exact",
      network: NETWORK,
      asset,
      amount: amountUnits,
      payTo: to,
      maxTimeoutSeconds: 120,
      extra: { assetTransferMethod: "eip3009", name: "USDC", version: "2" }
    };

    const client = new x402Client().register(NETWORK, new ExactEvmScheme(account));
    const payload = await client.createPaymentPayload({
      x402Version: 2,
      resource: { url: "https://localhost/escrow-payout", description: "Marketplace escrow payout" },
      accepts: [requirements]
    });

    const verification = await facilitator.verify(payload, requirements);
    if (!verification.isValid) {
      throw new Error(`Facilitator rejected the escrow payout: ${verification.invalidReason ?? verification.invalidMessage ?? "unknown reason"}`);
    }
    const settlement = await facilitator.settle(payload, requirements);
    if (!settlement.success || !/^0x[a-fA-F0-9]{64}$/.test(settlement.transaction)) {
      throw new Error(`Escrow payout did not settle: ${settlement.errorReason ?? settlement.errorMessage ?? "unknown reason"}`);
    }
    const hash = settlement.transaction as `0x${string}`;
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") throw new Error(`Escrow transfer ${hash} failed on chain.`);
    return hash;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

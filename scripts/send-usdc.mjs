// Sends Base Sepolia test USDC from one of the project's wallets to another address,
// with no ETH needed: the sender signs a one-time USDC transfer authorization (EIP-3009),
// and the x402 facilitator submits it on chain and pays the gas.
//
// Run from the project folder:
//   node scripts/send-usdc.mjs                 preview only: shows balances and the plan, sends nothing
//   node scripts/send-usdc.mjs --yes           sends 1 USDC from BUYER_PRIVATE_KEY's wallet to ESCROW_ADDRESS
//   node scripts/send-usdc.mjs --amount 0.5 --yes
//   node scripts/send-usdc.mjs --to 0x... --from-env SELLER_PRIVATE_KEY --yes
//
// Private keys are read from .env and never printed. Testnet only.
import "dotenv/config";
import { x402Client } from "@x402/core/client";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createPublicClient, formatUnits, getAddress, http, isAddress, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const NETWORK = "eip155:84532";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DEFAULT_ESCROW = "0xA360194De2Ff897C0fE441890FdC7DD045DE49b2";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const confirmed = process.argv.includes("--yes");
const fromEnv = argument("--from-env") ?? "BUYER_PRIVATE_KEY";
const amountText = argument("--amount") ?? "1";
const toText = argument("--to") ?? process.env.ESCROW_ADDRESS?.trim() ?? DEFAULT_ESCROW;

class StopError extends Error {}

// Stop with a message. Exiting via process.exitCode (not process.exit) avoids a
// Windows Node.js assertion when network sockets are still closing.
function fail(message) {
  throw new StopError(message);
}

async function main() {

const rawKey = process.env[fromEnv]?.trim();
if (!rawKey || !/^(0x)?[a-fA-F0-9]{64}$/.test(rawKey)) fail(`${fromEnv} in .env is missing or is not a 32-byte private key.`);
if (!isAddress(toText)) fail(`Recipient ${toText} is not a valid address.`);
if (!/^\d+(\.\d{1,6})?$/.test(amountText) || Number(amountText) <= 0) fail("--amount must be a positive USDC amount with up to 6 decimals.");

const account = privateKeyToAccount(rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`);
const to = getAddress(toText);
const amountUnits = parseUnits(amountText, 6);
if (to === account.address) fail("Sender and recipient are the same wallet.");

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL?.trim() || "https://sepolia.base.org";
const chain = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl, { timeout: 20_000 }) });
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const usdcBalance = (address) => chain.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [address] });

const [senderBefore, recipientBefore] = await Promise.all([usdcBalance(account.address), usdcBalance(to)]);
console.log(`From  ${account.address} (${fromEnv}): ${formatUnits(senderBefore, 6)} USDC`);
console.log(`To    ${to}: ${formatUnits(recipientBefore, 6)} USDC`);
console.log(`Send  ${amountText} USDC on Base Sepolia; the x402 facilitator pays the gas.`);
if (senderBefore < amountUnits) fail("The sender does not have enough USDC.");
if (!confirmed) {
  console.log("\nPreview only. Nothing was signed or sent. Add --yes to send.");
  return;
}

const facilitatorUrl = process.env.X402_FACILITATOR_URL?.trim() || process.env.FACILITATOR_URL?.trim() || "https://x402.org/facilitator";
const requirements = {
  scheme: "exact",
  network: NETWORK,
  asset: USDC,
  amount: amountUnits.toString(),
  payTo: to,
  maxTimeoutSeconds: 120,
  extra: { assetTransferMethod: "eip3009", name: "USDC", version: "2" }
};

// 1. Sign a one-time transfer authorization for exactly this amount and recipient.
const client = new x402Client().register(NETWORK, new ExactEvmScheme(account));
const payload = await client.createPaymentPayload({
  x402Version: 2,
  resource: { url: "https://localhost/send-usdc", description: "Direct test USDC transfer" },
  accepts: [requirements]
});

// 2. Ask the facilitator to check it, then to put it on chain.
const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl });
const verification = await facilitator.verify(payload, requirements);
if (!verification.isValid) fail(`Facilitator rejected the authorization: ${verification.invalidReason ?? verification.invalidMessage ?? "unknown reason"}`);
console.log("\nAuthorization verified. Settling on chain…");
const settlement = await facilitator.settle(payload, requirements);
if (!settlement.success) fail(`Settlement failed: ${settlement.errorReason ?? settlement.errorMessage ?? "unknown reason"}`);

console.log(`Sent. Transaction: https://sepolia.basescan.org/tx/${settlement.transaction}`);
await chain.waitForTransactionReceipt({ hash: settlement.transaction, timeout: 60_000 }).catch(() => undefined);
const [senderAfter, recipientAfter] = await Promise.all([usdcBalance(account.address), usdcBalance(to)]);
console.log(`From  ${account.address}: ${formatUnits(senderAfter, 6)} USDC`);
console.log(`To    ${to}: ${formatUnits(recipientAfter, 6)} USDC`);
}

try {
  await main();
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

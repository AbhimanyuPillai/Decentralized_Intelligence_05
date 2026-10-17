# Escrow and refunds for disputed calls

Stretch goal: *escrow or refunds for disputed calls.*

## The idea

x402 says "pay this amount to this address". It does not require that address to be the seller. With escrow on, every built-in seller's listing and 402 quote point buyers at the **marketplace escrow wallet**. The marketplace holds the money until the buyer is satisfied, then releases it to the seller or refunds the buyer.

This is custodial escrow: buyers trust the marketplace to hold funds fairly. A trustless version would hold funds in a smart contract that collects the payment itself, which needs a custom x402 scheme and facilitator. That is the production path.

## One call, step by step

```
Scout ──pays──▶ escrow wallet          (ledger: paid · escrow: held)
seller does the work, Scout receives the result
Scout checks the result ──▶ accept ──▶ escrow pays the seller          (released)
                        └─▶ dispute ─▶ rules / AI judge / human ──▶ released or refunded
nobody answers before the hold period ends ──▶ escrow pays the seller   (released)
```

1. **Hold.** When the buyer reports a paid call to the Call Ledger service (`POST /api/ledger` on port 3002), the ledger verifies the on-chain payment to the escrow wallet, as before, and opens a hold.
2. **Buyer check.** Scout asks its AI whether the result matches what was ordered. It compares against both the user's whole request and the step. It then sends a verdict, signed by the paying wallet in paid mode, so nobody else can accept or dispute that call.
3. **Accept** releases the money to the seller's own wallet immediately.
4. **Dispute** is settled in three layers:
   - **Automatic rule.** A result that breaks the seller's own published output format is refunded without debate.
   - **AI judge.** The marketplace's own impartial judge, separate from Scout, reads the request, the listing, the result and the complaint. It rules refund, release, or unsure.
   - **Human reviewer.** Unsure cases, and disputes without evidence, show **Release to seller** and **Refund buyer** buttons on the Call Ledger page at http://localhost:3002.
5. **Timeout.** A hold nobody disputes is released to the seller after `ESCROW_HOLD_SECONDS`, 10 minutes by default.
6. **Consequences.** A refunded call counts as a failure in the seller's reputation, which lowers its ranking. Scout treats a refunded call as failed and never uses that result.

## Settings

| Setting | Meaning |
| --- | --- |
| `ESCROW_ENABLED=true` | Turns escrow on for all built-in sellers. |
| `ESCROW_PRIVATE_KEY` | Paid mode only. The escrow wallet that buyers pay and that sends releases and refunds. Use a separate Base Sepolia test wallet. It needs no ETH: it signs each payout as a one-time USDC transfer authorization, and the x402 facilitator submits it and pays the gas, exactly as for buyer payments. It only holds USDC that buyers paid in. |
| `ESCROW_HOLD_SECONDS` | How long undisputed money is held before automatic release. Default 600. |
| `ESCROW_ADMIN_TOKEN` | Optional. Without it, only someone on the marketplace computer can use the review buttons. With it, the page asks for this token. |
| `ESCROW_JUDGE_API_KEY`, `ESCROW_JUDGE_MODEL`, `ESCROW_JUDGE_API_URL` | Optional. A separate model for the judge. Otherwise it uses `LLM_API_KEY`. |

In free test mode all amounts are zero. Holds, verdicts, rulings and reviews still run, so the whole flow can be demonstrated without wallets.

## Demos

- **Dispute and refund.** In Scout, run *Get English Wikipedia facts about the 2012 film Life of Pi, the Oscar-winning movie.* The facts seller returns the 2001 novel. Scout disputes, the AI judge refunds, and the task is reported as not successful.
- **Clean release.** Run *Give me the top Oscar-winning films of 2010, with their Wikipedia facts and a Hindi summary of each.* Scout hires the film scraper, the Wikipedia facts seller and the Hindi summary seller; each call is accepted and released to the seller.
- **Human review.** A dispute with no evidence waits on the Call Ledger page with Release and Refund buttons.

## API

- All escrow endpoints live on the Call Ledger service, port 3002, next to the records they hold.
- `GET /api/escrow/:recordId` returns one hold. `GET /api/ledger` includes each call's `escrow` hold.
- `POST /api/escrow/:recordId/verdict` takes `{ decision: "accept" | "dispute", reason, evidence: { task, input, output }, signature }`. The signature is required in paid mode, over the text from `verdictMessage()` in `src/marketplace/escrowConfig.ts`.
- `POST /api/escrow/:recordId/resolve` takes `{ outcome: "release" | "refund", note }` and is for the human reviewer only.

## Limits

- **Custodial.** The escrow wallet's key holder controls the funds.
- **Buyer-supplied evidence.** The judge sees the result the buyer submits. A dishonest buyer could submit a fake result. Seller-signed responses would close this gap.
- **Interrupted transfers.** A server stop in the middle of a transfer leaves the hold "releasing" or "refunding". Failed transfers show **Transfer failed** with retry buttons.
- **Built-in sellers only.** Website-registered sellers are paid directly.
- **Payouts use the public x402 facilitator.** Releases and refunds are gasless only while the facilitator at `X402_FACILITATOR_URL` is reachable. If it is down, the hold shows **Transfer failed** and can be retried later.

## Moving test USDC by hand

`scripts/send-usdc.mjs` sends Base Sepolia test USDC from a project wallet with no ETH, through the same facilitator. Run it without `--yes` first to preview balances; nothing is signed or sent until you add `--yes`.

```
node scripts/send-usdc.mjs --amount 1 --yes
```

By default it sends from `BUYER_PRIVATE_KEY`'s wallet to `ESCROW_ADDRESS`. Use `--from-env` and `--to` to choose others.
- **Free-tier AI limits.** Groq's free tier allows about 8,000 tokens per minute. Model calls wait and retry when rate limited. A hold whose verdict could not be sent simply releases when it expires.

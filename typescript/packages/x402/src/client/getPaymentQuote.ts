import { Network } from "../types/shared";
import { QuoteRequest, QuoteResponse } from "../types/verify";

/**
 * Gets a payment quote from the facilitator for gasless Solana transactions.
 * This endpoint returns the payment amount, facilitator address, and fee payer address
 * needed to create gasless transaction signatures.
 *
 * @param srcTokenAddress - Source token address (SPL token mint or "11111111111111111111111111111111" for native SOL)
 * @param srcNetwork - Source network (e.g., "solana", "solana-devnet")
 * @param dstTokenAddress - Destination token address (EVM address)
 * @param dstNetwork - Destination network (e.g., "base", "ethereum")
 * @param dstAmount - Destination amount in atomic units
 * @param facilitatorUrl - URL of the facilitator service
 * @returns A promise that resolves to the quote response
 * @throws Error if the quote request fails
 *
 * @example
 * ```typescript
 * const quote = await getPaymentQuote(
 *   "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC on Solana
 *   "solana",
 *   "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
 *   "base",
 *   "1000000", // 1 USDC
 *   "https://mainnet.anyspend.com"
 * );
 *
 * console.log(quote.data?.paymentAmount); // Amount user needs to approve/pay
 * console.log(quote.data?.facilitatorAddress); // Address to approve or send to
 * console.log(quote.data?.feePayerAddress); // Who will pay transaction fees
 * ```
 */
export async function getPaymentQuote(
  srcTokenAddress: string,
  srcNetwork: Network,
  dstTokenAddress: string,
  dstNetwork: Network,
  dstAmount: string,
  facilitatorUrl: string,
): Promise<QuoteResponse> {
  const request: QuoteRequest = {
    srcTokenAddress,
    srcNetwork,
    dstTokenAddress,
    dstNetwork,
    dstAmount,
  };

  const response = await fetch(`${facilitatorUrl}/x402/quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get payment quote: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data as QuoteResponse;
}


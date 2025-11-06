import { TransactionSigner } from "@solana/kit";
import { PaymentRequirements } from "../../../types/verify";
import { X402Config } from "../../../types/config";

/**
 * Creates and encodes a payment header for the given client and payment requirements.
 *
 * SVM only supports gasless transactions where:
 * - For SPL tokens: User signs an approval, facilitator executes the transfer
 * - For native SOL: User signs a transfer to facilitator's wallet
 * - Backend (facilitator) pays all transaction fees
 *
 * The middleware must call /x402/quote to get facilitatorAddress and feePayerAddress,
 * which must be present in paymentRequirements.extra.
 *
 * @param client - The signer instance used to create the payment header
 * @param x402Version - The version of the X402 protocol to use
 * @param paymentRequirements - The payment requirements (must include facilitatorAddress in extra)
 * @param config - Optional configuration for X402 operations (e.g., custom RPC URLs)
 * @returns A promise that resolves to a base64 encoded payment header string
 * @throws Error if facilitatorAddress is not provided in paymentRequirements.extra
 */
export async function createPaymentHeader(
  client: TransactionSigner,
  x402Version: number,
  paymentRequirements: PaymentRequirements,
  config?: X402Config,
): Promise<string> {
  const facilitatorAddress = paymentRequirements.extra?.facilitatorAddress as string | undefined;

  if (!facilitatorAddress) {
    throw new Error(
      "SVM requires facilitatorAddress in paymentRequirements.extra. " +
        "The server must call /x402/quote to get this value. " +
        "Only gasless transactions are supported for SVM.",
    );
  }

  // Import gasless functions to create approval or native transfer
  const { createGaslessPaymentHeader } = await import("./gasless-client");
  return await createGaslessPaymentHeader(
    client,
    x402Version,
    paymentRequirements,
    facilitatorAddress,
    config,
  );
}

import {
  Address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  partiallySignTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  TransactionSigner,
  fetchEncodedAccount,
  address,
} from "@solana/kit";
import {
  findAssociatedTokenPda as findAssociatedTokenPda2022,
  getApproveInstruction as getApproveInstruction2022,
  TOKEN_2022_PROGRAM_ADDRESS,
  fetchMint,
} from "@solana-program/token-2022";
import {
  findAssociatedTokenPda,
  getApproveInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { getRpcClient } from "../../../shared/svm/rpc";
import { X402Config } from "../../../types/config";
import { PaymentRequirements, QuoteResponse } from "../../../types/verify";
import { base58 } from "@scure/base";
import {
  ExactSolanaApprovalPayload,
  ExactSolanaNativePayload,
  PaymentPayload,
} from "../../../types/verify/x402Specs";
import { encodePayment } from "../../utils";

/**
 * Creates a gasless SPL token approval signature for payment.
 * The user approves the facilitator to spend tokens, and the backend pays all transaction fees.
 *
 * @param client - The transaction signer (user's wallet)
 * @param x402Version - The version of the X402 protocol to use
 * @param paymentRequirements - The payment requirements containing scheme and network information
 * @param quoteResponse - The quote response containing payment amount and fee payer info
 * @param config - Optional configuration for X402 operations (e.g., custom RPC URLs)
 * @returns A promise that resolves to the payment payload with approval signature
 *
 * @example
 * ```typescript
 * const quote = await getPaymentQuote(...);
 * const paymentPayload = await createGaslessApprovalPayment(
 *   wallet,
 *   1,
 *   paymentRequirements,
 *   quote,
 *   { svmConfig: { rpcUrl: "https://api.mainnet-beta.solana.com" } }
 * );
 * ```
 */
export async function createGaslessApprovalPayment(
  client: TransactionSigner,
  x402Version: number,
  paymentRequirements: PaymentRequirements,
  quoteResponse: QuoteResponse,
  config?: X402Config,
): Promise<PaymentPayload> {
  if (!quoteResponse.success || !quoteResponse.data) {
    throw new Error("Invalid quote response");
  }

  const { paymentAmount, facilitatorAddress, feePayerAddress } = quoteResponse.data;

  const rpc = getRpcClient(paymentRequirements.network, config?.svmConfig?.rpcUrl);

  // Get token mint info
  const tokenMint = await fetchMint(rpc, paymentRequirements.asset as Address);
  const tokenProgramAddress = tokenMint.programAddress;

  // Validate token program
  if (
    tokenProgramAddress.toString() !== TOKEN_PROGRAM_ADDRESS.toString() &&
    tokenProgramAddress.toString() !== TOKEN_2022_PROGRAM_ADDRESS.toString()
  ) {
    throw new Error("Asset was not created by a known token program");
  }

  // Get user's token account using the appropriate function for the token program
  const userTokenAccount =
    tokenProgramAddress.toString() === TOKEN_PROGRAM_ADDRESS.toString()
      ? (
          await findAssociatedTokenPda({
            mint: paymentRequirements.asset as Address,
            owner: client.address,
            tokenProgram: tokenProgramAddress,
          })
        )[0]
      : (
          await findAssociatedTokenPda2022({
            mint: paymentRequirements.asset as Address,
            owner: client.address,
            tokenProgram: tokenProgramAddress,
          })
        )[0];

  // Verify user has the token account
  const maybeAccount = await fetchEncodedAccount(rpc, userTokenAccount);
  if (!maybeAccount.exists) {
    throw new Error("User does not have a token account for this asset");
  }

  // Create approval instruction using token-2022 API (works for both token programs)
  // getApproveInstruction expects: account (token account), delegate, owner, amount
  const approvalInstruction = getApproveInstruction2022(
    {
      account: userTokenAccount,
      delegate: facilitatorAddress as Address,
      owner: client,
      amount: BigInt(paymentAmount),
    } as any, // Type assertion needed due to complex address/signer generic types
    { programAddress: tokenProgramAddress },
  );

  // Get latest blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // Create transaction message using pipe pattern
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    tx => setTransactionMessageFeePayer(feePayerAddress as Address, tx),
    tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    tx => appendTransactionMessageInstruction(approvalInstruction, tx),
  );

  // User signs (backend will sign as fee payer later)
  const partiallySignedTransaction =
    await partiallySignTransactionMessageWithSigners(transactionMessage);

  // Serialize with partial signatures
  const serializedTransaction = getBase64EncodedWireTransaction(partiallySignedTransaction);

  // Extract user's signature
  const userSignature = partiallySignedTransaction.signatures[client.address];
  if (!userSignature) {
    throw new Error("Failed to get user's signature from transaction");
  }

  // Create approval payload
  const approvalPayload: ExactSolanaApprovalPayload = {
    signature: base58.encode(userSignature),
    approval: {
      owner: client.address,
      delegate: facilitatorAddress,
      tokenAccount: userTokenAccount,
      tokenMint: paymentRequirements.asset,
      value: paymentAmount,
      serializedTransaction,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: Number(latestBlockhash.lastValidBlockHeight),
    },
  };

  return {
    x402Version,
    scheme: paymentRequirements.scheme,
    network: paymentRequirements.network,
    payload: approvalPayload,
  };
}

/**
 * Creates a gasless native SOL transfer signature for payment.
 * The user signs a transfer to the global wallet, and the backend pays all transaction fees.
 *
 * @param client - The transaction signer (user's wallet)
 * @param x402Version - The version of the X402 protocol to use
 * @param paymentRequirements - The payment requirements containing scheme and network information
 * @param quoteResponse - The quote response containing payment amount, destination, and fee payer info
 * @param config - Optional configuration for X402 operations (e.g., custom RPC URLs)
 * @returns A promise that resolves to the payment payload with transfer signature
 *
 * @example
 * ```typescript
 * const quote = await getPaymentQuote(...);
 * const paymentPayload = await createGaslessNativePayment(
 *   wallet,
 *   1,
 *   paymentRequirements,
 *   quote,
 *   { svmConfig: { rpcUrl: "https://api.mainnet-beta.solana.com" } }
 * );
 * ```
 */
export async function createGaslessNativePayment(
  client: TransactionSigner,
  x402Version: number,
  paymentRequirements: PaymentRequirements,
  quoteResponse: QuoteResponse,
  config?: X402Config,
): Promise<PaymentPayload> {
  if (!quoteResponse.success || !quoteResponse.data) {
    throw new Error("Invalid quote response");
  }

  const { paymentAmount, facilitatorAddress, feePayerAddress } = quoteResponse.data;

  const rpc = getRpcClient(paymentRequirements.network, config?.svmConfig?.rpcUrl);

  // Create native SOL transfer instruction manually
  // System Program ID: 11111111111111111111111111111111
  const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111");
  
  // Transfer instruction data: [instruction_index(u32), lamports(u64)]
  // Instruction index 2 = Transfer
  const transferInstructionData = new Uint8Array(12);
  transferInstructionData[0] = 2; // Transfer instruction
  transferInstructionData[1] = 0;
  transferInstructionData[2] = 0;
  transferInstructionData[3] = 0;
  
  // Encode lamports as little-endian u64
  const lamports = BigInt(paymentAmount);
  const lamportsView = new DataView(transferInstructionData.buffer, 4, 8);
  lamportsView.setBigUint64(0, lamports, true); // true = little-endian
  
  const transferInstruction = {
    programAddress: SYSTEM_PROGRAM_ADDRESS,
    accounts: [
      { address: client.address, role: 0 }, // from (signer + writable)
      { address: facilitatorAddress as Address, role: 1 }, // to (writable)
    ],
    data: transferInstructionData,
  };

  // Get latest blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // Create transaction message using pipe pattern
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    tx => setTransactionMessageFeePayer(feePayerAddress as Address, tx),
    tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    tx => appendTransactionMessageInstruction(transferInstruction, tx),
  );

  // User signs (backend will sign as fee payer later)
  const partiallySignedTransaction =
    await partiallySignTransactionMessageWithSigners(transactionMessage);

  // Serialize with partial signatures
  const serializedTransaction = getBase64EncodedWireTransaction(partiallySignedTransaction);

  // Extract user's signature
  const userSignature = partiallySignedTransaction.signatures[client.address];
  if (!userSignature) {
    throw new Error("Failed to get user's signature from transaction");
  }

  // Create transfer payload
  const transferPayload: ExactSolanaNativePayload = {
    signature: base58.encode(userSignature),
    transfer: {
      owner: client.address,
      destination: facilitatorAddress,
      value: paymentAmount,
      serializedTransaction,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: Number(latestBlockhash.lastValidBlockHeight),
    },
  };

  return {
    x402Version,
    scheme: paymentRequirements.scheme,
    network: paymentRequirements.network,
    payload: transferPayload,
  };
}

/**
 * Creates and encodes a gasless approval payment header for SPL tokens.
 *
 * @param client - The transaction signer (user's wallet)
 * @param x402Version - The version of the X402 protocol to use
 * @param paymentRequirements - The payment requirements
 * @param quoteResponse - The quote response
 * @param config - Optional configuration for X402 operations
 * @returns A promise that resolves to the encoded payment header string
 */
export async function createGaslessApprovalPaymentHeader(
  client: TransactionSigner,
  x402Version: number,
  paymentRequirements: PaymentRequirements,
  quoteResponse: QuoteResponse,
  config?: X402Config,
): Promise<string> {
  const paymentPayload = await createGaslessApprovalPayment(
    client,
    x402Version,
    paymentRequirements,
    quoteResponse,
    config,
  );
  return encodePayment(paymentPayload);
}

/**
 * Creates and encodes a gasless native SOL payment header.
 *
 * @param client - The transaction signer (user's wallet)
 * @param x402Version - The version of the X402 protocol to use
 * @param paymentRequirements - The payment requirements
 * @param quoteResponse - The quote response
 * @param config - Optional configuration for X402 operations
 * @returns A promise that resolves to the encoded payment header string
 */
export async function createGaslessNativePaymentHeader(
  client: TransactionSigner,
  x402Version: number,
  paymentRequirements: PaymentRequirements,
  quoteResponse: QuoteResponse,
  config?: X402Config,
): Promise<string> {
  const paymentPayload = await createGaslessNativePayment(
    client,
    x402Version,
    paymentRequirements,
    quoteResponse,
    config,
  );
  return encodePayment(paymentPayload);
}

/**
 * Automatically detects the token type and creates the appropriate gasless payment header.
 * 
 * - For native SOL (address: "11111111111111111111111111111111"), creates a gasless native transfer
 * - For SPL tokens, creates a gasless approval
 *
 * @param client - The transaction signer (user's wallet)
 * @param x402Version - The version of the X402 protocol to use
 * @param paymentRequirements - The payment requirements (must include facilitatorAddress in extra)
 * @param facilitatorAddress - The facilitator's address (from quote response)
 * @param config - Optional configuration for X402 operations
 * @returns A promise that resolves to the encoded payment header string
 */
export async function createGaslessPaymentHeader(
  client: TransactionSigner,
  x402Version: number,
  paymentRequirements: PaymentRequirements,
  facilitatorAddress: string,
  config?: X402Config,
): Promise<string> {
  const NATIVE_SOL_ADDRESS = "11111111111111111111111111111111";
  const isNativeSOL = paymentRequirements.asset === NATIVE_SOL_ADDRESS;

  // Create a quote response object from payment requirements
  // The middleware has already called /quote and included the info in extra
  const feePayerAddress = paymentRequirements.extra?.feePayer as string;
  const paymentAmount = paymentRequirements.maxAmountRequired;

  if (!feePayerAddress) {
    throw new Error("feePayer is required in paymentRequirements.extra for gasless transactions");
  }

  const quoteResponse: QuoteResponse = {
    success: true,
    data: {
      paymentAmount,
      facilitatorAddress,
      feePayerAddress,
    },
  };

  if (isNativeSOL) {
    return await createGaslessNativePaymentHeader(
      client,
      x402Version,
      paymentRequirements,
      quoteResponse,
      config,
    );
  } else {
    return await createGaslessApprovalPaymentHeader(
      client,
      x402Version,
      paymentRequirements,
      quoteResponse,
      config,
    );
  }
}


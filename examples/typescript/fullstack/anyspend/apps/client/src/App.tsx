import { useEffect, useState } from "react";
import { publicActions } from "viem";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import { base } from "wagmi/chains";
import {
  decodeXPaymentResponse,
  MultiNetworkSigner,
  Signer,
  wrapFetchWithPayment,
} from "x402-fetch";
import "./App.css";
import { BASE_TOKENS } from "./wagmi.config";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
const MAX_PAYMENT_VALUE = BigInt(1 * 10 ** 25); // 1 USDC max

interface PaymentInfo {
  status: string;
  payer?: string;
  transaction?: string;
  network?: string;
  error?: string;
}

interface PremiumData {
  symbol: string;
  name: string;
  currentPrice: number;
  priceChange: number;
  priceChangePercent: string;
  high24h: number;
  low24h: number;
  priceHistory: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
  dataPoints: number;
  timestamp: string;
}

function App() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const { switchChain } = useSwitchChain();

  const [selectedToken, setSelectedToken] = useState<string>("preset");
  const [customTokenAddress, setCustomTokenAddress] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [premiumData, setPremiumData] = useState<PremiumData | null>(null);
  const [priceInfo, setPriceInfo] = useState<string>("Loading...");
  const [maxAmountInfo, setMaxAmountInfo] = useState<string>("Loading...");
  const [srcNetwork, setSrcNetwork] = useState<string>("base");
  const [dstNetwork, setDstNetwork] = useState<string>("base");
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>(
    {},
  );
  const [selectedChain, setSelectedChain] = useState<string>("8453"); // Base mainnet
  const [userTokens, setUserTokens] = useState<
    Array<{
      address: string;
      symbol: string;
      name: string;
      decimals: number;
      balance: string;
      valueUsd?: number;
    }>
  >([]);

  // Set default preset token when connected (default to B3)
  useEffect(() => {
    if (isConnected && selectedToken === "preset" && BASE_TOKENS.length > 0) {
      setSelectedToken(BASE_TOKENS[0].address); // B3 token
    }
  }, [isConnected, selectedToken]);

  // Fetch token balances from server
  useEffect(() => {
    const fetchBalances = async () => {
      if (!address) return;

      try {
        const url = `${API_BASE_URL}/api/balances/${address}?chain_id=${selectedChain}`;
        console.log("Fetching balances from:", url);

        const response = await fetch(url);

        if (response.ok) {
          const data = await response.json();
          console.log("Balance response:", data);

          if (data.success && data.tokens) {
            const balances: Record<string, string> = {};

            // Map balances by token address
            data.tokens.forEach((token: any) => {
              const tokenAddress = token.address.toLowerCase();
              balances[tokenAddress] = token.balance;
            });

            setTokenBalances(balances);
            setUserTokens(data.tokens);
          }
        } else {
          console.error("Balance fetch failed:", response.status);
        }
      } catch (err) {
        console.error("Failed to fetch balances:", err);
      }
    };

    fetchBalances();
  }, [address, selectedChain]);


  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `${timestamp}: ${message}`]);
  };

  const getTokenIcon = (address: string) => {
    const token = BASE_TOKENS.find(
      (t) => t.address.toLowerCase() === address.toLowerCase(),
    );
    if (!token) return { className: "custom", symbol: "?" };
    return {
      className: token.symbol.toLowerCase(),
      symbol: token.symbol.charAt(0),
    };
  };

  // Fetch price information from server
  useEffect(() => {
    const fetchPriceInfo = async () => {
      try {
        let tokenAddress = selectedToken;

        // Handle custom token
        if (selectedToken === "custom") {
          tokenAddress = customTokenAddress;
        }

        // Skip if no valid token
        if (
          !tokenAddress ||
          tokenAddress === "preset" ||
          !tokenAddress.startsWith("0x")
        ) {
          console.log("Skipping price fetch - invalid token:", tokenAddress);
          setPriceInfo("1 USDC");
          return;
        }

        // Set loading state
        setPriceInfo("Loading...");
        setMaxAmountInfo("Loading...");
        setSrcNetwork("base");
        setDstNetwork("base");
        console.log("Fetching price for token:", tokenAddress);

        // Make a request to get payment requirements (402 response)
        const headers: HeadersInit = {};

        // Map chain ID to network name
        const getNetworkName = (chainId: string): string => {
          switch (chainId) {
            case "1":
              return "ethereum";
            case "8453":
              return "base";
            case "137":
              return "polygon";
            case "42161":
              return "arbitrum";
            default:
              return "base";
          }
        };

        // Only add X-PREFERRED-TOKEN if it's not USDC (USDC is the default)
        const usdcAddress =
          "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase();
        if (tokenAddress.toLowerCase() !== usdcAddress) {
          headers["X-PREFERRED-TOKEN"] = tokenAddress;
          headers["X-PREFERRED-NETWORK"] = getNetworkName(selectedChain);
          console.log("Using preferred token:", tokenAddress);
          console.log("Using preferred network:", getNetworkName(selectedChain));
        } else {
          console.log("Using default USDC (no preference header)");
        }

        const response = await fetch(`${API_BASE_URL}/api/premium`, {
          method: "POST",
          headers,
        });

        console.log("Price fetch response status:", response.status);

        // If 402, parse the payment requirements
        if (response.status === 402) {
          const data = await response.json();
          console.log("Payment requirements:", data);

          // Check for 'accepts' array (new format)
          const paymentReqs = data.accepts || data.paymentRequirements || [];

          if (paymentReqs.length > 0) {
            const req = paymentReqs[0];

            // Check if this is a direct payment (no swap) - when srcTokenAddress is missing
            const isDirectPayment = !req.srcTokenAddress;

            // Capture networks
            setSrcNetwork(req.srcNetwork || req.network || "base");
            setDstNetwork(req.network || "base");

            // Process srcAmountRequired (what you pay)
            const srcAmountStr = req.srcAmountRequired || req.amount || req.maxAmountRequired;

            if (srcAmountStr) {
              const srcAmount = BigInt(srcAmountStr);

              // Get decimals - try multiple sources
              let srcDecimals = 18; // Default
              let srcTokenAddr = req.srcTokenAddress || req.asset;

              // First try to find in BASE_TOKENS
              const srcToken = BASE_TOKENS.find(
                (t) =>
                  t.address.toLowerCase() ===
                  (srcTokenAddr || "").toLowerCase(),
              );

              if (srcToken) {
                srcDecimals = srcToken.decimals;
              } else if (req.extra?.chainId && req.extra?.verifyingContract) {
                // For cross-chain tokens, try to infer decimals from common tokens
                const tokenAddr = (req.srcTokenAddress || req.extra.verifyingContract || "").toLowerCase();

                // Common token decimals mapping
                if (tokenAddr === "0xdac17f958d2ee523a2206206994597c13d831ec7") {
                  // USDT on Ethereum
                  srcDecimals = 6;
                } else if (tokenAddr === "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48") {
                  // USDC on Ethereum
                  srcDecimals = 6;
                } else if (tokenAddr.includes("usdc") || tokenAddr.includes("usdt")) {
                  // Most stablecoins use 6 decimals
                  srcDecimals = 6;
                }
              } else if (req.decimals) {
                srcDecimals = req.decimals;
              }

              // Convert to human-readable format
              const srcDivisor = BigInt(10 ** srcDecimals);
              const srcIntegerPart = srcAmount / srcDivisor;
              const srcFractionalPart = srcAmount % srcDivisor;

              let srcPriceStr = srcIntegerPart.toString();
              if (srcFractionalPart > 0) {
                const fracStr = srcFractionalPart.toString().padStart(srcDecimals, "0");
                const displayDecimals = fracStr.slice(0, 6);
                srcPriceStr += "." + displayDecimals.replace(/0+$/, "");
              }

              // Get source token symbol
              let srcSymbol = "tokens";

              if (req.srcTokenAddress) {
                const sourceToken = BASE_TOKENS.find(
                  (t) =>
                    t.address.toLowerCase() === req.srcTokenAddress.toLowerCase(),
                );
                if (sourceToken) {
                  srcSymbol = sourceToken.symbol;
                }
              } else if (req.asset) {
                // For direct payment, use asset symbol
                const assetToken = BASE_TOKENS.find(
                  (t) => t.address.toLowerCase() === req.asset.toLowerCase(),
                );
                if (assetToken) {
                  srcSymbol = assetToken.symbol;
                }
              }

              if (srcSymbol === "tokens" && req.extra?.name) {
                srcSymbol = req.extra.name;
              }

              setPriceInfo(`${srcPriceStr} ${srcSymbol}`);
            } else {
              setPriceInfo("1 USDC");
            }

            // Process maxAmountRequired (maximum you'll pay)
            const maxAmountStr = req.maxAmountRequired;

            if (maxAmountStr) {
              const maxAmount = BigInt(maxAmountStr);

              // Get decimals for asset token
              let assetDecimals = 18;
              const assetToken = BASE_TOKENS.find(
                (t) =>
                  t.address.toLowerCase() ===
                  (req.asset || "").toLowerCase(),
              );

              if (assetToken) {
                assetDecimals = assetToken.decimals;
              }

              // Convert to human-readable format
              const maxDivisor = BigInt(10 ** assetDecimals);
              const maxIntegerPart = maxAmount / maxDivisor;
              const maxFractionalPart = maxAmount % maxDivisor;

              let maxPriceStr = maxIntegerPart.toString();
              if (maxFractionalPart > 0) {
                const fracStr = maxFractionalPart.toString().padStart(assetDecimals, "0");
                const displayDecimals = fracStr.slice(0, 6);
                maxPriceStr += "." + displayDecimals.replace(/0+$/, "");
              }

              // Get asset token symbol
              let assetSymbol = "tokens";
              if (req.asset) {
                const assetTokenSymbol = BASE_TOKENS.find(
                  (t) => t.address.toLowerCase() === req.asset.toLowerCase(),
                );
                if (assetTokenSymbol) {
                  assetSymbol = assetTokenSymbol.symbol;
                }
              }

              if (assetSymbol === "tokens" && req.extra?.name) {
                assetSymbol = req.extra.name;
              }

              setMaxAmountInfo(`${maxPriceStr} ${assetSymbol}`);
            } else {
              setMaxAmountInfo("N/A");
            }
          } else {
            console.log("No payment requirements found");
            setPriceInfo("1 USDC");
            setMaxAmountInfo("N/A");
          }
        } else {
          console.log("Non-402 response, using default");
          setPriceInfo("1 USDC");
        }
      } catch (err) {
        console.error("Failed to fetch price info:", err);
        setPriceInfo("1 USDC");
      }
    };

    if (isConnected && selectedToken && selectedToken !== "preset") {
      fetchPriceInfo();
    } else if (!isConnected || selectedToken === "preset") {
      // Set default when not connected or preset
      setPriceInfo("Loading...");
    }
  }, [isConnected, selectedToken, customTokenAddress]);

  const openPaymentModal = () => {
    if (!isConnected) {
      setError("Please connect your wallet first");
      return;
    }
    if (chain?.id !== base.id) {
      setError("Please switch to Base network");
      return;
    }
    setShowPaymentModal(true);
  };

  const fetchPremiumData = async () => {
    if (!isConnected || !walletClient || !address) {
      setError("Please connect your wallet first");
      setShowPaymentModal(false);
      return;
    }

    // Determine which token address to use
    const tokenAddress =
      selectedToken === "custom" ? customTokenAddress : selectedToken;

    if (!tokenAddress || tokenAddress === "preset") {
      setError("Please select or enter a token address");
      return;
    }

    // Validate custom token address format
    if (
      selectedToken === "custom" &&
      !customTokenAddress.match(/^0x[a-fA-F0-9]{40}$/)
    ) {
      setError("Invalid token address format");
      return;
    }

    // Check if on correct network
    if (chain?.id !== base.id) {
      setError("Please switch to Base network");
      return;
    }

    setLoading(true);
    setLogs([]);
    setError(null);
    setPaymentInfo(null);
    setPremiumData(null);

    try {
      addLog(`🔐 Connected wallet: ${address}`);
      addLog(`💰 Payment token: ${tokenAddress}`);
      addLog(`🌐 Network: ${chain?.name}`);

      addLog("🔧 Setting up payment-enabled fetch...");
      // Extend wallet client with public actions to make it compatible with Signer type
      const extendedWalletClient = walletClient.extend(publicActions);

      // Only set payment preferences if not using default USDC
      const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

      // Map chain ID to network name
      const getNetworkName = (chainId: string): string => {
        switch (chainId) {
          case "1":
            return "ethereum";
          case "8453":
            return "base";
          case "137":
            return "polygon";
          case "42161":
            return "arbitrum";
          default:
            return "base";
        }
      };

      const paymentPreferences =
        tokenAddress.toLowerCase() !== usdcAddress.toLowerCase()
          ? {
              // Payment preferences - tell server which token we want to pay with
              preferredToken: tokenAddress,
              preferredNetwork: getNetworkName(selectedChain) as any,
            }
          : undefined; // Use default (USDC) when undefined

      if (paymentPreferences) {
        addLog(`💡 Using preferred token: ${tokenAddress}`);
      } else {
        addLog(`💡 Using default token (USDC)`);
      }

      // Wrap fetch with automatic payment handling and payment preferences
      const fetchWithPayment = wrapFetchWithPayment(
        fetch,
        extendedWalletClient as Signer | MultiNetworkSigner,
        MAX_PAYMENT_VALUE, // Max 1 USDC
        undefined, // Use default payment requirements selector
        undefined, // Use default config
        paymentPreferences,
      );

      addLog(
        "📡 Making request to server (payment will be handled automatically)...",
      );

      // Make request - payment preferences are automatically added as headers
      try {
        const response = await fetchWithPayment(`${API_BASE_URL}/api/premium`, {
          method: "POST",
        });

        addLog(`✅ Server responded with status: ${response.status}`);

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.message || errorData.error || "Request failed",
          );
        }

        // Get payment response header if present
        const paymentResponseHeader =
          response.headers.get("X-PAYMENT-RESPONSE");
        if (paymentResponseHeader) {
          const paymentInfo = decodeXPaymentResponse(paymentResponseHeader);
          addLog(`✅ Payment ${paymentInfo.success ? "settled" : "verified"}`);
          if (paymentInfo.transaction) {
            addLog(`Transaction: ${paymentInfo.transaction}`);
          }
          setPaymentInfo({
            status: paymentInfo.success ? "settled" : "verified",
            payer: paymentInfo.payer,
            transaction: paymentInfo.transaction,
            network: paymentInfo.network,
          });
        }

        // Get the response data
        const data = await response.json();
        addLog("🎉 Premium content received!");
        setPremiumData(data.data);
      } catch (fetchError) {
        // This catches errors from fetchWithPayment including signature requests
        const message =
          fetchError instanceof Error ? fetchError.message : "Unknown error";
        addLog(`❌ Error during payment: ${message}`);
        console.error("Payment error details:", fetchError);
        throw fetchError;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      addLog(`❌ Error: ${message}`);
      setError(message);
    } finally {
      setLoading(false);
      setShowPaymentModal(false);
    }
  };

  return (
    <div className="app">
      <div className="container">
        {/* Header with Wallet Status */}
        <div className="header">
          <div className="header-content">
            <div className="logo-section">
              <img
                src="https://cdn.b3.fun/anyspend-logo-brand.svg"
                alt="AnySpend"
                className="logo"
              />
              <div className="logo-text">
                <p className="subtitle">
                  Premium ETH price data - Pay with any token
                </p>
              </div>
            </div>
            <div className="wallet-section">
              {!isConnected ? (
                <div className="connector-buttons-header">
                  {connectors.map((connector) => (
                    <button
                      key={connector.id}
                      onClick={() => connect({ connector })}
                      className="button button-small"
                    >
                      Connect Wallet
                    </button>
                  ))}
                </div>
              ) : (
                <div className="wallet-header-info">
                  {chain?.id === base.id ? (
                    <span className="status-badge">
                      ✅ {address?.slice(0, 6)}...{address?.slice(-4)}
                    </span>
                  ) : (
                    <span className="status-badge warning">
                      ⚠️ Wrong Network
                    </span>
                  )}
                  <button
                    onClick={() => disconnect()}
                    className="button button-small button-secondary"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Main Action Card */}
        {isConnected && chain?.id === base.id && (
          <div className="card action-card">
            <div className="action-content">
              <div className="action-text">
                <h2>📈 ETH Price History</h2>
                <p className="subtitle">
                  Get 24-hour ETH price history with OHLC data from CoinGecko
                </p>
              </div>
              <button
                onClick={openPaymentModal}
                disabled={loading}
                className="button button-large"
              >
                📊 Get Price Data
              </button>
            </div>
          </div>
        )}

        {/* Payment Modal */}
        {showPaymentModal && (
          <div
            className="modal-overlay"
            onClick={() => setShowPaymentModal(false)}
          >
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>💳 Payment Configuration</h2>
                <button
                  className="modal-close"
                  onClick={() => setShowPaymentModal(false)}
                  disabled={loading}
                >
                  ✕
                </button>
              </div>
              <div className="modal-body">
                {/* Price Display - Show at top */}
                {selectedToken && selectedToken !== "preset" && (
                  <div className="price-display">
                    <div className="price-row">
                      <div className="price-item">
                        <div className="price-label">You Pay</div>
                        <div className="price-value">
                          {priceInfo === "Loading..." ? (
                            <span className="loading">⏳ Loading...</span>
                          ) : (
                            <span>{priceInfo}</span>
                          )}
                        </div>
                        <div className="price-network-small">on {srcNetwork}</div>
                      </div>
                      <div className="swap-arrow">→</div>
                      <div className="price-item">
                        <div className="price-label">Recipient Gets (Max)</div>
                        <div className="price-value">
                          {maxAmountInfo === "Loading..." ? (
                            <span className="loading">⏳ Loading...</span>
                          ) : (
                            <span>{maxAmountInfo}</span>
                          )}
                        </div>
                        <div className="price-network-small">on {dstNetwork}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Chain Selection */}
                <div className="input-group">
                  <label>⛓️ Select Chain</label>
                  <div className="chain-selector">
                    <button
                      type="button"
                      className={`chain-option ${selectedChain === "1" ? "selected" : ""}`}
                      onClick={() => setSelectedChain("1")}
                      disabled={loading}
                    >
                      <span className="chain-name">Ethereum</span>
                    </button>
                    <button
                      type="button"
                      className={`chain-option ${selectedChain === "8453" ? "selected" : ""}`}
                      onClick={() => setSelectedChain("8453")}
                      disabled={loading}
                    >
                      <span className="chain-name">Base</span>
                    </button>
                    <button
                      type="button"
                      className={`chain-option ${selectedChain === "137" ? "selected" : ""}`}
                      onClick={() => setSelectedChain("137")}
                      disabled={loading}
                    >
                      <span className="chain-name">Polygon</span>
                    </button>
                    <button
                      type="button"
                      className={`chain-option ${selectedChain === "42161" ? "selected" : ""}`}
                      onClick={() => setSelectedChain("42161")}
                      disabled={loading}
                    >
                      <span className="chain-name">Arbitrum</span>
                    </button>
                  </div>
                </div>

                {/* Token Selection - Top 5 from wallet */}
                <div className="input-group">
                  <label>
                    💰 Select Payment Token
                    {userTokens.length > 0 && (
                      <span
                        style={{
                          fontWeight: "normal",
                          fontSize: "0.8rem",
                          marginLeft: "0.5rem",
                        }}
                      >
                        (Top {userTokens.length} by value)
                      </span>
                    )}
                  </label>
                  <div className="token-grid">
                    {userTokens.length > 0 ? (
                      userTokens.map((token) => (
                        <button
                          key={token.address}
                          type="button"
                          className={`token-option ${selectedToken === token.address ? "selected" : ""}`}
                          onClick={() => setSelectedToken(token.address)}
                          disabled={loading}
                        >
                          <div className="token-info">
                            <div className="token-symbol">{token.symbol}</div>
                            <div className="token-name">
                              {token.balance} {token.symbol}
                            </div>
                          </div>
                          {selectedToken === token.address && (
                            <div className="token-check">✓</div>
                          )}
                        </button>
                      ))
                    ) : (
                      <div className="no-tokens">
                        No tokens found. Connect your wallet or select a
                        different chain.
                      </div>
                    )}
                    <button
                      type="button"
                      className={`token-option ${selectedToken === "custom" ? "selected" : ""}`}
                      onClick={() => setSelectedToken("custom")}
                      disabled={loading}
                    >
                      <div className="token-info">
                        <div className="token-symbol">Custom</div>
                        <div className="token-name">Other Token</div>
                      </div>
                      {selectedToken === "custom" && (
                        <div className="token-check">✓</div>
                      )}
                    </button>
                  </div>
                </div>

                {/* Custom Token Address Input */}
                {selectedToken === "custom" && (
                  <div className="input-group">
                    <label htmlFor="customToken">Custom Token Address</label>
                    <input
                      type="text"
                      id="customToken"
                      value={customTokenAddress}
                      onChange={(e) => setCustomTokenAddress(e.target.value)}
                      placeholder="0x..."
                      className="input"
                      disabled={loading}
                    />
                    <p className="help-text">
                      Enter the ERC-20 token contract address on Base
                    </p>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button
                  onClick={() => setShowPaymentModal(false)}
                  className="button button-secondary"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  onClick={fetchPremiumData}
                  disabled={
                    loading || !selectedToken || selectedToken === "preset"
                  }
                  className={`button ${loading ? "loading" : ""}`}
                >
                  {loading ? "⏳ Processing..." : "✓ Confirm Payment"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Network Switcher Card */}
        {isConnected && chain?.id !== base.id && (
          <div className="card error-card">
            <h3>⚠️ Wrong Network</h3>
            <p style={{ marginBottom: "1rem" }}>
              Please switch to Base network to continue
            </p>
            <button
              onClick={() => switchChain({ chainId: base.id })}
              className="button"
            >
              Switch to Base
            </button>
          </div>
        )}

        {/* Results Section */}
        <div className="results-section">
          {/* Logs */}
          {logs.length > 0 && (
            <div className="card logs-card">
              <h2>📜 Transaction Log</h2>
              <div className="logs">
                {logs.map((log, i) => (
                  <div key={i} className="log-entry">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="card error-card">
              <h3>Error</h3>
              <p>{error}</p>
            </div>
          )}

          {/* Payment Info */}
          {paymentInfo && (
            <div className="card payment-card">
              <h2>✅ Payment Confirmed</h2>
              <div className="payment-details">
                <div className="detail">
                  <span className="label">Status:</span>
                  <span className="value">{paymentInfo.status}</span>
                </div>
                {paymentInfo.payer && (
                  <div className="detail">
                    <span className="label">Payer:</span>
                    <span className="value mono">{paymentInfo.payer}</span>
                  </div>
                )}
                {paymentInfo.transaction && (
                  <>
                    <div className="detail">
                      <span className="label">Transaction:</span>
                      <a
                        href={`https://sepolia.basescan.org/tx/${paymentInfo.transaction}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="value link mono"
                      >
                        {paymentInfo.transaction}
                      </a>
                    </div>
                    <div className="detail">
                      <span className="label">Network:</span>
                      <span className="value">{paymentInfo.network}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Premium Content */}
          {premiumData && (
            <div className="card content-card">
              <div className="content-header">
                <h2>📈 {premiumData.name} ({premiumData.symbol}) Price History</h2>
                <span className="badge">✨ PAID</span>
              </div>

              {/* Price Overview */}
              <div className="section">
                <h3>💰 Current Price</h3>
                <div className="analysis-grid">
                  <div className="stat">
                    <span className="stat-label">Price</span>
                    <p className="stat-value">${premiumData.currentPrice.toLocaleString()}</p>
                  </div>
                  <div className="stat">
                    <span className="stat-label">24h Change</span>
                    <p className={`stat-value ${parseFloat(premiumData.priceChangePercent) >= 0 ? "positive" : "negative"}`}>
                      {premiumData.priceChangePercent}%
                    </p>
                  </div>
                  <div className="stat">
                    <span className="stat-label">24h High</span>
                    <p className="stat-value">${premiumData.high24h.toLocaleString()}</p>
                  </div>
                  <div className="stat">
                    <span className="stat-label">24h Low</span>
                    <p className="stat-value">${premiumData.low24h.toLocaleString()}</p>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Data Points</span>
                    <p className="stat-value">{premiumData.dataPoints}</p>
                  </div>
                </div>
              </div>

              {/* Price History Sample */}
              <div className="section">
                <h3>📊 Recent Price History (Last 10 data points)</h3>
                <div className="price-history-table">
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid var(--border-primary)" }}>
                        <th style={{ padding: "0.75rem", textAlign: "left" }}>Time</th>
                        <th style={{ padding: "0.75rem", textAlign: "right" }}>Open</th>
                        <th style={{ padding: "0.75rem", textAlign: "right" }}>High</th>
                        <th style={{ padding: "0.75rem", textAlign: "right" }}>Low</th>
                        <th style={{ padding: "0.75rem", textAlign: "right" }}>Close</th>
                      </tr>
                    </thead>
                    <tbody>
                      {premiumData.priceHistory.slice(-10).reverse().map((item, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid var(--border-primary)" }}>
                          <td style={{ padding: "0.75rem", fontSize: "0.875rem" }}>
                            {new Date(item.timestamp).toLocaleTimeString()}
                          </td>
                          <td style={{ padding: "0.75rem", textAlign: "right", fontSize: "0.875rem" }}>
                            ${item.open.toLocaleString()}
                          </td>
                          <td style={{ padding: "0.75rem", textAlign: "right", fontSize: "0.875rem", color: "var(--accent-success)" }}>
                            ${item.high.toLocaleString()}
                          </td>
                          <td style={{ padding: "0.75rem", textAlign: "right", fontSize: "0.875rem", color: "var(--accent-error)" }}>
                            ${item.low.toLocaleString()}
                          </td>
                          <td style={{ padding: "0.75rem", textAlign: "right", fontSize: "0.875rem", fontWeight: "600" }}>
                            ${item.close.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="timestamp">
                Data fetched at {new Date(premiumData.timestamp).toLocaleString()}
              </div>
            </div>
          )}
        </div>
        {/* End Results Section */}

        {/* Footer */}
        <div className="footer">
          <p>
            Powered by{" "}
            <a
              href="https://x402.org"
              target="_blank"
              rel="noopener noreferrer"
            >
              x402 Payment Protocol
            </a>{" "}
            ⚡ Pay with any token, get instant access
          </p>
          <p style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
            🔒 Your keys never leave your wallet • 🌐 Works on any chain • ✨
            Gas-efficient permits
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;

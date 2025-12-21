import { HTTPFacilitatorClient } from "@x402/core/http";
import { withBazaar } from "@x402/extensions/bazaar";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

// Create facilitator client with Bazaar extension
const facilitatorClient = withBazaar(
  new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" })
);

// Query available services
const discovery = await facilitatorClient.extensions.discovery.listResources({
  type: "http",   // Filter by protocol type
  limit: 20,      // Pagination
  offset: 0,
});

console.log(`Found ${discovery.resources.length} services`);

// Browse discovered resources
for (const resource of discovery.resources) {
  console.log(`- ${resource.url}`);
  console.log(`  Type: ${resource.type}`);
  if (resource.metadata) {
    console.log(`  Metadata:`, resource.metadata);
  }
}

// Select a service and make a paid request
const selectedService = discovery.resources[0];

// Set up x402 client for payments
const signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer });

const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// Call the discovered service
const response = await fetchWithPayment(selectedService.url);
const data = await response.json();
console.log("Response:", data);
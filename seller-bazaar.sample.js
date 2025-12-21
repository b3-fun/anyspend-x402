import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} from "@x402/extensions/bazaar";

const app = express();

// Create facilitator client
const facilitatorClient = new HTTPFacilitatorClient({
  url: "https://x402.org/facilitator",
});

// Create resource server and register extensions
const server = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(server);
server.registerExtension(bazaarResourceServerExtension);

// Configure payment middleware with discovery metadata
app.use(
  paymentMiddleware(
    {
      "GET /weather": {
        accepts: {
          scheme: "exact",
          price: "$0.001",
          network: "eip155:84532",
          payTo: "0xYourAddress",
        },
        extensions: {
          // Declare discovery metadata for this endpoint
          ...declareDiscoveryExtension({
            output: {
              example: {
                temperature: 72,
                conditions: "sunny",
                humidity: 45,
              },
              schema: {
                properties: {
                  temperature: { type: "number" },
                  conditions: { type: "string" },
                  humidity: { type: "number" },
                },
                required: ["temperature", "conditions"],
              },
            },
          }),
        },
      },
    },
    server
  )
);

app.get("/weather", (req, res) => {
  res.json({
    temperature: 72,
    conditions: "sunny",
    humidity: 45,
  });
});

app.listen(4021);

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AnySpend x402 is a fork of the Coinbase x402 protocol that implements HTTP-native cryptocurrency payments using the `402 Payment Required` status code. The project extends the base protocol with multi-chain support (EVM and Solana) and multi-token transactions.

**Key concept**: Clients pay with any token (ERC-20, SPL), a facilitator swaps to USDC if needed, and sellers receive USDC.

## Repository Structure

Multi-language monorepo:
- `typescript/` - Main packages and middleware (pnpm + turbo)
- `go/` - Gin middleware for Go servers
- `java/` - Maven-based servlet filter
- `python/` - Standalone package (not in monorepo)
- `examples/` - TypeScript and Python example implementations
- `e2e/` - Cross-language end-to-end tests
- `specs/` - Protocol specifications

## Build Commands

### TypeScript (primary development)
```bash
cd typescript
pnpm install           # Install all dependencies
pnpm build             # Build all packages (via turbo)
pnpm test              # Run tests across all packages
pnpm lint              # Lint all packages
pnpm format            # Format all packages

# Single package test
cd packages/x402
pnpm test              # Uses vitest
pnpm test:watch        # Watch mode
```

### Go
```bash
cd go
go test ./...          # Run all tests
go build ./...         # Build all packages
```

### Java
```bash
cd java
mvn clean install      # Build and test
mvn test               # Run tests only
mvn jacoco:report      # Coverage report
mvn checkstyle:check   # Code style
mvn spotbugs:check     # Static analysis
```

### E2E Tests
```bash
cd e2e
pnpm test              # Full suite
pnpm test -d -ts       # TypeScript on testnet
pnpm test -d -py       # Python on testnet
pnpm test -d -go       # Go on testnet
```

## TypeScript Packages (in `typescript/packages/`)

| Package | Purpose | npm Name |
|---------|---------|----------|
| `x402` | Core protocol, types, facilitator client | `@b3dotfun/anyspend-x402` |
| `x402-express` | Express.js middleware | `@b3dotfun/anyspend-x402-express` |
| `x402-hono` | Hono middleware | |
| `x402-next` | Next.js middleware | |
| `x402-fetch` | Fetch wrapper with payment | |
| `x402-axios` | Axios interceptor with payment | |
| `x402-solana-wallet-adapter` | Solana browser wallet bridge | `@b3dotfun/anyspend-x402-solana-wallet-adapter` |
| `x402-token-compat` | Token compatibility utilities | |

## Architecture

### Protocol Flow
1. Client requests resource
2. Server returns `402 Payment Required` with `PaymentRequirements` JSON
3. Client creates payment payload (EIP-3009 signature on EVM, transaction signature on Solana)
4. Client retries request with `X-PAYMENT` header (base64 encoded)
5. Server calls facilitator `/verify` endpoint
6. On success, server serves resource
7. Server calls facilitator `/settle` endpoint (often async)
8. Server includes `X-PAYMENT-RESPONSE` header with transaction details

### Scheme-Network Pairs
- `exact` + EVM: Uses EIP-3009 (TransferWithAuthorization) or ERC-2612 (Permit)
- `exact` + Solana (SVM): Uses SPL Token TransferChecked with gasless facilitator-sponsored transactions

### Facilitator Endpoints
- `POST /verify` - Validate payment signature
- `POST /settle` - Execute on-chain transaction
- `GET /supported` - List supported scheme-network pairs

**Production facilitator**: `https://mainnet.anyspend.com/x402`

## Key Files

- `specs/x402-specification.md` - Full protocol specification
- `specs/schemes/exact/` - Scheme implementations for EVM and SVM
- `typescript/packages/x402/src/types/` - Core TypeScript types
- `typescript/turbo.json` - Turbo build configuration

## Important Notes

- If updating the core x402 TypeScript package, run `pnpm build:paywall` and commit generated files
- All commits must be signed for contributions to be merged
- Example private keys are for testnet only - never commit mainnet keys
- This is a fork of `coinbase/x402` - sync upstream with:
  ```bash
  git remote add upstream https://github.com/coinbase/x402.git
  git fetch upstream && git merge upstream/main
  ```

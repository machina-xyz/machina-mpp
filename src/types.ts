/**
 * @machina/mpp — Type definitions for MACHINA's governed MPP integration.
 *
 * MPP (Machine Payments Protocol) defines the wire format for agent-to-service
 * payments. MACHINA wraps MPP with policy enforcement: every payment flows
 * through the MACHINA policy engine before settlement.
 */

// ─── Payment Methods ──────────────────────────────────────────────────────────

/**
 * Supported payment method types.
 * "machina" is MACHINA's custom MPP payment method — multi-chain, policy-governed.
 */
export type PaymentMethodType =
  | "machina"        // MACHINA multi-chain (Base, Solana, Arbitrum, Sui, etc.)
  | "tempo"          // Tempo/Stripe rails
  | "stripe"         // Direct Stripe
  | "card"           // Card payment
  | "lightning"      // Bitcoin Lightning
  | "x402"           // x402 protocol (legacy compat)
  | "custom";        // Other custom methods

/**
 * A payment method configuration for MPP credential generation.
 */
export interface PaymentMethod {
  type: PaymentMethodType;
  /** Chain for on-chain settlement (e.g., "base", "solana", "arbitrum") */
  chain?: string;
  /** Token for payment (e.g., "USDC", "ETH", "SOL") */
  token?: string;
  /** Wallet address or payment endpoint */
  address?: string;
  /** Additional method-specific configuration */
  config?: Record<string, unknown>;
}

// ─── MPP Challenge (402 Response) ─────────────────────────────────────────────

/**
 * The 402 Payment Required challenge returned by an MPP-enabled server.
 */
export interface MppChallenge {
  /** Unique challenge identifier */
  challengeId: string;
  /** Requested payment amount in USD */
  amountUsd: string;
  /** Accepted payment methods */
  accepts: PaymentMethodType[];
  /** Payee address (service provider) */
  payee: string;
  /** Payment description */
  description?: string;
  /** Chain preferences (ordered by priority) */
  chains?: string[];
  /** Token preferences */
  tokens?: string[];
  /** Challenge expiry (ISO 8601) */
  expiresAt?: string;
  /** Network (mainnet, testnet) */
  network?: "mainnet" | "testnet";
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ─── MPP Credential ───────────────────────────────────────────────────────────

/**
 * An MPP payment credential — proof of payment or payment authorization.
 * Generated after policy approval, included in request headers.
 */
export interface MppCredential {
  /** Credential version */
  version: "1";
  /** Payment method used */
  method: PaymentMethodType;
  /** Payer address/identifier */
  payer: string;
  /** Payee address/identifier */
  payee: string;
  /** Payment amount in USD */
  amountUsd: string;
  /** Token used for settlement */
  token: string;
  /** Chain used for settlement */
  chain: string;
  /** Transaction hash (if on-chain settlement) */
  txHash?: string;
  /** Cryptographic signature over credential fields */
  signature: string;
  /** Credential issuance timestamp (ISO 8601) */
  issuedAt: string;
  /** Credential expiry (ISO 8601) */
  expiresAt: string;
  /** Challenge ID this credential responds to */
  challengeId?: string;
  /** MACHINA policy evaluation ID */
  policyEvalId?: string;
}

// ─── MPP Receipt ──────────────────────────────────────────────────────────────

/**
 * A payment receipt returned after successful service delivery.
 */
export interface MppReceipt {
  /** Receipt identifier */
  receiptId: string;
  /** Credential that was used */
  credentialId?: string;
  /** Service that was paid for */
  service: string;
  /** Amount settled */
  amountUsd: string;
  /** Platform fee (MACHINA) */
  platformFeeUsd: string;
  /** Service provider amount */
  serviceAmountUsd: string;
  /** Settlement transaction hash */
  txHash?: string;
  /** Settlement chain */
  chain: string;
  /** Settlement status */
  status: "pending" | "confirmed" | "failed" | "refunded";
  /** Timestamp */
  settledAt: string;
}

// ─── Policy Evaluation ────────────────────────────────────────────────────────

/**
 * Result of MACHINA policy engine evaluation on an MPP payment.
 * This is what makes MACHINA MPP different from vanilla MPP — governance.
 */
export interface PolicyEvaluation {
  /** Evaluation ID */
  evalId: string;
  /** Whether the payment is approved */
  approved: boolean;
  /** Agent making the payment */
  agentId: string;
  /** Reason for denial (if denied) */
  reason?: string;
  /** Policy rules that were evaluated */
  rulesEvaluated: string[];
  /** Rules that blocked the payment */
  rulesBlocked: string[];
  /** Budget remaining after this payment (if approved) */
  budgetRemainingUsd?: string;
  /** Whether human approval is required */
  requiresApproval: boolean;
  /** Approval request ID (if HITL required) */
  approvalRequestId?: string;
  /** Compliance checks performed */
  complianceChecks: {
    sanctionsScreening: "pass" | "fail" | "pending" | "unavailable";
    travelRule: "pass" | "fail" | "not_required" | "unavailable";
    budgetLimit: "pass" | "fail" | "no_limit";
    rateLimit: "pass" | "fail";
  };
  /** Timestamp */
  evaluatedAt: string;
}

// ─── Client Configuration ─────────────────────────────────────────────────────

/**
 * Configuration for the MACHINA MPP client.
 */
export interface MachinaMppClientConfig {
  /** MACHINA API URL */
  apiUrl: string;
  /** Agent identifier (address or DID) */
  agentId: string;
  /** Default payment method */
  defaultMethod?: PaymentMethodType;
  /** Default chain for settlement */
  defaultChain?: string;
  /** Default token */
  defaultToken?: string;
  /** Wallet address for on-chain payments */
  walletAddress?: string;
  /** Signing function for credential generation */
  signer?: (message: Uint8Array) => Promise<Uint8Array>;
  /** API key for MACHINA API */
  apiKey?: string;
  /** Auto-handle 402 challenges (default: true) */
  autoHandle402?: boolean;
  /** Maximum auto-payment amount in USD (default: "1.00") */
  maxAutoPayUsd?: string;
  /** Custom fetch implementation */
  fetch?: typeof globalThis.fetch;
}

// ─── Server Configuration ─────────────────────────────────────────────────────

/**
 * Configuration for the MACHINA MPP server middleware.
 */
export interface MachinaMppServerConfig {
  /** MACHINA API URL for policy checks */
  apiUrl: string;
  /** Service identifier */
  serviceId: string;
  /** Payment address (where to receive payments) */
  paymentAddress: string;
  /** Price per request in USD */
  pricePerRequestUsd: string;
  /** Accepted payment methods (default: ["machina", "x402"]) */
  acceptedMethods?: PaymentMethodType[];
  /** Accepted chains */
  acceptedChains?: string[];
  /** Accepted tokens (default: ["USDC"]) */
  acceptedTokens?: string[];
  /** Whether to verify credentials against MACHINA API (default: true) */
  verifyCredentials?: boolean;
  /** Platform fee percentage (default: 0.01 = 1%) */
  platformFeeRate?: number;
  /** API key for MACHINA API */
  apiKey?: string;
  /** Network (default: "mainnet") */
  network?: "mainnet" | "testnet";
}

// ─── MCP Integration ──────────────────────────────────────────────────────────

/**
 * MPP error code for MCP JSON-RPC payment required responses.
 * Per MPP spec: -32042 = Payment Required
 */
export const MCP_PAYMENT_REQUIRED_CODE = -32042;

/**
 * MCP payment metadata key for credential transport.
 * Credentials flow through `_meta['org.paymentauth/credential']`
 */
export const MCP_CREDENTIAL_META_KEY = "org.paymentauth/credential";

/**
 * MCP tool call payment context.
 */
export interface McpPaymentContext {
  /** The tool being called */
  toolName: string;
  /** Tool call arguments */
  args: Record<string, unknown>;
  /** Payment challenge (if 402) */
  challenge?: MppChallenge;
  /** Payment credential (if paying) */
  credential?: MppCredential;
  /** Policy evaluation result */
  policyEval?: PolicyEvaluation;
}

// ─── Wire Format ──────────────────────────────────────────────────────────────

/**
 * HTTP header names for MPP credential transport.
 */
export const MPP_HEADERS = {
  /** Credential header (request) */
  CREDENTIAL: "x-mpp-credential",
  /** Challenge header (402 response) */
  CHALLENGE: "x-mpp-challenge",
  /** Receipt header (response) */
  RECEIPT: "x-mpp-receipt",
  /** MACHINA policy eval header */
  POLICY_EVAL: "x-machina-policy-eval",
  /** Agent identity header */
  AGENT_ID: "x-machina-agent-id",
  /** x402 compatibility header */
  X402_PAYMENT: "x-402-payment",
} as const;

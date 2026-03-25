// Client
export { MachinaMppClient, createMppFetch } from "./client.js";

// Server
export { MachinaMppServer } from "./server.js";

// MCP
export {
  requirePayment,
  extractMcpCredential,
  isPaymentRequired,
  parsePaymentError,
  encodeMcpCredential,
  MCP_PAYMENT_REQUIRED_CODE,
  MCP_CREDENTIAL_META_KEY,
} from "./mcp.js";

// Types
export type {
  PaymentMethodType,
  PaymentMethod,
  MppChallenge,
  MppCredential,
  MppReceipt,
  PolicyEvaluation,
  MachinaMppClientConfig,
  MachinaMppServerConfig,
  McpPaymentContext,
} from "./types.js";

export { MPP_HEADERS } from "./types.js";

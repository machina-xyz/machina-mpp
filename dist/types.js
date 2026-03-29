/**
 * @machina/mpp — Type definitions for MACHINA's governed MPP integration.
 *
 * MPP (Machine Payments Protocol) defines the wire format for agent-to-service
 * payments. MACHINA wraps MPP with policy enforcement: every payment flows
 * through the MACHINA policy engine before settlement.
 */
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
};
//# sourceMappingURL=types.js.map
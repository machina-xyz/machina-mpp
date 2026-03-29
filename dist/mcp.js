/**
 * @machina/mpp/mcp — MCP Transport for MPP payments.
 *
 * Enables MACHINA MCP servers to gate tool calls behind payments:
 *   - Server returns JSON-RPC error -32042 (Payment Required)
 *   - Client extracts challenge from error data
 *   - Client evaluates via MACHINA policy engine
 *   - Client retries with credential in `_meta['org.paymentauth/credential']`
 *
 * This is where MACHINA's value is highest — governance INSIDE agent tool calls.
 *
 * @example Server-side (gating a tool):
 * ```typescript
 * import { requirePayment, extractMcpCredential } from "@machina/mpp/mcp";
 *
 * // In tool handler:
 * const credential = extractMcpCredential(request._meta);
 * if (!credential) {
 *   throw requirePayment({
 *     serviceId: "image-gen",
 *     priceUsd: "0.05",
 *     paymentAddress: "0x...",
 *   });
 * }
 * ```
 *
 * @example Client-side (handling -32042):
 * ```typescript
 * import { MachinaMppClient } from "@machina/mpp/client";
 *
 * const result = await mcpClient.callTool("generate_image", { prompt: "..." });
 * if (result.error?.code === -32042) {
 *   const { meta } = await mppClient.handleMcpPayment(result.error.data);
 *   const retryResult = await mcpClient.callTool("generate_image", { prompt: "..." }, { _meta: meta });
 * }
 * ```
 */
import { MCP_PAYMENT_REQUIRED_CODE, MCP_CREDENTIAL_META_KEY } from "./types.js";
// ─── Server-Side Helpers ──────────────────────────────────────────────────────
/**
 * Create an MCP JSON-RPC -32042 error for a paid tool call.
 * Throw this from your MCP tool handler to require payment.
 */
export function requirePayment(opts) {
    return {
        code: MCP_PAYMENT_REQUIRED_CODE,
        message: "Payment required",
        data: {
            challengeId: crypto.randomUUID(),
            amountUsd: opts.priceUsd,
            accepts: opts.acceptedMethods ?? ["machina", "x402"],
            payee: opts.paymentAddress,
            description: opts.description ?? `Payment for ${opts.serviceId}`,
            chains: opts.chains,
            tokens: opts.tokens ?? ["USDC"],
            network: opts.network ?? "mainnet",
            serviceId: opts.serviceId,
        },
    };
}
/**
 * Extract an MPP credential from MCP request _meta.
 * Returns null if no credential is present.
 */
export function extractMcpCredential(meta) {
    if (!meta)
        return null;
    const raw = meta[MCP_CREDENTIAL_META_KEY];
    if (!raw || typeof raw !== "string")
        return null;
    try {
        return JSON.parse(atob(raw));
    }
    catch {
        return null;
    }
}
/**
 * Check if an MCP error is a payment-required error (-32042).
 */
export function isPaymentRequired(error) {
    return error?.code === MCP_PAYMENT_REQUIRED_CODE;
}
// ─── Client-Side Helpers ──────────────────────────────────────────────────────
/**
 * Parse a -32042 error data block into an MppChallenge.
 */
export function parsePaymentError(errorData) {
    return {
        challengeId: errorData.challengeId || crypto.randomUUID(),
        amountUsd: errorData.amountUsd || errorData.amount || "0",
        accepts: errorData.accepts || ["machina"],
        payee: errorData.payee || "",
        description: errorData.description,
        chains: errorData.chains,
        tokens: errorData.tokens,
        network: errorData.network || "mainnet",
    };
}
/**
 * Encode a credential for MCP _meta transport.
 */
export function encodeMcpCredential(credential) {
    return {
        [MCP_CREDENTIAL_META_KEY]: btoa(JSON.stringify(credential)),
    };
}
// Re-export constants
export { MCP_PAYMENT_REQUIRED_CODE, MCP_CREDENTIAL_META_KEY };
//# sourceMappingURL=mcp.js.map
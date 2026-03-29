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
import type { MppCredential, MppChallenge, PaymentMethodType } from "./types.js";
import { MCP_PAYMENT_REQUIRED_CODE, MCP_CREDENTIAL_META_KEY } from "./types.js";
/**
 * Create an MCP JSON-RPC -32042 error for a paid tool call.
 * Throw this from your MCP tool handler to require payment.
 */
export declare function requirePayment(opts: {
    serviceId: string;
    priceUsd: string;
    paymentAddress: string;
    description?: string;
    acceptedMethods?: PaymentMethodType[];
    chains?: string[];
    tokens?: string[];
    network?: "mainnet" | "testnet";
}): {
    code: number;
    message: string;
    data: Record<string, unknown>;
};
/**
 * Extract an MPP credential from MCP request _meta.
 * Returns null if no credential is present.
 */
export declare function extractMcpCredential(meta: Record<string, unknown> | undefined | null): MppCredential | null;
/**
 * Check if an MCP error is a payment-required error (-32042).
 */
export declare function isPaymentRequired(error: {
    code?: number;
} | null | undefined): boolean;
/**
 * Parse a -32042 error data block into an MppChallenge.
 */
export declare function parsePaymentError(errorData: Record<string, unknown>): MppChallenge;
/**
 * Encode a credential for MCP _meta transport.
 */
export declare function encodeMcpCredential(credential: MppCredential): Record<string, string>;
export { MCP_PAYMENT_REQUIRED_CODE, MCP_CREDENTIAL_META_KEY };
//# sourceMappingURL=mcp.d.ts.map
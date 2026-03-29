/**
 * @machina/mpp — MPP Client
 *
 * Policy-governed MPP client. Wraps fetch() with automatic 402 handling:
 *   1. Agent calls fetch('/api/service')
 *   2. Server returns 402 + MPP Challenge
 *   3. MACHINA policy engine evaluates: budget, compliance, approval
 *   4. If approved → generate credential → retry with payment
 *   5. If denied → reject with policy violation
 *   6. Receipt logged to MACHINA audit trail
 *
 * Key differentiator: Stripe/Tempo MPP = dumb pipe. MACHINA MPP = governed pipe.
 */
import type { MachinaMppClientConfig, MppChallenge, MppCredential, PolicyEvaluation } from "./types.js";
export declare class MachinaMppClient {
    private config;
    constructor(config: MachinaMppClientConfig);
    /**
     * MPP-aware fetch. Automatically handles 402 challenges by:
     * 1. Evaluating payment against MACHINA policy engine
     * 2. Generating a credential if approved
     * 3. Retrying the request with the credential
     */
    fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
    /**
     * Parse a 402 response into an MppChallenge.
     * Supports both header-based and body-based challenges.
     */
    parseChallenge(response: Response): Promise<MppChallenge | null>;
    private parseAcceptedMethods;
    /**
     * Evaluate a payment challenge against the MACHINA policy engine.
     * This is where MACHINA adds value over vanilla MPP — governance.
     */
    evaluatePolicy(challenge: MppChallenge): Promise<PolicyEvaluation>;
    /**
     * Generate an MPP credential after policy approval.
     * If a signer is configured, the credential is cryptographically signed.
     */
    generateCredential(challenge: MppChallenge, policyEval: PolicyEvaluation): Promise<MppCredential>;
    private parseReceipt;
    /**
     * Log a receipt to the MACHINA audit trail.
     */
    private logReceipt;
    /**
     * Handle MCP -32042 (Payment Required) error by evaluating policy
     * and returning a credential for `_meta['org.paymentauth/credential']`.
     *
     * Usage in MCP tool call:
     *   const result = await client.callTool("search", { query: "..." });
     *   if (result.error?.code === -32042) {
     *     const credential = await mppClient.handleMcpPayment(result.error.data);
     *     // Retry with credential in _meta
     *   }
     */
    handleMcpPayment(errorData: Record<string, unknown>): Promise<{
        credential: string;
        meta: Record<string, unknown>;
    } | {
        error: string;
    }>;
    private encodeCredential;
    private credentialMessage;
    private bytesToHex;
}
/**
 * Create an MPP-aware fetch function.
 * Drop-in replacement for fetch() that auto-handles 402 challenges.
 *
 * @example
 * ```typescript
 * const fetch = createMppFetch({
 *   apiUrl: "https://api.machina.money",
 *   agentId: "0x1234...",
 *   walletAddress: "0x5678...",
 *   signer: mySignerFn,
 * });
 *
 * // Automatically handles 402 → policy check → credential → retry
 * const res = await fetch("https://fal.machina.money/v1/generate");
 * ```
 */
export declare function createMppFetch(config: MachinaMppClientConfig): typeof globalThis.fetch;
//# sourceMappingURL=client.d.ts.map
/**
 * @machina/mpp — MPP Server
 *
 * Server-side credential verification and challenge generation.
 * Services use this to:
 *   1. Generate 402 challenges with pricing info
 *   2. Verify incoming MPP credentials
 *   3. Generate receipts after service delivery
 *   4. Support dual protocol (x402 + MPP)
 */
import type { MachinaMppServerConfig, MppCredential, MppReceipt } from "./types.js";
export declare class MachinaMppServer {
    private config;
    constructor(config: MachinaMppServerConfig);
    /**
     * Generate a 402 Payment Required challenge.
     * Returns headers and body for the 402 response.
     */
    generateChallenge(opts?: {
        description?: string;
        customPrice?: string;
        expiresInMs?: number;
    }): {
        status: 402;
        headers: Record<string, string>;
        body: Record<string, unknown>;
    };
    /**
     * Extract credential from request headers.
     * Supports both MPP credential header and x402 payment header.
     */
    extractCredential(headers: {
        get(name: string): string | null | undefined;
    }): MppCredential | null;
    /**
     * Verify an MPP credential.
     * Checks: expiry, amount, payee match, and optionally verifies with MACHINA API.
     */
    verifyCredential(credential: MppCredential): Promise<{
        valid: boolean;
        reason?: string;
    }>;
    /**
     * Generate a payment receipt after successful service delivery.
     */
    generateReceipt(credential: MppCredential): MppReceipt;
    /**
     * Encode a receipt for the response header.
     */
    encodeReceipt(receipt: MppReceipt): string;
    /**
     * Generate an MCP JSON-RPC -32042 error response for a paid tool call.
     */
    generateMcpPaymentError(opts?: {
        description?: string;
        customPrice?: string;
    }): {
        code: number;
        message: string;
        data: Record<string, unknown>;
    };
}
//# sourceMappingURL=server.d.ts.map
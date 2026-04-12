/**
 * @machina/mpp -- MPP Server
 *
 * Server-side credential verification and challenge generation.
 * Services use this to:
 *   1. Generate 402 challenges with pricing info
 *   2. Verify incoming MPP credentials
 *   3. Generate receipts after service delivery
 *   4. Support dual protocol (x402 + MPP)
 */

import type {
  MachinaMppServerConfig,
  MppChallenge,
  MppCredential,
  MppReceipt,
  PaymentMethodType,
} from "./types.js";
import { MPP_HEADERS } from "./types.js";

// ── Server ───────────────────────────────────────────────────────────────────

export class MachinaMppServer {
  private config: Required<
    Pick<
      MachinaMppServerConfig,
      "acceptedMethods" | "acceptedTokens" | "platformFeeRate" | "verifyCredentials" | "network"
    >
  > &
    MachinaMppServerConfig;

  constructor(config: MachinaMppServerConfig) {
    this.config = {
      ...config,
      acceptedMethods: config.acceptedMethods ?? (["machina", "x402"] as PaymentMethodType[]),
      acceptedTokens: config.acceptedTokens ?? ["USDC"],
      platformFeeRate: config.platformFeeRate ?? 0.01,
      verifyCredentials: config.verifyCredentials ?? true,
      network: config.network ?? "mainnet",
    };
  }

  // ── Challenge Generation ───────────────────────────────────────────────

  /**
   * Generate a 402 Payment Required challenge.
   * Returns headers and body for the 402 response.
   */
  generateChallenge(opts?: {
    description?: string;
    customPrice?: string;
    expiresInMs?: number;
  }): { status: 402; headers: Record<string, string>; body: Record<string, unknown> } {
    const challengeId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + (opts?.expiresInMs ?? 300_000)).toISOString();
    const price = opts?.customPrice ?? this.config.pricePerRequestUsd;

    const challenge: MppChallenge = {
      challengeId,
      amountUsd: price,
      accepts: this.config.acceptedMethods,
      payee: this.config.paymentAddress,
      description: opts?.description,
      chains: this.config.acceptedChains,
      tokens: this.config.acceptedTokens,
      expiresAt,
      network: this.config.network,
    };

    const encodedChallenge = btoa(JSON.stringify(challenge));

    return {
      status: 402,
      headers: {
        [MPP_HEADERS.CHALLENGE]: encodedChallenge,
        "Content-Type": "application/json",
      },
      body: {
        error: "Payment required",
        pricing: {
          perRequestUsd: price,
          protocols: this.config.acceptedMethods,
          paymentAddress: this.config.paymentAddress,
          chain: this.config.acceptedChains?.[0] ?? "base",
        },
        mpp: challenge,
        // x402 backwards compatibility
        x402: this.config.acceptedMethods.includes("x402")
          ? {
              accepts: {
                price,
                token: this.config.acceptedTokens[0] ?? "USDC",
                chain: this.config.acceptedChains?.[0] ?? "base",
                payee: this.config.paymentAddress,
              },
            }
          : undefined,
      },
    };
  }

  // ── Credential Extraction ──────────────────────────────────────────────

  /**
   * Extract credential from request headers.
   * Supports both MPP credential header and x402 payment header.
   */
  extractCredential(headers: { get(name: string): string | null | undefined }): MppCredential | null {
    // Try MPP credential header first
    const mppHeader = headers.get(MPP_HEADERS.CREDENTIAL);
    if (mppHeader) {
      try {
        return JSON.parse(atob(mppHeader));
      } catch {
        // Invalid credential
      }
    }

    // Try x402 payment header (backwards compatibility)
    const x402Header = headers.get(MPP_HEADERS.X402_PAYMENT);
    if (x402Header) {
      // x402 sends a tx hash -- wrap it in a minimal credential
      return {
        version: "1",
        method: "x402",
        payer: headers.get(MPP_HEADERS.AGENT_ID) ?? "unknown",
        payee: this.config.paymentAddress,
        amountUsd: this.config.pricePerRequestUsd,
        token: "USDC",
        chain: "base",
        txHash: x402Header,
        signature: "",
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      };
    }

    return null;
  }

  // ── Credential Verification ────────────────────────────────────────────

  /**
   * Verify an MPP credential.
   * Checks: expiry, amount, payee match, and optionally verifies with MACHINA API.
   */
  async verifyCredential(credential: MppCredential): Promise<{ valid: boolean; reason?: string }> {
    // Check expiry
    if (new Date(credential.expiresAt) < new Date()) {
      return { valid: false, reason: "Credential expired" };
    }

    // Check amount
    if (parseFloat(credential.amountUsd) < parseFloat(this.config.pricePerRequestUsd)) {
      return { valid: false, reason: "Insufficient payment amount" };
    }

    // Check payee
    if (credential.payee !== this.config.paymentAddress && credential.payee !== "") {
      return { valid: false, reason: "Payee mismatch" };
    }

    // Check method is accepted
    if (!this.config.acceptedMethods.includes(credential.method)) {
      return { valid: false, reason: `Payment method '${credential.method}' not accepted` };
    }

    // Verify with MACHINA API (optional but recommended)
    if (this.config.verifyCredentials) {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (this.config.apiKey) headers["X-API-Key"] = this.config.apiKey;

        const res = await fetch(`${this.config.apiUrl}/api/mpp/verify-credential`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            serviceId: this.config.serviceId,
            credential,
          }),
        });

        if (res.ok) {
          const result = (await res.json()) as { valid: boolean; reason?: string };
          return result;
        }

        // API error -- fail open for availability
        return { valid: true };
      } catch {
        // Network error -- accept credential based on local checks
        return { valid: true };
      }
    }

    return { valid: true };
  }

  // ── Receipt Generation ─────────────────────────────────────────────────

  /**
   * Generate a payment receipt after successful service delivery.
   */
  generateReceipt(credential: MppCredential): MppReceipt {
    const amount = parseFloat(credential.amountUsd);
    const platformFee = amount * this.config.platformFeeRate;
    const serviceAmount = amount - platformFee;

    const receipt: MppReceipt = {
      receiptId: crypto.randomUUID(),
      credentialId: credential.challengeId,
      service: this.config.serviceId,
      amountUsd: credential.amountUsd,
      platformFeeUsd: platformFee.toFixed(6),
      serviceAmountUsd: serviceAmount.toFixed(6),
      txHash: credential.txHash,
      chain: credential.chain,
      status: credential.txHash ? "confirmed" : "pending",
      settledAt: new Date().toISOString(),
    };

    return receipt;
  }

  /**
   * Encode a receipt for the response header.
   */
  encodeReceipt(receipt: MppReceipt): string {
    return btoa(JSON.stringify(receipt));
  }

  // ── MCP Error Response ─────────────────────────────────────────────────

  /**
   * Generate an MCP JSON-RPC -32042 error response for a paid tool call.
   */
  generateMcpPaymentError(opts?: {
    description?: string;
    customPrice?: string;
  }): { code: number; message: string; data: Record<string, unknown> } {
    const price = opts?.customPrice ?? this.config.pricePerRequestUsd;

    return {
      code: -32042,
      message: "Payment required",
      data: {
        challengeId: crypto.randomUUID(),
        amountUsd: price,
        accepts: this.config.acceptedMethods,
        payee: this.config.paymentAddress,
        description: opts?.description,
        chains: this.config.acceptedChains,
        tokens: this.config.acceptedTokens,
        network: this.config.network,
      },
    };
  }
}

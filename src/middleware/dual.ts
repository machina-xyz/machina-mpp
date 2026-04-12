/**
 * @machina/mpp/middleware/dual -- Dual Protocol Payment Gate (x402 + MPP)
 *
 * Hono middleware that detects which payment protocol the client is using
 * (x402 or MPP) and routes to the appropriate handler. Sits in front of
 * any Cloudflare Worker to gate access behind payment.
 *
 * Protocol detection order:
 *   1. x-mpp-credential header -> MPP protocol
 *   2. x-payment / x-payment-proof / Authorization: x402 -> x402 protocol
 *   3. x-402-payment header -> x402 protocol (legacy)
 *   4. No payment header -> fallback (defaults to MPP challenge format)
 *
 * @example
 * ```typescript
 * import { Hono } from "hono";
 * import { dualProtocolGate } from "@machina-xyz/mpp/middleware/dual";
 *
 * const app = new Hono();
 *
 * app.use("/api/paid/*", dualProtocolGate({
 *   apiUrl: "https://api.machina.money",
 *   serviceId: "my-service",
 *   paymentAddress: "0x1234...",
 *   pricePerRequestUsd: "0.01",
 * }));
 *
 * app.get("/api/paid/data", (c) => {
 *   const credential = c.get("mppCredential");
 *   const protocol = c.get("detectedProtocol");
 *   return c.json({ data: "premium", paidVia: protocol });
 * });
 * ```
 */

import { createMiddleware } from "hono/factory";
import { MachinaMppServer } from "../server.js";
import type { MachinaMppServerConfig, MppCredential, MppReceipt } from "../types.js";
import { MPP_HEADERS, X402_HEADERS } from "../types.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Detected payment protocol */
export type DetectedProtocol = "mpp" | "x402" | "none";

/** Configuration for the dual protocol gate */
export interface DualProtocolGateConfig extends MachinaMppServerConfig {
  /**
   * Protocol to use for 402 challenge format when no protocol is detected.
   * "mpp" returns MPP challenge format, "x402" returns x402 challenge format,
   * "both" returns a challenge body with both formats.
   * Default: "both"
   */
  fallbackChallengeFormat?: "mpp" | "x402" | "both";

  /**
   * Custom policy evaluator. Called after credential verification to run
   * additional policy checks (budget, compliance, rate limiting).
   * Return { approved: true } to allow, or { approved: false, reason } to deny.
   */
  policyEvaluator?: (
    credential: MppCredential,
    protocol: DetectedProtocol,
  ) => Promise<{ approved: boolean; reason?: string }>;
}

type DualProtocolEnv = {
  Variables: {
    mppCredential?: MppCredential;
    mppReceipt?: MppReceipt;
    detectedProtocol?: DetectedProtocol;
  };
};

// ── Protocol Detection ───────────────────────────────────────────────────────

/**
 * Detect which payment protocol the client is using based on request headers.
 */
export function detectProtocol(getHeader: (name: string) => string | null | undefined): DetectedProtocol {
  // 1. Check for MPP credential header
  if (getHeader(MPP_HEADERS.CREDENTIAL)) {
    return "mpp";
  }

  // 2. Check for x402 native headers (X-Payment, X-Payment-Proof, Authorization: x402)
  if (getHeader(X402_HEADERS.PAYMENT)) {
    return "x402";
  }
  if (getHeader(X402_HEADERS.PAYMENT_PROOF)) {
    return "x402";
  }
  const authHeader = getHeader("authorization");
  if (authHeader && authHeader.startsWith(`${X402_HEADERS.AUTHORIZATION_PREFIX} `)) {
    return "x402";
  }

  // 3. Check for legacy x402 payment header
  if (getHeader(MPP_HEADERS.X402_PAYMENT)) {
    return "x402";
  }

  return "none";
}

// ── x402 Credential Extraction ───────────────────────────────────────────────

/**
 * Extract a credential from x402-format headers.
 * Parses X-Payment, X-Payment-Proof, or Authorization: x402 headers into
 * a normalized MppCredential for unified downstream processing.
 */
function extractX402Credential(
  getHeader: (name: string) => string | null | undefined,
  config: DualProtocolGateConfig,
): MppCredential | null {
  // Try X-Payment header (primary x402 header)
  const xPayment = getHeader(X402_HEADERS.PAYMENT);
  if (xPayment) {
    return parseX402Payload(xPayment, getHeader, config);
  }

  // Try X-Payment-Proof header
  const xProof = getHeader(X402_HEADERS.PAYMENT_PROOF);
  if (xProof) {
    return parseX402Payload(xProof, getHeader, config);
  }

  // Try Authorization: x402 <token>
  const authHeader = getHeader("authorization");
  if (authHeader?.startsWith(`${X402_HEADERS.AUTHORIZATION_PREFIX} `)) {
    const token = authHeader.slice(X402_HEADERS.AUTHORIZATION_PREFIX.length + 1);
    return parseX402Payload(token, getHeader, config);
  }

  // Try legacy x-402-payment header (tx hash only)
  const legacyHeader = getHeader(MPP_HEADERS.X402_PAYMENT);
  if (legacyHeader) {
    return {
      version: "1",
      method: "x402",
      payer: getHeader(MPP_HEADERS.AGENT_ID) ?? "unknown",
      payee: config.paymentAddress,
      amountUsd: config.pricePerRequestUsd,
      token: "USDC",
      chain: "base",
      txHash: legacyHeader,
      signature: "",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  }

  return null;
}

/**
 * Parse an x402 payload string (JSON or base64) into an MppCredential.
 */
function parseX402Payload(
  raw: string,
  getHeader: (name: string) => string | null | undefined,
  config: DualProtocolGateConfig,
): MppCredential | null {
  let parsed: Record<string, any> | null = null;

  // Try direct JSON parse
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Try base64 decode then JSON parse
    try {
      parsed = JSON.parse(atob(raw));
    } catch {
      return null;
    }
  }

  if (!parsed) return null;

  // Extract fields from x402 payload (handles nested payload.* and top-level)
  const payload = parsed.payload ?? parsed;
  const amount = payload.amount ?? parsed.amount ?? config.pricePerRequestUsd;
  const payer =
    payload.from ?? payload.payer ?? parsed.from ?? getHeader(MPP_HEADERS.AGENT_ID) ?? "unknown";
  const payee = payload.to ?? payload.payee ?? parsed.to ?? config.paymentAddress;
  const txHash = payload.txHash ?? parsed.txHash ?? parsed.hash;
  const signature = payload.signature ?? parsed.signature ?? "";

  return {
    version: "1",
    method: "x402",
    payer,
    payee,
    amountUsd: String(amount),
    token: payload.token ?? parsed.token ?? "USDC",
    chain: payload.chain ?? parsed.chain ?? "base",
    txHash,
    signature: typeof signature === "string" ? signature : "",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  };
}

// ── 402 Challenge Formatting ─────────────────────────────────────────────────

/**
 * Generate a 402 challenge formatted for x402 protocol.
 * Returns the WWW-Authenticate-style x402 response.
 */
function generateX402Challenge(server: MachinaMppServer, config: DualProtocolGateConfig): {
  headers: Record<string, string>;
  body: Record<string, unknown>;
} {
  const baseChallenge = server.generateChallenge();
  const price = config.pricePerRequestUsd;
  const token = config.acceptedTokens?.[0] ?? "USDC";
  const chain = config.acceptedChains?.[0] ?? "base";

  return {
    headers: {
      ...baseChallenge.headers,
      // x402 spec uses WWW-Authenticate-style header
      "x-payment-required": JSON.stringify({
        price,
        token,
        chain,
        payee: config.paymentAddress,
      }),
    },
    body: {
      error: "Payment required",
      protocol: "x402",
      x402: {
        accepts: {
          price,
          token,
          chain,
          payee: config.paymentAddress,
        },
      },
    },
  };
}

/**
 * Generate a 402 challenge with both MPP and x402 formats in the response.
 */
function generateDualChallenge(server: MachinaMppServer, config: DualProtocolGateConfig): {
  headers: Record<string, string>;
  body: Record<string, unknown>;
} {
  const mppChallenge = server.generateChallenge();
  const price = config.pricePerRequestUsd;
  const token = config.acceptedTokens?.[0] ?? "USDC";
  const chain = config.acceptedChains?.[0] ?? "base";

  return {
    headers: {
      ...mppChallenge.headers,
      "x-payment-required": JSON.stringify({
        price,
        token,
        chain,
        payee: config.paymentAddress,
      }),
    },
    body: {
      ...mppChallenge.body,
      protocols: ["mpp", "x402"],
    },
  };
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Dual protocol payment gate middleware for Hono.
 *
 * Detects whether the client is using x402 or MPP protocol and handles
 * both transparently. Normalizes all credentials into MppCredential format
 * for unified downstream processing.
 *
 * Features:
 * - Auto-detects x402 vs MPP from request headers
 * - Returns 402 challenge in the correct format for the detected protocol
 * - Runs credential verification for both protocols
 * - Optional policy evaluation hook
 * - Generates receipts after successful responses
 * - Falls back to dual-format 402 when no protocol is detected
 */
export function dualProtocolGate(config: DualProtocolGateConfig) {
  const server = new MachinaMppServer(config);
  const fallbackFormat = config.fallbackChallengeFormat ?? "both";

  return createMiddleware<DualProtocolEnv>(async (c, next) => {
    const getHeader = (name: string) => c.req.header(name) ?? null;

    // Detect protocol
    const protocol = detectProtocol(getHeader);
    c.set("detectedProtocol", protocol);

    // ── No payment headers: return 402 challenge ──────────────────────

    if (protocol === "none") {
      let challenge: { headers: Record<string, string>; body: Record<string, unknown> };

      if (fallbackFormat === "x402") {
        challenge = generateX402Challenge(server, config);
      } else if (fallbackFormat === "mpp") {
        const mppChallenge = server.generateChallenge();
        challenge = { headers: mppChallenge.headers, body: mppChallenge.body };
      } else {
        // "both" -- include both formats
        challenge = generateDualChallenge(server, config);
      }

      for (const [key, value] of Object.entries(challenge.headers)) {
        c.header(key, value);
      }
      return c.json(challenge.body, 402);
    }

    // ── Extract credential based on detected protocol ─────────────────

    let credential: MppCredential | null = null;

    if (protocol === "mpp") {
      credential = server.extractCredential({
        get: getHeader,
      });
    } else if (protocol === "x402") {
      credential = extractX402Credential(getHeader, config);
    }

    if (!credential) {
      // Had protocol headers but couldn't parse credential
      const errorBody: Record<string, unknown> = {
        error: "Invalid payment credential",
        protocol,
        reason: "Could not parse credential from request headers",
      };
      return c.json(errorBody, 402);
    }

    // ── Verify credential ─────────────────────────────────────────────

    const verification = await server.verifyCredential(credential);
    if (!verification.valid) {
      return c.json(
        {
          error: "Invalid payment credential",
          protocol,
          reason: verification.reason,
        },
        402,
      );
    }

    // ── Policy evaluation (optional) ──────────────────────────────────

    if (config.policyEvaluator) {
      const policyResult = await config.policyEvaluator(credential, protocol);
      if (!policyResult.approved) {
        return c.json(
          {
            error: "Payment blocked by policy",
            protocol,
            reason: policyResult.reason,
          },
          403,
        );
      }
    }

    // ── Store credential and continue ─────────────────────────────────

    c.set("mppCredential", credential);

    await next();

    // Generate receipt after successful response
    if (c.res.status >= 200 && c.res.status < 300) {
      const receipt = server.generateReceipt(credential);
      c.set("mppReceipt", receipt);
      c.header(MPP_HEADERS.RECEIPT, server.encodeReceipt(receipt));
    }
  });
}

export type { DualProtocolGateConfig, DualProtocolEnv };

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

import type {
  MachinaMppClientConfig,
  MppChallenge,
  MppCredential,
  MppReceipt,
  PolicyEvaluation,
  PaymentMethodType,
} from "./types.js";
import { MPP_HEADERS, MCP_PAYMENT_REQUIRED_CODE, MCP_CREDENTIAL_META_KEY } from "./types.js";

// ─── Client ───────────────────────────────────────────────────────────────────

export class MachinaMppClient {
  private config: Required<
    Pick<MachinaMppClientConfig, "apiUrl" | "agentId" | "autoHandle402" | "maxAutoPayUsd">
  > & MachinaMppClientConfig;

  constructor(config: MachinaMppClientConfig) {
    this.config = {
      ...config,
      autoHandle402: config.autoHandle402 ?? true,
      maxAutoPayUsd: config.maxAutoPayUsd ?? "1.00",
      defaultMethod: config.defaultMethod ?? "machina",
      defaultChain: config.defaultChain ?? "base",
      defaultToken: config.defaultToken ?? "USDC",
    };
  }

  /**
   * MPP-aware fetch. Automatically handles 402 challenges by:
   * 1. Evaluating payment against MACHINA policy engine
   * 2. Generating a credential if approved
   * 3. Retrying the request with the credential
   */
  async fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const fetchFn = this.config.fetch ?? globalThis.fetch;

    // Add agent identity header
    const headers = new Headers(init?.headers);
    headers.set(MPP_HEADERS.AGENT_ID, this.config.agentId);

    const response = await fetchFn(input, { ...init, headers });

    // Not a payment challenge — return as-is
    if (response.status !== 402 || !this.config.autoHandle402) {
      return response;
    }

    // Parse 402 challenge
    const challenge = await this.parseChallenge(response);
    if (!challenge) {
      return response; // Can't parse — return original 402
    }

    // Check auto-pay limit
    const amount = parseFloat(challenge.amountUsd);
    if (amount > parseFloat(this.config.maxAutoPayUsd)) {
      return response; // Over auto-pay limit — let caller handle
    }

    // Evaluate against MACHINA policy engine
    const policyEval = await this.evaluatePolicy(challenge);
    if (!policyEval.approved) {
      // Return a synthetic 403 with policy violation details
      return new Response(JSON.stringify({
        error: "Payment blocked by policy",
        reason: policyEval.reason,
        rulesBlocked: policyEval.rulesBlocked,
        requiresApproval: policyEval.requiresApproval,
        approvalRequestId: policyEval.approvalRequestId,
      }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }

    // Generate credential
    const credential = await this.generateCredential(challenge, policyEval);

    // Retry with credential
    const retryHeaders = new Headers(init?.headers);
    retryHeaders.set(MPP_HEADERS.AGENT_ID, this.config.agentId);
    retryHeaders.set(MPP_HEADERS.CREDENTIAL, this.encodeCredential(credential));

    // Also set x402 header for backwards compatibility
    if (credential.txHash) {
      retryHeaders.set(MPP_HEADERS.X402_PAYMENT, credential.txHash);
    }

    const retryResponse = await fetchFn(input, { ...init, headers: retryHeaders });

    // Parse receipt if present
    const receiptHeader = retryResponse.headers.get(MPP_HEADERS.RECEIPT);
    if (receiptHeader) {
      const receipt = this.parseReceipt(receiptHeader);
      if (receipt) {
        await this.logReceipt(receipt, credential);
      }
    }

    return retryResponse;
  }

  // ─── Challenge Parsing ────────────────────────────────────────────────────

  /**
   * Parse a 402 response into an MppChallenge.
   * Supports both header-based and body-based challenges.
   */
  async parseChallenge(response: Response): Promise<MppChallenge | null> {
    // Try header first
    const challengeHeader = response.headers.get(MPP_HEADERS.CHALLENGE);
    if (challengeHeader) {
      try {
        return JSON.parse(atob(challengeHeader));
      } catch {
        // Fall through to body parsing
      }
    }

    // Try body
    try {
      const body = await response.clone().json();
      if (body.pricing || body.x402 || body.mpp) {
        return {
          challengeId: body.challengeId || body.mpp?.challengeId || crypto.randomUUID(),
          amountUsd: body.pricing?.perRequestUsd || body.x402?.accepts?.price || body.mpp?.amountUsd || "0",
          accepts: this.parseAcceptedMethods(body),
          payee: body.pricing?.paymentAddress || body.x402?.accepts?.payee || body.mpp?.payee || "",
          description: body.description || body.mpp?.description,
          chains: body.pricing?.chain ? [body.pricing.chain] : body.mpp?.chains,
          tokens: body.x402?.accepts?.token ? [body.x402.accepts.token] : body.mpp?.tokens,
          network: body.network || body.mpp?.network || "mainnet",
        };
      }
    } catch {
      // Not JSON
    }

    return null;
  }

  private parseAcceptedMethods(body: any): PaymentMethodType[] {
    if (body.mpp?.accepts) return body.mpp.accepts;
    const methods: PaymentMethodType[] = [];
    if (body.pricing?.protocols) {
      for (const p of body.pricing.protocols) {
        if (p === "x402") methods.push("x402");
        else if (p === "mpp") methods.push("machina");
        else if (p === "both") { methods.push("x402"); methods.push("machina"); }
      }
    }
    if (methods.length === 0) methods.push("machina", "x402");
    return methods;
  }

  // ─── Policy Evaluation ────────────────────────────────────────────────────

  /**
   * Evaluate a payment challenge against the MACHINA policy engine.
   * This is where MACHINA adds value over vanilla MPP — governance.
   */
  async evaluatePolicy(challenge: MppChallenge): Promise<PolicyEvaluation> {
    try {
      const fetchFn = this.config.fetch ?? globalThis.fetch;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.config.apiKey) headers["X-API-Key"] = this.config.apiKey;

      const res = await fetchFn(`${this.config.apiUrl}/api/mpp/evaluate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          agentId: this.config.agentId,
          challenge,
          method: this.config.defaultMethod,
          chain: this.config.defaultChain,
          token: this.config.defaultToken,
          walletAddress: this.config.walletAddress,
        }),
      });

      if (res.ok) {
        return await res.json() as PolicyEvaluation;
      }

      // API error — fail closed (deny payment)
      return {
        evalId: crypto.randomUUID(),
        approved: false,
        agentId: this.config.agentId,
        reason: `Policy evaluation failed: ${res.status}`,
        rulesEvaluated: [],
        rulesBlocked: ["api_error"],
        requiresApproval: false,
        complianceChecks: {
          sanctionsScreening: "unavailable",
          travelRule: "unavailable",
          budgetLimit: "no_limit",
          rateLimit: "pass",
        },
        evaluatedAt: new Date().toISOString(),
      };
    } catch (err) {
      // Network error — fail closed
      return {
        evalId: crypto.randomUUID(),
        approved: false,
        agentId: this.config.agentId,
        reason: `Policy evaluation unavailable: ${err instanceof Error ? err.message : "unknown"}`,
        rulesEvaluated: [],
        rulesBlocked: ["network_error"],
        requiresApproval: false,
        complianceChecks: {
          sanctionsScreening: "unavailable",
          travelRule: "unavailable",
          budgetLimit: "no_limit",
          rateLimit: "pass",
        },
        evaluatedAt: new Date().toISOString(),
      };
    }
  }

  // ─── Credential Generation ────────────────────────────────────────────────

  /**
   * Generate an MPP credential after policy approval.
   * If a signer is configured, the credential is cryptographically signed.
   */
  async generateCredential(
    challenge: MppChallenge,
    policyEval: PolicyEvaluation,
  ): Promise<MppCredential> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 min expiry

    const credential: MppCredential = {
      version: "1",
      method: this.config.defaultMethod ?? "machina",
      payer: this.config.walletAddress ?? this.config.agentId,
      payee: challenge.payee,
      amountUsd: challenge.amountUsd,
      token: this.config.defaultToken ?? "USDC",
      chain: this.config.defaultChain ?? "base",
      signature: "",
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      challengeId: challenge.challengeId,
      policyEvalId: policyEval.evalId,
    };

    // Sign credential if signer is available
    if (this.config.signer) {
      const message = this.credentialMessage(credential);
      const sig = await this.config.signer(message);
      credential.signature = this.bytesToHex(sig);
    } else {
      // Request signature from MACHINA API (server-side signing)
      try {
        const fetchFn = this.config.fetch ?? globalThis.fetch;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (this.config.apiKey) headers["X-API-Key"] = this.config.apiKey;

        const res = await fetchFn(`${this.config.apiUrl}/api/mpp/sign-credential`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            agentId: this.config.agentId,
            credential,
            policyEvalId: policyEval.evalId,
          }),
        });

        if (res.ok) {
          const signed = await res.json() as { signature: string; txHash?: string };
          credential.signature = signed.signature;
          if (signed.txHash) credential.txHash = signed.txHash;
        }
      } catch {
        // Signing failed — credential will be unsigned
      }
    }

    return credential;
  }

  // ─── Receipt Handling ─────────────────────────────────────────────────────

  private parseReceipt(header: string): MppReceipt | null {
    try {
      return JSON.parse(atob(header));
    } catch {
      return null;
    }
  }

  /**
   * Log a receipt to the MACHINA audit trail.
   */
  private async logReceipt(receipt: MppReceipt, credential: MppCredential): Promise<void> {
    try {
      const fetchFn = this.config.fetch ?? globalThis.fetch;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.config.apiKey) headers["X-API-Key"] = this.config.apiKey;

      await fetchFn(`${this.config.apiUrl}/api/mpp/receipts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          agentId: this.config.agentId,
          receipt,
          credential: {
            method: credential.method,
            payer: credential.payer,
            payee: credential.payee,
            amountUsd: credential.amountUsd,
            chain: credential.chain,
            token: credential.token,
            txHash: credential.txHash,
            policyEvalId: credential.policyEvalId,
          },
        }),
      });
    } catch {
      // Best-effort logging — don't block the response
    }
  }

  // ─── MCP Integration ──────────────────────────────────────────────────────

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
  async handleMcpPayment(
    errorData: Record<string, unknown>,
  ): Promise<{ credential: string; meta: Record<string, unknown> } | { error: string }> {
    const challenge: MppChallenge = {
      challengeId: (errorData.challengeId as string) || crypto.randomUUID(),
      amountUsd: (errorData.amountUsd as string) || (errorData.amount as string) || "0",
      accepts: (errorData.accepts as PaymentMethodType[]) || ["machina"],
      payee: (errorData.payee as string) || "",
      description: errorData.description as string | undefined,
      chains: errorData.chains as string[] | undefined,
      tokens: errorData.tokens as string[] | undefined,
    };

    const policyEval = await this.evaluatePolicy(challenge);
    if (!policyEval.approved) {
      return { error: policyEval.reason || "Payment denied by policy" };
    }

    const credential = await this.generateCredential(challenge, policyEval);
    const encoded = this.encodeCredential(credential);

    return {
      credential: encoded,
      meta: {
        [MCP_CREDENTIAL_META_KEY]: encoded,
      },
    };
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  private encodeCredential(credential: MppCredential): string {
    return btoa(JSON.stringify(credential));
  }

  private credentialMessage(credential: MppCredential): Uint8Array {
    const msg = `mpp:v1:${credential.payer}:${credential.payee}:${credential.amountUsd}:${credential.token}:${credential.chain}:${credential.issuedAt}`;
    return new TextEncoder().encode(msg);
  }

  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  }
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
export function createMppFetch(config: MachinaMppClientConfig): typeof globalThis.fetch {
  const client = new MachinaMppClient(config);
  return (input: string | URL | Request, init?: RequestInit) => client.fetch(input, init);
}

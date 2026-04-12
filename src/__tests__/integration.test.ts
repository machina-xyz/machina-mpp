/**
 * Integration test: MachinaMppServer + MachinaMppClient
 *
 * Verifies the full MPP flow in-memory:
 *   1. Server generates a 402 challenge
 *   2. Client receives 402, parses challenge
 *   3. Client evaluates policy (mocked as approved)
 *   4. Client generates credential and retries with it
 *   5. Server extracts and verifies the credential
 *   6. Server generates a receipt
 *   7. Client receives the final 200 response
 */
import { describe, it, expect, vi } from "vitest";
import { MachinaMppClient } from "../client.js";
import { MachinaMppServer } from "../server.js";
import { MPP_HEADERS } from "../types.js";
import type { MppCredential, PolicyEvaluation } from "../types.js";

describe("MPP Client/Server Integration", () => {
  const serverConfig = {
    apiUrl: "https://api.machina.money",
    serviceId: "test-service",
    paymentAddress: "0xServicePayee",
    pricePerRequestUsd: "0.05",
    verifyCredentials: false, // skip remote verification for in-memory test
  };

  const clientConfig = {
    apiUrl: "https://api.machina.money",
    agentId: "agent-integration-test",
    walletAddress: "0xAgentWallet",
    maxAutoPayUsd: "1.00",
  };

  it("completes the full request -> 402 -> credential -> retry flow", async () => {
    const server = new MachinaMppServer(serverConfig);

    // Simulate an in-memory HTTP server that returns 402 initially, then 200 with receipt
    let requestCount = 0;
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const headers = new Headers(init?.headers);

      // Policy evaluation endpoint (MACHINA API)
      if (url.includes("/api/mpp/evaluate")) {
        const policyResult: PolicyEvaluation = {
          evalId: "eval-integration-1",
          approved: true,
          agentId: clientConfig.agentId,
          rulesEvaluated: ["budget", "rate_limit"],
          rulesBlocked: [],
          requiresApproval: false,
          complianceChecks: {
            sanctionsScreening: "pass",
            travelRule: "not_required",
            budgetLimit: "pass",
            rateLimit: "pass",
          },
          evaluatedAt: new Date().toISOString(),
        };
        return new Response(JSON.stringify(policyResult), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Credential signing endpoint (MACHINA API)
      if (url.includes("/api/mpp/sign-credential")) {
        return new Response(JSON.stringify({ signature: "0xintegration_sig" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Receipt logging endpoint (MACHINA API)
      if (url.includes("/api/mpp/receipts")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // The actual service endpoint
      requestCount++;

      // First request: no credential -> return 402 challenge
      const credential = server.extractCredential({
        get: (name: string) => headers.get(name),
      });

      if (!credential) {
        const challenge = server.generateChallenge({
          description: "Access to premium API",
        });
        return new Response(JSON.stringify(challenge.body), {
          status: challenge.status,
          headers: challenge.headers,
        });
      }

      // Retry request: has credential -> verify and return 200
      const verification = await server.verifyCredential(credential);
      if (!verification.valid) {
        return new Response(JSON.stringify({ error: verification.reason }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Generate receipt and include in response
      const receipt = server.generateReceipt(credential);
      const encodedReceipt = server.encodeReceipt(receipt);

      return new Response(JSON.stringify({ data: "premium content", paid: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          [MPP_HEADERS.RECEIPT]: encodedReceipt,
        },
      });
    });

    // Create client with the mock fetch
    const client = new MachinaMppClient({
      ...clientConfig,
      fetch: mockFetch as unknown as typeof globalThis.fetch,
    });

    // Make the request - client should handle the 402 automatically
    const response = await client.fetch("https://premium-api.example.com/data");

    // Verify we got a successful response
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBe("premium content");
    expect(body.paid).toBe(true);

    // Verify the flow: original 402, policy eval, sign credential, retry 200, receipt log
    // mockFetch should have been called multiple times:
    // 1. Original request -> 402
    // 2. Policy evaluation
    // 3. Credential signing
    // 4. Retry with credential -> 200
    // 5. Receipt logging
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(4);

    // Verify the service endpoint was hit twice (initial 402 + retry 200)
    expect(requestCount).toBe(2);

    // Verify agent ID header was sent
    const firstCallHeaders = new Headers(mockFetch.mock.calls[0][1]?.headers);
    expect(firstCallHeaders.get(MPP_HEADERS.AGENT_ID)).toBe(clientConfig.agentId);
  });

  it("server generates valid challenge and client can parse it", async () => {
    const server = new MachinaMppServer(serverConfig);
    const challenge = server.generateChallenge({ description: "Test endpoint" });

    // Verify challenge structure
    expect(challenge.status).toBe(402);
    expect(challenge.headers[MPP_HEADERS.CHALLENGE]).toBeDefined();
    expect(challenge.body.pricing).toBeDefined();
    expect(challenge.body.mpp).toBeDefined();

    // Create a Response from the challenge
    const response = new Response(JSON.stringify(challenge.body), {
      status: challenge.status,
      headers: challenge.headers,
    });

    // Client should be able to parse it
    const client = new MachinaMppClient(clientConfig);
    const parsed = await client.parseChallenge(response);

    expect(parsed).not.toBeNull();
    expect(parsed!.amountUsd).toBe("0.05");
    expect(parsed!.payee).toBe("0xServicePayee");
    expect(parsed!.accepts).toContain("machina");
    expect(parsed!.challengeId).toBeDefined();
  });

  it("server verifies client-generated credential", async () => {
    const server = new MachinaMppServer(serverConfig);

    // Generate a valid credential as the client would
    const credential: MppCredential = {
      version: "1",
      method: "machina",
      payer: "0xAgentWallet",
      payee: "0xServicePayee",
      amountUsd: "0.05",
      token: "USDC",
      chain: "base",
      signature: "0xtest_sig",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      challengeId: "ch-test",
      policyEvalId: "eval-test",
    };

    // Server should verify it
    const result = await server.verifyCredential(credential);
    expect(result.valid).toBe(true);
  });

  it("server rejects credential with wrong payee", async () => {
    const server = new MachinaMppServer(serverConfig);

    const credential: MppCredential = {
      version: "1",
      method: "machina",
      payer: "0xAgentWallet",
      payee: "0xWrongPayee",
      amountUsd: "0.05",
      token: "USDC",
      chain: "base",
      signature: "0xtest_sig",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };

    const result = await server.verifyCredential(credential);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Payee mismatch");
  });

  it("server generates receipt with correct fee calculation", () => {
    const server = new MachinaMppServer({
      ...serverConfig,
      platformFeeRate: 0.02, // 2%
    });

    const credential: MppCredential = {
      version: "1",
      method: "machina",
      payer: "0xAgentWallet",
      payee: "0xServicePayee",
      amountUsd: "1.00",
      token: "USDC",
      chain: "base",
      signature: "0xtest_sig",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      txHash: "0xtx_hash",
    };

    const receipt = server.generateReceipt(credential);
    expect(receipt.service).toBe("test-service");
    expect(receipt.amountUsd).toBe("1.00");
    expect(receipt.platformFeeUsd).toBe("0.020000");
    expect(receipt.serviceAmountUsd).toBe("0.980000");
    expect(receipt.status).toBe("confirmed");
    expect(receipt.txHash).toBe("0xtx_hash");

    // Encode and decode receipt
    const encoded = server.encodeReceipt(receipt);
    const decoded = JSON.parse(atob(encoded));
    expect(decoded.receiptId).toBe(receipt.receiptId);
  });

  it("client skips auto-pay when amount exceeds maxAutoPayUsd", async () => {
    const server = new MachinaMppServer({
      ...serverConfig,
      pricePerRequestUsd: "5.00", // Exceeds client's $1.00 limit
    });

    const challenge = server.generateChallenge();

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(challenge.body), {
        status: challenge.status,
        headers: challenge.headers,
      }),
    );

    const client = new MachinaMppClient({
      ...clientConfig,
      maxAutoPayUsd: "1.00",
      fetch: mockFetch as unknown as typeof globalThis.fetch,
    });

    const response = await client.fetch("https://expensive-api.example.com/data");

    // Should return the 402 as-is since $5.00 > $1.00 limit
    expect(response.status).toBe(402);
    // Only the original request, no retry
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("client returns 403 when policy denies payment", async () => {
    const server = new MachinaMppServer(serverConfig);
    const challenge = server.generateChallenge();

    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/api/mpp/evaluate")) {
        // Policy denies the payment
        const policyResult: PolicyEvaluation = {
          evalId: "eval-denied",
          approved: false,
          agentId: clientConfig.agentId,
          reason: "Budget exceeded for this billing period",
          rulesEvaluated: ["budget"],
          rulesBlocked: ["budget_limit"],
          requiresApproval: false,
          complianceChecks: {
            sanctionsScreening: "pass",
            travelRule: "not_required",
            budgetLimit: "fail",
            rateLimit: "pass",
          },
          evaluatedAt: new Date().toISOString(),
        };
        return new Response(JSON.stringify(policyResult), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Return the 402 challenge
      return new Response(JSON.stringify(challenge.body), {
        status: challenge.status,
        headers: challenge.headers,
      });
    });

    const client = new MachinaMppClient({
      ...clientConfig,
      fetch: mockFetch as unknown as typeof globalThis.fetch,
    });

    const response = await client.fetch("https://premium-api.example.com/data");

    // Should return a synthetic 403 with policy violation details
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Payment blocked by policy");
    expect(body.reason).toContain("Budget exceeded");
  });

  it("handles the full MCP payment required flow", async () => {
    const server = new MachinaMppServer(serverConfig);

    // Server generates MCP -32042 error
    const mcpError = server.generateMcpPaymentError({
      description: "Search tool requires payment",
    });
    expect(mcpError.code).toBe(-32042);
    expect(mcpError.message).toBe("Payment required");
    expect(mcpError.data.amountUsd).toBe("0.05");
    expect(mcpError.data.payee).toBe("0xServicePayee");

    // Client handles the MCP error
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/api/mpp/evaluate")) {
        return new Response(JSON.stringify({
          evalId: "eval-mcp",
          approved: true,
          agentId: clientConfig.agentId,
          rulesEvaluated: ["budget"],
          rulesBlocked: [],
          requiresApproval: false,
          complianceChecks: {
            sanctionsScreening: "pass",
            travelRule: "not_required",
            budgetLimit: "pass",
            rateLimit: "pass",
          },
          evaluatedAt: new Date().toISOString(),
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/api/mpp/sign-credential")) {
        return new Response(JSON.stringify({ signature: "0xmcp_sig" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("ok", { status: 200 });
    });

    const client = new MachinaMppClient({
      ...clientConfig,
      fetch: mockFetch as unknown as typeof globalThis.fetch,
    });

    const result = await client.handleMcpPayment(mcpError.data);

    // Should return a credential
    expect("credential" in result).toBe(true);
    if ("credential" in result) {
      expect(result.credential).toBeDefined();
      expect(result.meta["org.paymentauth/credential"]).toBe(result.credential);

      // Decode the credential and verify
      const decoded = JSON.parse(atob(result.credential)) as MppCredential;
      expect(decoded.version).toBe("1");
      expect(decoded.payee).toBe("0xServicePayee");
      expect(decoded.amountUsd).toBe("0.05");

      // Server should be able to extract and verify this credential
      const headers = {
        get: (name: string) =>
          name === MPP_HEADERS.CREDENTIAL ? result.credential : null,
      };
      const extracted = server.extractCredential(headers);
      expect(extracted).not.toBeNull();
      expect(extracted!.payee).toBe("0xServicePayee");

      const verification = await server.verifyCredential(extracted!);
      expect(verification.valid).toBe(true);
    }
  });
});

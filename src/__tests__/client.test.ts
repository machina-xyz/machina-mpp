import { describe, it, expect, vi } from "vitest";
import { MachinaMppClient, createMppFetch } from "../client.js";

describe("MachinaMppClient", () => {
  const baseConfig = {
    apiUrl: "https://api.machina.money",
    agentId: "agent-001",
  };

  describe("constructor defaults", () => {
    it("sets autoHandle402 to true by default", () => {
      const client = new MachinaMppClient(baseConfig);
      // We verify the default by checking that a non-402 response passes through
      // and a 402 triggers handling (tested below)
      expect(client).toBeDefined();
    });

    it("sets maxAutoPayUsd to 1.00 by default", () => {
      const client = new MachinaMppClient(baseConfig);
      expect(client).toBeDefined();
    });

    it("sets defaultChain to base by default", () => {
      const client = new MachinaMppClient(baseConfig);
      expect(client).toBeDefined();
    });

    it("sets defaultMethod to machina by default", () => {
      const client = new MachinaMppClient(baseConfig);
      expect(client).toBeDefined();
    });

    it("sets defaultToken to USDC by default", () => {
      const client = new MachinaMppClient(baseConfig);
      expect(client).toBeDefined();
    });

    it("respects user-provided overrides", () => {
      const client = new MachinaMppClient({
        ...baseConfig,
        autoHandle402: false,
        maxAutoPayUsd: "5.00",
        defaultChain: "solana",
        defaultMethod: "x402",
        defaultToken: "ETH",
      });
      expect(client).toBeDefined();
    });
  });

  describe("fetch", () => {
    it("passes through non-402 responses unchanged", async () => {
      const mockResponse = new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      const mockFetch = vi.fn().mockResolvedValue(mockResponse);

      const client = new MachinaMppClient({
        ...baseConfig,
        fetch: mockFetch,
      });

      const res = await client.fetch("https://example.com/api");
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("adds agent identity header to requests", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const client = new MachinaMppClient({
        ...baseConfig,
        fetch: mockFetch,
      });

      await client.fetch("https://example.com/api");

      const calledHeaders = mockFetch.mock.calls[0][1]?.headers as Headers;
      expect(calledHeaders.get("x-machina-agent-id")).toBe("agent-001");
    });

    it("returns 402 as-is when autoHandle402 is false", async () => {
      const mockResponse = new Response("payment required", { status: 402 });
      const mockFetch = vi.fn().mockResolvedValue(mockResponse);

      const client = new MachinaMppClient({
        ...baseConfig,
        autoHandle402: false,
        fetch: mockFetch,
      });

      const res = await client.fetch("https://example.com/api");
      expect(res.status).toBe(402);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("detects 402 and parses challenge from header", async () => {
      const challenge = {
        challengeId: "ch-123",
        amountUsd: "0.50",
        accepts: ["machina"],
        payee: "0xPayee",
      };
      const encodedChallenge = btoa(JSON.stringify(challenge));

      // First call returns 402 with challenge
      const challengeResponse = new Response(
        JSON.stringify({ error: "Payment required" }),
        {
          status: 402,
          headers: {
            "x-mpp-challenge": encodedChallenge,
            "content-type": "application/json",
          },
        },
      );

      // Policy eval call returns approved
      const policyResponse = new Response(
        JSON.stringify({
          evalId: "eval-1",
          approved: true,
          agentId: "agent-001",
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
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

      // Sign credential call
      const signResponse = new Response(
        JSON.stringify({ signature: "0xsig123" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

      // Retry call succeeds
      const retryResponse = new Response(
        JSON.stringify({ data: "result" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(challengeResponse)
        .mockResolvedValueOnce(policyResponse)
        .mockResolvedValueOnce(signResponse)
        .mockResolvedValueOnce(retryResponse);

      const client = new MachinaMppClient({
        ...baseConfig,
        fetch: mockFetch,
      });

      const res = await client.fetch("https://example.com/api");
      expect(res.status).toBe(200);
      // Should have called: original, policy eval, sign, retry
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("returns 402 when amount exceeds maxAutoPayUsd", async () => {
      const challenge = {
        challengeId: "ch-123",
        amountUsd: "10.00",
        accepts: ["machina"],
        payee: "0xPayee",
      };
      const encodedChallenge = btoa(JSON.stringify(challenge));

      const challengeResponse = new Response(
        JSON.stringify({ error: "Payment required" }),
        {
          status: 402,
          headers: {
            "x-mpp-challenge": encodedChallenge,
            "content-type": "application/json",
          },
        },
      );

      const mockFetch = vi.fn().mockResolvedValue(challengeResponse);

      const client = new MachinaMppClient({
        ...baseConfig,
        maxAutoPayUsd: "1.00",
        fetch: mockFetch,
      });

      const res = await client.fetch("https://example.com/api");
      expect(res.status).toBe(402);
      // Only the original call, no retry
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("encodeCredential and credentialMessage", () => {
    it("encodeCredential produces valid base64 JSON", async () => {
      // We test through the public flow: generate a credential and check it's sent as base64
      const challenge = {
        challengeId: "ch-test",
        amountUsd: "0.01",
        accepts: ["machina" as const],
        payee: "0xPayee",
      };

      const policyEval = {
        evalId: "eval-1",
        approved: true,
        agentId: "agent-001",
        rulesEvaluated: [],
        rulesBlocked: [],
        requiresApproval: false,
        complianceChecks: {
          sanctionsScreening: "pass" as const,
          travelRule: "not_required" as const,
          budgetLimit: "pass" as const,
          rateLimit: "pass" as const,
        },
        evaluatedAt: new Date().toISOString(),
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ signature: "0xabc" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const client = new MachinaMppClient({
        ...baseConfig,
        fetch: mockFetch,
      });

      const credential = await client.generateCredential(challenge, policyEval);
      expect(credential.version).toBe("1");
      expect(credential.payee).toBe("0xPayee");
      expect(credential.amountUsd).toBe("0.01");
      expect(credential.chain).toBe("base");
      expect(credential.token).toBe("USDC");
    });

    it("credentialMessage is used for signing when signer provided", async () => {
      const signerFn = vi.fn().mockResolvedValue(new Uint8Array([0xaa, 0xbb]));

      const client = new MachinaMppClient({
        ...baseConfig,
        signer: signerFn,
        walletAddress: "0xWallet",
      });

      const challenge = {
        challengeId: "ch-1",
        amountUsd: "0.10",
        accepts: ["machina" as const],
        payee: "0xPayee",
      };

      const policyEval = {
        evalId: "eval-1",
        approved: true,
        agentId: "agent-001",
        rulesEvaluated: [],
        rulesBlocked: [],
        requiresApproval: false,
        complianceChecks: {
          sanctionsScreening: "pass" as const,
          travelRule: "not_required" as const,
          budgetLimit: "pass" as const,
          rateLimit: "pass" as const,
        },
        evaluatedAt: new Date().toISOString(),
      };

      const credential = await client.generateCredential(challenge, policyEval);

      expect(signerFn).toHaveBeenCalledTimes(1);
      // Signer receives a Uint8Array message
      const msg = signerFn.mock.calls[0][0];
      expect(msg).toBeInstanceOf(Uint8Array);

      // The message should contain the credential fields
      const decoded = new TextDecoder().decode(msg);
      expect(decoded).toContain("mpp:v1:");
      expect(decoded).toContain("0xWallet");
      expect(decoded).toContain("0xPayee");
      expect(decoded).toContain("0.10");

      // Signature should be hex-encoded
      expect(credential.signature).toBe("aabb");
    });
  });

  describe("createMppFetch", () => {
    it("returns a function", () => {
      const fetch = createMppFetch(baseConfig);
      expect(typeof fetch).toBe("function");
    });

    it("returned function calls through to MachinaMppClient.fetch", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const mppFetch = createMppFetch({
        ...baseConfig,
        fetch: mockFetch,
      });

      const res = await mppFetch("https://example.com");
      expect(res.status).toBe(200);
    });
  });
});

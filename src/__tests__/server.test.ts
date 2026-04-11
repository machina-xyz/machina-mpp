import { describe, it, expect, vi } from "vitest";
import { MachinaMppServer } from "../server.js";
import type { MppCredential } from "../types.js";

describe("MachinaMppServer", () => {
  const baseConfig = {
    apiUrl: "https://api.machina.money",
    serviceId: "test-service",
    paymentAddress: "0xServicePayee",
    pricePerRequestUsd: "0.05",
  };

  describe("constructor defaults", () => {
    it("sets acceptedMethods to [machina, x402] by default", () => {
      const server = new MachinaMppServer(baseConfig);
      expect(server).toBeDefined();
    });

    it("sets acceptedTokens to [USDC] by default", () => {
      const server = new MachinaMppServer(baseConfig);
      expect(server).toBeDefined();
    });

    it("sets platformFeeRate to 0.01 by default", () => {
      const server = new MachinaMppServer(baseConfig);
      const credential: MppCredential = {
        version: "1",
        method: "machina",
        payer: "0xPayer",
        payee: "0xServicePayee",
        amountUsd: "1.00",
        token: "USDC",
        chain: "base",
        signature: "0xsig",
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      };
      const receipt = server.generateReceipt(credential);
      // 1% of 1.00 = 0.01
      expect(receipt.platformFeeUsd).toBe("0.010000");
    });

    it("sets verifyCredentials to true by default", () => {
      const server = new MachinaMppServer(baseConfig);
      expect(server).toBeDefined();
    });

    it("sets network to mainnet by default", () => {
      const server = new MachinaMppServer(baseConfig);
      const { body } = server.generateChallenge();
      expect((body.mpp as any).network).toBe("mainnet");
    });
  });

  describe("generateChallenge", () => {
    it("returns valid MppChallenge with all required fields", () => {
      const server = new MachinaMppServer(baseConfig);
      const result = server.generateChallenge();

      expect(result.status).toBe(402);
      expect(result.headers["Content-Type"]).toBe("application/json");
      expect(result.headers["x-mpp-challenge"]).toBeDefined();

      const challenge = JSON.parse(atob(result.headers["x-mpp-challenge"]));
      expect(challenge.challengeId).toBeDefined();
      expect(challenge.amountUsd).toBe("0.05");
      expect(challenge.accepts).toContain("machina");
      expect(challenge.payee).toBe("0xServicePayee");
      expect(challenge.expiresAt).toBeDefined();
      expect(challenge.network).toBe("mainnet");
    });

    it("has correct expiry (5 min default)", () => {
      const server = new MachinaMppServer(baseConfig);
      const before = Date.now();
      const result = server.generateChallenge();
      const after = Date.now();

      const challenge = JSON.parse(atob(result.headers["x-mpp-challenge"]));
      const expiresAt = new Date(challenge.expiresAt).getTime();

      // Should expire ~5 minutes from now
      expect(expiresAt).toBeGreaterThanOrEqual(before + 300_000 - 100);
      expect(expiresAt).toBeLessThanOrEqual(after + 300_000 + 100);
    });

    it("uses customPrice when provided", () => {
      const server = new MachinaMppServer(baseConfig);
      const result = server.generateChallenge({ customPrice: "2.50" });

      const challenge = JSON.parse(atob(result.headers["x-mpp-challenge"]));
      expect(challenge.amountUsd).toBe("2.50");
    });

    it("uses custom expiresInMs when provided", () => {
      const server = new MachinaMppServer(baseConfig);
      const before = Date.now();
      const result = server.generateChallenge({ expiresInMs: 60_000 });

      const challenge = JSON.parse(atob(result.headers["x-mpp-challenge"]));
      const expiresAt = new Date(challenge.expiresAt).getTime();

      expect(expiresAt).toBeGreaterThanOrEqual(before + 60_000 - 100);
      expect(expiresAt).toBeLessThanOrEqual(before + 60_000 + 200);
    });

    it("includes x402 compat block when x402 is in accepted methods", () => {
      const server = new MachinaMppServer(baseConfig);
      const result = server.generateChallenge();

      expect(result.body.x402).toBeDefined();
    });

    it("omits x402 block when x402 is not in accepted methods", () => {
      const server = new MachinaMppServer({
        ...baseConfig,
        acceptedMethods: ["machina"],
      });
      const result = server.generateChallenge();

      expect(result.body.x402).toBeUndefined();
    });
  });

  describe("extractCredential", () => {
    it("returns null when no headers are present", () => {
      const server = new MachinaMppServer(baseConfig);
      const headers = { get: (_name: string) => null };
      expect(server.extractCredential(headers)).toBeNull();
    });

    it("parses x-mpp-credential header", () => {
      const server = new MachinaMppServer(baseConfig);
      const credential: MppCredential = {
        version: "1",
        method: "machina",
        payer: "0xPayer",
        payee: "0xServicePayee",
        amountUsd: "0.05",
        token: "USDC",
        chain: "base",
        signature: "0xsig",
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      };

      const encoded = btoa(JSON.stringify(credential));
      const headers = {
        get: (name: string) =>
          name === "x-mpp-credential" ? encoded : null,
      };

      const result = server.extractCredential(headers);
      expect(result).not.toBeNull();
      expect(result!.payer).toBe("0xPayer");
      expect(result!.method).toBe("machina");
    });

    it("falls back to x-402-payment header", () => {
      const server = new MachinaMppServer(baseConfig);
      const headers = {
        get: (name: string) => {
          if (name === "x-mpp-credential") return null;
          if (name === "x-402-payment") return "0xtxhash123";
          if (name === "x-machina-agent-id") return "agent-007";
          return null;
        },
      };

      const result = server.extractCredential(headers);
      expect(result).not.toBeNull();
      expect(result!.method).toBe("x402");
      expect(result!.txHash).toBe("0xtxhash123");
      expect(result!.payer).toBe("agent-007");
    });
  });

  describe("verifyCredential", () => {
    const makeCredential = (overrides?: Partial<MppCredential>): MppCredential => ({
      version: "1",
      method: "machina",
      payer: "0xPayer",
      payee: "0xServicePayee",
      amountUsd: "0.10",
      token: "USDC",
      chain: "base",
      signature: "0xsig",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      ...overrides,
    });

    it("rejects expired credentials", async () => {
      const server = new MachinaMppServer({
        ...baseConfig,
        verifyCredentials: false,
      });

      const expired = makeCredential({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });

      const result = await server.verifyCredential(expired);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Credential expired");
    });

    it("rejects insufficient amounts", async () => {
      const server = new MachinaMppServer({
        ...baseConfig,
        verifyCredentials: false,
      });

      const underpaid = makeCredential({ amountUsd: "0.01" });

      const result = await server.verifyCredential(underpaid);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Insufficient payment amount");
    });

    it("rejects wrong payee", async () => {
      const server = new MachinaMppServer({
        ...baseConfig,
        verifyCredentials: false,
      });

      const wrongPayee = makeCredential({ payee: "0xWrongPayee" });

      const result = await server.verifyCredential(wrongPayee);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Payee mismatch");
    });

    it("accepts valid credential with local checks", async () => {
      const server = new MachinaMppServer({
        ...baseConfig,
        verifyCredentials: false,
      });

      const valid = makeCredential();
      const result = await server.verifyCredential(valid);
      expect(result.valid).toBe(true);
    });

    it("rejects unaccepted payment method", async () => {
      const server = new MachinaMppServer({
        ...baseConfig,
        acceptedMethods: ["machina"],
        verifyCredentials: false,
      });

      const wrongMethod = makeCredential({ method: "lightning" });
      const result = await server.verifyCredential(wrongMethod);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("not accepted");
    });
  });

  describe("generateReceipt", () => {
    it("calculates platform fee correctly", () => {
      const server = new MachinaMppServer({
        ...baseConfig,
        platformFeeRate: 0.02, // 2%
      });

      const credential: MppCredential = {
        version: "1",
        method: "machina",
        payer: "0xPayer",
        payee: "0xServicePayee",
        amountUsd: "10.00",
        token: "USDC",
        chain: "base",
        signature: "0xsig",
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        txHash: "0xtx123",
        challengeId: "ch-1",
      };

      const receipt = server.generateReceipt(credential);
      expect(receipt.receiptId).toBeDefined();
      expect(receipt.service).toBe("test-service");
      expect(receipt.amountUsd).toBe("10.00");
      expect(receipt.platformFeeUsd).toBe("0.200000");
      expect(receipt.serviceAmountUsd).toBe("9.800000");
      expect(receipt.chain).toBe("base");
      expect(receipt.txHash).toBe("0xtx123");
      expect(receipt.status).toBe("confirmed");
    });

    it("sets status to pending when no txHash", () => {
      const server = new MachinaMppServer(baseConfig);

      const credential: MppCredential = {
        version: "1",
        method: "machina",
        payer: "0xPayer",
        payee: "0xServicePayee",
        amountUsd: "1.00",
        token: "USDC",
        chain: "base",
        signature: "0xsig",
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      };

      const receipt = server.generateReceipt(credential);
      expect(receipt.status).toBe("pending");
      expect(receipt.txHash).toBeUndefined();
    });
  });

  describe("encodeReceipt", () => {
    it("produces valid base64", () => {
      const server = new MachinaMppServer(baseConfig);

      const credential: MppCredential = {
        version: "1",
        method: "machina",
        payer: "0xPayer",
        payee: "0xServicePayee",
        amountUsd: "0.05",
        token: "USDC",
        chain: "base",
        signature: "0xsig",
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      };

      const receipt = server.generateReceipt(credential);
      const encoded = server.encodeReceipt(receipt);

      // Should be valid base64 that decodes to JSON
      const decoded = JSON.parse(atob(encoded));
      expect(decoded.receiptId).toBe(receipt.receiptId);
      expect(decoded.service).toBe("test-service");
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  requirePayment,
  isPaymentRequired,
  encodeMcpCredential,
  parsePaymentError,
  extractMcpCredential,
  MCP_PAYMENT_REQUIRED_CODE,
  MCP_CREDENTIAL_META_KEY,
} from "../mcp.js";
import type { MppCredential } from "../types.js";

describe("MCP helpers", () => {
  describe("requirePayment", () => {
    it("returns correct error code (-32042)", () => {
      const error = requirePayment({
        serviceId: "image-gen",
        priceUsd: "0.05",
        paymentAddress: "0xPayee",
      });

      expect(error.code).toBe(-32042);
      expect(error.message).toBe("Payment required");
      expect(error.data.amountUsd).toBe("0.05");
      expect(error.data.payee).toBe("0xPayee");
      expect(error.data.serviceId).toBe("image-gen");
      expect(error.data.challengeId).toBeDefined();
    });

    it("includes default accepted methods and tokens", () => {
      const error = requirePayment({
        serviceId: "search",
        priceUsd: "0.01",
        paymentAddress: "0xPayee",
      });

      expect(error.data.accepts).toEqual(["machina", "x402"]);
      expect(error.data.tokens).toEqual(["USDC"]);
      expect(error.data.network).toBe("mainnet");
    });

    it("uses provided description", () => {
      const error = requirePayment({
        serviceId: "search",
        priceUsd: "0.01",
        paymentAddress: "0xPayee",
        description: "Custom description",
      });

      expect(error.data.description).toBe("Custom description");
    });

    it("generates default description from serviceId", () => {
      const error = requirePayment({
        serviceId: "image-gen",
        priceUsd: "0.05",
        paymentAddress: "0xPayee",
      });

      expect(error.data.description).toBe("Payment for image-gen");
    });
  });

  describe("isPaymentRequired", () => {
    it("identifies -32042 correctly", () => {
      expect(isPaymentRequired({ code: -32042 })).toBe(true);
    });

    it("returns false for other codes", () => {
      expect(isPaymentRequired({ code: -32000 })).toBe(false);
      expect(isPaymentRequired({ code: 402 })).toBe(false);
      expect(isPaymentRequired({ code: 0 })).toBe(false);
    });

    it("returns false for null/undefined", () => {
      expect(isPaymentRequired(null)).toBe(false);
      expect(isPaymentRequired(undefined)).toBe(false);
    });

    it("returns false when code is missing", () => {
      expect(isPaymentRequired({} as any)).toBe(false);
    });
  });

  describe("encodeMcpCredential", () => {
    it("produces correct key", () => {
      const credential: MppCredential = {
        version: "1",
        method: "machina",
        payer: "0xPayer",
        payee: "0xPayee",
        amountUsd: "0.05",
        token: "USDC",
        chain: "base",
        signature: "0xsig",
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      };

      const result = encodeMcpCredential(credential);
      expect(result).toHaveProperty("org.paymentauth/credential");

      // Value should be valid base64 that decodes to the credential
      const decoded = JSON.parse(atob(result["org.paymentauth/credential"]));
      expect(decoded.payer).toBe("0xPayer");
      expect(decoded.payee).toBe("0xPayee");
    });
  });

  describe("extractMcpCredential", () => {
    it("returns null when meta is null/undefined", () => {
      expect(extractMcpCredential(null)).toBeNull();
      expect(extractMcpCredential(undefined)).toBeNull();
    });

    it("returns null when key is missing", () => {
      expect(extractMcpCredential({})).toBeNull();
    });

    it("extracts credential from valid meta", () => {
      const credential: MppCredential = {
        version: "1",
        method: "machina",
        payer: "0xPayer",
        payee: "0xPayee",
        amountUsd: "0.05",
        token: "USDC",
        chain: "base",
        signature: "0xsig",
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      };

      const meta = {
        [MCP_CREDENTIAL_META_KEY]: btoa(JSON.stringify(credential)),
      };

      const result = extractMcpCredential(meta);
      expect(result).not.toBeNull();
      expect(result!.payer).toBe("0xPayer");
    });
  });

  describe("parsePaymentError", () => {
    it("extracts challenge fields from error data", () => {
      const errorData = {
        challengeId: "ch-123",
        amountUsd: "0.50",
        accepts: ["machina", "x402"],
        payee: "0xPayee",
        description: "Test payment",
        chains: ["base", "solana"],
        tokens: ["USDC"],
        network: "mainnet",
      };

      const challenge = parsePaymentError(errorData);
      expect(challenge.challengeId).toBe("ch-123");
      expect(challenge.amountUsd).toBe("0.50");
      expect(challenge.accepts).toEqual(["machina", "x402"]);
      expect(challenge.payee).toBe("0xPayee");
      expect(challenge.description).toBe("Test payment");
      expect(challenge.chains).toEqual(["base", "solana"]);
      expect(challenge.tokens).toEqual(["USDC"]);
      expect(challenge.network).toBe("mainnet");
    });

    it("handles missing fields with defaults", () => {
      const challenge = parsePaymentError({});
      expect(challenge.challengeId).toBeDefined(); // generated UUID
      expect(challenge.amountUsd).toBe("0");
      expect(challenge.accepts).toEqual(["machina"]);
      expect(challenge.payee).toBe("");
      expect(challenge.network).toBe("mainnet");
    });
  });
});

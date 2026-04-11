import { describe, it, expect } from "vitest";
import { MPP_HEADERS, MCP_PAYMENT_REQUIRED_CODE, MCP_CREDENTIAL_META_KEY } from "../types.js";

describe("Type constants", () => {
  describe("MPP_HEADERS", () => {
    it("has CREDENTIAL key", () => {
      expect(MPP_HEADERS.CREDENTIAL).toBe("x-mpp-credential");
    });

    it("has CHALLENGE key", () => {
      expect(MPP_HEADERS.CHALLENGE).toBe("x-mpp-challenge");
    });

    it("has RECEIPT key", () => {
      expect(MPP_HEADERS.RECEIPT).toBe("x-mpp-receipt");
    });

    it("has POLICY_EVAL key", () => {
      expect(MPP_HEADERS.POLICY_EVAL).toBe("x-machina-policy-eval");
    });

    it("has AGENT_ID key", () => {
      expect(MPP_HEADERS.AGENT_ID).toBe("x-machina-agent-id");
    });

    it("has X402_PAYMENT key", () => {
      expect(MPP_HEADERS.X402_PAYMENT).toBe("x-402-payment");
    });

    it("has all expected keys", () => {
      const expectedKeys = [
        "CREDENTIAL",
        "CHALLENGE",
        "RECEIPT",
        "POLICY_EVAL",
        "AGENT_ID",
        "X402_PAYMENT",
      ];
      expect(Object.keys(MPP_HEADERS).sort()).toEqual(expectedKeys.sort());
    });
  });

  describe("MCP_PAYMENT_REQUIRED_CODE", () => {
    it("equals -32042", () => {
      expect(MCP_PAYMENT_REQUIRED_CODE).toBe(-32042);
    });
  });

  describe("MCP_CREDENTIAL_META_KEY", () => {
    it("equals expected string", () => {
      expect(MCP_CREDENTIAL_META_KEY).toBe("org.paymentauth/credential");
    });
  });
});

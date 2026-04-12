import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  dualProtocolGate,
  detectProtocol,
  type DualProtocolGateConfig,
  type DetectedProtocol,
} from "../middleware/dual.js";
import type { MppCredential } from "../types.js";
import { MPP_HEADERS, X402_HEADERS } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeHeaderGetter(headers: Record<string, string>) {
  return (name: string) => headers[name.toLowerCase()] ?? null;
}

function makeValidMppCredential(overrides?: Partial<MppCredential>): MppCredential {
  return {
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
  };
}

function encodeMppCredential(credential: MppCredential): string {
  return btoa(JSON.stringify(credential));
}

const baseConfig: DualProtocolGateConfig = {
  apiUrl: "https://api.machina.money",
  serviceId: "test-service",
  paymentAddress: "0xServicePayee",
  pricePerRequestUsd: "0.05",
  verifyCredentials: false, // Skip API verification in tests
};

function createTestApp(config: DualProtocolGateConfig = baseConfig) {
  const app = new Hono();
  app.use("/api/*", dualProtocolGate(config));
  app.get("/api/data", (c) => {
    const credential = c.get("mppCredential");
    const protocol = c.get("detectedProtocol");
    return c.json({ ok: true, protocol, payer: credential?.payer });
  });
  return app;
}

// ── detectProtocol ───────────────────────────────────────────────────────────

describe("detectProtocol", () => {
  it("detects MPP protocol from x-mpp-credential header", () => {
    const result = detectProtocol(
      makeHeaderGetter({ "x-mpp-credential": "some-credential-data" }),
    );
    expect(result).toBe("mpp");
  });

  it("detects x402 protocol from x-payment header", () => {
    const result = detectProtocol(
      makeHeaderGetter({ "x-payment": '{"amount":"100"}' }),
    );
    expect(result).toBe("x402");
  });

  it("detects x402 protocol from x-payment-proof header", () => {
    const result = detectProtocol(
      makeHeaderGetter({ "x-payment-proof": '{"amount":"100"}' }),
    );
    expect(result).toBe("x402");
  });

  it("detects x402 protocol from Authorization: x402 header", () => {
    const result = detectProtocol(
      makeHeaderGetter({ authorization: "x402 eyJhbW91bnQiOiIxMDAifQ==" }),
    );
    expect(result).toBe("x402");
  });

  it("detects x402 protocol from legacy x-402-payment header", () => {
    const result = detectProtocol(
      makeHeaderGetter({ "x-402-payment": "0xtxhash123" }),
    );
    expect(result).toBe("x402");
  });

  it("returns 'none' when no payment headers are present", () => {
    const result = detectProtocol(
      makeHeaderGetter({ "content-type": "application/json" }),
    );
    expect(result).toBe("none");
  });

  it("prioritizes MPP over x402 when both headers are present", () => {
    const result = detectProtocol(
      makeHeaderGetter({
        "x-mpp-credential": "mpp-data",
        "x-payment": '{"amount":"100"}',
      }),
    );
    expect(result).toBe("mpp");
  });

  it("does not detect x402 from non-x402 Authorization header", () => {
    const result = detectProtocol(
      makeHeaderGetter({ authorization: "Bearer some-token" }),
    );
    expect(result).toBe("none");
  });
});

// ── dualProtocolGate: MPP Detection ──────────────────────────────────────────

describe("dualProtocolGate - MPP protocol", () => {
  it("accepts valid MPP credential and passes through", async () => {
    const app = createTestApp();
    const credential = makeValidMppCredential();

    const res = await app.request("/api/data", {
      headers: {
        [MPP_HEADERS.CREDENTIAL]: encodeMppCredential(credential),
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.protocol).toBe("mpp");
    expect(body.payer).toBe("0xPayer");
  });

  it("returns receipt header on successful MPP request", async () => {
    const app = createTestApp();
    const credential = makeValidMppCredential();

    const res = await app.request("/api/data", {
      headers: {
        [MPP_HEADERS.CREDENTIAL]: encodeMppCredential(credential),
      },
    });

    expect(res.status).toBe(200);
    const receiptHeader = res.headers.get(MPP_HEADERS.RECEIPT);
    expect(receiptHeader).toBeTruthy();

    const receipt = JSON.parse(atob(receiptHeader!));
    expect(receipt.service).toBe("test-service");
    expect(receipt.amountUsd).toBe("0.10");
  });

  it("rejects expired MPP credential", async () => {
    const app = createTestApp();
    const credential = makeValidMppCredential({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const res = await app.request("/api/data", {
      headers: {
        [MPP_HEADERS.CREDENTIAL]: encodeMppCredential(credential),
      },
    });

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("Invalid payment credential");
    expect(body.protocol).toBe("mpp");
    expect(body.reason).toBe("Credential expired");
  });

  it("rejects MPP credential with insufficient amount", async () => {
    const app = createTestApp();
    const credential = makeValidMppCredential({ amountUsd: "0.01" });

    const res = await app.request("/api/data", {
      headers: {
        [MPP_HEADERS.CREDENTIAL]: encodeMppCredential(credential),
      },
    });

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.reason).toBe("Insufficient payment amount");
  });
});

// ── dualProtocolGate: x402 Detection ─────────────────────────────────────────

describe("dualProtocolGate - x402 protocol", () => {
  it("accepts valid x402 X-Payment header (JSON)", async () => {
    const app = createTestApp();
    const payload = JSON.stringify({
      amount: "0.10",
      from: "0xX402Payer",
      to: "0xServicePayee",
      token: "USDC",
      chain: "base",
      txHash: "0xtx456",
      signature: "0xsig",
    });

    const res = await app.request("/api/data", {
      headers: {
        [X402_HEADERS.PAYMENT]: payload,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.protocol).toBe("x402");
    expect(body.payer).toBe("0xX402Payer");
  });

  it("accepts valid x402 X-Payment header (base64)", async () => {
    const app = createTestApp();
    const payload = btoa(
      JSON.stringify({
        amount: "0.10",
        from: "0xBase64Payer",
        to: "0xServicePayee",
        txHash: "0xtx789",
      }),
    );

    const res = await app.request("/api/data", {
      headers: {
        [X402_HEADERS.PAYMENT]: payload,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.protocol).toBe("x402");
    expect(body.payer).toBe("0xBase64Payer");
  });

  it("accepts valid Authorization: x402 header", async () => {
    const app = createTestApp();
    const token = btoa(
      JSON.stringify({
        amount: "0.10",
        from: "0xAuthPayer",
        to: "0xServicePayee",
      }),
    );

    const res = await app.request("/api/data", {
      headers: {
        authorization: `x402 ${token}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.protocol).toBe("x402");
    expect(body.payer).toBe("0xAuthPayer");
  });

  it("accepts legacy x-402-payment header (tx hash)", async () => {
    const app = createTestApp();

    const res = await app.request("/api/data", {
      headers: {
        [MPP_HEADERS.X402_PAYMENT]: "0xlegacytxhash",
        [MPP_HEADERS.AGENT_ID]: "agent-007",
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.protocol).toBe("x402");
    expect(body.payer).toBe("agent-007");
  });

  it("returns 402 when x402 header is present but unparseable", async () => {
    const app = createTestApp();

    const res = await app.request("/api/data", {
      headers: {
        [X402_HEADERS.PAYMENT]: "not-json-not-base64!!!",
      },
    });

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("Invalid payment credential");
    expect(body.protocol).toBe("x402");
  });

  it("handles x402 payload with nested payload object", async () => {
    const app = createTestApp();
    const payload = JSON.stringify({
      payload: {
        amount: "0.10",
        from: "0xNestedPayer",
        to: "0xServicePayee",
        txHash: "0xtxnested",
      },
    });

    const res = await app.request("/api/data", {
      headers: {
        [X402_HEADERS.PAYMENT]: payload,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payer).toBe("0xNestedPayer");
  });
});

// ── dualProtocolGate: No Protocol (402 Challenge) ────────────────────────────

describe("dualProtocolGate - 402 challenge format", () => {
  it("returns 402 when no payment headers are present", async () => {
    const app = createTestApp();

    const res = await app.request("/api/data");

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("Payment required");
  });

  it("returns dual-format 402 by default (both protocols)", async () => {
    const app = createTestApp();

    const res = await app.request("/api/data");

    expect(res.status).toBe(402);
    const body = await res.json();

    // Should have both MPP challenge and x402 accepts block
    expect(body.mpp).toBeDefined();
    expect(body.mpp.challengeId).toBeDefined();
    expect(body.mpp.amountUsd).toBe("0.05");
    expect(body.protocols).toContain("mpp");
    expect(body.protocols).toContain("x402");

    // Should have x-mpp-challenge header
    const challengeHeader = res.headers.get(MPP_HEADERS.CHALLENGE);
    expect(challengeHeader).toBeTruthy();

    // Should have x-payment-required header for x402 clients
    const x402Header = res.headers.get("x-payment-required");
    expect(x402Header).toBeTruthy();
    const x402Data = JSON.parse(x402Header!);
    expect(x402Data.price).toBe("0.05");
    expect(x402Data.payee).toBe("0xServicePayee");
  });

  it("returns MPP-only 402 when fallbackChallengeFormat is 'mpp'", async () => {
    const app = createTestApp({
      ...baseConfig,
      fallbackChallengeFormat: "mpp",
    });

    const res = await app.request("/api/data");

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.mpp).toBeDefined();

    // MPP challenge header should be present
    expect(res.headers.get(MPP_HEADERS.CHALLENGE)).toBeTruthy();
  });

  it("returns x402-only 402 when fallbackChallengeFormat is 'x402'", async () => {
    const app = createTestApp({
      ...baseConfig,
      fallbackChallengeFormat: "x402",
    });

    const res = await app.request("/api/data");

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.protocol).toBe("x402");
    expect(body.x402).toBeDefined();
    expect(body.x402.accepts.price).toBe("0.05");
  });
});

// ── dualProtocolGate: Policy Evaluation ──────────────────────────────────────

describe("dualProtocolGate - policy evaluation", () => {
  it("blocks payment when policy evaluator denies", async () => {
    const app = createTestApp({
      ...baseConfig,
      policyEvaluator: async (_credential, _protocol) => ({
        approved: false,
        reason: "Budget exceeded",
      }),
    });

    const credential = makeValidMppCredential();
    const res = await app.request("/api/data", {
      headers: {
        [MPP_HEADERS.CREDENTIAL]: encodeMppCredential(credential),
      },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Payment blocked by policy");
    expect(body.reason).toBe("Budget exceeded");
  });

  it("allows payment when policy evaluator approves", async () => {
    const app = createTestApp({
      ...baseConfig,
      policyEvaluator: async (_credential, _protocol) => ({
        approved: true,
      }),
    });

    const credential = makeValidMppCredential();
    const res = await app.request("/api/data", {
      headers: {
        [MPP_HEADERS.CREDENTIAL]: encodeMppCredential(credential),
      },
    });

    expect(res.status).toBe(200);
  });

  it("passes detected protocol to policy evaluator", async () => {
    let receivedProtocol: DetectedProtocol | undefined;

    const app = createTestApp({
      ...baseConfig,
      policyEvaluator: async (_credential, protocol) => {
        receivedProtocol = protocol;
        return { approved: true };
      },
    });

    // Test with x402
    const x402Payload = JSON.stringify({
      amount: "0.10",
      from: "0xPayer",
      to: "0xServicePayee",
    });

    await app.request("/api/data", {
      headers: {
        [X402_HEADERS.PAYMENT]: x402Payload,
      },
    });

    expect(receivedProtocol).toBe("x402");

    // Test with MPP
    const credential = makeValidMppCredential();
    await app.request("/api/data", {
      headers: {
        [MPP_HEADERS.CREDENTIAL]: encodeMppCredential(credential),
      },
    });

    expect(receivedProtocol).toBe("mpp");
  });

  it("passes credential to policy evaluator", async () => {
    let receivedCredential: MppCredential | undefined;

    const app = createTestApp({
      ...baseConfig,
      policyEvaluator: async (credential, _protocol) => {
        receivedCredential = credential;
        return { approved: true };
      },
    });

    const credential = makeValidMppCredential({ payer: "0xTestPayer" });
    await app.request("/api/data", {
      headers: {
        [MPP_HEADERS.CREDENTIAL]: encodeMppCredential(credential),
      },
    });

    expect(receivedCredential).toBeDefined();
    expect(receivedCredential!.payer).toBe("0xTestPayer");
  });
});

// ── dualProtocolGate: Credential Passthrough ─────────────────────────────────

describe("dualProtocolGate - credential passthrough", () => {
  it("stores credential on context for MPP", async () => {
    const app = new Hono();
    app.use("/api/*", dualProtocolGate(baseConfig));
    app.get("/api/data", (c) => {
      const credential = c.get("mppCredential");
      return c.json({
        method: credential?.method,
        payer: credential?.payer,
        amountUsd: credential?.amountUsd,
      });
    });

    const credential = makeValidMppCredential();
    const res = await app.request("/api/data", {
      headers: {
        [MPP_HEADERS.CREDENTIAL]: encodeMppCredential(credential),
      },
    });

    const body = await res.json();
    expect(body.method).toBe("machina");
    expect(body.payer).toBe("0xPayer");
    expect(body.amountUsd).toBe("0.10");
  });

  it("stores normalized credential on context for x402", async () => {
    const app = new Hono();
    app.use("/api/*", dualProtocolGate(baseConfig));
    app.get("/api/data", (c) => {
      const credential = c.get("mppCredential");
      return c.json({
        method: credential?.method,
        payer: credential?.payer,
        txHash: credential?.txHash,
      });
    });

    const payload = JSON.stringify({
      amount: "0.10",
      from: "0xX402Payer",
      to: "0xServicePayee",
      txHash: "0xmytx",
    });

    const res = await app.request("/api/data", {
      headers: {
        [X402_HEADERS.PAYMENT]: payload,
      },
    });

    const body = await res.json();
    expect(body.method).toBe("x402");
    expect(body.payer).toBe("0xX402Payer");
    expect(body.txHash).toBe("0xmytx");
  });

  it("exposes detected protocol on context", async () => {
    const app = new Hono();
    app.use("/api/*", dualProtocolGate(baseConfig));
    app.get("/api/data", (c) => {
      return c.json({ protocol: c.get("detectedProtocol") });
    });

    // MPP request
    const credential = makeValidMppCredential();
    const mppRes = await app.request("/api/data", {
      headers: {
        [MPP_HEADERS.CREDENTIAL]: encodeMppCredential(credential),
      },
    });
    expect((await mppRes.json()).protocol).toBe("mpp");

    // x402 request
    const x402Res = await app.request("/api/data", {
      headers: {
        [MPP_HEADERS.X402_PAYMENT]: "0xtxhash",
        [MPP_HEADERS.AGENT_ID]: "agent-1",
      },
    });
    expect((await x402Res.json()).protocol).toBe("x402");
  });
});

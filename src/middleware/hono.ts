/**
 * @machina/mpp/middleware/hono -- Hono middleware for MPP payment gating.
 *
 * Adds policy-governed payment gating to any Hono app:
 *   1. Check for MPP credential or x402 payment header
 *   2. If missing -> return 402 with challenge
 *   3. If present -> verify credential -> evaluate policy -> allow/deny
 *   4. After response -> generate receipt
 *
 * @example
 * ```typescript
 * import { machinaMpp } from "@machina/mpp/middleware/hono";
 *
 * app.use("/api/paid/*", machinaMpp({
 *   apiUrl: "https://api.machina.money",
 *   serviceId: "my-service",
 *   paymentAddress: "0x1234...",
 *   pricePerRequestUsd: "0.01",
 * }));
 * ```
 */

import { createMiddleware } from "hono/factory";
import { MachinaMppServer } from "../server.js";
import type { MachinaMppServerConfig, MppCredential, MppReceipt } from "../types.js";
import { MPP_HEADERS } from "../types.js";

type MachinaMppEnv = {
  Variables: {
    mppCredential?: MppCredential;
    mppReceipt?: MppReceipt;
  };
};

/**
 * Hono middleware for MPP payment gating with MACHINA policy enforcement.
 */
export function machinaMpp(config: MachinaMppServerConfig) {
  const server = new MachinaMppServer(config);

  return createMiddleware<MachinaMppEnv>(async (c, next) => {
    // Extract credential from request
    const credential = server.extractCredential({
      get: (name: string) => c.req.header(name) ?? null,
    });

    // No credential -> return 402 challenge
    if (!credential) {
      const challenge = server.generateChallenge();
      for (const [key, value] of Object.entries(challenge.headers)) {
        c.header(key, value);
      }
      return c.json(challenge.body, 402);
    }

    // Verify credential
    const verification = await server.verifyCredential(credential);
    if (!verification.valid) {
      return c.json(
        {
          error: "Invalid payment credential",
          reason: verification.reason,
        },
        402,
      );
    }

    // Store credential on context for downstream handlers
    c.set("mppCredential", credential);

    // Continue to handler
    await next();

    // Generate receipt after successful response
    if (c.res.status >= 200 && c.res.status < 300) {
      const receipt = server.generateReceipt(credential);
      c.set("mppReceipt", receipt);
      c.header(MPP_HEADERS.RECEIPT, server.encodeReceipt(receipt));
    }
  });
}

export type { MachinaMppServerConfig, MachinaMppEnv };

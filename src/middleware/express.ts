/**
 * @machina/mpp/middleware/express — Express middleware for MPP payment gating.
 *
 * @example
 * ```typescript
 * import { machinaMpp } from "@machina/mpp/middleware/express";
 *
 * app.use("/api/paid", machinaMpp({
 *   apiUrl: "https://api.machina.money",
 *   serviceId: "my-service",
 *   paymentAddress: "0x1234...",
 *   pricePerRequestUsd: "0.01",
 * }));
 * ```
 */

import { MachinaMppServer } from "../server.js";
import type { MachinaMppServerConfig, MppCredential, MppReceipt } from "../types.js";
import { MPP_HEADERS } from "../types.js";

// Express types (peer dependency — not imported directly)
interface ExpressRequest {
  headers: Record<string, string | string[] | undefined>;
  get(name: string): string | undefined;
}
interface ExpressResponse {
  status(code: number): ExpressResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  locals: Record<string, unknown>;
  statusCode: number;
  on(event: string, listener: () => void): void;
}
type NextFunction = (err?: unknown) => void;

/**
 * Express middleware for MPP payment gating with MACHINA policy enforcement.
 */
export function machinaMpp(config: MachinaMppServerConfig) {
  const server = new MachinaMppServer(config);

  return async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    // Extract credential from request
    const credential = server.extractCredential({
      get: (name: string) => req.get(name) ?? null,
    });

    // No credential → return 402 challenge
    if (!credential) {
      const challenge = server.generateChallenge();
      for (const [key, value] of Object.entries(challenge.headers)) {
        res.setHeader(key, value);
      }
      return res.status(402).json(challenge.body);
    }

    // Verify credential
    const verification = await server.verifyCredential(credential);
    if (!verification.valid) {
      return res.status(402).json({
        error: "Invalid payment credential",
        reason: verification.reason,
      });
    }

    // Store credential on response locals for downstream handlers
    res.locals.mppCredential = credential;

    // Generate receipt after response completes
    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const receipt = server.generateReceipt(credential);
        res.locals.mppReceipt = receipt;
        // Note: headers can't be set after finish — receipt is in locals only
      }
    });

    // Set receipt header proactively (before response is sent)
    const receipt = server.generateReceipt(credential);
    res.setHeader(MPP_HEADERS.RECEIPT, server.encodeReceipt(receipt));

    next();
  };
}

export type { MachinaMppServerConfig };

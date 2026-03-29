/**
 * @machina/mpp/middleware/hono — Hono middleware for MPP payment gating.
 *
 * Adds policy-governed payment gating to any Hono app:
 *   1. Check for MPP credential or x402 payment header
 *   2. If missing → return 402 with challenge
 *   3. If present → verify credential → evaluate policy → allow/deny
 *   4. After response → generate receipt
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
import type { MachinaMppServerConfig, MppCredential, MppReceipt } from "../types.js";
type MachinaMppEnv = {
    Variables: {
        mppCredential?: MppCredential;
        mppReceipt?: MppReceipt;
    };
};
/**
 * Hono middleware for MPP payment gating with MACHINA policy enforcement.
 */
export declare function machinaMpp(config: MachinaMppServerConfig): import("hono/types").MiddlewareHandler<MachinaMppEnv, string, {}, Response>;
export type { MachinaMppServerConfig, MachinaMppEnv };
//# sourceMappingURL=hono.d.ts.map
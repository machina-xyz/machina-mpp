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
import type { MachinaMppServerConfig } from "../types.js";
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
export declare function machinaMpp(config: MachinaMppServerConfig): (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => Promise<void>;
export type { MachinaMppServerConfig };
//# sourceMappingURL=express.d.ts.map
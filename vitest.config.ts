import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Map .js imports to .ts source files (vitest runs TypeScript directly)
      "../server.js": path.resolve(__dirname, "src/server.ts"),
      "../types.js": path.resolve(__dirname, "src/types.ts"),
      "../middleware/dual.js": path.resolve(__dirname, "src/middleware/dual.ts"),
      "../middleware/hono.js": path.resolve(__dirname, "src/middleware/hono.ts"),
      "../middleware/index.js": path.resolve(__dirname, "src/middleware/index.ts"),
      // Files that only exist in dist (no source created yet)
      "../mcp.js": path.resolve(__dirname, "dist/mcp.js"),
      "../middleware/express.js": path.resolve(__dirname, "dist/middleware/express.js"),
      // For client.ts which imports ./types.js
      "./types.js": path.resolve(__dirname, "src/types.ts"),
    },
  },
});

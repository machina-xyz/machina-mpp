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
      // Map sibling imports to dist (source files for server, types, mcp, middleware only exist in dist)
      "../server.js": path.resolve(__dirname, "dist/server.js"),
      "../types.js": path.resolve(__dirname, "dist/types.js"),
      "../mcp.js": path.resolve(__dirname, "dist/mcp.js"),
      "../middleware/index.js": path.resolve(__dirname, "dist/middleware/index.js"),
      "../middleware/hono.js": path.resolve(__dirname, "dist/middleware/hono.js"),
      "../middleware/express.js": path.resolve(__dirname, "dist/middleware/express.js"),
      // For client.ts which imports ./types.js
      "./types.js": path.resolve(__dirname, "dist/types.js"),
    },
  },
});

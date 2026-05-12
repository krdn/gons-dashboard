import { defineConfig } from "tsup";
export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  outDir: "dist",
  target: "node22",
  splitting: false,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  noExternal: ["@gons/shared-google", "@gons/shared-mcp-runtime"],
});

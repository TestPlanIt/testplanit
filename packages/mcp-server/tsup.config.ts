import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    // tsup runs the two configs concurrently, so this clean must not remove the
    // CLI bundle the other config emits — a wiped dist/cli.js publishes a
    // package whose `bin` points at nothing.
    clean: ["!cli.js", "!cli.js.map"],
    sourcemap: true,
    splitting: false,
    treeshake: true,
    minify: false,
  },
  {
    entry: ["src/cli.ts"],
    format: ["cjs"],
    dts: false,
    clean: false,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    minify: false,
    banner: { js: "#!/usr/bin/env node" },
  },
]);

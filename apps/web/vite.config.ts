import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

// Test-only helper: `import css from "./styles.css.rawfile"` yields the file text verbatim. Vite's `?raw` (and any
// `.css?query` id) is blanked by Vitest's CSS handling, which would silently turn the static CSS checks into no-ops.
const rawFile: Plugin = {
  name: "mcl-raw-file",
  enforce: "pre",
  async resolveId(source, importer) {
    if (!source.endsWith(".rawfile")) return null;
    const target = await this.resolve(source.slice(0, -".rawfile".length), importer, { skipSelf: true });
    return target ? `${target.id}.rawfile` : null;
  },
  load(id) {
    if (id.endsWith(".rawfile")) return `export default ${JSON.stringify(readFileSync(id.slice(0, -".rawfile".length), "utf8"))}`;
  },
};

// Unit/component tests run in Node (react-dom/server rendering); they use *.test.ts(x) so they can never be confused
// with the Playwright *.spec.ts journey files under tests/e2e.
export default defineConfig({
  plugins: [react(), rawFile],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

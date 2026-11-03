import { cloudflare } from "@cloudflare/vite-plugin";
import vue from "@vitejs/plugin-vue";
import { defineConfig, lazyPlugins } from "vite-plus";

// https://viteplus.dev/config/
export default defineConfig({
  fmt: {
    ignorePatterns: ["worker-configuration.d.ts", "public/demo/**"],
  },
  lint: {
    ignorePatterns: ["dist/**", "worker-configuration.d.ts"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    include: [
      "shared/**/*.test.ts",
      "src/**/*.test.ts",
      "worker/**/*.test.ts",
      "scripts/**/*.test.ts",
      "fixtures/**/*.test.ts",
    ],
    environment: "node",
  },
  // Vitest 実行時は Worker ランタイム（Miniflare）を立ち上げない
  plugins: lazyPlugins(() => [vue(), ...(process.env.VITEST ? [] : [cloudflare()])]),
});

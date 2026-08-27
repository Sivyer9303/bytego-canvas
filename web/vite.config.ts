import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { parseChangelog } from "./src/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");

function viteBasePath() {
    const base = process.env.VITE_BASE || "/";
    return base.endsWith("/") ? base : `${base}/`;
}

// Expose plugins/index.json with local plugin files from public/plugins.
// The frontend can discover and list them when enabled; development reads the directory live, while builds emit a static registry.
function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(webDir, "public/plugins");
    const listLocalPlugins = () => {
        try {
            return readdirSync(pluginsDir)
                .filter((file) => file.endsWith(".js"))
                .sort()
                .map((file) => `${viteBasePath()}plugins/${file}`);
        } catch {
            return [];
        }
    };
    const serveIndex: Plugin["configureServer"] = (server) => {
        const handler = (_req: unknown, res: { setHeader: (name: string, value: string) => void; end: (body: string) => void }) => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(listLocalPlugins()));
        };
        const indexPath = `${viteBasePath()}plugins/index.json`;
        server.middlewares.use(indexPath, handler);
        if (indexPath !== "/plugins/index.json") server.middlewares.use("/plugins/index.json", handler);
    };
    return {
        name: "local-plugins-manifest",
        configureServer: serveIndex,
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "plugins/index.json", source: JSON.stringify(listLocalPlugins()) });
        },
    };
}

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    plugins: [react(), localPluginsManifest()],
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
        __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
    },
});

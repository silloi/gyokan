/**
 * 行間（gyokan）の Worker。静的アセット（Vue の SPA）は Cloudflare が配信し、/api/* だけここに来る。
 */
import { handleAnnotate, handleImport } from "./annotate.ts";
import { dailyLimit } from "./guard.ts";
import { errorResponse, json } from "./http.ts";
import { handlePage } from "./page.ts";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    try {
      switch (pathname) {
        case "/api/health":
          return json({
            ok: true,
            browserRendering: Boolean(env.BROWSER),
            claude: Boolean(env.ANTHROPIC_API_KEY),
            cache: Boolean(env.CACHE),
            model: env.CLAUDE_MODEL,
            allowedHosts: env.ALLOWED_HOSTS,
            dailyGenerations: dailyLimit(env),
          });
        case "/api/page":
          return await handlePage(request, env);
        case "/api/annotate":
          return await handleAnnotate(request, env, ctx);
        case "/api/dev/import":
          // 開発用（.dev.vars の DEV_TOOLS=1）。本番では存在しない扱い
          if (env.DEV_TOOLS !== "1")
            return json({ error: "not_found", message: "見つかりません" }, 404);
          return await handleImport(request, env);
        default:
          return json({ error: "not_found", message: "見つかりません" }, 404);
      }
    } catch (e) {
      return errorResponse(e);
    }
  },
} satisfies ExportedHandler<Env>;

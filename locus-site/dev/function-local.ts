// 本地 Deno 校验入口（放在 functions/ 之外，避免进入发布包）。
// 用法（需本机有 Deno）：
//   deno check functions/index.ts
//   deno run --allow-net=127.0.0.1:8000 --allow-env dev/function-local.ts
//   curl --fail 'http://127.0.0.1:8000/healthz'
import { handler } from "../functions/handler.ts";

Deno.serve({ hostname: "127.0.0.1", port: 8000 }, handler);

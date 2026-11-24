// Qoder Sites 单函数入口：逻辑名 app，运行时 edge，formatVersion 2，无 authMode。
// 打包时 functions/ 目录作为 runtime/app.zip，本文件为 ZIP 根 index.ts。
import { handler } from "./handler.ts";

Deno.serve(handler);

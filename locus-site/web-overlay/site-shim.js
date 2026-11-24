// 前端接入 shim：把 LOCUS 前端对 /api/* 的请求改走本站 Site 函数（/functions/v1/app）。
// 放在 index.html 的 <head>，在任何 module 脚本（app.js）之前执行。
// 不改动 app.js / lib/api.js：所有调用都经 fetch 与 /api/* 链接。
(function () {
  var BASE = "/functions/v1/app";

  // 竞赛页面：收起「AI 配置」入口与抽屉（模型固定，避免评委打开必然失败的表单）。
  try {
    var st = document.createElement("style");
    st.textContent = "[data-open-ai]{display:none!important}#ai-drawer{display:none!important}";
    (document.head || document.documentElement).appendChild(st);
  } catch (e) { /* 忽略 */ }

  // 1) 覆盖 fetch：仅改写以 /api/ 开头的同源请求
  var _fetch = window.fetch ? window.fetch.bind(window) : null;
  if (_fetch) {
    window.fetch = function (input, init) {
      try {
        if (typeof input === "string" && input.indexOf("/api/") === 0) return _fetch(BASE + input, init);
      } catch (e) { /* 保底：不改写 */ }
      return _fetch(input, init);
    };
  }

  // 2) 拦截 /api/* 下载链接（原件下载），改走 Site 函数
  document.addEventListener(
    "click",
    function (e) {
      var el = e.target;
      var a = el && el.closest ? el.closest('a[href^="/api/"]') : null;
      if (a) {
        e.preventDefault();
        window.location.href = BASE + a.getAttribute("href");
      }
    },
    true
  );

  // 3) 顶部 AI 状态按钮改为**只读**：不打开（已隐藏的）配置面板，仅展示当前状态。
  function showHint(msg) {
    try {
      var d = document.createElement("div");
      d.textContent = msg;
      d.style.cssText =
        "position:fixed;left:50%;top:16px;transform:translateX(-50%);background:#2f6f4e;color:#fff;padding:8px 14px;border-radius:6px;font:14px system-ui,sans-serif;z-index:99999;box-shadow:0 2px 8px rgba(0,0,0,.2)";
      document.body.appendChild(d);
      setTimeout(function () { d.remove(); }, 2200);
    } catch (e) { /* 忽略 */ }
  }
  document.addEventListener(
    "click",
    function (e) {
      var el = e.target && e.target.closest ? e.target.closest("#ai-chip,[data-open-ai]") : null;
      if (!el) return;
      // 捕获阶段截断：阻止 app.js 的冒泡监听打开配置面板
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      var chip = document.getElementById("ai-chip");
      var txt = chip ? (chip.textContent || "").trim() : "";
      showHint("AI：" + (txt || "状态") + "（竞赛固定，只读）");
    },
    true
  );
})();

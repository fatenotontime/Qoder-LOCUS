"""S08 公开展示版 E1–E7 离屏验收（Playwright + 系统 Edge，不依赖 Node、不启动后端）。

用法（在 e worktree 根）：
  PYTHONIOENCODING=utf-8 python record/acceptance-s08/scripts/run_acceptance.py \
      --base http://127.0.0.1:8785 \
      --out  record/acceptance-s08/evidence/s08-t7 \
      --zip  "<web>/demo-data/locus-demo-public.zip"
前置：静态服务已指向 D 的生成物目录。
"""
import argparse, hashlib, json, os, re, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

RESULT = {}
def check(key, ok, detail=""):
    RESULT[key] = {"ok": bool(ok), "detail": str(detail)[:800]}
    print(("PASS " if ok else "FAIL ") + key + (" | " + str(detail)[:200] if detail else ""))

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()

def texts(page, sel):
    return [t.strip() for t in page.locator(sel).all_inner_texts() if t.strip()]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--zip", required=True)
    a = ap.parse_args()
    base = a.base.rstrip("/")
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    requests = []
    consoles = []
    errors = []

    def wire(page, tag):
        page.on("request", lambda r: requests.append({"ctx": tag, "method": r.method, "url": r.url, "type": r.resource_type}))
        page.on("console", lambda m: consoles.append({"ctx": tag, "type": m.type, "text": m.text}) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: errors.append({"ctx": tag, "error": str(e)}))

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            channel="msedge", headless=True,
            args=["--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
                  "--disable-background-networking", "--no-first-run"])
        vp = {"width": 1440, "height": 900}

        # ── E1 首页 ───────────────────────────────────────────
        ctx = browser.new_context(viewport=vp)
        page = ctx.new_page(); wire(page, "E1")
        page.goto(base + "/", wait_until="networkidle", timeout=45000)
        page.wait_for_selector(".demo-app", timeout=20000)
        theme = page.evaluate("document.documentElement.dataset.theme")
        build = page.evaluate("window.__LOCUS_BUILD__?.version || document.querySelector('meta[name=locus-build-version]')?.content")
        topic = texts(page, ".demo-topic b")
        fixturebar = page.locator(".demo-fixture").count()
        page.screenshot(path=str(out / "E1_home.png"), full_page=True)
        check("E1.1 直接进入主课题", "/demo/demo.html" in page.url and bool(topic), f"url={page.url} topic={topic}")
        check("E1.2 全站暖色", theme == "paper", f"data-theme={theme}")
        check("E1.3 非夹具占位", fixturebar == 0, f"fixture bar={fixturebar}")
        check("E1.4 构建版本", build == "s08-public-3103888", f"build={build}")
        check("E1.5 无未捕获异常", len(errors) == 0, json.dumps(errors, ensure_ascii=False))

        # ── E1b 预存 tech 后仍暖色 ─────────────────────────────
        ctx2 = browser.new_context(viewport=vp)
        ctx2.add_init_script("try{localStorage.setItem('locus.theme.v1','tech');localStorage.setItem('locus.theme','tech')}catch(e){}")
        p2 = ctx2.new_page(); wire(p2, "E1b")
        p2.goto(base + "/demo/demo.html", wait_until="networkidle", timeout=45000)
        p2.wait_for_selector(".demo-app", timeout=20000)
        theme2 = p2.evaluate("document.documentElement.dataset.theme")
        seal = p2.locator("#theme-seal, #replay-theme, [data-action=theme], .theme-seal").count()
        p2.screenshot(path=str(out / "E1_tech_refresh.png"), full_page=True)
        check("E1.6 预存 tech 仍暖色", theme2 == "paper", f"data-theme={theme2}")
        check("E1.7 无冷色切换入口", seal == 0, f"seal/replay nodes={seal}")

        # ── E2 文献库 ─────────────────────────────────────────
        p = page
        p.goto(base + "/demo/demo.html#/papers", wait_until="networkidle", timeout=30000)
        p.wait_for_selector(".demo-cardbtn", timeout=15000)
        states = texts(p, ".demo-cardstate")
        check("E2.1 待审/已审可区分", any("已确认" in s for s in states) and any("待审" in s for s in states), states)
        idx_pending = next((i for i, s in enumerate(states) if "待审" in s), None)
        check("E2.2 存在待审卡", idx_pending is not None, f"states={states}")
        btns = p.locator(".demo-cardbtn")
        if idx_pending is not None:
            btns.nth(idx_pending).click()
        p.wait_for_selector(".demo-carddetail", timeout=10000)
        detail_txt = p.locator(".demo-carddetail").inner_text()
        p.screenshot(path=str(out / "E2_card_pending.png"), full_page=True)
        check("E2.3 卡片详情含条件/单位", ("条件" in detail_txt) and ("单位" in detail_txt) and ("出处定位" in detail_txt))
        quote = p.locator(".demo-carddetail blockquote.demo-quote").first.inner_text()
        quotes = [q.strip() for q in p.locator(".demo-carddetail blockquote.demo-quote").all_inner_texts()]
        loc = p.locator('.demo-carddetail [data-action="locate"]').first
        loc.click()
        p.wait_for_selector("article.demo-src", timeout=10000)
        mark = p.locator("article.demo-src mark")
        nmarks = mark.count()
        mark_txt = mark.first.inner_text() if nmarks else ""
        p.screenshot(path=str(out / "E2_backtrace.png"), full_page=True)
        hit_any = any(mark_txt.strip() and mark_txt.strip()[:25] in q for q in quotes)
        check("E2.4 原文定位逐字命中", nmarks > 0, f"marks={nmarks} quotes={[q[:40] for q in quotes]}")
        check("E2.5 定位到同一引文", hit_any, f"mark={mark_txt[:60]}")
        p.locator('.demo-pane-head [data-action="compare"]').first.click()
        p.wait_for_selector(".demo-table", timeout=10000)
        rows = p.locator(".demo-table tbody tr").count()
        cmp_txt = p.locator(".demo-mid").inner_text()
        p.screenshot(path=str(out / "E2_compare.png"), full_page=True)
        check("E2.6 比较视图两边来源", rows >= 2, f"rows={rows}")
        check("E2.7 比较含共同指标/条件差异", ("共同指标" in cmp_txt) and ("条件差异" in cmp_txt), cmp_txt[:120])
        back = p.locator(".demo-mid .demo-table [data-action=locate]").first
        if back.count():
            back.click()
            p.wait_for_selector("article.demo-src", timeout=10000)
            check("E2.8 比较可回查原文", True, "clicked locate")
        else:
            check("E2.8 比较可回查原文", False, "无 locate 按钮")

        # ── E3 报告回查链 ─────────────────────────────────────
        task = "atask_9cf2587e-9818-447d-9f63-9111eb090fa8"
        p.goto(f"{base}/demo/demo.html#/analysis?task={task}", wait_until="networkidle", timeout=30000)
        p.wait_for_selector(".demo-block", timeout=15000)
        p.screenshot(path=str(out / "E3_report.png"), full_page=True)
        refs = p.locator(".demo-block [data-action=backref]")
        nrefs = refs.count()
        check("E3.1 报告块有可回查引用", nrefs >= 3, f"refs={nrefs}")
        kinds = [refs.nth(i).get_attribute("data-kind") for i in range(min(nrefs, 8))]
        check("E3.2 引用覆盖多类对象", len(set(kinds)) >= 2, kinds)
        hops = []
        for i in range(min(nrefs, 4)):
            p.goto(f"{base}/demo/demo.html#/analysis?task={task}", wait_until="networkidle", timeout=20000)
            p.wait_for_selector(".demo-block", timeout=10000)
            el = p.locator(".demo-block [data-action=backref]").nth(i)
            kind, oid = el.get_attribute("data-kind"), el.get_attribute("data-id")
            el.click()
            page2ok = p.locator(".demo-app").count() == 1 and p.locator(".demo-miss").count() == 0
            hops.append({"kind": kind, "id": oid, "hash": p.evaluate("location.hash"), "ok": page2ok})
            if i == 0:
                p.screenshot(path=str(out / "E3_after_ref.png"), full_page=True)
        check("E3.3 每跳可点且无缺项", all(h["ok"] for h in hops), hops)
        # 结果附件 → 原件
        p.goto(f"{base}/demo/demo.html#/analysis?task={task}", wait_until="networkidle", timeout=20000)
        asset_link = p.locator('.demo-mid [data-action=backref][data-kind=asset]').first
        if asset_link.count():
            name = asset_link.inner_text()
            asset_link.click()
            p.wait_for_selector("article.demo-src, .demo-mid .demo-pane-head", timeout=10000)
            head = p.locator(".demo-mid .demo-pane-head").first.inner_text()
            mid_txt = p.locator(".demo-mid").inner_text()
            check("E3.4 结果附件到原件", (".csv" in mid_txt) or (name in mid_txt), f"head={head}")
        else:
            check("E3.4 结果附件到原件", False, "无 asset 回查")

        # ── E4 上下文图 / 预生成 / 下一步 ─────────────────────
        p.goto(f"{base}/demo/demo.html#/topic", wait_until="networkidle", timeout=30000)
        p.wait_for_selector(".demo-suggestion", timeout=15000)
        sug = p.locator(".demo-suggestion").count()
        sug_txt = p.locator(".demo-right").inner_text()
        p.locator('.demo-suggestion [data-action="basis"]').first.click()
        p.wait_for_selector(".demo-basis", timeout=10000)
        basis_txt = p.locator(".demo-basis").first.inner_text()
        p.screenshot(path=str(out / "E4_nextstep.png"), full_page=True)
        check("E4.1 下一步 1–2 条", 1 <= sug <= 2, f"sugs={sug}")
        check("E4.2 依据四要素", all(x in basis_txt for x in ["证据分歧", "要补什么数据", "可区分解释", "仍不确定"]), basis_txt[:160])
        p.goto(f"{base}/demo/demo.html#/analysis?task={task}", wait_until="networkidle", timeout=30000)
        p.wait_for_selector("svg.demo-map, .demo-miss", timeout=15000)
        nodes = p.locator("svg.demo-map .demo-mapnode").count()
        p.screenshot(path=str(out / "E4_map.png"), full_page=True)
        check("E4.3 实跑上下文图节点", nodes > 0, f"nodes={nodes}")
        if nodes:
            p.locator("svg.demo-map .demo-mapnode").first.click()
            ok = p.locator(".demo-miss").count() == 0
            check("E4.4 图节点可回查", ok, p.evaluate("location.hash"))
        footprint = p.locator(".demo-foot").inner_text()
        check("E4.5 预生成/只读标识", ("未调用" in p.content() or "预生成" in p.content()) and "不触发后端" in footprint, footprint[:160])

        # ── E5 ZIP ───────────────────────────────────────────
        p.goto(f"{base}/demo/demo.html#/topic", wait_until="networkidle", timeout=30000)
        page_sha = p.locator(".demo-right code").first.inner_text() if p.locator(".demo-right code").count() else ""
        with p.expect_download(timeout=30000) as dl:
            p.locator('.demo-zip[data-action="zip"]').first.click()
        zpath = out / "downloaded.zip"
        dl.value.save_as(str(zpath))
        zsha = sha256(zpath)
        exp = sha256(a.zip)
        import zipfile
        with zipfile.ZipFile(zpath) as z:
            names = z.namelist()
        check("E5.1 ZIP 可下载并打开", len(names) > 5, f"entries={len(names)}")
        check("E5.2 ZIP 哈希一致", zsha == exp, f"down={zsha[:16]} site={exp[:16]}")
        check("E5.3 页面显示哈希一致", page_sha.strip() == zsha, f"page={page_sha[:16]}")
        docs = [n for n in names if n.startswith("docs/") or n.lower() == "readme.md"]
        check("E5.4 许可与指引齐全", len(docs) >= 3, docs)
        check("E5.5 原件齐备", len([n for n in names if n.startswith("originals/")]) >= 8, [n for n in names if n.startswith("originals/")][:12])

        # ── E6 折扇与设置 ────────────────────────────────────
        p.goto(f"{base}/demo/demo.html", wait_until="networkidle", timeout=30000)
        p.wait_for_selector("#settings-open", timeout=15000)
        entry = p.locator("#settings-open")
        entry.click()
        p.wait_for_selector("#settings-fan:not([hidden])", timeout=10000)
        time.sleep(0.5)
        expanded = entry.get_attribute("aria-expanded")
        inside = p.evaluate("!!document.querySelector('#settings-fan')?.contains(document.activeElement)")
        p.screenshot(path=str(out / "E6_desktop_open.png"))
        check("E6.1 折扇打开且焦点进入", expanded == "true" and inside, f"aria-expanded={expanded} inside={inside}")
        # Tab 循环
        stayed = True
        for _ in range(14):
            p.keyboard.press("Tab")
            if not p.evaluate("!!document.querySelector('#settings-fan')?.contains(document.activeElement)"):
                stayed = False
        p.keyboard.press("Shift+Tab")
        stayed = stayed and p.evaluate("!!document.querySelector('#settings-fan')?.contains(document.activeElement)")
        check("E6.2 Tab 焦点限制", stayed)
        p.keyboard.press("Escape")
        p.wait_for_selector("#settings-fan", state="hidden", timeout=5000)
        time.sleep(0.2)
        returned = p.evaluate("document.activeElement?.id")
        check("E6.3 Esc 关闭并归还焦点", returned == "settings-open", f"focus={returned}")
        # 偏好修改 + 刷新保留
        entry.click(); p.wait_for_selector("#settings-fan:not([hidden])"); time.sleep(0.3)
        p.locator('[data-density-seg] button[data-v="compact"]').click()
        p.locator('[data-fontsize-seg] button[data-v="lg"]').click()
        p.locator("[data-motion-switch]").click()
        ds = p.evaluate("[document.documentElement.dataset.density,document.documentElement.dataset.fontsize,document.documentElement.dataset.motion]")
        p.screenshot(path=str(out / "E6_prefs.png"))
        p.reload(wait_until="networkidle")
        ds2 = p.evaluate("[document.documentElement.dataset.density,document.documentElement.dataset.fontsize,document.documentElement.dataset.motion]")
        check("E6.4 偏好刷新保留", ds == ds2 == ["compact", "lg", "reduced"], f"before={ds} after={ds2}")
        # 页签：鼠标点击（真实指针）——判定项
        entry.click()
        p.wait_for_selector("#settings-fan:not([hidden])")
        p.wait_for_selector("#settings-fan.is-open", timeout=5000)
        time.sleep(0.8)
        nav_models = p.locator('[data-fan-tab="models"]').first
        box = nav_models.bounding_box()
        if box:
            p.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            time.sleep(0.2)
        click_err = None
        for attempt in range(2):
            try:
                nav_models.click(timeout=2000)
                break
            except Exception as e:
                click_err = str(e).splitlines()[0][:80]
                time.sleep(0.4)
        active_after_click = p.evaluate("document.querySelector('[data-fan-tab][aria-current=true]')?.dataset.fanTab")
        check("E6.10 页签鼠标可点击", active_after_click == "models", f"active={active_after_click} err={click_err}")
        # 用键盘激活（聚焦后 Enter）验证 模型/关于 内容
        p.locator('[data-fan-tab="models"]').first.focus(); p.keyboard.press("Enter"); time.sleep(0.2)
        drawer = p.locator("#settings-fan")
        model_html = drawer.inner_html()
        check("E6.5 模型页只读无密钥控件", ("key" not in model_html.lower()) and ("保存" not in model_html) and ("测试" not in model_html), "checked")
        check("E6.11 键盘可切页签", p.evaluate("document.querySelector('[data-fan-tab][aria-current=true]')?.dataset.fanTab") == "models", "kbd models")
        p.locator('[data-fan-tab="about"]').first.focus(); p.keyboard.press("Enter"); time.sleep(0.2)
        about_active = p.evaluate("document.querySelector('[data-fan-tab][aria-current=true]')?.dataset.fanTab")
        about = drawer.inner_text()
        check("E6.6 关于显示构建版本", about_active == "about" and "s08-public-3103888" in about, f"active={about_active} text={about[:90]}")
        p.keyboard.press("Escape")

        # 四档视口：内容面板须完整可用（折扇整体按原型允许部分出屏）
        vps = [(1440, 900), (1280, 720), (1024, 768), (390, 800)]
        layout_ok = []
        for w, h in vps:
            p.set_viewport_size({"width": w, "height": h})
            p.goto(f"{base}/demo/demo.html", wait_until="networkidle", timeout=30000)
            p.locator("#settings-open").click(); p.wait_for_selector("#settings-fan:not([hidden])"); time.sleep(0.5)
            box = p.locator("#settings-fan .fan-content").first.bounding_box()
            mode = p.evaluate("document.querySelector('#settings-fan')?.dataset.fanSheet")
            ok = bool(box) and box["x"] >= -1 and box["y"] >= -1 and box["x"] + box["width"] <= w + 1 and box["y"] + box["height"] <= h + 1 and box["width"] > 120
            layout_ok.append({"vp": f"{w}x{h}", "sheet": mode, "content": box, "ok": ok})
            p.screenshot(path=str(out / f"E6_{w}x{h}.png"))
            if w == 390:
                sheet_tab = next((p.locator('[data-fan-tab="models"]').nth(i) for i in range(p.locator('[data-fan-tab="models"]').count())
                                  if (p.locator('[data-fan-tab="models"]').nth(i).bounding_box() or {}).get("height", 0) > 0), None)
                try:
                    sheet_tab.click(timeout=1500)
                    off = p.evaluate("document.querySelector('[data-fan-tab][aria-current=true]')?.dataset.fanTab")
                    check("E6.12 窄屏抽屉页签可点击", off == "models", f"active={off}")
                except Exception as e:
                    check("E6.12 窄屏抽屉页签可点击", False, str(e).splitlines()[0][:80])
            p.keyboard.press("Escape"); time.sleep(0.5)
        check("E6.7 四档无错位", all(x["ok"] for x in layout_ok), layout_ok)

        # 系统减少动效
        ctx3 = browser.new_context(viewport=vp, reduced_motion="reduce")
        p3 = ctx3.new_page(); wire(p3, "E6r")
        p3.goto(base + "/demo/demo.html", wait_until="networkidle", timeout=30000)
        motion = p3.evaluate("document.documentElement.dataset.motion")
        p3.locator("#settings-open").click()
        p3.wait_for_selector("#settings-fan:not([hidden])", timeout=5000)
        instant = p3.evaluate("document.querySelector('#settings-fan').classList.contains('is-open')")
        check("E6.8 系统减少动效生效", motion == "reduced" and instant, f"motion={motion} instant={instant}")
        p3.screenshot(path=str(out / "E6_reduced.png"))
        # 预存 tech + 打开设置
        p3.evaluate("localStorage.setItem('locus.theme.v1','tech')")
        p3.reload(wait_until="networkidle")
        th = p3.evaluate("document.documentElement.dataset.theme")
        theme_controls = p3.locator("#settings-fan [data-theme], #theme-seal").count()
        check("E6.9 存 tech 后仍暖色且无冷色控件", th == "paper" and theme_controls == 0, f"theme={th} ctrls={theme_controls}")

        # ── E7 请求审计（排除本机卡巴斯基 HTTPS 注入噪声）────────
        noise = re.compile(r"kaspersky-labs\.com", re.I)
        bad_path = [r for r in requests if re.search(r"/(api|functions)/", r["url"])]
        external = [r for r in requests if not r["url"].startswith(base) and not noise.search(r["url"])]
        writes = [r for r in requests if r["method"] not in ("GET", "HEAD", "OPTIONS") and not noise.search(r["url"])]
        check("E7.1 无 /api 或 /functions 请求", len(bad_path) == 0, bad_path[:5])
        check("E7.2 无外部主机请求（除本机 AV 注入）", len(external) == 0, external[:5])
        check("E7.3 无写入请求（除本机 AV 注入）", len(writes) == 0, writes[:5])
        bad_console = [c for c in consoles if c["type"] == "error" and not re.search(r"favicon|404", c["text"], re.I)]
        check("E7.4 控制台无初始化错误", len(bad_console) == 0 and len(errors) == 0, {"console": bad_console[:5], "pageerror": errors[:5]})

        browser.close()

    (out / "requests.json").write_text(json.dumps(requests, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "console.json").write_text(json.dumps({"console": consoles, "errors": errors}, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "result.json").write_text(json.dumps(RESULT, ensure_ascii=False, indent=1), encoding="utf-8")
    fails = [k for k, v in RESULT.items() if not v["ok"]]
    print("\n== 汇总 ==", len(RESULT), "项；失败", len(fails), fails)
    return 0 if not fails else 1

if __name__ == "__main__":
    sys.exit(main())

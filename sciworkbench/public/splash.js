
(function () {
  "use strict";

  // V9：合拢卷轴等待点击 → 展开 → 科研时间线 → 引线 → 手写研迹 / LOCUS → 朱印 → 左轴收卷揭示界面 → 卷筒飞角标展开 → 卡面重写 → 字标飞入顶栏 → 朱印
  var T = { in1: 280, open0: 300, open1: 1000,
            origin0: 1000, origin1: 1200, tl0: 1100, tl1: 2900,
            lead0: 2880, leadA1: 3050, leadB0: 3020, lead1: 3100,
            text0: 3060, text1: 3840,
            locus0: 3760, locus1: 3960, locusFill1: 3990,
            seal0: 3880, seal1: 4060,
            roll0: 4220, roll1: 5200,
            leadFade0: 4050, leadFade1: 4210,
            ink0: 5000, ink1: 5180,
            rollFly0: 5200, rollFly1: 5580,
            cardO0: 5580, cardO1: 5760,
            writeY0: 5800, writeY1: 6080,
            writeL0: 6060, writeL1: 6300,
            sealC0: 6280, sealC1: 6400,
            flyL0: 6320, flyL1: 6680, total: 6740 };

  var $ = function (id) { return document.getElementById(id); };
  var overlay = $("overlay"), stage = $("stage");
  var uiBrand = document.querySelector(".brand");
  var el = {
    closed: $("scroll-closed"), scrollMain: $("scroll-main"),
    paper: $("paper"), paperInner: $("paper-inner"), scrollShadow: $("scroll-shadow"),
    rollers: [$("roller-left"), $("roller-right")],
    coilL: $("coil-left-rect"), coilR: $("coil-right-rect"),
    seamL: $("seam-left"), seamR: $("seam-right"),
    knobsLeft: $("knobs-left"), knobsRight: $("knobs-right"),
    furniture: $("scroll-furniture"), coilContact: $("coil-contact"), coilShade: $("coil-shade"),
    shadeLeft: $("shade-left"), shadeRight: $("shade-right"),
    clip: $("paper-clip-rect"),
    tlPath: $("tl-path"), tlOrigin: $("tl-origin"),
    nodes: [$("tn1"), $("tn2"), $("tn3"), $("tn4"), $("tn5")],
    paperWorld: $("paper-world"), burnHole: $("burn-hole"), burnClipPath: $("burn-clip-path"),
    rollClip: $("roll-clip-rect"), revealRect: $("reveal-rect"),
    mark: $("mark"), markPaper: $("mark-paper"), markInner: $("mark-inner"),
    markShadow: $("mark-shadow"), markEdgeT: $("mark-edge-t"), markEdgeB: $("mark-edge-b"),
    markRodL: $("mark-rod-l"), markRodR: $("mark-rod-r"), markKnobs: $("mark-knobs"),
    logoCard: null, logoRoll: $("logo-roll"),
    locusLift: $("locus-lift"),
    burnEdge: $("burn-edge"), burnScorch: $("burn-scorch"),
    burnSoot: $("burn-soot"), burnChar: $("burn-char"),
    burnGlowW: $("burn-glow-w"), burnGlow: $("burn-glow"), burnGlowC: $("burn-glow-c"), burnGlowI: $("burn-glow-i"),
    burnHot: $("burn-hot"), fuse: $("burn-fuse"), fuseHalo: $("fuse-halo"),
    heatGlow: $("burn-heat-glow"), heatHot: $("burn-heat-hot"),
    deskSolid: $("desk-solid"),
    brandLit: $("brand-lit"), brandEmber: $("brand-ember"),
    yanjiLit: $("yanji-lit"), locusLit: $("locus-lit"),
    yanjiEmber: $("yanji-ember"), locusEmber: $("locus-ember"),
    sparks: [], smokes: [], embers: [],
    lead: $("lead"), leadA: $("lead-a"), leadB: $("lead-b"),
    brand: $("brand"), yanji: $("yanji"), yanjiPaths: $("yanji-paths"), yanjiGlyphs: $("yanji-glyphs"),
    yanjiFill: $("yanji-fill"), yanjiPen: $("yanji-pen"),
    sealPos: $("seal-pos"), seal: $("seal"), sealMark: $("seal-mark"), sealBloom: $("seal-bloom"),
    locusLift: $("locus-lift"), locusGlyphs: $("locus-glyphs"),
    locusBelow: $("locus-below"), locusPaths: $("locus-paths"),
    locusFill: $("locus-fill"), locusPen: $("locus-pen"),
    brandEn: document.querySelector(".brand-en"),
    sealArt: document.querySelector(".seal-art"),
    stage: $("stage")
  };

  var L = { tlLen: 0, leadA: 0, leadB: 0, nodeFrac: [], targetBox: null, locusT: "",
            yanjiT: "", locusPenT: "", locusY: 0, sealPosT: "", markBox: null, ink: null,
            locusBox: null, locusS: 1, viewRight: 1200 };
  var t = 0, playing = false, speed = 1, last = 0, finished = false, hasBegun = false;
  var IDLE = T.open0 - 1, awaiting = false, hint = $("open-hint");
  var hovering = false, wobbleTimer = 0;

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function seg(a, b) { return clamp01((t - a) / (b - a)); }
  function easeOutCubic(p) { return 1 - Math.pow(1 - p, 3); }
  function easeOutBack(p, s) { var q = p - 1; return 1 + (s + 1) * q * q * q + s * q * q; }
  function easeInOutCubic(p) { return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  // 火势位置：引线阶段沿时间线走，之后向右扫出画面
  function burnState() {
    var pf = clamp01((t - T.burn0) / (T.fuse1 - T.burn0));
    var pt = el.tlPath.getPointAtLength(L.tlLen * pf);
    if (t > T.fuse1) {
      var q = easeInOutCubic(clamp01((t - T.fuse1) / (T.spread1 - T.fuse1)));
      pt = { x: pt.x + 882 * q, y: pt.y - 31 * clamp01((t - T.fuse1) / 220) };
    }
    return pt;
  }

  // 烧穿前沿：火种附近前凸，上下两翼滞后，叠加多频扰动与两侧慢速火舌
  function edgeX(yv, st) {
    var dy = yv - st.y;
    var lag = Math.min(Math.abs(dy), 500) * 0.34;
    var ph = t * 0.0055;
    var x = st.x + 18 * Math.exp(-(dy * dy) / 39200) - lag +
      10 * Math.sin(yv * 0.033 + ph * 1.3) +
      5 * Math.sin(yv * 0.081 + ph * 2.1) +
      3.2 * Math.sin(yv * 0.16 + t * 0.012) +
      2.2 * Math.sin(yv * 0.31 - t * 0.0071) +
      2.2 * Math.sin(yv * 0.19 + ph * 3.7) +
      1.4 * Math.sin(yv * 0.63 + t * 0.019) +
      1.0 * Math.sin(yv * 1.37 + t * 0.027);
    var t1 = st.y + 50 * Math.sin(t * 0.0013 + 0.7);
    var t2 = st.y - 140 + 30 * Math.sin(t * 0.0011 + 2.4);
    x += 26 * Math.exp(-Math.pow(yv - t1, 2) / 3000) +
         15 * Math.exp(-Math.pow(yv - t2, 2) / 1600);
    // 几缕向纸面舔出的火舌
    for (var tg = 0; tg < 4; tg++) {
      var ty = st.y + (hash(tg * 6.7 + 0.9) * 2 - 1) * 400 + 26 * Math.sin(t * 0.0017 + tg * 1.9);
      var amp = 6 + 9 * (0.5 + 0.5 * Math.sin(t * 0.0023 + tg * 2.7)) + 4 * hash(tg * 9.1 + 3.3);
      x += amp * Math.exp(-Math.pow(yv - ty, 2) / 900);
    }
    return x;
  }

  // 过中点的二次曲线，消掉折线锯齿
  function smoothBody(pts) {
    if (!pts.length) return "";
    var d = pts[0][0].toFixed(1) + " " + pts[0][1].toFixed(1);
    for (var i = 1; i < pts.length - 1; i++) {
      var mx = (pts[i][0] + pts[i + 1][0]) / 2;
      var my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += " Q" + pts[i][0].toFixed(1) + " " + pts[i][1].toFixed(1) +
           " " + mx.toFixed(1) + " " + my.toFixed(1);
    }
    var last = pts[pts.length - 1];
    d += " L" + last[0].toFixed(1) + " " + last[1].toFixed(1);
    return d;
  }
  function smoothPath(pts) { return pts.length ? "M" + smoothBody(pts) : ""; }

  function initBurnFx() {
    var g = $("burn-sparks"), sg = $("burn-smoke"), eg = $("burn-embers");
    el.embers = [];
    for (var e0 = 0; e0 < 18; e0++) {
      var d0 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      d0.setAttribute("fill", "url(#ember-grad)");
      d0.setAttribute("opacity", 0);
      d0._seed = { y: hash(e0 * 4.9 + 2.4), phase: hash(e0 * 8.1 + 6.6), r: 3.4 + 3.2 * hash(e0 * 13.3 + 1.7) };
      eg.appendChild(d0); el.embers.push(d0);
    }
    el.sparks = [];
    for (var i = 0; i < 30; i++) {
      var c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("fill", i % 3 === 0 ? "#ff9a4a" : (i % 3 === 1 ? "#ffcf95" : "#ffe6c2"));
      c.setAttribute("opacity", 0);
      c._seed = { y: hash(i * 3.7 + 1.2), phase: hash(i * 7.3 + 4.1), r: 1.2 + 2.0 * hash(i * 11.9 + 2.6) };
      g.appendChild(c); el.sparks.push(c);
    }
    el.flames = [];
    var fg = $("burn-flames");
    var fOff = [-238, -196, -160, -126, -92, -60, -30, 2, 36, 72, 112, 158, 208];
    var fShapes = [
      "M0 0 C 4 -9 2.8 -17 0 -24 C -2.8 -17 -4 -9 0 0 Z",
      "M0 0 C 4.6 -8 3.6 -16 1.8 -23 C -0.4 -17 -3 -9 0 0 Z",
      "M0 0 C 3.4 -8 1.8 -15 -1.4 -22 C -3.6 -15 -3.2 -9 0 0 Z"
    ];
    for (var f = 0; f < fOff.length; f++) {
      var gp = document.createElementNS("http://www.w3.org/2000/svg", "g");
      var o1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
      o1.setAttribute("d", fShapes[f % 3]);
      o1.setAttribute("fill", f % 4 === 0 ? "#ff5e1a" : (f % 2 ? "#ff7a2a" : "#ff9346"));
      var o2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
      o2.setAttribute("d", fShapes[(f + 1) % 3]);
      o2.setAttribute("fill", "#ffd9a0");
      o2.setAttribute("transform", "scale(0.58)");
      gp.appendChild(o1); gp.appendChild(o2);
      gp._seed = {
        off: fOff[f], phase: hash(f * 7.7 + 2.2),
        h: 0.7 + 0.8 * hash(f * 5.3 + 1.9),
        w: 0.9 + 0.55 * hash(f * 9.7 + 3.1),
        tilt: (hash(f * 4.1 + 0.6) * 2 - 1) * 13
      };
      fg.appendChild(gp); el.flames.push(gp);
    }
    el.smokes = [];
    for (var j = 0; j < 5; j++) {
      var e = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      e.setAttribute("fill", "url(#smoke-grad)");
      e.setAttribute("opacity", 0);
      e._seed = { y: hash(j * 5.1 + 0.7), phase: hash(j * 9.7 + 3.3), o: 0.5 + 0.5 * hash(j * 2.3 + 8.8) };
      sg.appendChild(e); el.smokes.push(e);
    }
  }

  // 角标落点：按屏幕坐标换算，等比装进左上角卷轴卡（.seal-art）
  function cornerTarget() {
    if (!L.targetBox) {
      var b = el.brand.getBBox();
      L.targetBox = { x: b.x, y: b.y, w: Math.max(b.width, 1), h: Math.max(b.height, 1) };
    }
    var box = L.targetBox;
    var host = el.sealArt || uiBrand;
    var r = host ? host.getBoundingClientRect() : { left: 0, top: 0, width: 72, height: 72 };
    var slotW = Math.max(r.width || 72, 1), slotH = Math.max(r.height || 72, 1);
    var m = null, s = 1;
    try { m = el.stage.getScreenCTM(); s = m.a || 1; } catch (e) {}
    var p = { x: r.left, y: r.top };
    if (m) {
      try { var q = new DOMPoint(r.left, r.top).matrixTransform(m.inverse()); p = { x: q.x, y: q.y }; } catch (e) {}
    }
    var scf = Math.min(slotW / (box.w * s), slotH / (box.h * s));
    var offx = (slotW - box.w * scf * s) / (2 * s);
    var offy = (slotH - box.h * scf * s) / (2 * s);
    return { tx: p.x + offx - box.x * scf, ty: p.y + offy - box.y * scf, sc: scf,
             px: p.x, py: p.y, bx: box.x, by: box.y };
  }

  // 手写字标落点：手写 LOCUS 飞向顶栏 .brand-en，与之完全重合后交接
  function locusTarget() {
    var b = L.locusBox;
    var r = el.brandEn.getBoundingClientRect();
    // 窄屏顶栏不显示字标：没有落点就留在角标下方，随覆盖层一起收场
    if (r.width < 8 || r.height < 4) return null;
    var m = null, s = 1;
    try { m = el.stage.getScreenCTM(); s = m.a || 1; } catch (e) {}
    var p = { x: r.left, y: r.top };
    if (m) {
      try { var q = new DOMPoint(r.left, r.top).matrixTransform(m.inverse()); p = { x: q.x, y: q.y }; } catch (e) {}
    }
    var w = Math.max(r.width / s, 1), h = Math.max(r.height / s, 1);
    var sc = Math.min(w / b.w, h / b.h);
    var offx = (w - b.w * sc) / 2, offy = (h - b.h * sc) / 2;
    return { sc: sc, tx: p.x + offx - b.x * sc, ty: p.y + offy - b.y * sc,
             cx: p.x + offx + b.w * sc / 2, cy: p.y + offy + b.h * sc / 2 };
  }

  // 徽记纸卡几何：近正方形构图，四周留白，两端细轴略探出纸边
  function layoutMark(b, s) {
    var H = b.height * s;
    var cw = 296, ch = Math.max(180, H + 96);
    var x0 = 600 - cw / 2, y0 = 548 - ch / 2;
    function box(el, x, y, w, h) {
      el.setAttribute("x", x.toFixed(1));
      el.setAttribute("y", y.toFixed(1));
      el.setAttribute("width", w.toFixed(1));
      el.setAttribute("height", h.toFixed(1));
    }
    box(el.markPaper, x0, y0, cw, ch);
    box(el.markShadow, x0, y0, cw, ch);
    box(el.markInner, x0 + 7, y0 + 7, cw - 14, ch - 14);
    box(el.markEdgeT, x0, y0, cw, 12);
    box(el.markEdgeB, x0, y0 + ch - 12, cw, 12);
    box(el.markRodL, x0 - 6, y0 - 9, 10, ch + 18);
    box(el.markRodR, x0 + cw - 4, y0 - 9, 10, ch + 18);
    var kn = [[x0 - 1, y0 - 12], [x0 - 1, y0 + ch + 12], [x0 + cw + 1, y0 - 12], [x0 + cw + 1, y0 + ch + 12]];
    var cs = el.markKnobs.querySelectorAll("circle");
    for (var i = 0; i < cs.length; i++) {
      cs[i].setAttribute("cx", kn[i][0].toFixed(1));
      cs[i].setAttribute("cy", kn[i][1].toFixed(1));
    }
    L.mark = { cx: 600, cy: 548, x0: x0, y0: y0, w: cw, h: ch };
  }

  // 品牌组合排版：研迹居中，朱印在其右侧，LOCUS 在下方
  function layoutBrand() {
    var b = el.yanjiPaths.getBBox();
    if (!b.width) { b = { x: 0, y: 0, width: 300, height: 140 }; }
    var s = 236 / b.width;
    var hh = (b.height * s) / 2;
    L.yanjiT = "translate(600 548) scale(" + s.toFixed(4) + ") translate(" +
      (-(b.x + b.width / 2)).toFixed(2) + " " + (-(b.y + b.height / 2)).toFixed(2) + ")";
    el.yanji.setAttribute("transform", L.yanjiT);
    layoutMark(b, s);
    var mb = el.mark.getBBox();
    L.markBox = { x: mb.x, y: mb.y, w: mb.width, h: mb.height };

    L.sealPosT = "translate(" + (L.mark.x0 + L.mark.w - 25 - 889).toFixed(1) + " " +
      (L.mark.y0 + L.mark.h - 23 - 407).toFixed(1) + ")";
    el.sealPos.setAttribute("transform", L.sealPosT);

    var b2 = el.locusPaths.getBBox();
    if (!b2.width) { b2 = { x: 0, y: 0, width: 320, height: 60 }; }
    var s2 = 150 / b2.width;
    L.locusS = s2;
    L.locusBox = { x: b2.x, y: b2.y, w: b2.width, h: b2.height };
    L.locusY = L.mark.y0 + L.mark.h + 29;
    L.locusT = "translate(600 " + L.locusY.toFixed(1) + ") scale(" + s2.toFixed(4) + ") translate(" +
      (-(b2.x + b2.width / 2)).toFixed(2) + " " + (-(b2.y + b2.height / 2)).toFixed(2) + ")";
    el.locusBelow.setAttribute("transform", L.locusT);
    // 手写笔顺取材于卷内稿，按同一映射落到最终字位
    L.locusPenT = L.locusT + " translate(199.92 265.14) scale(0.65366)";
    el.locusPen.setAttribute("transform", L.locusPenT);

    // 角标落点按中心构图缓存，卷筒/纸卡不参与包围盒
    if (!el.logoRoll) el.logoRoll = $("logo-roll");
    if (el.logoCard && el.logoCard.parentNode) {
      el.logoCard.parentNode.removeChild(el.logoCard);
      el.logoCard = null;
    }
    el.logoRoll.setAttribute("display", "none");
    // 角标只装卡片（轴与轴头算入），手写字标单独飞向顶栏
    L.targetBox = { x: L.mark.x0 - 6, y: L.mark.y0 - 14.6,
                    w: L.mark.w + 12, h: L.mark.h + 29.2 };
    buildCornerCard();
  }

  // 角标纸卡：复制徽记纸卡几何，作为卷筒在角落展开后的卡面
  function buildCornerCard() {
    if (el.logoCard && el.logoCard.parentNode) {
      el.logoCard.parentNode.removeChild(el.logoCard);
    }
    var c = el.mark.cloneNode(true);
    var ids = c.querySelectorAll("[id]");
    for (var i = 0; i < ids.length; i++) { ids[i].removeAttribute("id"); }
    c.removeAttribute("id");
    c.setAttribute("opacity", "1");
    c.setAttribute("display", "none");
    el.mark.parentNode.insertBefore(c, el.mark.nextSibling);
    el.logoCard = c;
  }

  function penPaths(group) {
    return Array.prototype.map.call(group.querySelectorAll("path"), function (p) {
      var len = p.getTotalLength();
      p.setAttribute("stroke-dasharray", len.toFixed(1) + " " + (len + 6).toFixed(1));
      p.setAttribute("stroke-dashoffset", (len + 1).toFixed(1));
      return { el: p, len: len };
    });
  }

  function measureView() {
    // slice 裁切后的可见舞台右缘：窄屏（4:3 等）时页面右缘比 1200 更早出画
    var r = el.stage.getBoundingClientRect();
    var aspect = r.width / Math.max(1, r.height);
    L.viewRight = aspect >= 1.5 ? 1200 : 600 + 600 * aspect / 1.5;
  }

  function measure() {
    measureView();
    L.tlLen = el.tlPath.getTotalLength();
    el.tlPath.setAttribute("stroke-dasharray", L.tlLen + " " + (L.tlLen + 8));
    el.tlPath.setAttribute("stroke-dashoffset", L.tlLen + 4);

    L.leadA = el.leadA.getTotalLength();
    el.leadA.setAttribute("stroke-dasharray", L.leadA + " " + (L.leadA + 8));
    el.leadA.setAttribute("stroke-dashoffset", L.leadA + 3);
    L.leadB = el.leadB.getTotalLength();
    el.leadB.setAttribute("stroke-dasharray", L.leadB + " " + (L.leadB + 8));
    el.leadB.setAttribute("stroke-dashoffset", L.leadB + 3);

    L.penY = penPaths(el.yanjiPen);
    L.penL = penPaths(el.locusPen);

    // 节点在线上的位置：取 x 首次到达该点的进度
    var xs = [372, 500, 628, 756, 845];
    L.nodeFrac = xs.map(function (x) {
      for (var k = 1; k <= 500; k++) {
        if (el.tlPath.getPointAtLength((L.tlLen * k) / 500).x >= x) { return k / 500; }
      }
      return 1;
    });

    layoutBrand();

    var sb = el.sealMark.getBBox();
    var sk = 16.5 / Math.max(sb.width, sb.height, 1);
    el.sealMark.setAttribute("transform",
      "translate(889 407) scale(" + sk + ") translate(" +
      (-(sb.x + sb.width / 2)) + " " + (-(sb.y + sb.height / 2)) + ")");
  }

  function drawPen(list, t0, t1) {
    var n = list.length, span = t1 - t0, done = 0;
    for (var i = 0; i < n; i++) {
      var s0 = t0 + span * (i / n) * 0.94;
      var dur = (span / n) * 1.7;
      var p = clamp01((t - s0) / dur);
      list[i].el.setAttribute("stroke-dashoffset", (list[i].len * (1 - p) + 0.8).toFixed(1));
      if (p >= 1) { done++; }
    }
    return done === n;
  }

  function render(t) {
    // P1 首帧即合拢卷轴；纸卷展开瞬间快速让位给实体卷轴
    var ein = easeOutCubic(clamp01(t / T.in1));
    var closedOp = t < T.open0 ? 1 : 0;
    el.closed.setAttribute("opacity", (ein * closedOp).toFixed(3));
    el.closed.setAttribute("transform",
      "translate(600 338) scale(" + (0.94 + 0.06 * ein).toFixed(4) + ") translate(-600 -338)");

    // P2 展开：纸卷变薄、接缝滚动、带 4% 回弹
    var p2raw = clamp01(seg(T.open0, T.open1));
    var p2 = easeOutBack(p2raw, 0.55);
    var p2v = clamp01(p2);
    el.scrollMain.setAttribute("opacity", (t < T.open0 || t >= T.rollFly0) ? 0 : 1);
    var w = 8 + 632 * p2;
    var px = 600 - w / 2;
    el.paper.setAttribute("x", px);
    el.paper.setAttribute("width", w);
    el.scrollShadow.setAttribute("x", px - 30);
    el.scrollShadow.setAttribute("width", w + 60);
    el.paperInner.setAttribute("x", px + 9);
    el.paperInner.setAttribute("width", Math.max(0, w - 18));
    el.clip.setAttribute("x", px);
    el.clip.setAttribute("width", w);
    var rl = 583 - 319 * p2, rr = 601 + 319 * p2;
    el.rollers[0].setAttribute("x", rl);
    el.rollers[1].setAttribute("x", rr);
    el.knobsLeft.setAttribute("transform", "translate(" + (-319 * p2) + " 0)");
    el.knobsRight.setAttribute("transform", "translate(" + (319 * p2) + " 0)");
    el.shadeLeft.setAttribute("x", rl + 16);
    el.shadeRight.setAttribute("x", rr - 24);
    var cw = 23 - 18 * p2v;
    el.coilL.setAttribute("x", (rl + 16 - cw).toFixed(1));
    el.coilL.setAttribute("width", cw.toFixed(1));
    el.coilR.setAttribute("x", rr.toFixed(1));
    el.coilR.setAttribute("width", cw.toFixed(1));
    var spin = -30 * easeInOutCubic(p2v);
    el.seamL.setAttribute("transform", "translate(" + (rl + 16 - cw).toFixed(1) + " " + (228 + spin).toFixed(1) + ")");
    el.seamR.setAttribute("transform", "translate(" + rr.toFixed(1) + " " + (228 + spin).toFixed(1) + ")");

    // P3 时间线：起笔原点 → 自左向右经过五个节点
    var od = easeOutCubic(seg(T.origin0, T.origin1));
    el.tlOrigin.setAttribute("opacity", (0.95 * od).toFixed(3));
    el.tlOrigin.setAttribute("r", (1.5 + 1.7 * od).toFixed(2));
    var pTl = clamp01((t - T.tl0) / (T.tl1 - T.tl0));
    el.tlPath.setAttribute("stroke-dashoffset", (L.tlLen * (1 - pTl) + 2).toFixed(2));
    for (var i = 0; i < el.nodes.length; i++) {
      var tn = T.tl0 + (T.tl1 - T.tl0) * L.nodeFrac[i];
      var act = easeOutCubic(clamp01((t - tn) / 280));
      el.nodes[i].setAttribute("opacity", act.toFixed(3));
      var dot = el.nodes[i].querySelector(".tn-dot");
      dot.setAttribute("r", (1.4 + 1.8 * act).toFixed(2));
    }

    // P4 出卷引线，末端收细后进入书写
    var la = easeInOutCubic(clamp01((t - T.lead0) / (T.leadA1 - T.lead0)));
    el.leadA.setAttribute("stroke-dashoffset", (L.leadA * (1 - la) + 2).toFixed(2));
    var lb = easeInOutCubic(clamp01((t - T.leadB0) / (T.lead1 - T.leadB0)));
    el.leadB.setAttribute("stroke-dashoffset", (L.leadB * (1 - lb) + 2).toFixed(2));
    el.lead.setAttribute("opacity", (1 - clamp01(seg(T.leadFade0, T.leadFade1))).toFixed(3));

    // 角标落点与角标变换前缀：卷筒起飞后缓存一次
    var corner = t >= T.rollFly0 ? cornerTarget() : null;
    var cgT = corner
      ? "translate(" + corner.tx.toFixed(2) + " " + corner.ty.toFixed(2) +
        ") scale(" + corner.sc.toFixed(4) + ") "
      : "";
    var ccx = corner ? 600 * corner.sc + corner.tx : 600;
    var ccy = corner ? 548 * corner.sc + corner.ty : 548;

    // 收卷时中心字迹淡出，角标展开后在卡面上重写
    var brandFade = 1 - easeOutCubic(clamp01(seg(T.ink0, T.ink1)));

    // P5 研迹手写：10 + 10 笔，收笔后整字落定；收尾时淡出、角标处重写
    if (t < T.ink0) {
      var writeDone = t >= T.text1;
      if (!writeDone) {
        if (el.yanjiGlyphs.getAttribute("mask") !== "url(#mask-brand)") {
          el.yanjiGlyphs.setAttribute("mask", "url(#mask-brand)");
        }
        drawPen(L.penY.slice(0, 10), T.text0, 3840);
        drawPen(L.penY.slice(10), 3840, T.text1);
        el.yanjiFill.setAttribute("opacity", clamp01((t - (T.text1 - 40)) / 90).toFixed(3));
      } else if (el.yanjiGlyphs.hasAttribute("mask")) {
        el.yanjiGlyphs.removeAttribute("mask");
      }
      el.yanjiGlyphs.setAttribute("opacity", 1);
      el.yanji.setAttribute("transform", L.yanjiT);
      el.yanjiPen.removeAttribute("transform");
    } else if (t < T.writeY0) {
      el.yanjiGlyphs.removeAttribute("mask");
      el.yanji.setAttribute("transform", L.yanjiT);
      el.yanjiGlyphs.setAttribute("opacity", brandFade.toFixed(3));
      el.yanjiPen.removeAttribute("transform");
    } else {
      el.yanji.setAttribute("transform", cgT + L.yanjiT);
      el.yanjiGlyphs.setAttribute("opacity", 1);
      if (t < T.writeY1) {
        el.yanjiGlyphs.setAttribute("mask", "url(#mask-brand)");
        if (cgT) { el.yanjiPen.setAttribute("transform", cgT.trim()); }
        else { el.yanjiPen.removeAttribute("transform"); }
        el.yanjiFill.setAttribute("opacity", clamp01((t - (T.writeY1 - 70)) / 90).toFixed(3));
        drawPen(L.penY, T.writeY0, T.writeY1);
      } else {
        el.yanjiGlyphs.removeAttribute("mask");
        el.yanjiFill.setAttribute("opacity", 1);
      }
    }

    // P6 LOCUS 手写（复用手写显现），随后朱印落款；收尾时淡出、角标处重写
    if (t < T.ink0) {
      if (t < T.locusFill1) {
        if (el.locusGlyphs.getAttribute("mask") !== "url(#mask-locus)") {
          el.locusGlyphs.setAttribute("mask", "url(#mask-locus)");
        }
        drawPen(L.penL, T.locus0, T.locus1);
        el.locusFill.setAttribute("opacity", clamp01((t - T.locus1) / 60).toFixed(3));
      } else if (el.locusGlyphs.hasAttribute("mask")) {
        el.locusGlyphs.removeAttribute("mask");
      }
      el.locusLift.setAttribute("opacity", 1);
      el.locusBelow.setAttribute("transform", L.locusT);
      el.locusPen.setAttribute("transform", L.locusPenT);
    } else if (t < T.writeL0) {
      el.locusGlyphs.removeAttribute("mask");
      el.locusBelow.setAttribute("transform", L.locusT);
      el.locusLift.setAttribute("opacity", brandFade.toFixed(3));
      el.locusPen.setAttribute("transform", L.locusPenT);
    } else {
      el.locusLift.setAttribute("opacity", 1);
      if (t < T.writeL1) {
        el.locusBelow.setAttribute("transform", cgT + L.locusT);
        el.locusGlyphs.setAttribute("mask", "url(#mask-locus)");
        el.locusPen.setAttribute("transform", cgT + L.locusPenT);
        el.locusFill.setAttribute("opacity", clamp01((t - (T.writeL1 - 70)) / 90).toFixed(3));
        drawPen(L.penL, T.writeL0, T.writeL1);
      } else {
        el.locusGlyphs.removeAttribute("mask");
        el.locusFill.setAttribute("opacity", 1);
        if (t < T.flyL0) {
          el.locusBelow.setAttribute("transform", cgT + L.locusT);
        } else {
          // 写完后离角，飞向顶栏字标槽位，落定即与真实界面重合
          var lt = locusTarget();
          if (!lt) {
            el.locusBelow.setAttribute("transform", cgT + L.locusT);
          } else {
            var fp = easeInOutCubic(seg(T.flyL0, T.flyL1));
            var fx0 = corner.tx + 600 * corner.sc;
            var fy0 = corner.ty + L.locusY * corner.sc;
            var fs0 = L.locusS * corner.sc;
            var fx = fx0 + (lt.cx - fx0) * fp;
            var fy = fy0 + (lt.cy - fy0) * fp - 26 * Math.sin(Math.PI * fp);
            var fs = fs0 + (lt.sc - fs0) * fp;
            el.locusBelow.setAttribute("transform",
              "translate(" + fx.toFixed(2) + " " + fy.toFixed(2) + ") scale(" + fs.toFixed(4) + ") " +
              "translate(" + (-(L.locusBox.x + L.locusBox.w / 2)).toFixed(2) + " " +
              (-(L.locusBox.y + L.locusBox.h / 2)).toFixed(2) + ")");
          }
        }
      }
    }

    // 朱印：中段落款，收卷时随字淡出，角标展开后重落
    var sealP = null;
    if (t < T.ink0) {
      sealP = seg(T.seal0, T.seal1);
      el.sealPos.setAttribute("transform", L.sealPosT);
    } else if (t >= T.sealC0) {
      sealP = seg(T.sealC0, T.sealC1);
      el.sealPos.setAttribute("transform", cgT + L.sealPosT);
    } else {
      el.sealPos.setAttribute("transform", L.sealPosT);
    }
    if (sealP === null) {
      el.seal.setAttribute("opacity", brandFade.toFixed(3));
      if (t >= T.ink0) {
        el.seal.setAttribute("transform",
          "translate(889 407) rotate(-2) scale(1) translate(-889 -407)");
      }
      el.sealBloom.setAttribute("opacity", 0);
    } else {
      var press = clamp01(sealP / 0.45);
      var s9 = sealP < 0.45
        ? 1.6 - 0.6 * easeOutCubic(press)
        : 1 + 0.02 * Math.sin(Math.PI * clamp01((sealP - 0.45) / 0.55));
      el.seal.setAttribute("opacity", clamp01(sealP / 0.16).toFixed(3));
      el.seal.setAttribute("transform",
        "translate(889 407) rotate(" + (-5 + 3 * sealP).toFixed(2) +
        ") scale(" + s9.toFixed(3) + ") translate(-889 -407)");
      var pb = clamp01((sealP - 0.06) / 0.6);
      el.sealBloom.setAttribute("r", (pb >= 1 ? 12 : 12 + 36 * easeOutCubic(pb)).toFixed(1));
      el.sealBloom.setAttribute("opacity", (1 - pb).toFixed(3));
    }

    // P7 收卷：左轴带卷筒右行，纸面自卷筒右沿卷入；界面显现的边界即卷筒右沿，
    //       轴头走到哪里界面就露到哪里，直到卷筒越出右缘，纸面（含右侧空白边）刚好收净
    el.scrollMain.setAttribute("opacity", (t < T.open0 || t >= T.rollFly0) ? 0 : 1);
    el.deskSolid.setAttribute("opacity", 1);
    el.burnEdge.setAttribute("opacity", 0);

    var rollP = easeInOutCubic(seg(T.roll0, T.roll1));
    // 收卷终点随可见右缘走：16:9 时卷筒恰好越出画外，窄屏时到可见边缘即收净
    var endFront = (L.viewRight || 1200) + 10;
    var front = 280 + (endFront - 280) * rollP;
    var paperP = clamp01((front - 280) / 640);
    var coilW = 5 + 44 * paperP;
    var coilX = front - coilW;
    var rl = coilX - 11;
    // 纸面收净后，右轴随卷筒一同撤出画外，别留在原地
    var extra = Math.max(0, front - 920);
    if (t >= T.roll0) {
      el.rollers[0].setAttribute("x", rl.toFixed(1));
      el.rollers[1].setAttribute("x", (920 + extra).toFixed(1));
      el.knobsLeft.setAttribute("transform", "translate(" + (rl - 583).toFixed(1) + " 0)");
      el.knobsRight.setAttribute("transform", "translate(" + (319 + extra).toFixed(1) + " 0)");
      el.coilL.setAttribute("x", coilX.toFixed(1));
      el.coilL.setAttribute("width", coilW.toFixed(1));
      el.coilR.setAttribute("x", (920 + extra).toFixed(1));
      el.shadeLeft.setAttribute("x", (front - 1).toFixed(1));
      el.coilContact.setAttribute("x", (rl - 26).toFixed(1));
      el.coilContact.setAttribute("opacity", (0.38 * clamp01(seg(T.roll0, T.roll0 + 160))).toFixed(3));
      el.coilShade.setAttribute("x", (front + 16).toFixed(1));
      el.coilShade.setAttribute("opacity", (0.9 * clamp01(extra / 24)).toFixed(3));
      var spinL = ((front - 280) * 1.5) % 54;
      var spinR = ((front - 280) * 0.8) % 54;
      el.seamL.setAttribute("transform",
        "translate(" + coilX.toFixed(1) + " " + (228 - 30 + spinL).toFixed(1) + ")");
      el.seamR.setAttribute("transform",
        "translate(" + (920 + extra).toFixed(1) + " " + (228 - 30 + spinR).toFixed(1) + ")");
    } else {
      el.coilContact.setAttribute("opacity", 0);
      el.coilShade.setAttribute("opacity", 0);
    }

    if (t >= T.roll0) {
      el.paperWorld.setAttribute("mask", "url(#reveal-keep)");
      el.rollClip.setAttribute("x", coilX.toFixed(1));
      el.rollClip.setAttribute("width", Math.max(0, 920 - coilX).toFixed(1));
      // 起卷时界面从屏幕左缘扫入，追上前沿后锁定，避免开卷瞬间左侧整块跳变
      var intro = 336 * (1 - easeOutCubic(seg(T.roll0, T.roll0 + 240)));
      el.revealRect.setAttribute("x", (front - 5 - intro).toFixed(1));
    } else {
      el.paperWorld.removeAttribute("mask");
      el.rollClip.setAttribute("x", "0");
      el.rollClip.setAttribute("width", "2000");
    }

    // 卷筒与轴头一直画在界面之上；纸面收净后由飞角卷筒接管，无需再用遮罩抹残轴
    el.furniture.setAttribute("opacity", (t < T.open0 || t >= T.rollFly0) ? 0 : 1);
    el.furniture.removeAttribute("transform");
    el.furniture.removeAttribute("mask");

    // 徽记纸卡：中央不再出现，仅保留几何作为角标卡面模板
    el.mark.setAttribute("opacity", 0);
    el.mark.removeAttribute("transform");

    // 备用版面不参与本版收尾
    el.brandLit.setAttribute("opacity", 0);
    el.brandEmber.setAttribute("opacity", 0);
    el.brand.removeAttribute("transform");

    // P8 卷筒飞角标：收卷完成的实体卷筒接管画面，从右缘缩到角标位
    if (corner) {
      var rollH = L.markBox.h * corner.sc;
      var rs = rollH / 231.8;
      var rf = easeInOutCubic(seg(T.rollFly0, T.rollFly1));
      // 起飞首帧对齐收卷末帧的卷筒：窄屏时卷筒未收满，横向随卷宽微缩
      var scx = coilW / 49;
      var tx0 = (coilX + front) / 2 - 895.5 * scx;
      var px0 = tx0 + 898 * scx;
      var px = px0 + (ccx - px0) * rf;
      var py = 336 + (ccy - 336) * rf;
      var sx = scx + (rs - scx) * rf;
      var sy = 1 + (rs - 1) * rf;
      el.logoRoll.setAttribute("display", "inline");
      el.logoRoll.setAttribute("transform",
        "translate(" + (px - 898 * sx).toFixed(2) + " " + (py - 336 * sy).toFixed(2) +
        ") scale(" + sx.toFixed(5) + " " + sy.toFixed(5) + ")");
      el.logoRoll.setAttribute("opacity",
        (1 - easeOutCubic(seg(T.cardO0, T.cardO0 + 100))).toFixed(3));
    } else {
      el.logoRoll.setAttribute("display", "none");
      el.logoRoll.setAttribute("opacity", 0);
    }

    // P9 角标展开：纸卡从卷筒轮廓横向展开
    if (corner && t >= T.cardO0) {
      var op = easeInOutCubic(seg(T.cardO0, T.cardO1));
      var narrow = (L.markBox.h * corner.sc * (76 / 231.8)) / L.markBox.w;
      var sx = narrow + (corner.sc - narrow) * op;
      el.logoCard.setAttribute("display", "inline");
      el.logoCard.setAttribute("transform",
        "translate(" + (ccx - 600 * sx).toFixed(3) + " " +
        (ccy - 548 * corner.sc).toFixed(3) +
        ") scale(" + sx.toFixed(5) + " " + corner.sc.toFixed(5) + ")");
    } else if (el.logoCard) {
      el.logoCard.setAttribute("display", "none");
    }
  }

  // 真实界面的左上角是同款卷轴卡（纸卡＋研迹＋朱印），卡落定后手写 LOCUS 再飞向顶栏字标；
// 两处落点与真实界面重合，覆盖层淡出即完成交接。

  // ===== 声音：纸、木、笔、印的触感层 + 五声音阶 + 低频 pad =====
  // 全部程序化合成，不引入外部音频；整轨在 begin() 时按 AudioContext 时钟一次排好。
  var AUD = { ctx: null, master: null, sess: null, run: null };

  function makeIR(c, dur) {
    var n = Math.floor(c.sampleRate * dur), b = c.createBuffer(2, n, c.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch), lp = 0;
      for (var i = 0; i < n; i++) {
        var k = i / n;
        var x = (Math.random() * 2 - 1) * Math.pow(1 - k, 2.8);
        lp += 0.22 * (x - lp);
        d[i] = lp;
      }
    }
    return b;
  }

  function makeSession(c) {
    var n = Math.floor(c.sampleRate * 2), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return { noise: b, ir: makeIR(c, 1.8) };
  }

  // DynamicsCompressorNode 在离线渲染时会在每次起音后 ~6ms 产生单点脉冲，
  // 改用无延迟线的软限幅 WaveShaper，低于 0.6 近似透明，只压顶部。
  function makeLimiter(c) {
    var n = 4097, curve = new Float32Array(n), k = 2.2;
    for (var i = 0; i < n; i++) {
      var x = i / (n - 1) * 2 - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    var w = c.createWaveShaper();
    w.curve = curve; w.oversample = "2x";
    return w;
  }

  function audioCtx() {
    if (!AUD.ctx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      AUD.ctx = new C();
      AUD.master = AUD.ctx.createGain();
      AUD.master.gain.value = 1.25;
      AUD.master.connect(makeLimiter(AUD.ctx)).connect(AUD.ctx.destination);
    }
    if (AUD.ctx.state === "suspended") AUD.ctx.resume();
    return AUD.ctx;
  }

  function noiseAt(c, when, dur) {
    var s = c.createBufferSource();
    s.buffer = AUD.sess.noise; s.loop = true;
    s.start(when, Math.random() * 1.4); s.stop(when + dur + 0.03);
    return s;
  }
  function wet(c, run, node, amt) {
    if (!amt) return;
    var g = c.createGain(); g.gain.value = amt;
    node.connect(g); g.connect(run.revSend);
  }

  // Chrome 在 setValueAtTime 恰逢整帧边界时，首个渲染块会瞬时回落默认增益 1，
  // 造成一声单点爆音；在包络起点前补一个极小值事件即可规避。
  function envPre(p, when) { p.setValueAtTime(0.0001, Math.max(0, when - 0.005)); }

  // 纸：带通噪声横扫 + 纤维颗粒
  function sfxPaper(c, run, when, dur, g) {
    var s = noiseAt(c, when, dur);
    var bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.75;
    bp.frequency.setValueAtTime(700 + Math.random() * 300, when);
    bp.frequency.linearRampToValueAtTime(2100 + Math.random() * 600, when + dur * 0.45);
    bp.frequency.linearRampToValueAtTime(1100, when + dur);
    var lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5600;
    var gn = c.createGain(); envPre(gn.gain, when);
    gn.gain.setValueAtTime(0.0001, when);
    gn.gain.exponentialRampToValueAtTime(g, when + dur * 0.3);
    gn.gain.exponentialRampToValueAtTime(g * 0.6, when + dur * 0.72);
    gn.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    s.connect(bp); bp.connect(lp); lp.connect(gn); gn.connect(run.gain);
    wet(c, run, gn, 0.1);
    var nb = Math.round(dur * 22);
    for (var i = 0; i < nb; i++) {
      var tt = when + Math.random() * dur * 0.9, d = 0.004 + Math.random() * 0.01;
      var cs = noiseAt(c, tt, d);
      var cb = c.createBiquadFilter(); cb.type = "bandpass";
      cb.frequency.value = 1500 + Math.random() * 2800; cb.Q.value = 2.4;
      var cg = c.createGain(), amp = g * (0.2 + Math.random() * 0.55); envPre(cg.gain, tt);
      cg.gain.setValueAtTime(0.0001, tt);
      cg.gain.exponentialRampToValueAtTime(amp, tt + 0.002);
      cg.gain.exponentialRampToValueAtTime(0.0001, tt + d);
      cs.connect(cb); cb.connect(cg); cg.connect(run.gain);
    }
  }

  // 木：模态敲击，音高下坠 + 高频瞬态
  function sfxKnock(c, run, when, f, g, dur, wetAmt) {
    var o = c.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(f, when);
    o.frequency.exponentialRampToValueAtTime(f * 0.55, when + dur * 0.7);
    var gn = c.createGain(); envPre(gn.gain, when);
    gn.gain.setValueAtTime(0.0001, when);
    gn.gain.exponentialRampToValueAtTime(g, when + 0.005);
    gn.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(gn); gn.connect(run.gain);
    o.start(when); o.stop(when + dur + 0.03);
    wet(c, run, gn, wetAmt || 0.18);
    var s = noiseAt(c, when, 0.012);
    var hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1800;
    var hg = c.createGain(); envPre(hg.gain, when);
    hg.gain.setValueAtTime(g * 0.5, when);
    hg.gain.exponentialRampToValueAtTime(0.0001, when + 0.012);
    s.connect(hp); hp.connect(hg); hg.connect(run.gain);
  }

  // 古琴/古筝拨弦：谐波叠加 + 指甲声
  function sfxPluck(c, run, when, f, g, decay) {
    var parts = [[1, 1, 1], [2, 0.38, 0.55], [3, 0.16, 0.34], [4.02, 0.07, 0.22]];
    for (var i = 0; i < parts.length; i++) {
      var o = c.createOscillator(); o.type = i === 0 ? "triangle" : "sine";
      o.frequency.value = f * parts[i][0] * (1 + (Math.random() - 0.5) * 0.0015);
      var gn = c.createGain(), gg = g * parts[i][1], dd = decay * parts[i][2]; envPre(gn.gain, when);
      gn.gain.setValueAtTime(0.0001, when);
      gn.gain.exponentialRampToValueAtTime(gg, when + 0.006);
      gn.gain.exponentialRampToValueAtTime(0.0001, when + dd);
      o.connect(gn); gn.connect(run.gain);
      wet(c, run, gn, 0.42);
      o.start(when); o.stop(when + dd + 0.05);
    }
    var s = noiseAt(c, when, 0.01);
    var hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2800;
    var hg = c.createGain(); envPre(hg.gain, when); hg.gain.setValueAtTime(g * 0.16, when);
    hg.gain.exponentialRampToValueAtTime(0.0001, when + 0.01);
    s.connect(hp); hp.connect(hg); hg.connect(run.gain);
  }

  // 磬：非谐泛音长音
  function sfxChime(c, run, when, f, g, decay) {
    var p = [[1, 1, 1], [2.76, 0.32, 0.42], [5.4, 0.11, 0.24]];
    for (var i = 0; i < p.length; i++) {
      var o = c.createOscillator(); o.type = "sine";
      o.frequency.value = f * p[i][0];
      var gn = c.createGain(), gg = g * p[i][1], dd = decay * p[i][2]; envPre(gn.gain, when);
      gn.gain.setValueAtTime(0.0001, when);
      gn.gain.exponentialRampToValueAtTime(gg, when + 0.008);
      gn.gain.exponentialRampToValueAtTime(0.0001, when + dd);
      o.connect(gn); gn.connect(run.gain); wet(c, run, gn, 0.6);
      o.start(when); o.stop(when + dd + 0.05);
    }
  }

  // 长音铺底：D2/A2 + 竹笛气声
  function sfxDrone(c, run, tA, tB, g) {
    var lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420; lp.Q.value = 0.4;
    var gn = c.createGain(); envPre(gn.gain, tA);
    gn.gain.setValueAtTime(0.0001, tA);
    gn.gain.exponentialRampToValueAtTime(g, tA + 0.5);
    gn.gain.setValueAtTime(g, tB - 0.6);
    gn.gain.exponentialRampToValueAtTime(0.0001, tB);
    lp.connect(gn); gn.connect(run.gain);
    var fs = [73.42, 110];
    for (var i = 0; i < fs.length; i++) {
      var o = c.createOscillator(); o.type = "triangle"; o.frequency.value = fs[i];
      var og = c.createGain(); og.gain.value = i ? 0.5 : 1;
      o.connect(og); og.connect(lp); o.start(tA); o.stop(tB + 0.05);
    }
    var s = noiseAt(c, tA, tB - tA);
    var bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 0.6;
    var ng = c.createGain(); envPre(ng.gain, tA); ng.gain.setValueAtTime(0.0001, tA);
    ng.gain.exponentialRampToValueAtTime(g * 0.18, tA + 0.9);
    ng.gain.exponentialRampToValueAtTime(0.0001, tB);
    s.connect(bp); bp.connect(ng); ng.connect(run.gain);
  }

  // 低频 pad：从"古"过渡到"工具"
  function sfxPad(c, run, tA, tHold, tB, g) {
    var lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 250; lp.Q.value = 0.5;
    var gn = c.createGain(); envPre(gn.gain, tA);
    gn.gain.setValueAtTime(0.0001, tA);
    gn.gain.linearRampToValueAtTime(g, tA + 1.25);
    gn.gain.setValueAtTime(g, tHold);
    gn.gain.exponentialRampToValueAtTime(0.0001, tB);
    lp.connect(gn); gn.connect(run.gain);
    var spec = [[73.42, "sawtooth", -5, 0.4], [110, "sawtooth", 4, 0.4], [146.83, "sine", 6, 0.32], [36.71, "sine", 0, 0.55]];
    for (var i = 0; i < spec.length; i++) {
      var o = c.createOscillator(); o.type = spec[i][1];
      o.frequency.value = spec[i][0]; o.detune.value = spec[i][2];
      var og = c.createGain(); og.gain.value = spec[i][3];
      o.connect(og); og.connect(lp); o.start(tA); o.stop(tB + 0.1);
    }
    var lfo = c.createOscillator(); lfo.frequency.value = 0.13;
    var lg = c.createGain(); lg.gain.value = 40;
    lfo.connect(lg); lg.connect(lp.frequency); lfo.start(tA); lfo.stop(tB + 0.1);
  }

  // 毛笔：带通噪声按行笔节奏起伏 + 细小沙粒
  function sfxBrush(c, run, tA, tB, g, swells) {
    var s = noiseAt(c, tA, tB - tA);
    var hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 600;
    var bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2400; bp.Q.value = 0.8;
    var gn = c.createGain(); envPre(gn.gain, tA);
    gn.gain.setValueAtTime(0.0001, tA);
    var span = tB - tA;
    for (var i = 0; i < swells.length; i++) {
      gn.gain.linearRampToValueAtTime(g * swells[i][1], tA + span * swells[i][0] + 0.05);
    }
    gn.gain.exponentialRampToValueAtTime(0.0001, tB);
    s.connect(hp); hp.connect(bp); bp.connect(gn); gn.connect(run.gain);
    var n = Math.round(span * 16);
    for (var k = 0; k < n; k++) {
      var tt = tA + Math.random() * span * 0.94, d = 0.004 + Math.random() * 0.008;
      var cs = noiseAt(c, tt, d);
      var cb = c.createBiquadFilter(); cb.type = "bandpass";
      cb.frequency.value = 2000 + Math.random() * 2200; cb.Q.value = 1.8;
      var cg = c.createGain(), amp = g * (0.15 + Math.random() * 0.5); envPre(cg.gain, tt);
      cg.gain.setValueAtTime(0.0001, tt);
      cg.gain.exponentialRampToValueAtTime(amp, tt + 0.002);
      cg.gain.exponentialRampToValueAtTime(0.0001, tt + d);
      cs.connect(cb); cb.connect(cg); cg.connect(run.gain);
    }
  }

  // 收卷时的木轴摩擦
  function sfxWoodRoll(c, run, tA, tB, g) {
    var s = noiseAt(c, tA, tB - tA);
    var bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 340; bp.Q.value = 2.6;
    var gn = c.createGain(); envPre(gn.gain, tA); gn.gain.setValueAtTime(0.0001, tA);
    gn.gain.linearRampToValueAtTime(g, tA + 0.35);
    gn.gain.linearRampToValueAtTime(0.0001, tB);
    var lfo = c.createOscillator(); lfo.frequency.value = 3.2;
    var lg = c.createGain(); lg.gain.value = g * 0.5;
    lfo.connect(lg); lg.connect(gn.gain);
    s.connect(bp); bp.connect(gn); gn.connect(run.gain);
    lfo.start(tA); lfo.stop(tB + 0.05);
  }

  function sfxAir(c, run, tA, tB, g) {
    var s = noiseAt(c, tA, tB - tA);
    var hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2600;
    var gn = c.createGain(); envPre(gn.gain, tA);
    gn.gain.setValueAtTime(0.0001, tA);
    gn.gain.linearRampToValueAtTime(g, (tA + tB) / 2);
    gn.gain.linearRampToValueAtTime(0.0001, tB);
    s.connect(hp); hp.connect(gn); gn.connect(run.gain);
  }

  // 合拢卷轴的轻晃：木轴吱声随两个摆幅起伏，宣纸轻擦，落定一声极轻的磕
  function sfxCreak(c, run, when) {
    var s = noiseAt(c, when, 0.72);
    var bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 5.5;
    bp.frequency.setValueAtTime(260, when);
    bp.frequency.linearRampToValueAtTime(430, when + 0.16);
    bp.frequency.linearRampToValueAtTime(310, when + 0.34);
    bp.frequency.linearRampToValueAtTime(370, when + 0.58);
    var gn = c.createGain(); envPre(gn.gain, when);
    gn.gain.setValueAtTime(0.0001, when);
    gn.gain.linearRampToValueAtTime(0.030, when + 0.16);
    gn.gain.linearRampToValueAtTime(0.012, when + 0.26);
    gn.gain.linearRampToValueAtTime(0.026, when + 0.36);
    gn.gain.linearRampToValueAtTime(0.0001, when + 0.60);
    s.connect(bp); bp.connect(gn); gn.connect(run.gain);
    wet(c, run, gn, 0.28);
    var p = noiseAt(c, when + 0.06, 0.5);
    var hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2200;
    var pg = c.createGain(); envPre(pg.gain, when);
    pg.gain.setValueAtTime(0.0001, when + 0.06);
    pg.gain.linearRampToValueAtTime(0.0042, when + 0.16);
    pg.gain.linearRampToValueAtTime(0.0018, when + 0.28);
    pg.gain.linearRampToValueAtTime(0.0001, when + 0.52);
    p.connect(hp); hp.connect(pg); pg.connect(run.gain);
    sfxKnock(c, run, when + 0.72, 150, 0.009, 0.05, 0.16);
  }

  // 首次悬停的轻晃声：仅在音频已解锁（此前有过点击）时发声
  function hoverCreak() {
    var c = AUD.ctx;
    if (!c || c.state !== "running") return;
    if (!AUD.sess) AUD.sess = makeSession(c);
    var run = { gain: c.createGain(), revSend: c.createGain(), rev: c.createConvolver(), revOut: c.createGain() };
    run.gain.gain.value = 1;
    run.revSend.gain.value = 0.5;
    run.rev.buffer = AUD.sess.ir;
    run.gain.connect(AUD.master);
    run.revSend.connect(run.rev); run.rev.connect(run.revOut); run.revOut.connect(AUD.master);
    sfxCreak(c, run, c.currentTime + 0.015);
    setTimeout(function () {
      try { run.gain.disconnect(); run.revSend.disconnect(); run.rev.disconnect(); run.revOut.disconnect(); } catch (e) {}
    }, 1500);
  }

  // 整条音轨：时间点全部取自动画时间轴 T / L.nodeFrac
  function buildScore(c, run, now, t0, sp) {
    function at(ms) { return now + Math.max(0, (ms - t0) / 1000 / sp); }
    function live(ms) { return ms >= t0 - 40; }

    if (live(T.open0)) {
      sfxPaper(c, run, at(T.open0 + 20), 0.72, 0.085);
      sfxKnock(c, run, at(T.open0 + 60), 92, 0.05, 0.16, 0.22);
      sfxKnock(c, run, at(T.open0 + 580), 78, 0.032, 0.13, 0.2);
    }
    if (live(T.tl0 - 20)) sfxKnock(c, run, at(T.tl0), 1600, 0.012, 0.02, 0.2);

    var notes = [146.83, 164.81, 196.0, 220.0, 261.63];
    var gains = [0.05, 0.056, 0.062, 0.068, 0.075];
    for (var i = 0; i < L.nodeFrac.length; i++) {
      var ms = T.tl0 + (T.tl1 - T.tl0) * L.nodeFrac[i];
      if (live(ms)) sfxPluck(c, run, at(ms), notes[i], gains[i], 1.25 - i * 0.08);
    }

    if (live(2550)) sfxDrone(c, run, at(2550), at(4250), 0.03);
    if (live(T.text0 - 60)) sfxBrush(c, run, at(T.text0), at(3840), 0.038,
      [[0.05, 0.45], [0.2, 0.9], [0.36, 0.5], [0.52, 1], [0.7, 0.55], [0.86, 0.85], [0.97, 0.4]]);
    if (live(T.locus0 - 20)) sfxBrush(c, run, at(T.locus0), at(3990), 0.021,
      [[0.15, 0.4], [0.5, 0.85], [0.85, 0.35]]);

    if (live(T.seal0)) {
      sfxKnock(c, run, at(3960), 96, 0.16, 0.14, 0.3);
      sfxChime(c, run, at(3975), 587.33, 0.075, 1.5);
    }

    if (live(T.roll0)) {
      sfxPaper(c, run, at(T.roll0 + 20), 0.92, 0.07);
      sfxWoodRoll(c, run, at(T.roll0 + 140), at(5140), 0.02);
      sfxKnock(c, run, at(4600), 76, 0.03, 0.12, 0.2);
      sfxKnock(c, run, at(4980), 70, 0.026, 0.12, 0.2);
    }
    if (live(4350)) sfxPad(c, run, at(4400), at(6300), at(6900), 0.05);
    if (live(5100)) sfxAir(c, run, at(5150), at(6900), 0.011);

    if (live(T.cardO0 - 80)) {
      sfxKnock(c, run, at(T.cardO0), 125, 0.085, 0.1, 0.3);
      sfxPaper(c, run, at(T.cardO0 + 10), 0.16, 0.036);
    }
    if (live(T.writeY0 - 100)) sfxBrush(c, run, at(T.writeY0), at(T.writeY1), 0.02,
      [[0.05, 0.5], [0.3, 0.95], [0.55, 0.5], [0.8, 0.85]]);
    if (live(T.writeL0 - 10)) sfxBrush(c, run, at(T.writeL0 + 20), at(T.writeL1), 0.016,
      [[0.1, 0.6], [0.55, 0.9]]);
    if (live(T.sealC0 + 100)) {
      sfxKnock(c, run, at(6334), 104, 0.075, 0.1, 0.25);
      sfxChime(c, run, at(6338), 880, 0.03, 0.7);
    }
    if (live(T.flyL0 - 20)) sfxAir(c, run, at(T.flyL0), at(T.flyL1), 0.014);
    if (live(T.flyL1 - 20)) sfxKnock(c, run, at(T.flyL1), 220, 0.006, 0.03, 0.12);
  }

  function audioStart(t0, sp) {
    var c = audioCtx(); if (!c) return;
    audioStop(0.05);
    AUD.sess = makeSession(c);
    var run = { gain: c.createGain(), revSend: c.createGain(), rev: c.createConvolver(), revOut: c.createGain() };
    run.gain.gain.value = 1;
    run.revSend.gain.value = 0.5;
    run.rev.buffer = AUD.sess.ir;
    run.gain.connect(AUD.master);
    run.revSend.connect(run.rev); run.rev.connect(run.revOut); run.revOut.connect(AUD.master);
    buildScore(c, run, c.currentTime + 0.03, t0, sp);
    AUD.run = run;
  }

  function audioStop(fade) {
    var run = AUD.run; if (!run) return;
    AUD.run = null;
    var c = AUD.ctx, now = c.currentTime, f = Math.max(0.03, fade || 0.2);
    var buses = [run.gain, run.revOut];
    for (var i = 0; i < buses.length; i++) {
      var p = buses[i].gain;
      try {
        if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now); else p.cancelScheduledValues(now);
        p.linearRampToValueAtTime(0, now + f);
      } catch (e) {}
    }
    setTimeout(function () {
      try { run.gain.disconnect(); run.revSend.disconnect(); run.rev.disconnect(); run.revOut.disconnect(); } catch (e) {}
    }, (f + 0.12) * 1000);
  }

  function wavFromBuffer(buf) {
    var n = buf.length, ch = buf.numberOfChannels, sr = buf.sampleRate;
    var bytes = 44 + n * ch * 2, ab = new ArrayBuffer(bytes), v = new DataView(ab);
    function wstr(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    wstr(0, "RIFF"); v.setUint32(4, bytes - 8, true); wstr(8, "WAVE");
    wstr(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    wstr(36, "data"); v.setUint32(40, n * ch * 2, true);
    var ds = [];
    for (var k = 0; k < ch; k++) ds.push(buf.getChannelData(k));
    var o = 44;
    for (var j = 0; j < n; j++) {
      for (var k2 = 0; k2 < ch; k2++) {
        var x = Math.max(-1, Math.min(1, ds[k2][j]));
        v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2;
      }
    }
    return new Blob([ab], { type: "audio/wav" });
  }

  // 开场交互：停在合拢卷轴，提示呼吸，点击后从展开开始播放
  function showHint() {
    awaiting = true;
    overlay.classList.add("awaiting");
    hint.classList.add("show");
  }
  function hideHint() {
    awaiting = false;
    hovering = false;
    clearTimeout(wobbleTimer);
    el.closed.classList.remove("wobble");
    overlay.classList.remove("awaiting");
    hint.classList.remove("show");
  }
  function begin() {
    if (!awaiting) return;
    hideHint();
    hasBegun = true;
    finished = false; playing = true; last = performance.now();
    // 声音失败绝不能拦住动画
    try { audioStart(t, speed); } catch (e) {}
    requestAnimationFrame(loop);
  }

  function safeRender() {
    try { render(t); return true; }
    catch (e) { console.error(e); finish(true); return false; }
  }

  // 启动层打开期间，真实界面不接收焦点与点击
  function lockApp(lock) {
    var nodes = document.querySelectorAll(".topbar, .shell-body, .navdrawer, .drawer, .navrail");
    for (var i = 0; i < nodes.length; i++) {
      if (lock) nodes[i].setAttribute("inert", "");
      else nodes[i].removeAttribute("inert");
    }
  }
  function unlockApp() { lockApp(false); }

  function finish(skip) {
    if (finished) return;
    finished = true; playing = false;
    hideHint();
    if (skip) audioStop(0.25);
    unlockApp();
    if (!hasBegun) {
      document.documentElement.dataset.splash = "skip";
      overlay.style.display = "none";
      return;
    }
    t = T.total; render(t);
    document.documentElement.dataset.splash = "skip";
    overlay.style.transition = "opacity .38s ease";
    overlay.style.opacity = "0";
    overlay.style.pointerEvents = "none";
    setTimeout(function () {
      if (finished) overlay.style.display = "none";
    }, 400);
  }

  function restart() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    finished = false; playing = false; hasBegun = false; t = IDLE;
    audioStop(0.2);
    lockApp(true);
    document.documentElement.removeAttribute("data-splash");
    overlay.hidden = false;
    overlay.style.display = "block";
    overlay.style.transition = "none";
    overlay.style.opacity = "1";
    overlay.style.pointerEvents = "";
    try { measure(); render(t); showHint(); }
    catch (e) { console.error(e); finish(true); }
  }

  function loop(now) {
    if (!playing) { last = now; return; }
    var dt = Math.min(64, now - last || 16); last = now;
    t += dt * speed;
    if (t >= T.total) { t = T.total; safeRender(); finish(); return; }
    if (!safeRender()) return;
    requestAnimationFrame(loop);
  }

  // 悬停轻晃：首次带木质吱声，之后每 2.2s 再晃一次，直到鼠标离开
  function pokeScroll(withSound) {
    if (!awaiting) return;
    el.closed.classList.remove("wobble");
    void el.closed.getBoundingClientRect();
    el.closed.classList.add("wobble");
    if (withSound) hoverCreak();
  }

  function bind() {
    overlay.addEventListener("click", begin);
    var openHit = $("open-hit");
    openHit.addEventListener("mouseenter", function () {
      if (!awaiting) return;
      hovering = true;
      clearTimeout(wobbleTimer);
      pokeScroll(true);
    });
    openHit.addEventListener("mouseleave", function () {
      hovering = false;
      clearTimeout(wobbleTimer);
    });
    el.closed.addEventListener("animationend", function (e) {
      if (e.animationName !== "roll-wobble") return;
      el.closed.classList.remove("wobble");
      if (!hovering || !awaiting) return;
      clearTimeout(wobbleTimer);
      wobbleTimer = setTimeout(function () {
        if (hovering && awaiting) pokeScroll(false);
      }, 2200);
    });
    window.addEventListener("resize", function () {
      if (finished) return;
      measureView();
      render(t);
    });
    $("btn-skip").onclick = function () { finish(true); };
    document.addEventListener("keydown", function (e) {
      if (finished) return;
      if (e.key === "Escape") finish(true);
      else if (awaiting && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); begin(); }
    });
  }

  // 首次完整开卷；同一天再次打开直接略过，可在顶栏「启卷」重播
  var SPLASH_KEY = "locus.splash.v1";
  function dayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  window.__locusSplash = {
    play: restart,
    finish: function () { finish(true); },
    seek: function (ms) {
      playing = false; finished = false; hasBegun = true; hideHint();
      lockApp(true);
      document.documentElement.removeAttribute("data-splash");
      overlay.hidden = false;
      overlay.style.display = "block";
      overlay.style.transition = "none";
      overlay.style.opacity = "1";
      overlay.style.pointerEvents = "";
      measure();
      t = Math.max(0, Math.min(T.total, +ms || 0));
      render(t);
    },
  };

  window.addEventListener("load", function () {
    bind(); lockApp(true);
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var last = "";
    try { last = localStorage.getItem(SPLASH_KEY) || ""; } catch (e) {}
    if (reduce || last === dayKey()) { finish(true); return; }
    try { localStorage.setItem(SPLASH_KEY, dayKey()); } catch (e) {}
    try { measure(); render(IDLE); showHint(); }
    catch (e) { console.error(e); finish(true); }
  });
})();

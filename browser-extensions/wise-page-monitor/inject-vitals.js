// Wise 页面监控注入脚本：采集 Web Vitals、长任务、加载时序、用户操作轨迹与白屏。
// 经 __wiseMonitorReport binding 回传。
// 请与 src-tauri/src/chrome_devtools_monitor.rs 的 PAGE_INJECTION_SCRIPT 保持同步。
export const PAGE_INJECTION_SOURCE = `(function () {
  try {
    if (window.__wiseVitalsInstalled) return;
    window.__wiseVitalsInstalled = true;
    var report = function (payload) {
      try { window.__wiseMonitorReport(JSON.stringify(payload)); } catch (e) {}
    };
    var round = function (n) { return Math.round(n); };
    var pageUrl = function () {
      try { return String(location.href || ""); } catch (e) { return ""; }
    };
    try {
      var nav = performance.getEntriesByType("navigation")[0];
      if (nav && nav.responseStart > 0) {
        report({ kind: "vitals", metric: "ttfb", value: round(nav.responseStart) });
      }
      var paintObs = new PerformanceObserver(function (list) {
        for (var i = 0; i < list.getEntries().length; i++) {
          var e = list.getEntries()[i];
          if (e.name === "first-contentful-paint") {
            report({ kind: "vitals", metric: "fcp", value: round(e.startTime) });
          }
        }
      });
      paintObs.observe({ type: "paint", buffered: true });
    } catch (e) {}
    try {
      var lcpSeen = null;
      var lcpObs = new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        var e = entries[entries.length - 1];
        if (e && e.startTime !== lcpSeen) {
          lcpSeen = e.startTime;
          report({ kind: "vitals", metric: "lcp", value: round(e.startTime) });
        }
      });
      lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
    } catch (e) {}
    try {
      var clsValue = 0;
      var clsTimer = null;
      var clsReport = function () {
        clsTimer = null;
        report({ kind: "vitals", metric: "cls", value: +clsValue.toFixed(3) });
      };
      var clsObs = new PerformanceObserver(function (list) {
        for (var i = 0; i < list.getEntries().length; i++) {
          var e = list.getEntries()[i];
          if (!e.hadRecentInput) clsValue += e.value;
        }
        if (clsTimer == null) clsTimer = setTimeout(clsReport, 1000);
      });
      clsObs.observe({ type: "layout-shift", buffered: true });
      window.addEventListener("pagehide", function () {
        if (clsValue > 0) clsReport();
      });
    } catch (e) {}
    try {
      var inpMax = 0;
      var inpObs = new PerformanceObserver(function (list) {
        for (var i = 0; i < list.getEntries().length; i++) {
          var d = list.getEntries()[i].duration;
          if (d > inpMax) inpMax = d;
        }
      });
      inpObs.observe({ type: "event", durationThreshold: 100, buffered: true });
      window.addEventListener("pagehide", function () {
        if (inpMax > 0) report({ kind: "vitals", metric: "inp", value: round(inpMax) });
      });
    } catch (e) {}
    try {
      var ltObs = new PerformanceObserver(function (list) {
        for (var i = 0; i < list.getEntries().length; i++) {
          var e = list.getEntries()[i];
          if (e.duration >= 500) {
            var src = "";
            if (e.attribution && e.attribution[0]) src = e.attribution[0].containerSrc || "";
            report({ kind: "long-task", value: round(e.duration), url: src });
          }
        }
      });
      ltObs.observe({ type: "longtask", buffered: true });
    } catch (e) {}
    try {
      var timingSent = {};
      var sendTiming = function () {
        try {
          var navT = performance.getEntriesByType("navigation")[0];
          if (!navT) return;
          if (navT.domContentLoadedEventEnd > 0 && !timingSent.dcl) {
            timingSent.dcl = true;
            report({ kind: "timing", metric: "dcl", value: round(navT.domContentLoadedEventEnd), url: pageUrl() });
          }
          if (navT.loadEventEnd > 0 && !timingSent.load) {
            timingSent.load = true;
            report({ kind: "timing", metric: "load", value: round(navT.loadEventEnd), url: pageUrl() });
          }
        } catch (err) {}
      };
      sendTiming();
      if (document.readyState !== "complete") {
        window.addEventListener("load", function () { setTimeout(sendTiming, 0); });
      }
    } catch (e) {}
    try {
      var lastClickAt = 0;
      var describe = function (el) {
        if (!el || !el.tagName) return "";
        var tag = String(el.tagName || "").toLowerCase();
        var id = el.id ? "#" + String(el.id).slice(0, 40) : "";
        var name = "";
        try { name = el.getAttribute("name") || el.getAttribute("aria-label") || ""; } catch (err) {}
        var namePart = name ? "[name=" + String(name).slice(0, 40) + "]" : "";
        var txt = "";
        try { txt = String(el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 32); } catch (err) {}
        var txtPart = txt ? (" '" + txt + "'") : "";
        return (tag + id + namePart + txtPart).slice(0, 120);
      };
      document.addEventListener("click", function (ev) {
        var now = Date.now();
        if (now - lastClickAt < 800) return;
        lastClickAt = now;
        report({ kind: "breadcrumb", metric: "click", message: describe(ev.target) || "click", url: pageUrl() });
      }, true);
      document.addEventListener("change", function (ev) {
        var t = ev.target;
        if (!t || !t.tagName) return;
        var tag = String(t.tagName).toLowerCase();
        if (tag !== "input" && tag !== "select" && tag !== "textarea") return;
        var type = "";
        try { type = String(t.type || "").toLowerCase(); } catch (err) {}
        var label = describe(t) || tag;
        if (type === "password") label += " (password)";
        report({ kind: "breadcrumb", metric: "input", message: label, url: pageUrl() });
      }, true);
      document.addEventListener("submit", function (ev) {
        report({ kind: "breadcrumb", metric: "submit", message: describe(ev.target) || "form", url: pageUrl() });
      }, true);
      var onNav = function (how) {
        report({ kind: "breadcrumb", metric: "navigate", message: how + " " + pageUrl(), url: pageUrl() });
      };
      var wrapHist = function (name) {
        try {
          var orig = history[name];
          if (typeof orig !== "function") return;
          history[name] = function () {
            var ret = orig.apply(this, arguments);
            onNav(name);
            return ret;
          };
        } catch (err) {}
      };
      wrapHist("pushState");
      wrapHist("replaceState");
      window.addEventListener("popstate", function () { onNav("popstate"); });
      window.addEventListener("hashchange", function () { onNav("hashchange"); });
    } catch (e) {}
    try {
      var blankSent = false;
      var hadContent = false;
      var textLen = function () {
        try {
          var body = document.body;
          if (!body) return 0;
          return String(body.innerText || body.textContent || "").replace(/\\s+/g, " ").trim().length;
        } catch (err) { return 0; }
      };
      var visibleCount = function () {
        try {
          if (!document.body) return 0;
          var nodes = document.body.getElementsByTagName("*");
          var n = 0;
          var max = Math.min(nodes.length, 500);
          for (var i = 0; i < max; i++) {
            var el = nodes[i];
            var tag = String(el.tagName || "");
            if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK" || tag === "META" || tag === "NOSCRIPT") continue;
            var r = el.getBoundingClientRect();
            if (r.width >= 8 && r.height >= 8) n++;
          }
          return n;
        } catch (err) { return 0; }
      };
      var hasSizedMedia = function () {
        try {
          var media = document.querySelectorAll("canvas, video, svg, img, iframe");
          for (var i = 0; i < media.length; i++) {
            var r = media[i].getBoundingClientRect();
            if (r.width >= 40 && r.height >= 40) return true;
          }
        } catch (err) {}
        return false;
      };
      var checkBlank = function (finalCheck) {
        if (blankSent || hadContent) return;
        try {
          var href = pageUrl();
          if (!href || href.indexOf("about:") === 0) return;
          var chars = textLen();
          var vis = visibleCount();
          if (hasSizedMedia() || chars >= 40 || vis >= 8) {
            hadContent = true;
            return;
          }
          if (!finalCheck) return;
          blankSent = true;
          report({
            kind: "blank-screen",
            message: chars + " chars, " + vis + " visible nodes",
            value: chars,
            url: href
          });
        } catch (err) {}
      };
      var startBlankWatch = function () {
        setTimeout(function () { checkBlank(false); }, 2500);
        setTimeout(function () { checkBlank(true); }, 6000);
      };
      if (document.readyState === "complete") startBlankWatch();
      else window.addEventListener("load", startBlankWatch);
    } catch (e) {}
  } catch (e) {}
})();`;

// Wise 页面监控注入脚本：采集 Web Vitals 与长任务，经 __wiseMonitorReport binding 回传。
// 请与 src-tauri/src/chrome_devtools_monitor.rs 的 PAGE_INJECTION_SCRIPT 保持同步。
export const PAGE_INJECTION_SOURCE = `(function () {
  try {
    if (window.__wiseVitalsInstalled) return;
    window.__wiseVitalsInstalled = true;
    var report = function (payload) {
      try { window.__wiseMonitorReport(JSON.stringify(payload)); } catch (e) {}
    };
    var round = function (n) { return Math.round(n); };
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
  } catch (e) {}
})();`;

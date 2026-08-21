"use strict";

// --- Static plan info (edit to match your subscriptions) ------------------
var CLAUDE_PLAN_LABEL = "Max 20x";
var CLAUDE_PLAN_PRICE = "$200/mo";
var CODEX_PLAN_PRICES = { plus: "$20/mo", prolite: "$100/mo", pro: "$200/mo", team: "$30/mo", business: "$30/mo" };
// API plan_type -> display name where they differ (ChatGPT calls "prolite" the "Pro plan").
var CODEX_PLAN_NAMES = { prolite: "Pro" };

// Percent shown everywhere is USED percent, matching the Claude and ChatGPT
// UIs (the previous build showed remaining percent, which read as noise).
var WARN_USED = 75;
var CRITICAL_USED = 90;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  var parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asObject(value) {
  return value && typeof value === "object" ? value : null;
}

function usedColor(usedPercent) {
  if (usedPercent >= CRITICAL_USED) return "red";
  if (usedPercent >= WARN_USED) return "orange";
  return "green";
}

function formatPercent(value) {
  return Math.round(clamp(value, 0, 100)) + "%";
}

var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Accepts an ISO-8601 string or epoch seconds; "" when unparsable.
function formatReset(value) {
  if (value === null || value === undefined || value === "") return "";
  var date;
  if (typeof value === "number") {
    date = new Date(value * 1000);
  } else {
    date = new Date(String(value));
  }
  if (isNaN(date.getTime())) return "";
  var hh = date.getHours();
  var mm = date.getMinutes();
  var time = hh + ":" + (mm < 10 ? "0" + mm : mm);
  var now = new Date();
  var sameDay = date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) return time;
  return WEEKDAYS[date.getDay()] + " " + time;
}

function sourceLabel(source) {
  switch (source) {
    case "oauth-api":
      return "OAuth API";
    case "oauth-api-stale":
      return "OAuth API (stale)";
    case "local-summary":
      return "Local summary";
    case "auth-token":
      return "Auth token";
    case "stats-cache":
      return "Stats cache";
    case "rate-limited":
      return "Rate limited";
    case "auth-error":
      return "Auth error";
    case "no-token":
      return "Not signed in";
    case "token-expired":
      return "Token expired";
    case "server-error":
      return "Server error";
    case "network-error":
      return "Offline";
    case "parse-error":
      return "Bad response";
    case "unavailable":
      return "Unavailable";
    default:
      return null;
  }
}

function withSource(detail, source) {
  var sourceText = sourceLabel(source);
  if (!sourceText) return detail;
  return detail ? detail + " | " + sourceText : sourceText;
}

// --- Data models ----------------------------------------------------------
// Each provider reduces to: { title, planLine, available, rows, maxUsed,
// color, text, progress, detail, extraLine }
// where rows = [{ label, used, resetsAt }] with used percent semantics.

function claudeModel(usage) {
  var claude = asObject(usage && usage.claude);
  var source = claude && typeof claude.source === "string" ? claude.source : null;
  var planLine = CLAUDE_PLAN_LABEL + " · " + CLAUDE_PLAN_PRICE;

  if (!claude || claude.available !== true) {
    return {
      title: "Claude",
      planLine: planLine,
      available: false,
      rows: [],
      maxUsed: 0,
      color: "gray",
      text: "--",
      progress: 0,
      detail: withSource("Not available", source),
      extraLine: null
    };
  }

  var rows = [];
  var limits = Array.isArray(claude.limits) ? claude.limits : [];
  for (var i = 0; i < limits.length; i++) {
    var limit = asObject(limits[i]);
    if (!limit) continue;
    var used = toNumber(limit.usedPercent, null);
    if (used === null) continue;
    rows.push({
      label: typeof limit.label === "string" ? limit.label : "window",
      used: clamp(used, 0, 100),
      resetsAt: limit.resetsAt || null
    });
  }

  // Older payloads (local summary, stats cache) carry only remaining percents.
  if (rows.length === 0) {
    var sessionRemaining = toNumber(claude.currentSessionRemainingPercent, null);
    var weeklyRemaining = toNumber(claude.weeklyRemainingPercent, null);
    if (sessionRemaining !== null) {
      rows.push({ label: "5h session", used: clamp(100 - sessionRemaining, 0, 100), resetsAt: claude.resetAt || null });
    }
    if (weeklyRemaining !== null) {
      rows.push({ label: "Week", used: clamp(100 - weeklyRemaining, 0, 100), resetsAt: null });
    }
  }

  var maxUsed = 0;
  for (var j = 0; j < rows.length; j++) {
    if (rows[j].used > maxUsed) maxUsed = rows[j].used;
  }

  var extraLine = null;
  var extra = asObject(claude.extraUsage);
  if (extra) {
    var usedAmount = toNumber(extra.usedAmount, null);
    if (usedAmount !== null) {
      var limitAmount = toNumber(extra.limitAmount, null);
      extraLine = "Extra usage " + "$" + usedAmount.toFixed(2) +
        (limitAmount !== null ? " / $" + limitAmount.toFixed(0) : "");
    }
  }

  var detail = typeof claude.statusLabel === "string" ? claude.statusLabel : null;
  if (claude.stale === true && !detail) detail = "Showing cached data";

  return {
    title: "Claude",
    planLine: planLine,
    available: rows.length > 0,
    rows: rows,
    maxUsed: maxUsed,
    color: rows.length > 0 ? usedColor(maxUsed) : "gray",
    text: rows.length > 0 ? formatPercent(maxUsed) : "--",
    progress: rows.length > 0 ? maxUsed / 100 : 0,
    detail: withSource(detail, source),
    extraLine: extraLine
  };
}

function codexWindowRowLabel(window) {
  var minutes = toNumber(window.windowMinutes, 0);
  if (minutes >= 5000) return "Week";
  if (window.windowLabel) return String(window.windowLabel) + " session";
  return "Window";
}

function codexModel(usage) {
  var codex = asObject(usage && usage.codex);
  var source = codex && typeof codex.source === "string" ? codex.source : null;
  var planType = codex && typeof codex.planType === "string" ? codex.planType : null;
  var planKey = planType ? planType.toLowerCase() : null;
  var planName = planKey
    ? (CODEX_PLAN_NAMES[planKey] || planType.charAt(0).toUpperCase() + planType.slice(1))
    : null;
  var planLine = planName
    ? planName + (CODEX_PLAN_PRICES[planKey] ? " · " + CODEX_PLAN_PRICES[planKey] : "")
    : "ChatGPT";

  if (!codex || codex.available !== true) {
    return {
      title: "Codex",
      planLine: planLine,
      available: false,
      rows: [],
      maxUsed: 0,
      color: "gray",
      text: "--",
      progress: 0,
      detail: withSource("Not available", source),
      extraLine: null
    };
  }

  if (codex.unlimited === true) {
    return {
      title: "Codex",
      planLine: planLine,
      available: true,
      rows: [],
      maxUsed: 0,
      color: "green",
      text: "∞",
      progress: 0,
      detail: withSource("Unlimited", source),
      extraLine: null
    };
  }

  var rows = [];
  var windows = [asObject(codex.primary), asObject(codex.secondary)];
  for (var i = 0; i < windows.length; i++) {
    var window = windows[i];
    if (!window) continue;
    var used = toNumber(window.usedPercent, null);
    if (used === null) {
      var remaining = toNumber(window.remainingPercent, null);
      if (remaining !== null) used = 100 - remaining;
    }
    if (used === null) continue;
    rows.push({
      label: codexWindowRowLabel(window),
      used: clamp(used, 0, 100),
      resetsAt: window.resetsAt !== undefined ? window.resetsAt : null
    });
  }

  var maxUsed = 0;
  for (var j = 0; j < rows.length; j++) {
    if (rows[j].used > maxUsed) maxUsed = rows[j].used;
  }

  var extraLine = codex.hasCredits === true ? "Credits available" : null;

  return {
    title: "Codex",
    planLine: planLine,
    available: rows.length > 0,
    rows: rows,
    maxUsed: maxUsed,
    color: rows.length > 0 ? usedColor(maxUsed) : "gray",
    text: rows.length > 0 ? formatPercent(maxUsed) : "--",
    progress: rows.length > 0 ? maxUsed / 100 : 0,
    detail: withSource(null, source),
    extraLine: extraLine
  };
}

// --- Shared views ---------------------------------------------------------

function ringWithPercent(model, lineWidth) {
  return View.hstack([
    View.circularProgress(model.progress, {
      total: 1,
      lineWidth: lineWidth,
      color: model.color
    }),
    View.text(model.text, {
      style: "monospacedSmall",
      color: model.color
    })
  ], { spacing: 5, align: "center" });
}

function limitRow(row) {
  var reset = formatReset(row.resetsAt);
  var children = [
    View.frame(
      View.text(row.label, { style: "footnote", color: "gray", lineLimit: 1 }),
      { width: 96, alignment: "leading" }
    ),
    View.frame(
      View.progress(row.used, { total: 100, color: usedColor(row.used) }),
      { width: 72, alignment: "center" }
    ),
    View.frame(
      View.text(formatPercent(row.used), { style: "monospacedSmall", color: usedColor(row.used) }),
      { width: 38, alignment: "trailing" }
    )
  ];
  if (reset) {
    children.push(View.text(reset, { style: "footnote", color: "gray" }));
  }
  return View.hstack(children, { spacing: 6, align: "center" });
}

function providerColumn(model) {
  var children = [
    View.hstack([
      View.text(model.title, { style: "headline", color: "white" }),
      View.text(model.planLine, { style: "footnote", color: "gray" })
    ], { spacing: 6, align: "center" })
  ];

  if (model.rows.length > 0) {
    for (var i = 0; i < model.rows.length; i++) {
      children.push(limitRow(model.rows[i]));
    }
  } else {
    children.push(View.text(model.text === "∞" ? "Unlimited" : "No data", {
      style: "caption",
      color: "gray"
    }));
  }

  if (model.extraLine) {
    children.push(View.text(model.extraLine, { style: "footnote", color: "gray" }));
  }
  if (model.detail) {
    children.push(View.text(model.detail, { style: "footnote", color: "gray", lineLimit: 1 }));
  }

  return View.vstack(children, { spacing: 5, align: "leading" });
}

function usageSnapshot() {
  var usage = SuperIsland.system.getAIUsage();
  return usage && typeof usage === "object" ? usage : null;
}

// --- Module ---------------------------------------------------------------

SuperIsland.registerModule({
  compact() {
    var usage = usageSnapshot();
    var codex = codexModel(usage);
    var claude = claudeModel(usage);

    return View.hstack([
      ringWithPercent(codex, 2.5),
      View.spacer(),
      ringWithPercent(claude, 2.5)
    ], { spacing: 8, align: "center" });
  },

  minimalCompact: {
    leading() {
      var usage = usageSnapshot();
      var codex = codexModel(usage);
      return View.circularProgress(codex.progress, {
        total: 1,
        lineWidth: 3,
        color: codex.color
      });
    },

    trailing() {
      var usage = usageSnapshot();
      var claude = claudeModel(usage);
      return View.frame(
        View.circularProgress(claude.progress, {
          total: 1,
          lineWidth: 3,
          color: claude.color
        }),
        { maxWidth: 1000, alignment: "trailing" }
      );
    }
  },

  expanded() {
    var usage = usageSnapshot();
    var codex = codexModel(usage);
    var claude = claudeModel(usage);

    return View.hstack([
      View.vstack([
        View.text("Codex", { style: "caption", color: "gray" }),
        ringWithPercent(codex, 4)
      ], { spacing: 4, align: "center" }),
      View.vstack([
        View.text("Claude", { style: "caption", color: "gray" }),
        ringWithPercent(claude, 4)
      ], { spacing: 4, align: "center" })
    ], { spacing: 12, align: "center", distribution: "fillEqually" });
  },

  fullExpanded() {
    var usage = usageSnapshot();
    var codex = codexModel(usage);
    var claude = claudeModel(usage);

    return View.vstack([
      View.text("AI Usage", { style: "title", color: "white" }),
      View.hstack([
        providerColumn(claude),
        providerColumn(codex)
      ], { spacing: 24, align: "top", distribution: "fillEqually" })
    ], { spacing: 10, align: "leading" });
  }
});

"use strict";
// Behavioural tests for index.js, run with `node --test Extensions/ai-usage/`.
// index.js is loaded into a vm context with a scripted SuperIsland host whose
// getAIUsage() returns whatever snapshot the test hands in.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");

function loadExtension(usage) {
  const View = new Proxy({}, {
    get: (_t, name) => (...args) => ({ view: name, args })
  });
  const sandbox = {
    console: { log() {} },
    View,
    SuperIsland: {
      system: { getAIUsage() { return usage; } },
      registerModule(m) { sandbox.__module = m; },
      settings: { get() { return undefined; } }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: "index.js" });

  const texts = (node, out = []) => {
    if (!node || typeof node !== "object") return out;
    if (node.view === "text" && typeof node.args[0] === "string") out.push(node.args[0]);
    for (const a of (node.args || [])) Array.isArray(a) ? a.forEach(x => texts(x, out)) : texts(a, out);
    return out;
  };
  return { module: sandbox.__module, fullTexts: () => texts(sandbox.__module.fullExpanded()) };
}

const codexWindows = {
  primary: { usedPercent: 12, remainingPercent: 88, windowMinutes: 300, windowLabel: "5h", resetsAt: null },
  secondary: { usedPercent: 40, remainingPercent: 60, windowMinutes: 10080, windowLabel: "168h", resetsAt: null }
};

test("fresh Codex data shows the rows with the live source", () => {
  const { fullTexts } = loadExtension({
    codex: { available: true, source: "oauth-api", planType: "pro", ...codexWindows },
    claude: { available: false, source: "no-token" }
  });
  const texts = fullTexts();
  assert.ok(texts.includes("5h session"), `rows missing: ${texts.join(" | ")}`);
  assert.ok(texts.includes("OAuth API"), `source missing: ${texts.join(" | ")}`);
});

test("stale Codex data keeps the rows and says how old they are", () => {
  const { fullTexts } = loadExtension({
    codex: {
      available: true,
      stale: true,
      source: "oauth-api-stale",
      statusLabel: "Codex usage API unreachable — data from 21:58",
      planType: "pro",
      ...codexWindows
    },
    claude: { available: false, source: "no-token" }
  });
  const texts = fullTexts();
  assert.ok(texts.includes("5h session"), `rows missing: ${texts.join(" | ")}`);
  assert.ok(
    texts.includes("Codex usage API unreachable — data from 21:58 | OAuth API (stale)"),
    `stale detail missing: ${texts.join(" | ")}`
  );
  // The stale column keeps its percentages; "No data" here would belong to
  // the (intentionally empty) Claude column of this snapshot only.
  assert.ok(texts.includes("12%") && texts.includes("40%"), `percentages missing: ${texts.join(" | ")}`);
});

test("stale Codex data without a label still says it is cached", () => {
  const { fullTexts } = loadExtension({
    codex: { available: true, stale: true, source: "oauth-api-stale", planType: "pro", ...codexWindows },
    claude: { available: false, source: "no-token" }
  });
  assert.ok(fullTexts().includes("Showing cached data | OAuth API (stale)"));
});

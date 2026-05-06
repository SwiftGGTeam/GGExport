/**
 * HTML cleaner for Framer-exported pages.
 *
 * Removes:
 *   1. <meta name="generator" content="Framer ..."> in any form.
 *   2. Framer editor / preload scripts (anything pointing at app.framerstatic.com
 *      or *.framer.com editor bundles, plus inline editor bootstrap blobs).
 *   3. The "Made in Framer" badge: its DOM container and any CSS rules that
 *      target it.
 */

export interface CleanResult {
  html: string;
  removed: {
    generatorMeta: number;
    editorScripts: number;
    editorPreloads: number;
    badgeNodes: number;
    badgeCssRules: number;
  };
}

const BADGE_SELECTORS = [
  "[data-framer-badge-container]",
  "[data-framer-badge]",
  ".framer-badge-container",
  ".framer-badge",
  '[data-framer-name="badge"]',
  '[data-framer-name="Badge"]',
  "#__framer-badge-container",
];

const EDITOR_HOST_PATTERNS = [
  /app\.framerstatic\.com/i,
  /framerusercontent\.com\/[^"']*editor/i,
  /framer\.com\/[^"']*\/editor/i,
];

export function cleanFramerHtml(rawHtml: string): CleanResult {
  const removed = {
    generatorMeta: 0,
    editorScripts: 0,
    editorPreloads: 0,
    badgeNodes: 0,
    badgeCssRules: 0,
  };

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, "text/html");

  // 1. Remove the Framer generator meta tag.
  doc
    .querySelectorAll('meta[name="generator" i]')
    .forEach((el) => {
      const content = el.getAttribute("content") ?? "";
      if (/framer/i.test(content)) {
        el.remove();
        removed.generatorMeta++;
      }
    });

  // 2a. Remove preload <link> hints that point at the editor.
  doc.querySelectorAll("link[rel]").forEach((el) => {
    const rel = (el.getAttribute("rel") ?? "").toLowerCase();
    const href = el.getAttribute("href") ?? "";
    if (!/preload|modulepreload|prefetch/.test(rel)) return;
    if (EDITOR_HOST_PATTERNS.some((re) => re.test(href))) {
      el.remove();
      removed.editorPreloads++;
    }
  });

  // 2b. Remove <script> tags that load the editor (external) or bootstrap it
  //     inline (text matches the editor host).
  doc.querySelectorAll("script").forEach((el) => {
    const src = el.getAttribute("src") ?? "";
    const text = el.textContent ?? "";
    const looksEditor =
      EDITOR_HOST_PATTERNS.some((re) => re.test(src)) ||
      EDITOR_HOST_PATTERNS.some((re) => re.test(text));
    if (looksEditor) {
      el.remove();
      removed.editorScripts++;
    }
  });

  // 3a. Remove any badge DOM nodes.
  for (const sel of BADGE_SELECTORS) {
    doc.querySelectorAll(sel).forEach((el) => {
      el.remove();
      removed.badgeNodes++;
    });
  }

  // 3b. Strip badge CSS rules out of any inline <style> blocks.
  doc.querySelectorAll("style").forEach((styleEl) => {
    const css = styleEl.textContent ?? "";
    if (!css) return;
    const stripped = stripCssRules(css, BADGE_SELECTORS);
    if (stripped.removedCount > 0) {
      styleEl.textContent = stripped.css;
      removed.badgeCssRules += stripped.removedCount;
    }
  });

  return {
    html: "<!doctype html>\n" + doc.documentElement.outerHTML,
    removed,
  };
}

/**
 * Walks a CSS string and drops every top-level rule whose selector list
 * mentions one of the target selectors. Naive but good enough for Framer's
 * mostly-flat output (it does descend one level into @media / @supports).
 */
function stripCssRules(
  css: string,
  selectors: string[],
): { css: string; removedCount: number } {
  let removedCount = 0;
  const lower = selectors.map((s) => s.toLowerCase());

  const walk = (input: string): string => {
    let out = "";
    let i = 0;
    while (i < input.length) {
      // Skip whitespace into output.
      const wsMatch = /^\s+/.exec(input.slice(i));
      if (wsMatch) {
        out += wsMatch[0];
        i += wsMatch[0].length;
        continue;
      }
      // Comment passthrough.
      if (input.startsWith("/*", i)) {
        const end = input.indexOf("*/", i + 2);
        if (end === -1) {
          out += input.slice(i);
          break;
        }
        out += input.slice(i, end + 2);
        i = end + 2;
        continue;
      }
      // Find the next "{" or ";" — whichever comes first decides if this is
      // a rule or an at-statement (like `@charset "utf-8";`).
      const braceIdx = input.indexOf("{", i);
      const semiIdx = input.indexOf(";", i);
      if (braceIdx === -1) {
        out += input.slice(i);
        break;
      }
      if (semiIdx !== -1 && semiIdx < braceIdx) {
        out += input.slice(i, semiIdx + 1);
        i = semiIdx + 1;
        continue;
      }
      const prelude = input.slice(i, braceIdx);
      // Find matching close brace.
      let depth = 1;
      let j = braceIdx + 1;
      while (j < input.length && depth > 0) {
        const ch = input[j];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        if (depth === 0) break;
        j++;
      }
      const body = input.slice(braceIdx + 1, j);
      const block = input.slice(i, j + 1);
      i = j + 1;

      const trimmedPrelude = prelude.trim();
      if (
        trimmedPrelude.startsWith("@media") ||
        trimmedPrelude.startsWith("@supports") ||
        trimmedPrelude.startsWith("@layer") ||
        trimmedPrelude.startsWith("@container")
      ) {
        const innerStripped = walk(body);
        out += `${prelude}{${innerStripped}}`;
        continue;
      }

      const preludeLower = prelude.toLowerCase();
      const hits = lower.some((s) => preludeLower.includes(s));
      if (hits) {
        removedCount++;
        continue; // drop this rule
      }
      out += block;
    }
    return out;
  };

  return { css: walk(css), removedCount };
}

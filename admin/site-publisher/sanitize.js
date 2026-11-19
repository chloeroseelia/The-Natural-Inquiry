import { parseFragment } from "parse5";

// Tags the dashboard editor can produce, minus media (images/figures are not
// publishable until public media support exists).
const ALLOWED_TAGS = new Set([
  "p", "h2", "h3", "strong", "b", "em", "i", "blockquote", "a", "ul", "ol", "li", "br"
]);

// Dropped together with everything inside them.
const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "object", "embed", "form", "template", "noscript", "svg", "math",
  "textarea", "select", "option", "button", "input", "title", "head", "base", "link", "meta",
  "frame", "frameset", "applet", "audio", "video", "source", "canvas", "dialog",
  "figure", "figcaption", "img", "picture"
]);
const MEDIA_TAGS = new Set(["figure", "figcaption", "img", "picture", "audio", "video", "source", "canvas"]);

const MAX_DEPTH = 40;
// C0/C1 controls (except tab/newline/CR) and bidirectional override characters.
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

export function cleanText(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").replace(UNSAFE_CHARS, "").trim();
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Returns a normalized safe URL string, or null. Only http(s), mailto, root-relative
// paths and fragments are allowed; everything else (javascript:, data:, vbscript:, ...) is rejected.
export function safeUrl(value) {
  if (typeof value !== "string") return null;
  const raw = value.replace(/[\u0000-\u0020\u007F-\u009F]/g, (character) => (character === " " ? " " : "")).trim();
  if (!raw || raw.length > 2048 || /[\\\s]/.test(raw)) return null;
  if (raw.startsWith("#")) return /^#[\w\-.:%]*$/.test(raw) ? raw : null;
  if (raw.startsWith("/")) return raw.startsWith("//") ? null : raw;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) return null;
  if (parsed.username || parsed.password) return null;
  return parsed.protocol === "mailto:" ? raw : parsed.href;
}

export function sanitizeHtml(input) {
  const stats = { removedMedia: 0, removedLinks: 0, droppedElements: 0 };
  if (typeof input !== "string" || !input.trim()) return { html: "", text: "", stats };

  const fragment = parseFragment(input.replace(UNSAFE_CHARS, ""));
  const textParts = [];

  function render(node, depth) {
    if (depth > MAX_DEPTH) {
      stats.droppedElements += 1;
      return "";
    }
    if (node.nodeName === "#text") {
      textParts.push(node.value);
      return escapeHtml(node.value);
    }
    if (!node.tagName) return ""; // comments, doctype

    const tag = node.tagName.toLowerCase();
    if (node.namespaceURI && !node.namespaceURI.endsWith("/xhtml")) {
      stats.droppedElements += 1;
      return "";
    }
    if (DROP_WITH_CONTENT.has(tag)) {
      if (MEDIA_TAGS.has(tag)) stats.removedMedia += 1;
      else stats.droppedElements += 1;
      return "";
    }

    const children = (node.childNodes || []).map((child) => render(child, depth + 1)).join("");
    if (!ALLOWED_TAGS.has(tag)) return children;
    if (tag === "br") return "<br>";

    if (tag === "a") {
      const href = safeUrl((node.attrs.find((attribute) => attribute.name === "href") || {}).value);
      if (!href) {
        stats.removedLinks += 1;
        return children;
      }
      const external = /^(https?:|mailto:)/i.test(href);
      return `<a href="${escapeHtml(href)}"${external ? ' rel="noopener noreferrer"' : ""}>${children}</a>`;
    }
    return `<${tag}>${children}</${tag}>`;
  }

  const html = (fragment.childNodes || []).map((node) => render(node, 0)).join("").trim();
  const text = textParts.join(" ").replace(/\s+/g, " ").trim();
  return { html, text, stats };
}

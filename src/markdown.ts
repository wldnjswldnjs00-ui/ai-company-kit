import { marked } from "marked";

// Reports are written by an LLM, so they're treated as untrusted: raw HTML
// can't form (every "<" is escaped before parsing), and any link or image
// that isn't plain http(s) or a relative path is neutralized afterwards.
export function renderMarkdown(src: string): string {
  const escaped = src.replace(/</g, "&lt;");
  const html = marked.parse(escaped, { async: false, gfm: true, breaks: true }) as string;
  return html.replace(/\s(href|src)="(?!https?:\/\/|\/|#)[^"]*"/gi, ' $1="#"');
}

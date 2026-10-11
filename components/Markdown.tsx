import type { ReactNode } from "react";

// Minimal Markdown → React for LLM output: headings, paragraphs, bullet/numbered lists
// (one level of nesting), blockquotes, rules, **bold**, *italic*, `code`. Builds elements
// directly, so model output is never injected as HTML.

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "hr" }
  | { kind: "list"; ordered: boolean; items: { text: string; children: string[] }[] };

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function parse(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    const h = trimmed.match(/^(#{1,6})\s+(.*?)\s*#*$/);
    if (h) {
      flush();
      blocks.push({ kind: "h", level: h[1].length, text: h[2] });
      continue;
    }
    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
      flush();
      blocks.push({ kind: "hr" });
      continue;
    }
    if (trimmed.startsWith(">")) {
      flush();
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) quote.push(lines[i++].trim().replace(/^>\s?/, ""));
      i--;
      blocks.push({ kind: "quote", text: quote.join(" ") });
      continue;
    }
    const li = line.match(LIST_RE);
    if (li) {
      flush();
      const baseIndent = li[1].length;
      const ordered = /\d/.test(li[2]);
      const items: { text: string; children: string[] }[] = [];
      while (i < lines.length) {
        const cur = lines[i];
        const m = cur.match(LIST_RE);
        if (m && m[1].length <= baseIndent) items.push({ text: m[3], children: [] });
        else if (m && items.length) items.at(-1)!.children.push(m[3]);
        else if (cur.trim() && /^\s+/.test(cur) && items.length) items.at(-1)!.text += ` ${cur.trim()}`;
        else break;
        i++;
      }
      i--;
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    para.push(trimmed);
  }
  flush();
  return blocks;
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = out.length;
    if (tok.startsWith("**") || tok.startsWith("__")) out.push(<strong key={k} className="font-semibold text-slate-900">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k} className="rounded bg-slate-100 px-1 font-mono text-[0.9em]">{tok.slice(1, -1)}</code>);
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ source }: { source: string }) {
  return (
    <div className="space-y-4 text-lg leading-relaxed text-slate-800">
      {parse(source).map((b, i) => {
        switch (b.kind) {
          case "h":
            if (b.level === 1) return <h2 key={i} className="text-3xl font-bold tracking-tight text-slate-900">{inline(b.text)}</h2>;
            if (b.level === 2)
              return (
                <h3 key={i} className="border-b-2 border-slate-200 pt-4 pb-1 text-2xl font-bold text-slate-900">
                  {inline(b.text)}
                </h3>
              );
            return <h4 key={i} className="pt-2 text-xl font-semibold text-slate-900">{inline(b.text)}</h4>;
          case "p":
            return <p key={i}>{inline(b.text)}</p>;
          case "quote":
            return (
              <blockquote key={i} className="border-l-4 border-slate-400 bg-slate-50 px-4 py-2 text-slate-800">
                {inline(b.text)}
              </blockquote>
            );
          case "hr":
            return <hr key={i} className="border-slate-200" />;
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i} className={`space-y-2 pl-7 ${b.ordered ? "list-decimal" : "list-disc"}`}>
                {b.items.map((it, j) => (
                  <li key={j} className="pl-1">
                    {inline(it.text)}
                    {it.children.length > 0 && (
                      <ul className="mt-1 list-[circle] space-y-1 pl-6">
                        {it.children.map((c, k) => (
                          <li key={k}>{inline(c)}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </Tag>
            );
          }
        }
      })}
    </div>
  );
}

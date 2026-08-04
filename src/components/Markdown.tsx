import { Fragment, ReactNode } from "react";

/**
 * Minimal markdown renderer for AI answers — headings, bullet/numbered lists,
 * bold, inline code, and paragraphs. Builds React nodes directly (no HTML
 * injection), which covers everything queryNetwork produces.
 */

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let paragraph: string[] = [];

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{inline(item)}</li>);
    blocks.push(
      list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>
    );
    list = null;
  };
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(<p key={blocks.length}>{inline(paragraph.join(" "))}</p>);
    paragraph = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);

    if (line === "") {
      flushList();
      flushParagraph();
    } else if (heading) {
      flushList();
      flushParagraph();
      const level = heading[1].length;
      const content = inline(heading[2]);
      blocks.push(
        level <= 2 ? (
          <h3 key={blocks.length}>{content}</h3>
        ) : (
          <h4 key={blocks.length}>{content}</h4>
        )
      );
    } else if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushList();
  flushParagraph();

  return <div className="md">{blocks}</div>;
}

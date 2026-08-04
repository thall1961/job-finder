import PDFDocument from "pdfkit";

/**
 * Render Markdown (headings, bullets, bold, links) to a simply formatted PDF.
 * Covers the subset Claude produces for resumes and cover letters.
 */
export function markdownToPdf(markdown: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 54, bottom: 54, left: 60, right: 60 },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const cleanInline = (s: string) =>
      s
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [text](url) -> text
        .replace(/`([^`]*)`/g, "$1")
        .replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, "$1"); // single-* italics -> plain

    // Render text with **bold** segments, optionally prefixed (for bullets).
    const renderInline = (
      text: string,
      size: number,
      prefix = "",
      indent = 0
    ) => {
      const parts = cleanInline(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
      doc.fontSize(size);
      if (parts.length === 0) {
        doc.font("Helvetica").text(prefix, { indent });
        return;
      }
      parts.forEach((part, i) => {
        const bold = part.startsWith("**") && part.endsWith("**");
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").text(
          (i === 0 ? prefix : "") + (bold ? part.slice(2, -2) : part),
          {
            continued: i < parts.length - 1,
            indent: i === 0 ? indent : undefined,
            paragraphGap: 2,
          }
        );
      });
    };

    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    for (const raw of lines) {
      const line = raw.trimEnd();
      const trimmed = line.trim();

      if (trimmed === "") {
        doc.moveDown(0.35);
        continue;
      }
      if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
        doc.moveDown(0.2);
        const y = doc.y;
        doc
          .moveTo(doc.page.margins.left, y)
          .lineTo(doc.page.width - doc.page.margins.right, y)
          .lineWidth(0.5)
          .strokeColor("#999999")
          .stroke();
        doc.moveDown(0.4);
        continue;
      }

      const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        const size = level === 1 ? 17 : level === 2 ? 13 : 11.5;
        doc.moveDown(level === 1 ? 0.2 : 0.5);
        doc.font("Helvetica-Bold").fontSize(size).fillColor("#111111");
        doc.text(cleanInline(heading[2]).replace(/\*\*/g, ""));
        doc.moveDown(0.15);
        doc.fillColor("#222222");
        continue;
      }

      const bullet = trimmed.match(/^[-*+]\s+(.*)$/);
      if (bullet) {
        renderInline(bullet[1], 10, "•  ", 10);
        continue;
      }
      const numbered = trimmed.match(/^(\d+)\.\s+(.*)$/);
      if (numbered) {
        renderInline(numbered[2], 10, `${numbered[1]}.  `, 10);
        continue;
      }

      renderInline(trimmed, 10);
    }

    doc.end();
  });
}

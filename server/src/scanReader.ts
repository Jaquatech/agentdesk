import type { Conversion } from "./attachmentMarkdown.ts";

/**
 * Reading a scanned PDF (no text layer) with the agent the owner chose under Attachment handling > Reading scans.
 * The pages are rendered to PNG (pdfPages.ts) and the agent transcribes them once, at upload. These helpers
 * build the request and turn the answer into the Markdown copy; the call itself is Orchestrator.readScan.
 */

/** What the agent is asked. `pagesSent` images are attached; `total` is the page count of the whole file. */
export function scanPrompt(pagesSent: number, total: number, name: string): string {
  const limit = total > pagesSent ? ` The document has ${total} pages; only the first ${pagesSent} are attached.` : "";
  return `Transcribe the attached scanned pages of "${name}" into Markdown. Output only the text, page by page. Start each page with a line \`## Page N\` (N = the page number, starting at 1, in the order the images are attached). Keep headings, lists and tables as Markdown; write numbers and names exactly as printed. Mark text you cannot read as [unreadable]. Do not add comments or a summary.${limit}`;
}

/** The agent's answer as the file's Markdown copy. A reply with no text is a failure, not an empty copy. */
export function scanMarkdown(reply: string, pagesSent: number, total: number): Conversion {
  let text = reply.trim();
  if (!text) return { status: "failed: the agent returned no text", markdown: null };
  if (!/^## Page/m.test(text)) {
    text = `${pagesSent === 1 ? "## Page 1" : `## Pages 1-${pagesSent}`}\n\n${text}`;
  }
  if (total > pagesSent) {
    return { status: "truncated", markdown: `${text}\n\n(Scan: only the first ${pagesSent} of ${total} pages were read.)` };
  }
  return { status: "converted", markdown: text };
}

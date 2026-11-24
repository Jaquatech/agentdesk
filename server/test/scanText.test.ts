import { describe, it, expect } from "vitest";
import { scanMarkdown, scanPrompt } from "../src/scanReader.ts";

describe("scanPrompt", () => {
  it("names the file and asks for a ## Page heading per page", () => {
    const p = scanPrompt(2, 2, "invoice.pdf");
    expect(p.startsWith("Transcribe the attached scanned pages")).toBe(true);
    expect(p).toContain('"invoice.pdf"');
    expect(p).toContain("## Page N");
    expect(p).not.toContain("only the first");
  });

  it("says how many pages were left out only when the file is longer than the images sent", () => {
    const p = scanPrompt(2, 7, "invoice.pdf");
    expect(p).toContain("The document has 7 pages; only the first 2 are attached.");
  });
});

describe("scanMarkdown", () => {
  it("treats an empty reply as a failure with no copy", () => {
    expect(scanMarkdown("  \n ", 1, 1)).toEqual({ status: "failed: the agent returned no text", markdown: null });
  });

  it("wraps a reply without a page heading under Page 1 for one page", () => {
    expect(scanMarkdown("Hello", 1, 1)).toEqual({ status: "converted", markdown: "## Page 1\n\nHello" });
  });

  it("wraps a reply without a page heading under Pages 1-3 for three pages", () => {
    expect(scanMarkdown("Hello", 3, 3)).toEqual({ status: "converted", markdown: "## Pages 1-3\n\nHello" });
  });

  it("keeps a reply that already has page headings as it is", () => {
    const reply = "## Page 1\n\nA\n\n## Page 2\n\nB";
    expect(scanMarkdown(`\n${reply}\n`, 2, 2)).toEqual({ status: "converted", markdown: reply });
  });

  it("is truncated with a note when the file has more pages than were read", () => {
    const r = scanMarkdown("## Page 1\n\nA", 1, 4);
    expect(r.status).toBe("truncated");
    expect(r.markdown).toBe("## Page 1\n\nA\n\n(Scan: only the first 1 of 4 pages were read.)");
  });
});

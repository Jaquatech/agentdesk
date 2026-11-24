import { describe, it, expect } from "vitest";
import { claudeAttachmentPrompt } from "../src/engines/claudeCli.ts";
import type { PromptAttachments } from "../src/attachments.ts";

const image: PromptAttachments = {
  images: [{ name: "a.png", mime: "image/png", base64: "" }],
  texts: [],
  skipped: [],
  paths: ["/x/a.png"],
  readPaths: ["/x/a.png"],
  notes: [],
};

describe("Claude CLI attachment prompt asks for image notes", () => {
  it("lists each image and asks for image_notes", () => {
    const prompt = claudeAttachmentPrompt(image);
    expect(prompt).toContain("- a.png (image)");
    expect(prompt).toContain("image_notes");
  });

  it("asks for nothing when there are no images", () => {
    const prompt = claudeAttachmentPrompt({ ...image, images: [] });
    expect(prompt).not.toContain("image_notes");
  });

  it("keeps a text-only prompt unchanged, with no image note", () => {
    const text: PromptAttachments = {
      images: [],
      texts: [{ name: "notes.md", content: "hello", part: 1, parts: 1 }],
      skipped: [],
      paths: ["/x/notes.md"],
      readPaths: ["/x/notes.md"],
      notes: [],
    };
    const prompt = claudeAttachmentPrompt(text);
    expect(prompt).toBe("\n\n# Attached by the user\nRead these with the Read tool (images too):\n- /x/notes.md\n## notes.md\nhello");
    expect(prompt).toContain("## notes.md");
    expect(prompt).not.toContain("image_notes");
  });

  it("returns an empty string when there is no attachment", () => {
    expect(claudeAttachmentPrompt(undefined)).toBe("");
  });
});

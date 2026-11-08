import { describe, it, expect } from "vitest";
import { appVersion } from "../src/version.ts";

describe("app version", () => {
  it("reads the version from the root package.json", () => {
    expect(appVersion().version).toMatch(/^\d+\.\d+\.\d+/);
  });
  it("has release notes for the running version at the top of CHANGELOG.md", () => {
    const { version, notes } = appVersion();
    // Fixes wait under "## Unreleased" until a release; the first numbered section is the running version.
    const first = [...notes.matchAll(/^## (\S+)/gm)].map((m) => m[1]).find((v) => v.toLowerCase() !== "unreleased");
    expect(first).toBe(version);
  });
});

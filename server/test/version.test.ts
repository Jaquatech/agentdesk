import { describe, it, expect } from "vitest";
import { appVersion } from "../src/version.ts";

describe("app version", () => {
  it("reads the version from the root package.json", () => {
    expect(appVersion().version).toMatch(/^\d+\.\d+\.\d+/);
  });
  it("has release notes for the running version at the top of CHANGELOG.md", () => {
    const { version, notes } = appVersion();
    expect(/^## (\S+)/m.exec(notes)?.[1]).toBe(version);
  });
});

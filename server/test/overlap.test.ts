import { describe, it, expect } from "vitest";
import { blockingTask, pathsOverlap, type PlanningTask } from "../src/orchestrator/overlap.ts";

const parse = (s: string) => JSON.parse(s) as string[];
const task = (id: number, status: string, paths: string[], sprint = 1): PlanningTask => ({ id, title: `T${id}`, status, paths: JSON.stringify(paths), sprint_id: sprint });

describe("path overlap", () => {
  it("sees the same file, a file inside a folder, and a folder around a file", () => {
    expect(pathsOverlap(["README.md"], ["README.md"])).toBe(true);
    expect(pathsOverlap(["src/"], ["src/a/b.ts"])).toBe(true);
    expect(pathsOverlap(["./src/a"], ["src\\a\\b.ts"])).toBe(true);
    expect(pathsOverlap(["src/*.js"], ["src/x.js"])).toBe(true);
  });
  it("does not mix up names that only start the same, or separate folders", () => {
    expect(pathsOverlap(["src/"], ["srcs/a.ts"])).toBe(false);
    expect(pathsOverlap(["docs/"], ["README.md"])).toBe(false);
    expect(pathsOverlap([], ["README.md"])).toBe(false);
  });
  it("treats the whole project as overlapping everything", () => {
    expect(pathsOverlap(["."], ["src/a.ts"])).toBe(true);
  });
});

describe("blocking task", () => {
  const readme = ["README.md"];
  it("waits for an earlier task of the same sprint that is not finished, whatever state it is in", () => {
    for (const status of ["queued", "building", "reviewing", "needs_attention", "failed"]) {
      expect(blockingTask(task(2, "queued", readme), [task(1, status, readme), task(2, "queued", readme)], parse)?.id).toBe(1);
    }
  });
  it("does not wait for merged or cancelled tasks, later tasks, other sprints or other files", () => {
    const me = task(2, "queued", readme);
    expect(blockingTask(me, [task(1, "merged", readme)], parse)).toBeUndefined();
    expect(blockingTask(me, [task(1, "cancelled", readme)], parse)).toBeUndefined();
    expect(blockingTask(me, [task(3, "building", readme)], parse)).toBeUndefined();
    expect(blockingTask(me, [task(1, "building", readme, 2)], parse)).toBeUndefined();
    expect(blockingTask(me, [task(1, "building", ["docs/"])], parse)).toBeUndefined();
    expect(blockingTask({ ...me, sprint_id: null }, [task(1, "building", readme, 1)], parse)).toBeUndefined();
  });
});

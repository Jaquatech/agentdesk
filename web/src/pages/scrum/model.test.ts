import { describe, it, expect } from "vitest";
import { groupsByTab, type Overview, type Pi, type Sprint } from "./model.ts";

const pi = (id: number, status: Pi["status"] = "active") => ({ id, name: `PI ${id}`, goal: "", status, usage: null }) satisfies Pi;
const sprint = (number: number, status: Sprint["status"], pi_id: number | null) => ({ id: number, number, status, pi_id }) as Sprint;
const overview = (pis: Pi[], sprints: Sprint[]) => ({ pis, sprints }) as Overview;
const numbers = (groups: { sprints: Sprint[] }[]) => groups.map((g) => g.sprints.map((s) => s.number));

describe("groupsByTab", () => {
  it("puts a PI with only planned sprints under Coming", () => {
    const tabs = groupsByTab(overview([pi(1)], [sprint(1, "planning", 1)]));
    expect(numbers(tabs.coming)).toEqual([[1]]);
    expect(tabs.current).toEqual([]);
    expect(tabs.releases).toEqual([]);
  });

  it("puts a PI with a running sprint under Current and lists its released sprints newest first under Releases", () => {
    const tabs = groupsByTab(overview([pi(1)], [sprint(1, "released", 1), sprint(2, "released", 1), sprint(3, "active", 1)]));
    expect(numbers(tabs.current)).toEqual([[1, 2, 3]]);
    expect(numbers(tabs.releases)).toEqual([[2, 1]]);
    expect(tabs.coming).toEqual([]);
  });

  it("shows a closed PI only under Releases", () => {
    const tabs = groupsByTab(overview([pi(1, "closed")], [sprint(1, "released", 1)]));
    expect(tabs.current).toEqual([]);
    expect(tabs.coming).toEqual([]);
    expect(numbers(tabs.releases)).toEqual([[1]]);
  });

  it("groups sprints without a PI, or with an unknown PI, in a group with no PI", () => {
    const tabs = groupsByTab(overview([], [sprint(1, "planning", null), sprint(2, "active", 99), sprint(3, "released", null)]));
    expect(tabs.coming.map((g) => g.pi)).toEqual([null]);
    expect(numbers(tabs.coming)).toEqual([[1]]);
    expect(numbers(tabs.current)).toEqual([[2]]);
    expect(numbers(tabs.releases)).toEqual([[3]]);
  });
});

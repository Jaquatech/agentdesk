import { describe, it, expect } from "vitest";
import type { Approval } from "../api.ts";
import { withoutApproval } from "./approvalList.ts";

const ap = (id: number) => ({ id } as Approval);
const ids = (list: Approval[]) => list.map((a) => a.id);

describe("withoutApproval", () => {
  it("removes the item with the given id and keeps the order of the others", () => {
    expect(ids(withoutApproval([ap(1), ap(2), ap(3)], 2))).toEqual([1, 3]);
  });

  it("returns an equal list when the id is unknown", () => {
    expect(ids(withoutApproval([ap(1), ap(2)], 9))).toEqual([1, 2]);
  });

  it("does not change the input array", () => {
    const input = [ap(1), ap(2), ap(3)];
    withoutApproval(input, 2);
    expect(input).toHaveLength(3);
    expect(ids(input)).toEqual([1, 2, 3]);
  });

  it("keeps an empty list empty", () => {
    expect(withoutApproval([], 1)).toEqual([]);
  });
});

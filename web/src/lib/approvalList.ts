import type { Approval } from "../api.ts";

/** The list without the approval with this id. The input array is not changed. */
export function withoutApproval(list: Approval[], id: Approval["id"]): Approval[] {
  return list.filter((a) => a.id !== id);
}

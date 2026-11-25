import { describe, expect, it } from "vitest";
import {
  agreementSentence, agreementWord, defaultVoteFilter, judgeLabel, modelShown, nextAfterSkip, nextAfterVote, percentText, previousVoted, progressLine, voteLabel,
} from "./review.ts";

describe("votes table helpers", () => {
  it("says the agreement word", () => {
    expect(agreementWord(true)).toBe("Agree");
    expect(agreementWord(false)).toBe("Disagree");
    expect(agreementWord(null)).toBe("No judge");
    expect(agreementWord(undefined)).toBe("No judge");
  });
  it("picks the default filter", () => {
    expect(defaultVoteFilter(3)).toBe("disagree");
    expect(defaultVoteFilter(0)).toBe("all");
    expect(defaultVoteFilter(null)).toBe("all");
    expect(defaultVoteFilter(undefined)).toBe("all");
  });
  it("labels a vote", () => {
    expect(voteLabel("good")).toBe("Good");
    expect(voteLabel("bad")).toBe("Bad");
    expect(voteLabel(null)).toBe("-");
  });
  it("labels a judge verdict", () => {
    expect(judgeLabel({ score: 8, pass: true })).toBe("8, pass");
    expect(judgeLabel({ score: 0, pass: false })).toBe("0, fail");
    expect(judgeLabel({ score: null, pass: true })).toBe("pass");
    expect(judgeLabel(null)).toBe("No judge");
    expect(judgeLabel(undefined)).toBe("No judge");
  });
  it("hides the model only before the vote", () => {
    expect(modelShown(true, false, "m", "p")).toBe("Model hidden");
    expect(modelShown(true, true, "m", "p")).toBe("m (p)");
    expect(modelShown(false, false, "m", "p")).toBe("m (p)");
    expect(modelShown(false, true, "m", "p")).toBe("m (p)");
  });
});

describe("review helpers", () => {
  it("writes the progress line", () => {
    expect(progressLine(12, 40)).toBe("12 of 40 answers voted");
    expect(progressLine(0, 1)).toBe("0 of 1 answer voted");
    expect(progressLine(0, 0)).toBe("0 of 0 answers voted");
  });
  it("writes percent with a dash for none", () => {
    expect(percentText(0.756)).toBe("76%");
    expect(percentText(0)).toBe("0%");
    expect(percentText(null)).toBe("-");
    expect(percentText(undefined)).toBe("-");
    expect(percentText(NaN)).toBe("-");
  });
  it("says whether you and the judge agree", () => {
    expect(agreementSentence(true)).toBe("You and the judge agree");
    expect(agreementSentence(false)).toBe("You and the judge disagree");
    expect(agreementSentence(null)).toBeNull();
  });
  it("picks the next item after a vote", () => {
    expect(nextAfterVote([false, false, false], 0, true)).toBe(1);
    expect(nextAfterVote([false, false, false], 1, false)).toBe(2);
    expect(nextAfterVote([false, false], 1, false)).toBeNull();
    expect(nextAfterVote([], 0, true)).toBeNull();
    // wraps to an item skipped earlier, never to the one just voted
    expect(nextAfterVote([false, false], 1, true)).toBe(0);
    expect(nextAfterVote([false], 0, true)).toBeNull();
    expect(nextAfterVote([false, true, false], 0, true)).toBe(2);
  });
  it("picks the next item after a skip", () => {
    expect(nextAfterSkip([false, false], 0, true)).toBe(1);
    expect(nextAfterSkip([false, false], 1, true)).toBe(0);
    expect(nextAfterSkip([false, false], 1, false)).toBeNull();
    expect(nextAfterSkip([false], 0, true)).toBeNull();
    expect(nextAfterSkip([], 0, false)).toBeNull();
  });
  it("finds the previous item voted in this session", () => {
    expect(previousVoted([true, false, true, false], 3)).toBe(2);
    expect(previousVoted([true, false, true, false], 2)).toBe(0);
    expect(previousVoted([true, false], 4)).toBe(0);
    expect(previousVoted([false, false], 1)).toBeNull();
    expect(previousVoted([], 0)).toBeNull();
  });
});

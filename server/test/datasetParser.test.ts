import { describe, it, expect } from "vitest";
import { datasetWarnings, parseDataset, MAX_INPUT_CHARS, type DatasetCase } from "../src/dataFactory/datasetParser.ts";

const testCase = (over: Partial<DatasetCase> & { input: string }): DatasetCase => ({
  id: "x",
  tags: [],
  meta: {},
  ...over,
});

describe("JSON Lines", () => {
  it("reads one object per line with id, expected, tags and meta", () => {
    const text = [
      '{"id":"a","input":"2+2?","expected":"4","tags":["math"],"lang":"en"}',
      '{"input":"Capital of France?"}',
    ].join("\n");
    const { cases, problems } = parseDataset(text, "jsonl");
    expect(problems).toEqual([]);
    expect(cases).toEqual([
      { id: "a", input: "2+2?", expected: "4", tags: ["math"], meta: { lang: "en" } },
      { id: "case-1", input: "Capital of France?", tags: [], meta: {} },
    ]);
  });

  it("skips blank lines but keeps the physical line numbers", () => {
    const text = '\n{"input":"one"}\n\n   \n{"input":"two"}\n';
    const { cases, problems } = parseDataset(text, "jsonl");
    expect(problems).toEqual([]);
    expect(cases.map((c) => c.input)).toEqual(["one", "two"]);
  });

  it("reads CRLF line endings", () => {
    const { cases } = parseDataset('{"input":"a"}\r\n{"input":"b"}\r\n', "jsonl");
    expect(cases.map((c) => c.input)).toEqual(["a", "b"]);
  });
});

describe("JSON array", () => {
  it("reads an array of objects and numbers the problems by element position", () => {
    const text = JSON.stringify([{ input: "hi", expected: "hello" }, "not an object", { input: "" }, { input: "bye" }]);
    const { cases, problems } = parseDataset(text, "json");
    expect(cases.map((c) => [c.id, c.input])).toEqual([
      ["case-1", "hi"],
      ["case-2", "bye"],
    ]);
    expect(problems).toEqual([
      { line: 2, message: "not an object" },
      { line: 3, message: "no input text" },
    ]);
  });

  it("reports a file that is not an array, or not JSON at all", () => {
    expect(parseDataset('{"input":"x"}', "json").problems).toEqual([
      { line: 1, message: "the file must hold a JSON array of objects" },
    ]);
    const broken = parseDataset('[\n{"input":"a"},\n{"input":}\n]', "json");
    expect(broken.cases).toEqual([]);
    expect(broken.problems).toHaveLength(1);
    expect(broken.problems[0].message).toBe("the file is not valid JSON");
  });

  it("converts numbers and objects in fields to text", () => {
    const { cases } = parseDataset('[{"id":7,"input":"q","expected":42,"tags":"a;b","score":0.5,"extra":{"k":1}}]', "json");
    expect(cases[0]).toEqual({
      id: "7",
      input: "q",
      expected: "42",
      tags: ["a", "b"],
      meta: { score: "0.5", extra: '{"k":1}' },
    });
  });
});

describe("CSV", () => {
  it("reads the header and maps columns to fields and meta", () => {
    const text = "id,input,expected,tags,region\nc1,Hello,Hi,greeting;short,eu\n,Bye,,,us\n";
    const { cases, problems } = parseDataset(text, "csv");
    expect(problems).toEqual([]);
    expect(cases).toEqual([
      { id: "c1", input: "Hello", expected: "Hi", tags: ["greeting", "short"], meta: { region: "eu" } },
      { id: "case-1", input: "Bye", tags: [], meta: { region: "us" } },
    ]);
  });

  it("handles a quoted comma, an escaped quote and a quoted newline", () => {
    const text = 'input,expected\n"Hello, world","say ""hi"""\n"line one\nline two",ok\nnext,fine\n';
    const { cases, problems } = parseDataset(text, "csv");
    expect(problems).toEqual([]);
    expect(cases.map((c) => [c.input, c.expected])).toEqual([
      ["Hello, world", 'say "hi"'],
      ["line one\nline two", "ok"],
      ["next", "fine"],
    ]);
  });

  it("keeps later line numbers right after a quoted newline", () => {
    const text = 'input\n"one\ntwo"\nthree,extra\n';
    const { problems } = parseDataset(text, "csv");
    expect(problems).toEqual([{ line: 4, message: "the row has 2 columns; the header has 1" }]);
  });

  it("accepts CRLF and skips blank lines", () => {
    const { cases, problems } = parseDataset("input,id\r\n\r\na,one\r\n\r\nb,two\r\n", "csv");
    expect(problems).toEqual([]);
    expect(cases.map((c) => c.id)).toEqual(["one", "two"]);
  });

  it("reports a missing header, a header without input, and an unclosed quote", () => {
    expect(parseDataset("", "csv").problems).toEqual([{ line: 1, message: "the file has no header row" }]);
    expect(parseDataset("question,answer\nq,a\n", "csv")).toEqual({
      cases: [],
      problems: [{ line: 1, message: 'the header has no "input" column' }],
    });
    const open = parseDataset('input\n"never closed\nstill open\n', "csv");
    expect(open.problems).toContainEqual({ line: 2, message: "a quoted field is never closed" });
  });
});

describe("file-wide rules", () => {
  it("strips a byte order mark at the start of each format", () => {
    const bom = "﻿";
    expect(parseDataset(`${bom}{"input":"a"}\n`, "jsonl").cases.map((c) => c.input)).toEqual(["a"]);
    expect(parseDataset(`${bom}[{"input":"b"}]`, "json").cases.map((c) => c.input)).toEqual(["b"]);
    expect(parseDataset(`${bom}input\nc\n`, "csv").cases.map((c) => c.input)).toEqual(["c"]);
  });

  it("reports a missing or empty input and keeps the other cases", () => {
    const text = ['{"input":"ok"}', '{"expected":"no input"}', '{"input":"   "}', '{"input":"fine"}'].join("\n");
    const { cases, problems } = parseDataset(text, "jsonl");
    expect(cases.map((c) => c.input)).toEqual(["ok", "fine"]);
    expect(problems).toEqual([
      { line: 2, message: "no input text" },
      { line: 3, message: "no input text" },
    ]);
  });

  it("reports invalid JSON lines and lines that are not objects, with their line numbers", () => {
    const text = ['{"input":"a"}', "{oops", "[1,2]", '{"input":"b"}', "null"].join("\n");
    const { cases, problems } = parseDataset(text, "jsonl");
    expect(cases.map((c) => c.input)).toEqual(["a", "b"]);
    expect(problems).toEqual([
      { line: 2, message: "not valid JSON" },
      { line: 3, message: "not an object" },
      { line: 5, message: "not an object" },
    ]);
  });

  it("gives a duplicate id a problem and keeps the first case", () => {
    const text = ['{"id":"same","input":"first"}', '{"id":"same","input":"second"}', '{"id":"other","input":"third"}'].join(
      "\n",
    );
    const { cases, problems } = parseDataset(text, "jsonl");
    expect(cases.map((c) => [c.id, c.input])).toEqual([
      ["same", "first"],
      ["other", "third"],
    ]);
    expect(problems).toEqual([{ line: 2, message: 'id "same" is already used on line 1' }]);
  });

  it("never generates an id that the file names later", () => {
    const text = ['{"input":"no id"}', '{"id":"case-1","input":"named"}'].join("\n");
    const { cases, problems } = parseDataset(text, "jsonl");
    expect(problems).toEqual([]);
    expect(cases.map((c) => [c.id, c.input])).toEqual([
      ["case-2", "no id"],
      ["case-1", "named"],
    ]);
  });

  it("collects every problem in one pass", () => {
    const text = 'input,id\na,x\n,y\na,x\n';
    const { cases, problems } = parseDataset(text, "csv");
    expect(cases.map((c) => c.id)).toEqual(["x"]);
    expect(problems).toEqual([
      { line: 3, message: "no input text" },
      { line: 4, message: 'id "x" is already used on line 2' },
    ]);
  });
});

describe("datasetWarnings", () => {
  const five = (over: Partial<DatasetCase> = {}) =>
    Array.from({ length: 5 }, (_, i) => testCase({ id: `c${i}`, input: `input ${i}`, expected: "yes", ...over }));

  it("is quiet for a dataset with expected answers and at least five distinct cases", () => {
    expect(datasetWarnings(five())).toEqual([]);
  });

  it("warns when no case has an expected answer", () => {
    const cases = five().map((c) => ({ ...c, expected: undefined }));
    expect(datasetWarnings(cases)).toContain("No case has an expected answer, so scoring will need a judge.");
  });

  it("warns when there are fewer than five cases", () => {
    expect(datasetWarnings(five().slice(0, 4))).toEqual(["Only 4 cases. Five or more give a more useful score."]);
    expect(datasetWarnings(five().slice(0, 1))).toEqual(["Only 1 case. Five or more give a more useful score."]);
  });

  it("warns about an input that appears twice, naming the ids", () => {
    const cases = five();
    cases[3] = { ...cases[3], input: "input 0" };
    expect(datasetWarnings(cases)).toEqual(["2 cases have the same input: c0, c3."]);
  });

  it("warns about an input over the limit", () => {
    const cases = five();
    cases[1] = { ...cases[1], input: "x".repeat(MAX_INPUT_CHARS + 1) };
    expect(datasetWarnings(cases)).toEqual([
      `Case "c1" has an input of ${MAX_INPUT_CHARS + 1} characters; the limit is ${MAX_INPUT_CHARS}.`,
    ]);
  });

  const damaged = (id: string) =>
    `1 case contains characters that suggest a damaged file or a wrong encoding: ${id}. Check the file's encoding before using it.`;

  it("warns about byte order mark bytes in an input", () => {
    const cases = five();
    cases[2] = { ...cases[2], input: "okÿþ€ bytes" };
    expect(datasetWarnings(cases)).toEqual([damaged("c2")]);
  });

  it("warns about the replacement character in expected", () => {
    const cases = five();
    cases[0] = { ...cases[0], expected: "bad �" };
    expect(datasetWarnings(cases)).toEqual([damaged("c0")]);
  });

  it("warns about a NUL in a meta value", () => {
    const cases = five();
    cases[4] = { ...cases[4], meta: { source: "a\u0000b" } };
    expect(datasetWarnings(cases)).toEqual([damaged("c4")]);
  });

  it("warns about double encoding", () => {
    const cases = five();
    cases[1] = { ...cases[1], input: "MÃ¤kinen" };
    expect(datasetWarnings(cases)).toEqual([damaged("c1")]);
  });

  it("does not warn about Finnish and Swedish text, tabs or newlines", () => {
    const cases = five();
    cases[1] = { ...cases[1], input: "Äiti söi åt oss € 5 “quoted” – dash\tx\ny\r\n" };
    expect(datasetWarnings(cases)).toEqual([]);
  });

  it("lists at most five ids", () => {
    const cases = Array.from({ length: 7 }, (_, i) => testCase({ id: `c${i}`, input: `bad � ${i}`, expected: "yes" }));
    expect(datasetWarnings(cases)).toEqual([
      "7 cases contain characters that suggest a damaged file or a wrong encoding: c0, c1, c2, c3, c4 and 2 more. Check the file's encoding before using it.",
    ]);
  });

  it("does not warn about an input of exactly the limit", () => {
    const cases = five();
    cases[1] = { ...cases[1], input: "x".repeat(MAX_INPUT_CHARS) };
    expect(datasetWarnings(cases)).toEqual([]);
  });
});

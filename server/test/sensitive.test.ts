import { describe, it, expect } from "vitest";
import { findSensitive, type SensitiveKind, type SensitiveTerms } from "../src/dataFactory/sensitive.ts";

const none: SensitiveTerms = { people: [], terms: [] };
const kinds = (text: string, terms: SensitiveTerms = none): [SensitiveKind, string][] =>
  findSensitive(text, terms).map((m) => [m.kind, m.value]);

describe("secret", () => {
  it("finds keys, tokens and key=value secrets", () => {
    const key = "sk-" + "a1B2c3D4e5F6g7H8i9";
    expect(kinds(`key ${key} end`)).toEqual([["secret", key]]);
    expect(kinds("t ghp_abcdefghijklmnop1234")).toEqual([["secret", "ghp_abcdefghijklmnop1234"]]);
    expect(kinds("AKIAABCDEFGHIJKLMNOP")).toEqual([["secret", "AKIAABCDEFGHIJKLMNOP"]]);
    expect(kinds("xoxb-1234567890-abcdef")).toEqual([["secret", "xoxb-1234567890-abcdef"]]);
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl";
    expect(kinds(`Bearer ${jwt}`)).toEqual([["secret", jwt]]);
  });

  it("replaces only the value after a password-like word", () => {
    expect(kinds("Password: hunter2, next")).toEqual([["secret", "hunter2"]]);
    expect(kinds('{"api_key": "abc 123"}')).toEqual([["secret", "abc 123"]]);
    expect(kinds("TOKEN='xyz'")).toEqual([["secret", "xyz"]]);
  });

  it("finds a private key block, also without an END line", () => {
    const block = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----";
    expect(kinds(`a\n${block}\nb`)).toEqual([["secret", block]]);
    const open = "-----BEGIN PRIVATE KEY-----\nMIIabc";
    expect(kinds(`x ${open}`)).toEqual([["secret", open]]);
  });

  it("ignores ordinary text", () => {
    expect(kinds("the task-force sk-short and password reset")).toEqual([]);
  });
});

describe("email", () => {
  it("finds an address", () => {
    expect(kinds("write to anna.test+x@example.com.")).toEqual([["email", "anna.test+x@example.com"]]);
  });
  it("ignores an @ without a domain", () => {
    expect(kinds("meet @ noon, user@localhost, a@b")).toEqual([]);
  });
});

describe("iban", () => {
  it("accepts a valid number with spaces", () => {
    expect(kinds("Pay FI21 1234 5600 0007 85 today")).toEqual([["iban", "FI21 1234 5600 0007 85"]]);
    expect(kinds("DE89370400440532013000")).toEqual([["iban", "DE89370400440532013000"]]);
  });
  it("rejects a wrong checksum", () => {
    expect(kinds("FI22 1234 5600 0007 85")).toEqual([]);
  });
});

describe("personal_id", () => {
  it("accepts a correct check character in any case", () => {
    expect(kinds("id 010203-9013 ok")).toEqual([["personal_id", "010203-9013"]]);
    expect(kinds("150590a950k")).toEqual([["personal_id", "150590a950k"]]);
  });
  it("rejects a wrong check character or an impossible date", () => {
    // A wrong id can still read as a phone number; it must not be a personal_id.
    const personal = (t: string) => kinds(t).filter(([k]) => k === "personal_id");
    expect(personal("010203-9014")).toEqual([]);
    expect(personal("320203-9013")).toEqual([]);
    expect(personal("011303-9013")).toEqual([]);
  });
});

describe("ip", () => {
  it("finds IPv4 and IPv6", () => {
    expect(kinds("from 192.168.1.20 to")).toEqual([["ip", "192.168.1.20"]]);
    expect(kinds("addr 2001:db8::1.")).toEqual([["ip", "2001:db8::1"]]);
  });
  it("rejects out of range parts and times", () => {
    expect(kinds("300.1.1.1 and 1.2.3 and 12:30:45")).toEqual([]);
  });
});

describe("host", () => {
  it("finds a host and only the host part of a URL", () => {
    expect(kinds("see https://db.example.com/a/b.html?x=1")).toEqual([["host", "db.example.com"]]);
    expect(kinds("srv01.corp and nas.lan")).toEqual([
      ["host", "srv01.corp"],
      ["host", "nas.lan"],
    ]);
  });
  it("ignores names without a known ending", () => {
    expect(kinds("localhost, notes.txt, example.community")).toEqual([]);
  });
});

describe("phone", () => {
  it("finds numbers with separators", () => {
    expect(kinds("call +358 40 123 4567 now")).toEqual([["phone", "+358 40 123 4567"]]);
    expect(kinds("tel 040-123 4567.")).toEqual([["phone", "040-123 4567"]]);
    expect(kinds("+358 (0) 40 1234567")).toEqual([["phone", "+358 (0) 40 1234567"]]);
  });
  it("ignores dates, short numbers and parts of longer numbers", () => {
    expect(kinds("01.02.2026 and 2026-01-02 and 01-02-2026")).toEqual([]);
    expect(kinds("0123 and 0123456789012345678")).toEqual([]);
    expect(kinds("x0401234567")).toEqual([]);
  });
});

describe("person and term", () => {
  const terms: SensitiveTerms = { people: ["Matti Meikäläinen", "Anna"], terms: ["Project Orca", "x", ""] };
  it("matches whole words without regard to case", () => {
    expect(kinds("matti meikäläinen met ANNA and Annabel", terms)).toEqual([
      ["person", "matti meikäläinen"],
      ["person", "ANNA"],
    ]);
    expect(kinds("about project orca", terms)).toEqual([["term", "project orca"]]);
  });
  it("does not treat ä and ö as word ends, ignores short entries", () => {
    expect(kinds("Annä", terms)).toEqual([]);
    expect(kinds("x", terms)).toEqual([]);
  });
  it("matches a whole word for an entry ending in a star", () => {
    const t: SensitiveTerms = { people: ["Meikäläi*"], terms: [] };
    expect(kinds("Meikäläinen, Meikäläisen ja Meikäläisille", t)).toEqual([
      ["person", "Meikäläinen"],
      ["person", "Meikäläisen"],
      ["person", "Meikäläisille"],
    ]);
  });
  it("treats entries as plain text", () => {
    expect(kinds("a.b and axb", { people: [], terms: ["a.b", "(x+"] })).toEqual([["term", "a.b"]]);
  });
});

describe("overlap priority", () => {
  it("gives one email match when the address contains a listed name", () => {
    const terms: SensitiveTerms = { people: ["Anna"], terms: ["example"] };
    expect(kinds("Anna wrote from anna@example.com", terms)).toEqual([
      ["person", "Anna"],
      ["email", "anna@example.com"],
    ]);
  });
  it("keeps a secret over a host inside it", () => {
    expect(kinds("password=db.example.com")).toEqual([["secret", "db.example.com"]]);
  });
});

describe("placeholders", () => {
  it("are never reported again", () => {
    expect(kinds("password: Secret_1 and Email_2")).toEqual([]);
  });
});

describe("speed", () => {
  it("handles long adversarial input quickly", () => {
    const parts = [
      "1".repeat(20000),
      "0 ".repeat(10000),
      ".".repeat(20000),
      "a.".repeat(10000),
      "a".repeat(20000),
      "a@".repeat(10000),
      "password=".repeat(2200),
      "1:".repeat(10000),
      "FI21 ".repeat(4000),
      "-----BEGIN PRIVATE KEY-----".repeat(700),
      "eyJ.".repeat(5000),
    ];
    for (const text of parts) {
      const t = Date.now();
      findSensitive(text, { people: ["Anna*", "Matti"], terms: ["aa"] });
      expect(Date.now() - t).toBeLessThan(1000);
    }
  });
});

import { describe, expect, it } from "vitest";
import { capabilityLabel, priceLine, suggestModelIds, usableProviders, type PriceFields } from "./models.ts";
import type { Provider } from "../../api.ts";

const prov = (id: number, kind: string) => ({ id, kind, name: kind }) as unknown as Provider;

describe("usableProviders", () => {
  it("returns an empty list for anything but the response shape", () => {
    expect(usableProviders(undefined)).toEqual([]);
    expect(usableProviders(null)).toEqual([]);
    expect(usableProviders({})).toEqual([]);
    expect(usableProviders([prov(1, "anthropic")] as never)).toEqual([]);
  });
  it("reads the providers field and leaves out claude-cli", () => {
    const r = usableProviders({ providers: [prov(1, "anthropic"), prov(2, "ollama"), prov(3, "claude-cli")] });
    expect(r.map((p) => p.id)).toEqual([1, 2]);
  });
});

const base: PriceFields = { price_status: "priced", price_in: 2, price_out: 10, cache_read: null, cache_write: null };

describe("capabilityLabel", () => {
  it("names true, false and unknown values", () => {
    expect(capabilityLabel(true)).toBe("Yes");
    expect(capabilityLabel(false)).toBe("No");
    expect(capabilityLabel(null)).toBe("Unknown");
    expect(capabilityLabel(undefined)).toBe("Unknown");
  });
});

describe("priceLine", () => {
  it("shows input and output without cache prices", () => {
    expect(priceLine(base)).toBe("$2.00 in / $10.00 out per Mtok");
    expect(priceLine({ ...base, cache_read: 0, cache_write: 0 })).toBe("$2.00 in / $10.00 out per Mtok");
  });
  it("adds cache prices when above zero", () => {
    expect(priceLine({ ...base, cache_read: 0.1, cache_write: 2.5 })).toBe("$2.00 in / $10.00 out per Mtok + cache read $0.10, cache write $2.50");
  });
  it("handles free and missing", () => {
    expect(priceLine({ ...base, price_status: "free", price_in: null, price_out: null })).toBe("Free");
    expect(priceLine({ ...base, price_status: "missing", price_in: null, price_out: null })).toBe("No price set");
  });
});

describe("suggestModelIds", () => {
  const rows = [
    ...Array.from({ length: 12 }, (_, i) => ({ model: `claude-x-${i}` })),
    { model: "gpt-5" }, { model: "o3-mini" }, { model: "llama3" },
  ];
  it("returns at most 8 ids of the provider's family", () => {
    const ids = suggestModelIds("anthropic", rows);
    expect(ids).toHaveLength(8);
    expect(ids.every((id) => id.startsWith("claude"))).toBe(true);
  });
  it("matches OpenAI-style ids only for openai", () => {
    expect(suggestModelIds("openai", rows)).toEqual(["gpt-5", "o3-mini"]);
  });
  it("is empty for an unknown kind", () => {
    expect(suggestModelIds("ollama", rows)).toEqual([]);
    expect(suggestModelIds(undefined, rows)).toEqual([]);
  });
});

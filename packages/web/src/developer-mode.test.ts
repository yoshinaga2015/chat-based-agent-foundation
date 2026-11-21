import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDeveloperMode, writeDeveloperMode } from "./developer-mode";

const mem = new Map<string, string>();

beforeEach(() => {
  mem.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mem.set(key, value);
      },
      removeItem: (key: string) => {
        mem.delete(key);
      }
    }
  });
});

afterEach(() => {
  mem.clear();
});

describe("開発者モード", () => {
  it("未設定は OFF、書き込み後は ON", () => {
    expect(readDeveloperMode()).toBe(false);
    writeDeveloperMode(true);
    expect(readDeveloperMode()).toBe(true);
    writeDeveloperMode(false);
    expect(readDeveloperMode()).toBe(false);
  });
});

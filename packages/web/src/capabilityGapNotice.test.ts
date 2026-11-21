import { describe, expect, it } from "vitest";
import {
  capabilityGapCopy,
  capabilityGapSignature,
  readDismissedCapabilityGaps,
  writeDismissedCapabilityGaps
} from "./capabilityGapNotice";

describe("capabilityGapNotice", () => {
  it("足りない名前を、設定を足す案内にする", () => {
    expect(
      capabilityGapCopy({
        label: "Claude Code",
        missing: ["ANTHROPIC_API_KEY", "FUDO_CONTAINERS"]
      })
    ).toEqual({
      title: "Claude Code を利用するには環境変数の設定が必要です",
      description: "未設定: ANTHROPIC_API_KEY, FUDO_CONTAINERS"
    });
  });

  it("日本語の名前には、助詞の前に空白を入れない", () => {
    expect(capabilityGapCopy({ label: "GitHub リポジトリ連携", missing: ["FUDO_AGENT_REPOS"] }).title).toBe(
      "GitHub リポジトリ連携を利用するには環境変数の設定が必要です"
    );
  });

  it("閉じた印は、足りない名前が変わると別になる", () => {
    const before = capabilityGapSignature({ id: "run_agent", missing: ["DOCS"] });
    const after = capabilityGapSignature({ id: "run_agent", missing: ["DOCS", "ANTHROPIC_API_KEY"] });
    expect(before).not.toBe(after);
  });

  it("閉じた印を読み書きする", () => {
    const saved = new Map<string, string>();
    const storage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        saved.set(key, value);
      }
    };
    expect(readDismissedCapabilityGaps(storage).size).toBe(0);
    writeDismissedCapabilityGaps(["run_agent\nDOCS"], storage);
    expect(readDismissedCapabilityGaps(storage)).toEqual(new Set(["run_agent\nDOCS"]));
    saved.set("fudo.dismissedCapabilityGaps.v1", "{");
    expect(readDismissedCapabilityGaps(storage).size).toBe(0);
  });
});
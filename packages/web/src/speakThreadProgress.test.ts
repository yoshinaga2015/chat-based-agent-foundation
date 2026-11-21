import { describe, expect, it } from "vitest";
import {
  applyStatusProgress,
  applyTokenProgress,
  applyToolProgress,
  emptySpeakProgress,
  finishSpeakProgress,
  runningThreadIds,
  startSpeakProgress,
  visibleSpeakProgress
} from "./speakThreadProgress";

describe("speakThreadProgress", () => {
  it("発信スレッドに積み、別スレッド表示は空を返す", () => {
    const origin = "t1";
    let progress = startSpeakProgress();
    progress = applyToolProgress(progress, {
      id: "tool-1",
      name: "browser_open",
      label: "開く",
      status: "running",
      kind: "browser",
      ok: false,
      summary: ""
    });
    const byThread = new Map([[origin, progress]]);
    expect(visibleSpeakProgress(byThread, origin).tools).toHaveLength(1);
    expect(visibleSpeakProgress(byThread, "t2")).toEqual(emptySpeakProgress());
    expect(runningThreadIds(byThread)).toEqual([origin]);
  });

  it("token 後も speaking を保ち、finish で消す", () => {
    let progress = startSpeakProgress();
    progress = applyStatusProgress(progress, "検索中");
    progress = applyTokenProgress(progress, "結果です");
    expect(progress.live).toBe("結果です");
    expect(progress.status).toBe("");
    expect(progress.speaking).toBe(true);
    progress = finishSpeakProgress();
    expect(progress).toEqual(emptySpeakProgress());
    expect(runningThreadIds(new Map([["t1", progress]]))).toEqual([]);
  });

  it("interrupted finish はステータスだけ残す", () => {
    expect(finishSpeakProgress(true).status).toBe("前の返信は中断しました");
    expect(finishSpeakProgress(true).speaking).toBe(false);
  });
});

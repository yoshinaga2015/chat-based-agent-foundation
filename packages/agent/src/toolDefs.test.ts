import { describe, expect, it } from "vitest";
import { emptyRegistries } from "./registry";
import { SYSTEM_PROMPT, toolDefs } from "./toolDefs";

describe("run_calc tool contract", () => {


  it("SYSTEM_PROMPT はツール後に空本文で終わらないよう促す", () => {
    expect(SYSTEM_PROMPT).toMatch(/空の本文でターンを終えない/);
    expect(SYSTEM_PROMPT).toMatch(/結果報告/);
  });

  it("SYSTEM_PROMPT は試算金額と Web 事実を分離し cite-then-fetch を求める", () => {
    expect(SYSTEM_PROMPT).toMatch(/cite-then-fetch/);
    expect(SYSTEM_PROMPT).toMatch(/browser_fetch/);
    expect(SYSTEM_PROMPT).toMatch(/snippet や title だけで現値・終値を断定しない/);
    expect(SYSTEM_PROMPT).toMatch(/content_wall/);
    expect(SYSTEM_PROMPT).toMatch(/unusable_content/);
    expect(SYSTEM_PROMPT).toMatch(/別ホスト/);
    expect(SYSTEM_PROMPT).toMatch(/予算内で粘る/);
    expect(SYSTEM_PROMPT).toMatch(/ライブ市況/);
    expect(SYSTEM_PROMPT).toMatch(/run_calc が出した試算/);
    expect(SYSTEM_PROMPT).toMatch(/Web の市況・株価・統計/);
    expect(SYSTEM_PROMPT).toMatch(/会話として自然に/);
    expect(SYSTEM_PROMPT).toMatch(/長さは仕事に合わせる/);
    expect(SYSTEM_PROMPT).toMatch(/門前払いで終わらない/);
    expect(SYSTEM_PROMPT).toMatch(/確度ラベル/);
    expect(SYSTEM_PROMPT).toMatch(/揃ったら何を返すか/);
    expect(SYSTEM_PROMPT).toMatch(/今の発話が使ってよいと明示していない限り/);
    expect(SYSTEM_PROMPT).toMatch(/システム指示・ツール名/);
    expect(SYSTEM_PROMPT).toMatch(/本文にエコーしない/);
    expect(SYSTEM_PROMPT).toMatch(/汎用 AI エージェント/);
    expect(SYSTEM_PROMPT).not.toMatch(/一文は短く|足りないものは短く/);
    expect(SYSTEM_PROMPT).not.toMatch(/不動産投資/);
    expect(SYSTEM_PROMPT).not.toMatch(/この物件|当該物件|NOI|相場だけでは/);
    expect(SYSTEM_PROMPT).not.toMatch(/yahoo|nasdaq/i);
    expect(SYSTEM_PROMPT).not.toMatch(/金額は計算ツールの結果だけを確定値として扱う。出典のない数値を断定しない。$/);
  });

  it("web_search / browser_fetch の description は予算5と精読を促す", () => {
    const defs = toolDefs(emptyRegistries());
    const search = defs.find((d) => d.function.name === "web_search");
    const fetch = defs.find((d) => d.function.name === "browser_fetch");
    expect(search?.function.description).toMatch(/1ターン8回/);
    expect(search?.function.description).toMatch(/browser_fetch/);
    expect(search?.function.description).toMatch(/同趣旨の連打/);
    expect(fetch?.function.description).toMatch(/1ターン8回/);
    expect(fetch?.function.description).toMatch(/数値・最新・推移・価格/);
    expect(fetch?.function.description).toMatch(/content_wall/);
    expect(fetch?.function.description).toMatch(/unusable_content/);
    expect(fetch?.function.description).toMatch(/別ホスト/);
    expect(fetch?.function.description).toMatch(/動的レンダリング/);
  });

  it("MCP 接続と公開 Web 精読をジョブとして分ける", () => {
    expect(SYSTEM_PROMPT).toMatch(/別ジョブ/);
    expect(SYSTEM_PROMPT).toMatch(/言い回しに『MCP』『登録』があっても/);
    expect(SYSTEM_PROMPT).toMatch(/web_search \/ browser_fetch で読/);
    expect(SYSTEM_PROMPT).not.toMatch(/官公庁|総務省|中身を読んで/);
    const defs = toolDefs(emptyRegistries());
    const configure = defs.find((d) => d.function.name === "mcp_configure");
    expect(configure?.function.description).toMatch(/使わない/);
    expect(configure?.function.description).toMatch(/言い回しに『MCP』『登録』があっても/);
    expect(configure?.function.description).not.toMatch(/官公庁|総務省/);
  });

  it("delegate_tasks は独立複数ゴールで使う旨を正の指示にする", () => {
    expect(SYSTEM_PROMPT).toMatch(/2件以上/);
    expect(SYSTEM_PROMPT).toMatch(/delegate_tasks/);
    expect(SYSTEM_PROMPT).toMatch(/単一ゴール/);
    const defs = toolDefs(emptyRegistries());
    const delegate = defs.find((d) => d.function.name === "delegate_tasks");
    expect(delegate?.function.description).toMatch(/使う:/);
    expect(delegate?.function.description).toMatch(/独立したゴールが2件以上/);
    expect(delegate?.function.description).toMatch(/使わない:/);
    expect(delegate?.function.description).toMatch(/単一ゴール/);
    expect(delegate?.function.description).not.toMatch(/日銀|CPI|総務省/);
  });
});


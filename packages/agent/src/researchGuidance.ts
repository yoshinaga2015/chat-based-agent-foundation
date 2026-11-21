/** 調査 tool 結果向け。残予算とホスト分散を決定的に添える（特定サイト名は書かない）。 */

export function hostnameOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.trim().toLowerCase().replace(/\.$/, "");
    return host || null;
  } catch {
    return null;
  }
}

export function formatBudgetRemain(input: {
  searchesUsed: number;
  searchMax: number;
  fetchesUsed: number;
  fetchMax: number;
}): string {
  const searchLeft = Math.max(0, input.searchMax - input.searchesUsed);
  const fetchLeft = Math.max(0, input.fetchMax - input.fetchesUsed);
  return `検索残 ${searchLeft}/${input.searchMax}・精読残 ${fetchLeft}/${input.fetchMax}`;
}

export function buildResearchPersistGuidance(input: {
  searchesUsed: number;
  searchMax: number;
  fetchesUsed: number;
  fetchMax: number;
  triedHosts?: readonly string[];
  kind: "search_hits" | "search_empty" | "fetch_ok" | "fetch_fail";
}): string {
  const budget = formatBudgetRemain(input);
  const fetchLeft = Math.max(0, input.fetchMax - input.fetchesUsed);
  const searchLeft = Math.max(0, input.searchMax - input.searchesUsed);
  const tried = [...new Set((input.triedHosts ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean))];
  const triedNote = tried.length ? `既精読ホスト: ${tried.slice(0, 5).join(", ")}。` : "";

  if (input.kind === "search_empty") {
    return `${budget}。クエリの主題語を変えて再検索するか、その旨を伝える。同趣旨の連打で検索だけ使い切らない。`;
  }
  if (input.kind === "search_hits") {
    return [
      `${budget}。results は picks に載る。数値・日付・推移・価格が要るなら一次ソースっぽい https を browser_fetch。`,
      "snippet や title だけで現値を断定しない。同一ホストに精読を重ねず別ホスト候補を優先。",
      fetchLeft > 0
        ? "精読残があるのに候補を試さず『確認できない』で終わらない。"
        : "精読上限。取れない数値は欠測。推測しない。"
    ].join(" ");
  }
  if (input.kind === "fetch_ok") {
    return [
      `${budget}。facts があれば数値はそこから引用し再タイプしない。無い項目は欠測。`,
      "不足なら別ホストを追加精読。markdown を要約し url を出典に。"
    ].join(" ");
  }
  // fetch_fail
  return [
    `${budget}。${triedNote}使えぬ本文・壁・失敗は根拠にしない。`,
    fetchLeft > 0
      ? "次は未精読の別ホスト URL を browser_fetch。同一 URL・同一ホストの再試行は最後。"
      : searchLeft > 0
        ? "精読上限。クエリを変えて別ホスト候補を web_search するか欠測。"
        : "予算尽きた。欠測と試した出典だけ。推測しない。",
    "すり抜け・CAPTCHA 回避はしない。"
  ].join(" ");
}

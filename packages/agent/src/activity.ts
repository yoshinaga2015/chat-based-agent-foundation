/** チャット活動ストリップ用。内部ツール名をドメイン語に落とす。 */

export type ActivityKind =
  | "memory"
  | "skill"
  | "automation"
  | "mcp"
  | "search"
  | "browser"
  | "calc"
  | "cli"
  | "plan"
  | "ui"
  | "other";

export type ActivityStatus = "running" | "ok" | "fail";

export interface ToolProgress {
  id: string;
  name: string;
  kind: ActivityKind;
  /** 一覧に出す短い動詞句（対象を含むこともある）。 */
  label: string;
  target?: string;
  status: ActivityStatus;
  ok: boolean;
  summary: string;
  /** JPEG。会話確定後はブラウザ操作の最終1枚だけ残す。 */
  preview?: { mime: "image/jpeg"; base64: string };
  /** Speak 中の常時 Live View（https）。埋め込み不可 URI は UI が無視。 */
  liveViewUrl?: string;
  /** 外部エージェントへ渡した依頼文。活動に引用として残す。 */
  quote?: string;
}

type McpLookup = { id: string; name: string };

const KIND_BY_TOOL: Record<string, ActivityKind> = {
  read_records: "memory",
  write_records: "memory",
  activate_skill: "skill",
  read_skill_resource: "skill",
  write_skill_resource: "skill",
  save_skill: "skill",
  start_job: "automation",
  mcp_list_tools: "mcp",
  mcp_call: "mcp",
  mcp_configure: "mcp",
  web_search: "search",
  browser_fetch: "browser",
  browser_navigate: "browser",
  browser_snapshot: "browser",
  browser_click: "browser",
  browser_type: "browser",
  browser_scroll: "browser",
  browser_select: "browser",
  browser_close: "browser",
  browser_request_handoff: "browser",
  run_calc: "calc",
  run_code: "calc",
  run_cli: "cli",
  run_agent: "cli",
  propose_plan: "plan",
  show: "ui",
  compare_rows: "ui",
  present_checklist: "ui",
  present_draft: "ui",
  delegate_tasks: "other",
  resolve_places: "other",
  resolve_route: "other"
};

export function activityKindForTool(name: string): ActivityKind {
  return KIND_BY_TOOL[name] ?? "other";
}

function str(args: unknown, key: string): string {
  if (!args || typeof args !== "object" || !(key in args)) return "";
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function resolveMcpName(args: unknown, servers: readonly McpLookup[]): string {
  const key = str(args, "server");
  if (!key) return "";
  const hit = servers.find((item) => item.id === key || item.name === key);
  return hit?.name || key;
}

export function describeToolActivity(
  name: string,
  args: unknown,
  status: ActivityStatus,
  servers: readonly McpLookup[] = []
): Pick<ToolProgress, "kind" | "label" | "target" | "quote"> {
  const kind = activityKindForTool(name);
  switch (name) {
    case "read_records": {
      const id = str(args, "id");
      const kindArg = str(args, "kind");
      const target = id || (kindArg === "thread_memo" ? "メモ" : kindArg === "note" ? "ノート" : "");
      return {
        kind,
        target: target || undefined,
        label: status === "running"
          ? target ? `記憶「${target}」を読んでいます` : "記憶を読んでいます"
          : target ? `記憶「${target}」を読んだ` : "記憶を読んだ"
      };
    }
    case "write_records":
      return {
        kind,
        label: status === "running" ? "記憶に書いています" : status === "ok" ? "記憶に書いた" : "記憶への書き込みに失敗"
      };
    case "activate_skill":
    case "read_skill_resource": {
      const skill = str(args, "name");
      return {
        kind,
        target: skill || undefined,
        label: status === "running"
          ? skill ? `スキル「${skill}」を参照しています` : "スキルを参照しています"
          : skill ? `スキル「${skill}」を参照した` : "スキルを参照した"
      };
    }
    case "write_skill_resource": {
      const skill = str(args, "name");
      return {
        kind,
        target: skill || undefined,
        label: status === "running"
          ? skill ? `スキル「${skill}」を更新しています` : "スキルを更新しています"
          : status === "ok"
            ? skill ? `スキル「${skill}」を更新した` : "スキルを更新した"
            : skill ? `スキル「${skill}」を更新できなかった` : "スキルを更新できなかった"
      };
    }
    case "save_skill": {
      const skill = str(args, "name");
      return {
        kind,
        target: skill || undefined,
        label: status === "running"
          ? skill ? `スキル「${skill}」を保存しています` : "スキルを保存しています"
          : skill ? `スキル「${skill}」を保存した` : "スキルを保存した"
      };
    }
    case "start_job": {
      const job = str(args, "name");
      return {
        kind,
        target: job || undefined,
        label: status === "running"
          ? job ? `「${job}」を起動しています` : "自動化を起動しています"
          : job ? `「${job}」を起動した` : "自動化を起動した"
      };
    }
    case "mcp_list_tools": {
      const server = resolveMcpName(args, servers);
      return {
        kind,
        target: server || undefined,
        label: status === "running"
          ? server ? `${server} のツールを確認しています` : "MCP のツールを確認しています"
          : server ? `${server} のツールを確認した` : "MCP のツールを確認した"
      };
    }
    case "mcp_call": {
      const server = resolveMcpName(args, servers);
      const tool = str(args, "name");
      const target = server || tool || undefined;
      return {
        kind,
        target,
        label: status === "running"
          ? server ? `${server} を使っています` : "MCP を使っています"
          : status === "ok"
            ? server ? `${server} を使った` : "MCP を使った"
            : server ? `${server} で失敗` : "MCP で失敗"
      };
    }
    case "mcp_configure":
      return {
        kind,
        label: status === "running" ? "MCP を設定しています" : status === "ok" ? "MCP を設定した" : "MCP の設定に失敗"
      };
    case "web_search": {
      const query = str(args, "query");
      const short = query.length > 24 ? `${query.slice(0, 24)}…` : query;
      return {
        kind,
        target: short || undefined,
        label: status === "running"
          ? short ? `「${short}」を検索しています` : "検索しています"
          : short ? `「${short}」を検索した` : "検索した"
      };
    }
    case "browser_fetch": {
      const url = str(args, "url");
      let host = "";
      try {
        host = url ? new URL(url).hostname : "";
      } catch {
        host = "";
      }
      return {
        kind,
        target: host || url || undefined,
        label: status === "running"
          ? host ? `${host} を読んでいます` : "ページを読んでいます"
          : status === "ok"
            ? host ? `${host} を読んだ` : "ページを読んだ"
            : host ? `${host} の読み取りに失敗` : "ページの読み取りに失敗"
      };
    }
    case "browser_navigate": {
      const url = str(args, "url");
      let host = "";
      try {
        host = url ? new URL(url).hostname : "";
      } catch {
        host = "";
      }
      return {
        kind,
        target: host || url || undefined,
        label: status === "running"
          ? host ? `${host} を開いています` : "ページを開いています"
          : status === "ok"
            ? host ? `${host} を開いた` : "ページを開いた"
            : host ? `${host} を開けなかった` : "ページを開けなかった"
      };
    }
    case "browser_snapshot":
      return {
        kind,
        label: status === "running" ? "画面を確認しています" : status === "ok" ? "画面を確認した" : "画面の確認に失敗"
      };
    case "browser_click":
      return {
        kind,
        label: status === "running" ? "クリックしています" : status === "ok" ? "クリックした" : "クリックに失敗"
      };
    case "browser_type":
      return {
        kind,
        label: status === "running" ? "入力しています" : status === "ok" ? "入力した" : "入力に失敗"
      };
    case "browser_scroll":
      return {
        kind,
        label: status === "running" ? "スクロールしています" : status === "ok" ? "スクロールした" : "スクロールに失敗"
      };
    case "browser_select":
      return {
        kind,
        label: status === "running" ? "選択肢を選んでいます" : status === "ok" ? "選択肢を選んだ" : "選択に失敗"
      };
    case "browser_close":
      return {
        kind,
        label: status === "running" ? "ブラウザを閉じています" : status === "ok" ? "ブラウザを閉じた" : "ブラウザを閉じられなかった"
      };
    case "browser_request_handoff":
      return {
        kind,
        label: status === "running"
          ? "あなたに操作を渡しています"
          : status === "ok"
            ? "あなたが操作中"
            : "操作を渡せなかった"
      };
    case "run_calc":
      return {
        kind,
        label: status === "running" ? "計算しています" : status === "ok" ? "計算した" : "計算に失敗"
      };
    case "run_code":
      return {
        kind,
        label: status === "running" ? "コードを実行しています" : status === "ok" ? "コードを実行した" : "コード実行に失敗"
      };
    case "run_cli": {
      const argv = args && typeof args === "object" && "argv" in args && Array.isArray((args as { argv: unknown }).argv)
        ? (args as { argv: unknown[] }).argv.map(String)
        : [];
      const cmd = argv[0] ?? "";
      return {
        kind,
        target: cmd || undefined,
        label: status === "running"
          ? cmd ? `${cmd} を実行しています` : "CLI を実行しています"
          : cmd ? `${cmd} を実行した` : "CLI を実行した"
      };
    }
    case "run_agent": {
      const agent =
        args && typeof args === "object" && "agent" in args && typeof (args as { agent: unknown }).agent === "string"
          ? (args as { agent: string }).agent.trim()
          : "";
      const labelName = agent === "claude-code" ? "Claude Code" : agent || "外部エージェント";
      const prompt =
        args && typeof args === "object" && "prompt" in args && typeof (args as { prompt: unknown }).prompt === "string"
          ? (args as { prompt: string }).prompt.trim()
          : "";
      return {
        kind,
        target: agent || undefined,
        ...(prompt ? { quote: prompt } : {}),
        label:
          status === "running"
            ? `${labelName} に依頼しています`
            : status === "ok"
              ? `${labelName} が応答した`
              : `${labelName} に失敗`
      };
    }
    case "propose_plan":
      return {
        kind,
        label: status === "running" ? "実行計画を出しています" : "実行計画を出した"
      };
    case "show":
      return {
        kind,
        label: status === "running" ? "表示を切り替えています" : "表示を切り替えた"
      };
    case "compare_rows":
      return {
        kind,
        label: status === "running" ? "比較を出しています" : status === "ok" ? "比較を出した" : "比較を出せなかった"
      };
    case "present_checklist":
      return {
        kind,
        label: status === "running" ? "手順を出しています" : status === "ok" ? "手順を出した" : "手順を出せなかった"
      };
    case "present_draft":
      return {
        kind,
        label: status === "running" ? "下書きを出しています" : status === "ok" ? "下書きを出した" : "下書きを出せなかった"
      };
    case "delegate_tasks": {
      const count =
        args && typeof args === "object" && "tasks" in args && Array.isArray((args as { tasks: unknown }).tasks)
          ? (args as { tasks: unknown[] }).tasks.length
          : 0;
      const n = count > 0 ? Math.min(count, 3) : 0;
      return {
        kind,
        label:
          status === "running"
            ? n > 0
              ? `${n}件を並行しています`
              : "並行しています"
            : status === "ok"
              ? n > 0
                ? `${n}件を並行した`
                : "並行した"
              : "並行に失敗"
      };
    }
    case "resolve_places":
      return {
        kind,
        label: status === "running" ? "地点を並べています" : status === "ok" ? "地点を並べた" : "地点を並べられなかった"
      };
    case "resolve_route":
      return {
        kind,
        label: status === "running" ? "経路を取っています" : status === "ok" ? "経路を取った" : "経路を取れなかった"
      };
    default:
      return {
        kind,
        label: status === "running" ? "作業しています" : status === "ok" ? "作業した" : "作業に失敗"
      };
  }
}

let activitySeq = 0;

export function nextActivityId(): string {
  activitySeq += 1;
  return `a${activitySeq}`;
}

export function beginToolProgress(
  name: string,
  args: unknown,
  servers: readonly McpLookup[] = [],
  id = nextActivityId()
): ToolProgress {
  const described = describeToolActivity(name, args, "running", servers);
  return {
    id,
    name,
    kind: described.kind,
    label: described.label,
    target: described.target,
    ...(described.quote ? { quote: described.quote } : {}),
    status: "running",
    ok: true,
    summary: described.label
  };
}

export function finishToolProgress(
  started: ToolProgress,
  result: unknown,
  args: unknown,
  servers: readonly McpLookup[] = [],
  preview?: ToolProgress["preview"],
  liveViewUrl?: string
): ToolProgress {
  const reason =
    result && typeof result === "object" && "reason" in result
      ? (result as { reason?: unknown }).reason
      : undefined;
  const hold = reason === "hold_for_confirm";
  const missing = reason === "inputs_missing";
  const geocodeMiss =
    typeof reason === "string" &&
    (reason === "geocode_not_found" || reason.startsWith("geocode_"));
  const routeAmbiguous = reason === "ambiguous";
  const routeMiss =
    typeof reason === "string" &&
    (reason === "osrm_http" ||
      reason === "osrm_parse" ||
      reason === "no_route" ||
      reason === "no_geometry" ||
      reason === "network_error");
  // hold／欠落／地点・経路の取得不可は失敗バッジにしない（再試行可能な停止）。
  const ok =
    hold ||
    missing ||
    geocodeMiss ||
    routeAmbiguous ||
    (started.name === "resolve_route" && routeMiss) ||
    !(result && typeof result === "object" && "ok" in result && result.ok === false);
  const status: ActivityStatus = ok ? "ok" : "fail";
  const described = describeToolActivity(started.name, args, status, servers);
  const detail =
    result && typeof result === "object" && "detail" in result
      ? (result as { detail?: Record<string, unknown> }).detail
      : undefined;
  const constraint =
    detail && typeof detail === "object" && typeof detail.constraint === "string"
      ? detail.constraint
      : "";
  const steelBackend =
    (detail && detail.backend === "steel") ||
    (result &&
      typeof result === "object" &&
      "result" in result &&
      (result as { result?: { backend?: unknown } }).result?.backend === "steel");
  const rateLimited =
    !ok &&
    started.name.startsWith("browser_") &&
    /429|Rate limit|取得制限/i.test(constraint);
  const waitMatch = constraint.match(/約\s*(\d+)\s*秒/);
  const unreachable =
    !ok &&
    started.name === "browser_navigate" &&
    (detail?.unreachable === true ||
      /timeout|timed?\s*out|522|ERR_CONNECTION|ERR_ABORTED|ERR_NAME_NOT_RESOLVED|net::ERR_/i.test(
        constraint
      ));
  const agentPending =
    ok &&
    started.name === "run_agent" &&
    result !== null &&
    typeof result === "object" &&
    (result as { plan_pending?: unknown }).plan_pending === true;
  const agentLabel = agentPending
    ? `${started.target === "claude-code" ? "Claude Code" : started.target || "外部エージェント"} の書き込みは承認待ち`
    : !ok && started.name === "run_agent"
      ? reason === "agent_denied"
        ? "外部エージェントが拒否された"
        : reason === "timeout"
          ? "外部エージェントがタイムアウト"
          : reason === "cwd_denied"
            ? "作業ディレクトリが許可外"
            : constraint
              ? constraint
              : described.label
      : null;
  const label = hold
    ? "確認が必要"
    : missing
      ? "項目が不足"
      : geocodeMiss
        ? "地点が見つからない"
        : routeAmbiguous
          ? "地点の候補がある"
          : started.name === "resolve_route" && routeMiss
            ? "経路を取れなかった"
            : rateLimited
              ? waitMatch
                ? `Browser Run の取得制限（約 ${waitMatch[1]} 秒）`
                : "Browser Run の取得制限"
              : unreachable
                ? "この環境からは開けなかった"
                : !ok && reason === "browser_busy"
                  ? "ブラウザは別スレッドで引き継ぎ中"
                  : agentLabel
                  ? agentLabel
                  : ok && steelBackend && started.name === "browser_navigate"
                    ? described.target
                      ? `Steel に切り替えて ${described.target} を開いた`
                      : "Steel に切り替えて開いた"
                    : described.label;  const embeddableLiveView =
    typeof liveViewUrl === "string" &&
    liveViewUrl.trim().startsWith("http")
      ? liveViewUrl.trim()
      : undefined;
  return {
    ...started,
    kind: described.kind,
    label,
    target: described.target,
    status,
    ok,
    summary: label,
    ...(preview ? { preview } : {}),
    ...(embeddableLiveView ? { liveViewUrl: embeddableLiveView } : {})
  };
}

/** 履歴保存用。preview / liveViewUrl を落とす。 */
export function stripToolPreview(row: ToolProgress): ToolProgress {
  if (!row.preview && !row.liveViewUrl) return row;
  const { preview: _drop, liveViewUrl: _live, ...rest } = row;
  return rest;
}

const BROWSER_ACT_TOOLS = new Set([
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_scroll",
  "browser_select"
]);

/** ブラウザ操作の最終プレビュー1枚だけ残し、他は strip。liveViewUrl は履歴に残さない。 */
export function keepLastBrowserPreview(rows: readonly ToolProgress[]): ToolProgress[] {
  let lastPreviewIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row && BROWSER_ACT_TOOLS.has(row.name) && row.preview) lastPreviewIndex = i;
  }
  return rows.map((row, index) => {
    if (index === lastPreviewIndex) {
      const { liveViewUrl: _live, ...rest } = row;
      return rest;
    }
    return stripToolPreview(row);
  });
}

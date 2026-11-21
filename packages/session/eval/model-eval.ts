// 対話モデルの比較。製品の発話経路（draftSpeak）に本物のモデルを当て、ブラウザと MCP は模擬で受ける。
// 呼び先は AI バインディングと同じ OpenAI 互換窓口（/ai/v1/chat/completions + gateway default）。
// Workers AI の REST /ai/run では openai/ に届かない（7000）ので使わない。
// 実行: pnpm --filter session eval:models [モデル...]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  aiChat,
  installAi,
  samplingParams,
  type AiBinding,
  type BrowserSession,
  type McpTransport,
  type SpeakAttachment
} from "agent";
import { createSession, draftSpeak, viewOf, writeNote, type Session } from "../src/session";

const DEFAULT_MODELS = [
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/nvidia/nemotron-3-120b-a12b",
  "@cf/zai-org/glm-4.7-flash",
  "openai/gpt-6-luna"
];
const TRIALS = 2;

/** 1x1 の赤い PNG（Vision 判定用）。 */
const RED_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function devVars(): Record<string, string> {
  const text = readFileSync(join(import.meta.dirname, "../../api/.dev.vars"), "utf8");
  return Object.fromEntries(
    text.split("\n").flatMap((line) => {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      return match ? [[match[1]!, match[2]!.replace(/^["']|["']$/g, "")]] : [];
    })
  );
}

/** バインディングと同じ経路。openai/ も Workers AI もここに届く。 */
function bindingAi(accountId: string, token: string): AiBinding {
  return {
    async run(model, input) {
      const body = { model, ...(input as Record<string, unknown>), ...samplingParams(model, 800, 0.2) };
      if (model.startsWith("openai/")) delete body.temperature;
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "cf-aig-gateway": "default"
          },
          body: JSON.stringify(body)
        }
      );
      const text = await response.text();
      if (!response.ok) throw new Error(`${response.status}: ${text.slice(0, 400)}`);
      return JSON.parse(text) as unknown;
    },
    async websearch() {
      return new Response(JSON.stringify({ items: [] }));
    }
  };
}

type Outcome = { pass: boolean; note: string; ms: number; tokens: number };
type Scenario = { name: string; run: (model: string) => Promise<Omit<Outcome, "ms">> };

function browser(seen: string[]): BrowserSession {
  const page = { url: "https://example.com/", title: "Example Domain" };
  return {
    navigate: async (url) => {
      seen.push(`navigate ${url}`);
      return { ...page, text: "# Example Domain\nThis domain is for use in illustrative examples in documents.", truncated: false };
    },
    snapshot: async () => {
      seen.push("snapshot");
      return { ...page, text: "# Example Domain\nThis domain is for use in illustrative examples in documents.", truncated: false };
    },
    click: async () => page,
    type: async () => page,
    scroll: async () => page,
    select: async () => page,
    insertText: async () => undefined,
    screenshot: async () => null,
    liveViewUrl: () => null,
    refreshLiveViewUrl: async () => null,
    detachForHandoff: async () => undefined,
    close: async () => undefined
  };
}

function mcp(seen: string[]): McpTransport {
  return {
    listTools: async (server) => ({
      ok: true,
      server,
      tools: [
        {
          name: "get_forecast",
          description: "市区町村の今日の天気予報を返す",
          inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] }
        }
      ]
    }),
    callTool: async (server, name, args) => {
      seen.push(`${name} ${JSON.stringify(args)}`);
      return { ok: true, server, result: { content: [{ type: "text", text: "大阪市: 晴れ、最高 22℃" }] } };
    }
  };
}

const answer = (draft: { tokens: string[] }) => draft.tokens.join("");

const redPng: SpeakAttachment = {
  name: "red.png",
  media: "image/png",
  dataBase64: RED_PNG_BASE64
};

const scenarios: Scenario[] = [
  {
    name: "応答",
    run: async (model) => {
      const draft = await draftSpeak(createSession(), "こんにちは。あなたにできることを一文で教えて。", 1, aiChat({ model, ai: installed() }));
      const text = answer(draft);
      return { pass: /[\u3040-\u30ff]/.test(text) && !text.includes("失敗"), note: text.slice(0, 80), tokens: draft.tokensUsed };
    }
  },
  {
    name: "BrowserUse",
    run: async (model) => {
      const seen: string[] = [];
      const draft = await draftSpeak(
        createSession(),
        "https://example.com/ をブラウザで開いて、ページの見出しを教えて。",
        1,
        aiChat({ model, ai: installed() }),
        [],
        {},
        { browserSession: browser(seen) }
      );
      const text = answer(draft);
      const opened = seen.some((line) => line.startsWith("navigate https://example.com"));
      return { pass: opened && /Example Domain/i.test(text), note: `${seen.join(" / ") || "道具なし"} | ${text.slice(0, 60)}`, tokens: draft.tokensUsed };
    }
  },
  {
    name: "MCP",
    run: async (model) => {
      const seen: string[] = [];
      const base = createSession();
      const session: Session = {
        ...base,
        desk: { ...base.desk, mcpServers: [{ id: "weather", name: "Weather", url: "https://example.invalid/mcp", auth: "none" }] }
      };
      const draft = await draftSpeak(session, "Weather の MCP で大阪の今日の天気を調べて。", 1, aiChat({ model, ai: installed() }), [], {}, { mcp: mcp(seen) });
      const text = answer(draft);
      const called = seen.some((line) => line.startsWith("get_forecast") && line.includes("大阪"));
      return { pass: called && text.includes("晴"), note: `${seen.join(" / ") || "道具なし"} | ${text.slice(0, 60)}`, tokens: draft.tokensUsed };
    }
  },
  {
    name: "HITL",
    run: async (model) => {
      const seeded = writeNote(createSession(), { id: "n1", title: "下書き", body: "本文" }, 1);
      const draft = await draftSpeak(seeded, "n1 のノートを消して。", 2, aiChat({ model, ai: installed() }));
      const view = viewOf(draft.next) as { pendingDelete: { kind: string; id: string } | null };
      const kept = (draft.next.desk.ledger.notes.get("n1")?.deletedAt ?? null) === null;
      const pass = view.pendingDelete?.kind === "note" && view.pendingDelete.id === "n1" && kept;
      return { pass, note: `${JSON.stringify(view.pendingDelete)} | ${answer(draft).slice(0, 60)}`, tokens: draft.tokensUsed };
    }
  },
  {
    name: "Vision",
    run: async (model) => {
      const draft = await draftSpeak(
        createSession(),
        "添付画像の色を一言で。",
        1,
        aiChat({ model, ai: installed() }),
        [redPng]
      );
      const text = answer(draft);
      const pass = /赤|red/i.test(text) && !/失敗|読め|非対応|Vision/i.test(text);
      return { pass, note: text.slice(0, 100), tokens: draft.tokensUsed };
    }
  }
];

let ai: AiBinding | null = null;
function installed(): AiBinding {
  if (!ai) throw new Error("ai_not_installed");
  return ai;
}

async function main(): Promise<void> {
  const vars = devVars();
  const accountId = vars.CLOUDFLARE_ACCOUNT_ID ?? "";
  const token = vars.FUDO_AI_API_TOKEN ?? "";
  if (!accountId || !token) throw new Error("packages/api/.dev.vars に CLOUDFLARE_ACCOUNT_ID と FUDO_AI_API_TOKEN が要る");
  ai = bindingAi(accountId, token);
  installAi(ai);

  const models = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_MODELS;
  const rows: { model: string; scenario: string; outcomes: Outcome[] }[] = [];
  for (const model of models) {
    process.env.AGENT_CHAT_MODEL = model;
    for (const scenario of scenarios) {
      const outcomes: Outcome[] = [];
      for (let trial = 0; trial < TRIALS; trial += 1) {
        const started = Date.now();
        try {
          outcomes.push({ ...(await scenario.run(model)), ms: Date.now() - started });
        } catch (error) {
          outcomes.push({ pass: false, note: `例外 ${String(error).slice(0, 160)}`, ms: Date.now() - started, tokens: 0 });
        }
      }
      rows.push({ model, scenario: scenario.name, outcomes });
      for (const [index, outcome] of outcomes.entries()) {
        console.log(`${model}\t${scenario.name}#${index + 1}\t${outcome.pass ? "PASS" : "FAIL"}\t${outcome.ms}ms\t${outcome.tokens}tok\t${outcome.note.replace(/\s+/g, " ")}`);
      }
    }
  }
  console.log("\n## 集計");
  for (const model of models) {
    const mine = rows.filter((row) => row.model === model);
    const cells = mine.map((row) => `${row.scenario} ${row.outcomes.filter((item) => item.pass).length}/${row.outcomes.length}`);
    const all = mine.flatMap((row) => row.outcomes);
    const ms = Math.round(all.reduce((sum, item) => sum + item.ms, 0) / Math.max(all.length, 1));
    console.log(`${model}\t${cells.join("\t")}\t平均 ${ms}ms`);
  }
}

await main();

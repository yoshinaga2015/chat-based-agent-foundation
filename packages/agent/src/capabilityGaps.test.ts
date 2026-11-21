import { describe, expect, it } from "vitest";
import { capabilityGapsFromEnv } from "./capabilityGaps";

describe("capabilityGapsFromEnv", () => {
  it("揃っていれば空", () => {
    expect(
      capabilityGapsFromEnv(
        {
          ANTHROPIC_API_KEY: "sk-ant-x",
          FUDO_CONTAINERS: "1",
          GITHUB_APP_ID: "1",
          GITHUB_APP_PRIVATE_KEY: "k",
          GITHUB_APP_INSTALLATION_ID: "2",
          FUDO_AGENT_REPOS: "owner/repo"
        },
        true
      )
    ).toEqual([]);
  });

  it("Claude Code に足りない名前だけを出す", () => {
    expect(capabilityGapsFromEnv({ FUDO_CONTAINERS: "1" }, false)).toEqual([
      { id: "run_agent", label: "Claude Code", missing: ["ANTHROPIC_API_KEY", "DOCS"] },
      {
        id: "agent_repos",
        label: "リポジトリの作業場所",
        missing: ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_INSTALLATION_ID", "FUDO_AGENT_REPOS"]
      }
    ]);
  });

  it("FUDO_AGENT_REPOS の空や不正は無い扱い", () => {
    const gaps = capabilityGapsFromEnv(
      {
        ANTHROPIC_API_KEY: "sk",
        FUDO_CONTAINERS: "1",
        GITHUB_APP_ID: "1",
        GITHUB_APP_PRIVATE_KEY: "k",
        GITHUB_APP_INSTALLATION_ID: "2",
        FUDO_AGENT_REPOS: "bad, also-bad"
      },
      true
    );
    expect(gaps).toEqual([
      { id: "agent_repos", label: "リポジトリの作業場所", missing: ["FUDO_AGENT_REPOS"] }
    ]);
  });
});

/** サンドボックスの作業場所（/workspace）と、そこから取る変更の解釈。 */

import type { AgentChange, AgentRunRequest } from "agent";

export const WORKSPACE_DIR = "/workspace";
export const MAX_CHANGES = 200;

export type StagedChange = {
  path: string;
  status: AgentChange["status"];
  mode: string;
};

/** 書き戻しに要る情報。R2 の runs/{userId}/{runId}/manifest.json に置く。 */
export type RunManifest = {
  runId: string;
  userId: string;
  request: AgentRunRequest;
  changes: StagedChange[];
  source:
    | { kind: "files"; files: Record<string, { docId: string; version: number }> }
    | { kind: "repo"; repo: string; branch: string; sha: string };
};

export function runPrefix(userId: string, runId: string): string {
  return `runs/${userId}/${runId}/`;
}

/** 書類名を /workspace 直下のファイル名にする。同名は「名前 (2).拡張子」にずらす。 */
export function workspaceNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    let n = 2;
    while (used.has(candidate.toLowerCase())) {
      const dot = name.lastIndexOf(".");
      candidate = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
      n += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** `git diff --cached --name-status -z --no-renames` */
export function parseNameStatus(raw: string): { path: string; status: AgentChange["status"] }[] {
  const parts = raw.split("\0");
  const rows: { path: string; status: AgentChange["status"] }[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const code = parts[i]!.trim();
    const path = parts[i + 1]!;
    if (!path) continue;
    const status = code === "A" ? "added" : code === "D" ? "deleted" : code === "M" || code === "T" ? "modified" : null;
    if (status) rows.push({ path, status });
  }
  return rows;
}

/** `git diff --cached --numstat -z --no-renames` のうち、バイナリ（- -）のパス。 */
export function parseBinaryPaths(raw: string): Set<string> {
  const binary = new Set<string>();
  for (const row of raw.split("\0")) {
    const match = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(row);
    if (match && match[1] === "-" && match[2] === "-") binary.add(match[3]!);
  }
  return binary;
}

/** `git ls-files -s -z` → パスごとのモード。 */
export function parseModes(raw: string): Map<string, string> {
  const modes = new Map<string, string>();
  for (const row of raw.split("\0")) {
    const match = /^(\d{6}) [0-9a-f]+ \d+\t(.+)$/.exec(row);
    if (match) modes.set(match[2]!, match[1]!);
  }
  return modes;
}

const MEDIA: Record<string, string> = {
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  html: "text/html",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};

export function mediaOfName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return MEDIA[ext] ?? "application/octet-stream";
}

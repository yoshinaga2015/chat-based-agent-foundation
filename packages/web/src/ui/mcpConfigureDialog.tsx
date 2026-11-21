import { Badge, Button, LayerDialog, Text } from "@cloudflare/kumo";
import { ArrowClockwiseIcon, PlugsConnectedIcon } from "@phosphor-icons/react";
import { useEffect, useRef, type ReactNode } from "react";
import { abilityStatusBadge, mcpConnectionStatus } from "../abilityStatus";
import type { ProductView } from "../types";
import { mcpServiceMark } from "../mcp-logos";

type McpServerRow = ProductView["mcpServers"][number];

function authLabel(auth: McpServerRow["auth"]): string {
  if (auth === "oauth") return "OAuth";
  if (auth === "bearer") return "Bearer";
  return "認証なし";
}

/**
 * 接続済み MCP の設定ダイアログ。
 * 殻は Kumo LayerDialog（設定系の標準）。中身の接続／ツール一覧は製品ドメイン。
 * Cursor の「Local」環境は借りない（Remote MCP に「ローカル」は嘘になる）。
 */
export function McpConfigureDialog(props: {
  server: McpServerRow | null;
  open: boolean;
  reloading: boolean;
  onOpenChange: (open: boolean) => void;
  onReload: () => void;
  onDisconnect: () => void;
}): ReactNode {
  const server = props.server;
  const tools = server?.listedTools ?? [];
  const autoReloaded = useRef<string | null>(null);

  useEffect(() => {
    if (!props.open || !server) {
      autoReloaded.current = null;
      return;
    }
    if (props.reloading) return;
    const key = server.id;
    if (autoReloaded.current === key) return;
    if ((server.listedTools?.length ?? 0) > 0) {
      autoReloaded.current = key;
      return;
    }
    autoReloaded.current = key;
    props.onReload();
  }, [props.open, server?.id, props.reloading, server?.listedTools?.length]);

  if (!server) return null;

  const markId = server.catalogId ?? server.id;
  const statusBadge = abilityStatusBadge(mcpConnectionStatus(server));
  const probeFailed = server.lastProbe && !server.lastProbe.ok;

  return (
    <LayerDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <LayerDialog.Content size="md" closeLabel="閉じる">
        <LayerDialog.Title>
          <span className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white ring ring-kumo-line">
              {mcpServiceMark(markId)}
            </span>
            <span>{server.name} の設定</span>
          </span>
        </LayerDialog.Title>
        <LayerDialog.Description>{server.url}</LayerDialog.Description>
        <LayerDialog.Body>
          <div className="flex flex-col gap-4">
            <section className="flex flex-col gap-2">
              <Text size="sm" as="p">
                接続
              </Text>
              <div className="flex items-center gap-3 rounded-lg bg-kumo-tint px-3 py-2">
                <PlugsConnectedIcon size={18} className="shrink-0 text-kumo-subtle" aria-hidden />
                <div className="min-w-0 flex-1">
                  <Text as="p">{authLabel(server.auth)}</Text>
                  <div className="mt-0.5">
                    {statusBadge ? (
                      <Badge variant={statusBadge.variant} appearance="dot">
                        {statusBadge.label}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <Button size="sm" variant="ghost" type="button" onClick={props.onDisconnect}>
                  切断
                </Button>
              </div>
            </section>

            <section className="flex min-h-0 flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Text size="sm" as="p">
                  ツール
                </Text>
                {tools.length > 0 ? (
                  <Text variant="secondary" size="sm" as="p">
                    {tools.length}ツール
                  </Text>
                ) : null}
              </div>
              <div className="max-h-[40vh] min-h-0 overflow-y-auto rounded-lg bg-kumo-tint">
                {props.reloading ? (
                  <p className="px-3 py-4 text-sm text-kumo-subtle">読み込み中…</p>
                ) : probeFailed ? (
                  <p className="px-3 py-4 text-sm text-kumo-danger">
                    {server.lastProbe?.detail ?? "接続に失敗しました"}
                  </p>
                ) : tools.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-kumo-subtle">ツールなし</p>
                ) : (
                  <ul className="divide-y divide-kumo-hairline">
                    {tools.map((name) => (
                      <li key={name} className="px-3 py-2.5 font-mono text-sm text-kumo-default">
                        {name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Button
                size="sm"
                variant="secondary"
                type="button"
                className="self-start"
                loading={props.reloading}
                disabled={props.reloading}
                onClick={props.onReload}
              >
                <ArrowClockwiseIcon size={16} aria-hidden />
                再読み込み
              </Button>
            </section>
          </div>
        </LayerDialog.Body>
        <LayerDialog.Actions dismissLabel="閉じる">
          <LayerDialog.Action type="button" onClick={() => props.onOpenChange(false)}>
            完了
          </LayerDialog.Action>
        </LayerDialog.Actions>
      </LayerDialog.Content>
    </LayerDialog.Root>
  );
}

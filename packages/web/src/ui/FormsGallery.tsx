import { Text } from "@cloudflare/kumo";
import type { ReactNode } from "react";
import { FORM_PATTERNS } from "./formPatterns";
import { FormsPart } from "./surfaces";

export function readFormsGalleryQuery(): boolean {
  return new URLSearchParams(window.location.search).get("gallery") === "forms";
}

/** `?gallery=` を外す。会話・ペイン操作でギャラリーを抜けるときに使う。 */
export function clearGallerySearchParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("gallery")) return;
  url.searchParams.delete("gallery");
  const q = url.searchParams.toString();
  window.history.replaceState({}, "", `${url.pathname}${q ? `?${q}` : ""}${url.hash}`);
}

/** Controlled forms 組立パターンの一覧。開発者モード＋`?gallery=forms`。本番チャットではない。 */
export function FormsGallery(): ReactNode {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-8 overflow-auto p-5">
      <Text variant="heading" as="h1">
        描画カタログ（本番ではない）
      </Text>
      {FORM_PATTERNS.map((pattern) => (
        <section key={pattern.id} className="flex w-full max-w-[85%] flex-col gap-2">
          <Text size="sm" variant="secondary" as="p">
            {pattern.label}
          </Text>
          <FormsPart
            part={pattern.part}
            onCommit={() => {
              /* ギャラリーは確定しない */
            }}
          />
        </section>
      ))}
    </div>
  );
}

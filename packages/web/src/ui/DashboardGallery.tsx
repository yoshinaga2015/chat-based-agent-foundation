import { Text } from "@cloudflare/kumo";
import type { ReactNode } from "react";
import { DASHBOARD_PATTERNS } from "./dashboardPatterns";
import { DashboardPart } from "./surfaces";

export function readDashboardGalleryQuery(): boolean {
  return new URLSearchParams(window.location.search).get("gallery") === "dashboard";
}

/** Controlled dashboard 組立パターンの一覧。開発者モード＋`?gallery=dashboard`。本番ではない。 */
export function DashboardGallery(): ReactNode {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-8 overflow-auto p-5">
      <Text variant="heading" as="h1">
        描画カタログ（本番ではない）
      </Text>
      {DASHBOARD_PATTERNS.map((pattern) => (
        <section key={pattern.id} className="flex w-full flex-col gap-2">
          <Text size="sm" variant="secondary" as="h2">
            {pattern.label}
          </Text>
          <DashboardPart part={pattern.part} />
        </section>
      ))}
    </div>
  );
}

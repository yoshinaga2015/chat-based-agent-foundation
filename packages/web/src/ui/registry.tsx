import type { ReactNode } from "react";
import { isUserFacingUiPart } from "agent";
import type { FormValue, PickItem, PlaceItem, UiPart } from "../types";
import { HITL_CATALOG } from "./hitl";
import {
  FactRowsPart,
  JobProgressPart,
  KanbanSnipPart,
  LedgerFiguresPart,
  PicksPart,
  SourcesPart
} from "./parts";
import { groupPlaceMapParts, PlaceMapBundle } from "./PlaceMap";
import {
  ChartPart,
  ChecklistPart,
  CompareTablePart,
  DashboardPart,
  DraftPreviewPart,
  FormFieldsPart,
  FormsPart,
  MapSnipPart,
  PlaceListPart
} from "./surfaces";
import { checklistStateKey } from "./checklistState";

/**
 * Generative UI カタログ。
 *
 * - **UiPart**（`ThreadLine.ui`）: ツール結果の決定的マッパ。メッセージに永続。
 * - **HITL**（`HITL_CATALOG`）: デスク状態。別系統だが同族ジョブ「確認して実行する」。
 */
export { HITL_CATALOG };
export type { HitlKind } from "./hitl";

export const UI_PART_KINDS = [
  "picks",
  "sources",
  "job_progress",
  "fact_rows",
  "ledger_figures",
  "kanban_snip",
  "chart",
  "compare_table",
  "dashboard",
  "form_fields",
  "forms",
  "place_list",
  "map_snip",
  "checklist",
  "draft_preview"
] as const;

export type UiRenderOptions = {
  onPick?: (item: PickItem) => void;
  onPlace?: (item: PlaceItem) => void;
  onFormCommit?: (values: Record<string, FormValue>, speakSummary?: string) => void;
  onComparePick?: (rowId: string) => void;
  /** checklist の UI State キー用。 */
  threadLineKey?: string;
  /** checklist item.cardId → カンバン件名。無い id は表示しない。 */
  cardTitles?: Record<string, string>;
  pickDisabled?: boolean;
};

export function renderUiPart(
  part: UiPart,
  options: UiRenderOptions = {},
  partIndex = 0
): ReactNode {
  const lineKey = options.threadLineKey ?? "anon";
  switch (part.kind) {
    case "picks":
      return (
        <PicksPart part={part} onPick={options.onPick} disabled={options.pickDisabled} />
      );
    case "sources":
      return <SourcesPart part={part} />;
    case "job_progress":
      return <JobProgressPart part={part} />;
    case "fact_rows":
      return <FactRowsPart part={part} />;
    case "ledger_figures":
      return <LedgerFiguresPart part={part} />;
    case "kanban_snip":
      return <KanbanSnipPart part={part} />;
    case "chart":
      return <ChartPart part={part} />;
    case "compare_table":
      return (
        <CompareTablePart
          part={part}
          disabled={options.pickDisabled}
          onPickRow={options.onComparePick}
        />
      );
    case "dashboard":
      return (
        <DashboardPart
          part={part}
          disabled={options.pickDisabled}
          onComparePick={options.onComparePick}
        />
      );
    case "form_fields":
      return options.onFormCommit ? (
        <FormFieldsPart
          part={part}
          disabled={options.pickDisabled}
          onCommit={options.onFormCommit}
        />
      ) : null;
    case "forms":
      return options.onFormCommit ? (
        <FormsPart part={part} disabled={options.pickDisabled} onCommit={options.onFormCommit} />
      ) : null;
    case "place_list":
      return (
        <PlaceListPart part={part} onPick={options.onPlace} disabled={options.pickDisabled} />
      );
    case "map_snip":
      return <MapSnipPart part={part} />;
    case "checklist":
      return (
        <ChecklistPart
          part={part}
          storageKey={checklistStateKey(lineKey, partIndex)}
          disabled={options.pickDisabled}
          cardTitles={options.cardTitles}
        />
      );
    case "draft_preview":
      return <DraftPreviewPart part={part} disabled={options.pickDisabled} />;
    default: {
      const _exhaustive: never = part;
      void _exhaustive;
      return null;
    }
  }
}

export function renderUiParts(
  parts: UiPart[] | undefined,
  options: UiRenderOptions = {}
): ReactNode {
  if (!parts?.length) return null;
  // ハーネス専用（予算メータ等）はチャットに出さない。@see uiAudience / 2026-11-02-user-vs-harness-surfaces
  const visible = parts.filter((part) => isUserFacingUiPart(part));
  if (!visible.length) return null;
  const grouped = groupPlaceMapParts(visible);
  return (
    <div className="flex flex-col gap-3">
      {grouped.map((part, index) => {
        if (part.kind === "place_map") {
          return (
            <div key={`place_map-${index}`}>
              <PlaceMapBundle
                list={part.list}
                map={part.map}
                onPick={options.onPlace}
                disabled={options.pickDisabled}
              />
            </div>
          );
        }
        const node = renderUiPart(part, options, index);
        if (node == null) return null;
        return (
          <div key={`${part.kind}-${index}`}>{node}</div>
        );
      })}
    </div>
  );
}

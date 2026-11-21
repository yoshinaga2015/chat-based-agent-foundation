import { Button, Chart, LayerCard, Text } from "@cloudflare/kumo";
import {
  CaretDownIcon,
  CaretUpIcon,
  CheckIcon,
  CopyIcon,
  DotsSixVerticalIcon,
  EyeSlashIcon,
  SquareHalfIcon,
  SquareIcon
} from "@phosphor-icons/react";
import {
  BarChart,
  BoxplotChart,
  CandlestickChart,
  CustomChart,
  FunnelChart,
  GaugeChart,
  GraphChart,
  HeatmapChart,
  LineChart,
  PieChart,
  RadarChart,
  SankeyChart,
  ScatterChart,
  SunburstChart,
  TreemapChart
} from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  RadarComponent,
  TooltipComponent,
  VisualMapComponent
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type ReactNode
} from "react";
import {
  getResolvedColorMode,
  subscribeResolvedColorMode
} from "../color-mode";
import type { DashboardMetric, DashboardWidget, FormValue, UiPart } from "../types";
import { buildChartOption, chartDataTable, chartHeight } from "./chartOptions";
import {
  FormFieldControl,
  FormFieldsShell,
  formFieldSpan,
  formatFormValue,
  initialFormValues
} from "./formControls";
import {
  checklistStateKey,
  mergeChecklistStates,
  readChecklistState,
  writeChecklistState,
  type ChecklistItemState
} from "./checklistState";
import {
  dashboardLayoutKey,
  dropPlaceFromPointer,
  moveWidgetOrder,
  readDashboardLayout,
  reconcileDashboardLayout,
  shiftWidgetOrder,
  writeDashboardLayout,
  type DashboardLayoutPrefs,
  type WidgetDropPlace
} from "./dashboardLayout";
export { MapSnipPart, PlaceListPart, PlaceMapBundle } from "./PlaceMap";

const DASHBOARD_METRICS_MAX = 4;
const DASHBOARD_WIDGETS_MAX = 6;

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  ScatterChart,
  RadarChart,
  FunnelChart,
  GaugeChart,
  HeatmapChart,
  TreemapChart,
  SunburstChart,
  BoxplotChart,
  CandlestickChart,
  SankeyChart,
  GraphChart,
  CustomChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  RadarComponent,
  VisualMapComponent,
  AriaComponent,
  CanvasRenderer
]);

function subscribeReducedMotion(onStoreChange: () => void): () => void {
  const mq = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (!mq) return () => {};
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);
}

function useIsDarkMode(): boolean {
  return useSyncExternalStore(
    subscribeResolvedColorMode,
    () => getResolvedColorMode() === "dark",
    () => false
  );
}

function ChartDataTable(props: { part: Extract<UiPart, { kind: "chart" }>; labelledBy?: string }): ReactNode {
  const table = chartDataTable(props.part);
  if (!table.rows.length) return null;
  return (
    <table className="sr-only" aria-labelledby={props.labelledBy}>
      <caption>{table.caption}のデータ</caption>
      <thead>
        <tr>
          {table.columns.map((col) => (
            <th key={col} scope="col">
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) =>
              j === 0 ? (
                <th key={j} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={j}>{cell}</td>
              )
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ChartPart(props: {
  part: Extract<UiPart, { kind: "chart" }>;
  /** dashboard セルで widget.title を出すとき二重見出しを避ける */
  hideTitle?: boolean;
  surface?: "default" | "dashboard";
  span?: 1 | 2;
}): ReactNode {
  const { part, hideTitle, surface = "default", span = 1 } = props;
  const reduceMotion = usePrefersReducedMotion();
  const isDarkMode = useIsDarkMode();
  const titleId = useId();
  const options = buildChartOption(part, surface, { reduceMotion, isDarkMode });
  const visibleTitle = !hideTitle && part.title ? part.title : null;
  return (
    <figure className="flex flex-col gap-1 p-0.5" aria-labelledby={visibleTitle ? titleId : undefined}>
      {visibleTitle ? (
        <Text size="sm" as="figcaption" id={titleId}>
          {visibleTitle}
        </Text>
      ) : null}
      <Chart
        echarts={echarts}
        height={chartHeight(part.chartType, span)}
        options={options}
        isDarkMode={isDarkMode}
      />
      <ChartDataTable part={part} labelledBy={visibleTitle ? titleId : undefined} />
    </figure>
  );
}

function MetricStrip(props: { items: DashboardMetric[]; startIndex?: number }): ReactNode {
  const items = props.items.slice(0, DASHBOARD_METRICS_MAX);
  if (!items.length) return null;
  const start = props.startIndex ?? 0;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      {items.map((m, i) => {
        const toneClass =
          m.tone === "positive"
            ? "text-kumo-success"
            : m.tone === "negative"
              ? "text-kumo-warning"
              : "text-kumo-default";
        return (
          <div
            key={m.id}
            className="fudo-dash-enter flex min-w-0 flex-col gap-1"
            style={{ ["--fudo-dash-i" as string]: start + i }}
          >
            <Text size="sm" variant="secondary" as="p">
              {m.label}
            </Text>
            <div className={`truncate text-xl font-medium tracking-tight ${toneClass}`}>
              {m.value}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const DASH_WIDGET_DRAG = "application/x-fudo-dash-widget";

export function DashboardPart(props: {
  part: Extract<UiPart, { kind: "dashboard" }>;
  onComparePick?: (rowId: string) => void;
  disabled?: boolean;
}): ReactNode {
  const { part } = props;
  const metrics = (part.metrics ?? []).slice(0, DASHBOARD_METRICS_MAX);
  const sourceWidgets = part.widgets.slice(0, DASHBOARD_WIDGETS_MAX);
  const idsKey = sourceWidgets.map((w) => w.id).join("\0");
  const storageKey = useMemo(
    () => dashboardLayoutKey(part.title, idsKey ? idsKey.split("\0") : []),
    [part.title, idsKey]
  );
  const [prefs, setPrefs] = useState<DashboardLayoutPrefs | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropPlace, setDropPlace] = useState<WidgetDropPlace | null>(null);
  const [dragPreview, setDragPreview] = useState<DashboardLayoutPrefs | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const previewKeyRef = useRef("");
  const slotRectsRef = useRef<Map<string, DOMRect>>(new Map());

  useEffect(() => {
    const widgets = part.widgets.slice(0, DASHBOARD_WIDGETS_MAX);
    const saved = readDashboardLayout(storageKey);
    setPrefs(reconcileDashboardLayout(widgets, saved).prefs);
    // ids 集合が変わったときだけストレージから載せ直す（本体データの差し替えでは消さない）
  }, [storageKey]);

  const activePrefs =
    prefs ?? reconcileDashboardLayout(sourceWidgets, readDashboardLayout(storageKey)).prefs;
  const layoutPrefs = dragPreview ?? activePrefs;
  const { visible } = reconcileDashboardLayout(sourceWidgets, layoutPrefs);
  const slotOrderKey = visible.map((w) => `${w.id}:${w.span}`).join("\0");
  const widgetStart = metrics.length + 1;
  const editable = !props.disabled;

  useLayoutEffect(() => {
    const root = gridRef.current;
    if (!root) return;
    const slots = [...root.querySelectorAll<HTMLElement>("[data-dash-widget]")];
    const nextRects = new Map<string, DOMRect>();
    for (const el of slots) {
      const id = el.dataset.dashWidget;
      if (id) nextRects.set(id, el.getBoundingClientRect());
    }
    const reduceMotion =
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    const hadPrev = slotRectsRef.current.size > 0;
    if (hadPrev && !reduceMotion) {
      for (const el of slots) {
        const id = el.dataset.dashWidget;
        if (!id) continue;
        const prev = slotRectsRef.current.get(id);
        const next = nextRects.get(id);
        if (!prev || !next) continue;
        const dx = prev.left - next.left;
        const dy = prev.top - next.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
        el.style.transition = "none";
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        void el.offsetWidth;
        el.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
        el.style.transform = "";
        const onEnd = (event: TransitionEvent) => {
          if (event.propertyName !== "transform") return;
          el.style.transition = "";
          el.removeEventListener("transitionend", onEnd);
        };
        el.addEventListener("transitionend", onEnd);
      }
    }
    slotRectsRef.current = nextRects;
  }, [slotOrderKey]);

  function commit(next: DashboardLayoutPrefs) {
    const reconciled = reconcileDashboardLayout(sourceWidgets, next).prefs;
    setPrefs(reconciled);
    writeDashboardLayout(storageKey, reconciled);
  }

  function clearDragUi() {
    const root = gridRef.current;
    if (root) {
      for (const el of root.querySelectorAll<HTMLElement>("[data-dash-widget]")) {
        el.style.transition = "";
        el.style.transform = "";
      }
    }
    setDraggingId(null);
    setDropTargetId(null);
    setDropPlace(null);
    setDragPreview(null);
    previewKeyRef.current = "";
  }

  function applyDragHover(fromId: string, targetId: string, place: WidgetDropPlace) {
    const key = `${fromId}>${targetId}:${place}`;
    if (previewKeyRef.current === key) return;
    previewKeyRef.current = key;
    setDropTargetId(targetId);
    setDropPlace(place);
    setDragPreview({
      ...activePrefs,
      order: moveWidgetOrder(activePrefs.order, fromId, targetId, place)
    });
  }

  function hitTestSlot(
    clientX: number,
    clientY: number
  ): { id: string; rect: DOMRect } | null {
    const root = gridRef.current;
    if (!root) return null;
    const slots = root.querySelectorAll<HTMLElement>("[data-dash-widget]");
    for (const el of slots) {
      const id = el.dataset.dashWidget;
      if (!id) continue;
      const rect = el.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return { id, rect };
      }
    }
    return null;
  }

  function onGridDragOver(event: DragEvent<HTMLDivElement>) {
    if (!editable || !draggingId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const hit = hitTestSlot(event.clientX, event.clientY);
    if (!hit || hit.id === draggingId) {
      setDropTargetId(null);
      setDropPlace(null);
      return;
    }
    const place = dropPlaceFromPointer(event.clientX, event.clientY, hit.rect);
    applyDragHover(draggingId, hit.id, place);
  }

  function onGridDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const fromId = event.dataTransfer.getData(DASH_WIDGET_DRAG) || draggingId;
    const preview = dragPreview;
    clearDragUi();
    if (!fromId || !editable) return;
    if (preview) {
      commit(preview);
      return;
    }
    const hit = hitTestSlot(event.clientX, event.clientY);
    if (!hit || hit.id === fromId) return;
    const place = dropPlaceFromPointer(event.clientX, event.clientY, hit.rect);
    commit({
      ...activePrefs,
      order: moveWidgetOrder(activePrefs.order, fromId, hit.id, place)
    });
  }

  return (
    <LayerCard className="flex flex-col gap-4 rounded-lg p-3 sm:p-4">
      <div
        className="fudo-dash-enter flex items-center justify-between gap-2 p-0.5"
        style={{ ["--fudo-dash-i" as string]: 0 }}
      >
        <div className="min-w-0 flex-1 font-medium">
          <Text size="base" as="p">
            {part.title}
          </Text>
        </div>
        {editable && activePrefs.hidden.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            type="button"
            aria-label={`隠したウィジェット${activePrefs.hidden.length}件を戻す`}
            onClick={() => commit({ ...activePrefs, hidden: [] })}
          >
            戻す {activePrefs.hidden.length}
          </Button>
        ) : null}
      </div>
      {metrics.length ? (
        <div className="border-b border-kumo-line/50 px-0.5 pb-3">
          <MetricStrip items={metrics} startIndex={1} />
        </div>
      ) : null}
      <div
        ref={gridRef}
        className={`grid grid-cols-1 gap-x-4 gap-y-5 p-0.5 sm:grid-cols-2 ${
          draggingId ? "fudo-dash-dragging" : ""
        }`}
        onDragOver={editable ? onGridDragOver : undefined}
        onDrop={editable ? onGridDrop : undefined}
        onDragLeave={
          editable
            ? (event) => {
                const next = event.relatedTarget;
                if (next instanceof Node && event.currentTarget.contains(next)) return;
                setDropTargetId(null);
                setDropPlace(null);
              }
            : undefined
        }
      >
        {visible.map((widget, wi) => {
          const spanClass = widget.span === 2 ? "sm:col-span-2" : "";
          const label = widget.title?.trim() || widget.id;
          const isSource = draggingId === widget.id;
          const isDropTarget = dropTargetId === widget.id && draggingId !== widget.id;
          return (
            <div
              key={widget.id}
              data-dash-widget={widget.id}
              className={`fudo-dash-enter fudo-dash-slot min-w-0 rounded-lg p-0.5 ${spanClass} ${
                isSource ? "fudo-dash-slot-source" : ""
              } ${isDropTarget ? "fudo-dash-slot-target" : ""} ${
                isDropTarget && dropPlace === "before" ? "fudo-dash-slot-insert-before" : ""
              } ${isDropTarget && dropPlace === "after" ? "fudo-dash-slot-insert-after" : ""}`}
              style={{ ["--fudo-dash-i" as string]: widgetStart + wi }}
            >
              <div className="mb-1 flex items-center gap-0.5 px-0.5">
                {editable ? (
                  <span
                    className={`fudo-dash-handle shrink-0 touch-none ${
                      isSource ? "fudo-dash-handle-active" : ""
                    }`}
                    draggable
                    aria-grabbed={isSource}
                    aria-label={`${label}を並べ替え`}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(DASH_WIDGET_DRAG, widget.id);
                      event.dataTransfer.setData("text/plain", widget.id);
                      event.dataTransfer.effectAllowed = "move";
                      const slot = event.currentTarget.closest("[data-dash-widget]");
                      if (slot instanceof HTMLElement) {
                        const rect = slot.getBoundingClientRect();
                        event.dataTransfer.setDragImage(
                          slot,
                          Math.min(28, rect.width * 0.08),
                          Math.min(20, rect.height * 0.08)
                        );
                      }
                      setDraggingId(widget.id);
                      setDropTargetId(null);
                      setDropPlace(null);
                      setDragPreview(null);
                      previewKeyRef.current = "";
                    }}
                    onDragEnd={clearDragUi}
                  >
                    <DotsSixVerticalIcon size={16} aria-hidden />
                  </span>
                ) : null}
                {widget.title ? (
                  <div className="min-w-0 flex-1 truncate">
                    <Text size="sm" variant="secondary" as="p">
                      {widget.title}
                    </Text>
                  </div>
                ) : (
                  <span className="min-w-0 flex-1" />
                )}
                {editable ? (
                  <span className="flex shrink-0 items-center" data-no-drag>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      aria-label={`${label}を上へ`}
                      disabled={activePrefs.order.indexOf(widget.id) <= 0}
                      onClick={() =>
                        commit({
                          ...activePrefs,
                          order: shiftWidgetOrder(activePrefs.order, widget.id, -1)
                        })
                      }
                    >
                      <CaretUpIcon size={14} aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      aria-label={`${label}を下へ`}
                      disabled={activePrefs.order.indexOf(widget.id) >= activePrefs.order.length - 1}
                      onClick={() =>
                        commit({
                          ...activePrefs,
                          order: shiftWidgetOrder(activePrefs.order, widget.id, 1)
                        })
                      }
                    >
                      <CaretDownIcon size={14} aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      aria-label={widget.span === 2 ? `${label}を半幅に` : `${label}を全幅に`}
                      onClick={() =>
                        commit({
                          ...activePrefs,
                          span: {
                            ...activePrefs.span,
                            [widget.id]: widget.span === 2 ? 1 : 2
                          }
                        })
                      }
                    >
                      {widget.span === 2 ? (
                        <SquareHalfIcon size={14} aria-hidden />
                      ) : (
                        <SquareIcon size={14} aria-hidden />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      aria-label={`${label}を隠す`}
                      onClick={() =>
                        commit({
                          ...activePrefs,
                          hidden: activePrefs.hidden.includes(widget.id)
                            ? activePrefs.hidden
                            : [...activePrefs.hidden, widget.id]
                        })
                      }
                    >
                      <EyeSlashIcon size={14} aria-hidden />
                    </Button>
                  </span>
                ) : null}
              </div>
              <DashboardWidgetBody
                widget={widget}
                disabled={props.disabled}
                onComparePick={props.onComparePick}
                animIndex={widgetStart + wi}
              />
            </div>
          );
        })}
      </div>
    </LayerCard>
  );
}

function DashboardWidgetBody(props: {
  widget: DashboardWidget;
  disabled?: boolean;
  onComparePick?: (rowId: string) => void;
  animIndex: number;
}): ReactNode {
  const { widget } = props;
  if (widget.body.kind === "chart") {
    return (
      <ChartPart
        part={widget.body}
        hideTitle={Boolean(widget.title)}
        surface="dashboard"
        span={widget.span}
      />
    );
  }
  if (widget.body.kind === "compare_table") {
    return (
      <CompareTablePart
        part={widget.body}
        disabled={props.disabled}
        onPickRow={props.onComparePick}
      />
    );
  }
  if (widget.body.kind === "metrics") {
    return <MetricStrip items={widget.body.items} startIndex={props.animIndex} />;
  }
  return null;
}

export function CompareTablePart(props: {
  part: Extract<UiPart, { kind: "compare_table" }>;
  onPickRow?: (rowId: string) => void;
  disabled?: boolean;
}): ReactNode {
  return (
    <div className="max-h-64 overflow-auto p-0.5">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {props.part.columns.map((col) => (
              <th key={col.id} className="border-b border-kumo-line px-2 py-1.5 font-medium">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.part.rows.map((row) => (
            <tr key={row.id} className="border-b border-kumo-line/60">
              {props.part.columns.map((col, colIndex) => {
                const cell = row.cells[col.id];
                const text = cell === null || cell === undefined ? "—" : String(cell);
                if (colIndex === 0 && props.onPickRow && !props.disabled) {
                  return (
                    <td key={col.id} className="px-2 py-1.5">
                      <button
                        type="button"
                        className="text-left text-kumo-interact hover:underline"
                        aria-label={`${text}を採用`}
                        onClick={() => props.onPickRow?.(row.id)}
                      >
                        {text}
                      </button>
                    </td>
                  );
                }
                return (
                  <td key={col.id} className="px-2 py-1.5 text-kumo-default">
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FormFieldsPart(props: {
  part: Extract<UiPart, { kind: "form_fields" }>;
  disabled?: boolean;
  onCommit: (values: Record<string, FormValue>, speakSummary?: string) => void;
}): ReactNode {
  return (
    <FormFieldsShell
      title={props.part.title}
      fields={props.part.fields}
      commit={props.part.commit}
      submitLabel={props.part.submitLabel}
      disabled={props.disabled}
      onCommit={props.onCommit}
    />
  );
}

export function FormsPart(props: {
  part: Extract<UiPart, { kind: "forms" }>;
  disabled?: boolean;
  onCommit: (values: Record<string, FormValue>, speakSummary?: string) => void;
}): ReactNode {
  const allFields = useMemo(
    () => props.part.sections.flatMap((section) => section.fields),
    [props.part.sections]
  );
  const [values, setValues] = useState(() => initialFormValues(allFields));
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <Text size="sm" variant="secondary" as="p" role="status">
        反映済み
      </Text>
    );
  }

  return (
    <div className="p-0.5">
      <LayerCard className="flex min-w-0 flex-col gap-5 rounded-lg p-4 sm:p-5">
        <Text variant="heading" as="h2">
          {props.part.title}
        </Text>
        {props.part.sections.map((section) => (
          <div key={section.id} className="flex flex-col gap-3">
            {section.title ? (
              <Text size="sm" variant="secondary" as="h3">
                {section.title}
              </Text>
            ) : null}
            <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
              {section.fields.map((field) => (
                <div
                  key={field.id}
                  className={`min-w-0 ${formFieldSpan(field) === 2 ? "sm:col-span-2" : ""}`}
                >
                  <FormFieldControl
                    field={field}
                    value={values[field.id]}
                    disabled={props.disabled}
                    onChange={(next) => setValues((prev) => ({ ...prev, [field.id]: next }))}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
        <Button
          size="base"
          variant="primary"
          type="button"
          disabled={props.disabled}
          onClick={() => {
            setDone(true);
            const summary =
              props.part.commit === "speak_summary"
                ? allFields.map((f) => `${f.label}=${formatFormValue(f, values[f.id])}`).join("、")
                : undefined;
            props.onCommit(values, summary);
          }}
        >
          {props.part.submitLabel ?? "反映"}
        </Button>
      </LayerCard>
    </div>
  );
}

export function ChecklistPart(props: {
  part: Extract<UiPart, { kind: "checklist" }>;
  storageKey: string;
  disabled?: boolean;
  cardTitles?: Record<string, string>;
}): ReactNode {
  const initial = useMemo(
    () => mergeChecklistStates(props.part.items, readChecklistState(props.storageKey)),
    [props.part.items, props.storageKey]
  );
  const [states, setStates] = useState(initial);

  useEffect(() => {
    setStates(mergeChecklistStates(props.part.items, readChecklistState(props.storageKey)));
  }, [props.part.items, props.storageKey]);

  return (
    <div className="overflow-y-auto p-0.5">
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {props.part.items.map((item) => {
          const state = states[item.id] ?? item.state;
          const done = state === "done";
          const blocked = state === "blocked";
          const cardTitle =
            item.cardId && props.cardTitles?.[item.cardId]
              ? props.cardTitles[item.cardId]
              : undefined;
          return (
            <li key={item.id}>
              <button
                type="button"
                disabled={props.disabled || blocked}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ring ring-kumo-line ${
                  done ? "text-kumo-secondary line-through" : "text-kumo-default"
                }`}
                aria-pressed={done}
                aria-label={cardTitle ? `${item.label}（${cardTitle}）` : item.label}
                onClick={() => {
                  const nextState: ChecklistItemState = done ? "pending" : "done";
                  const next = { ...states, [item.id]: nextState };
                  setStates(next);
                  writeChecklistState(props.storageKey, { schemaVersion: 1, states: next });
                }}
              >
                <span
                  className={`inline-block size-3 shrink-0 rounded-sm ring ring-kumo-line ${
                    done ? "bg-kumo-interact" : "bg-transparent"
                  }`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  {cardTitle ? (
                    <span className="block truncate text-xs text-kumo-secondary">{cardTitle}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

async function copyDraftBody(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

/** 文案アーティファクト。殻は LayerCard、コピーは icon-only ghost（picks と同型）。 */
export function DraftPreviewPart(props: {
  part: Extract<UiPart, { kind: "draft_preview" }>;
  disabled?: boolean;
}): ReactNode {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [props.part.body]);

  return (
    <div className="overflow-y-auto p-0.5">
      <LayerCard>
        <LayerCard.Secondary className="flex items-center justify-between gap-2">
          {props.part.title ? (
            <Text size="sm" variant="secondary" as="span" className="min-w-0 truncate">
              {props.part.title}
            </Text>
          ) : (
            <span />
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            shape="square"
            icon={copied ? CheckIcon : CopyIcon}
            aria-label={copied ? "コピーした" : "本文をコピー"}
            disabled={props.disabled}
            onClick={() => {
              void copyDraftBody(props.part.body).then((ok) => {
                if (!ok) return;
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              });
            }}
          />
        </LayerCard.Secondary>
        <LayerCard.Primary>
          <pre className="m-0 whitespace-pre-wrap font-sans text-sm text-kumo-default">
            {props.part.body}
          </pre>
        </LayerCard.Primary>
      </LayerCard>
    </div>
  );
}

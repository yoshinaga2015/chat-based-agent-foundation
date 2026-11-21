import { LayerCard, Link, Text } from "@cloudflare/kumo";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import type { MediaImage, PickItem, PlaceItem, UiPart } from "../types";
import { ImageGalleryDialog } from "./ImageGallery";


const MEDIA_INLINE_MAX = 3;

function formatYen(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

export function pickSelectionText(item: PickItem): string {
  return item.url
    ? `「${item.title}」を採用します。${item.url}`
    : `「${item.title}」を採用します。`;
}

export function placeSelectionText(item: PlaceItem): string {
  const km =
    item.distanceM >= 1000 ? `${(item.distanceM / 1000).toFixed(1)}km` : `${item.distanceM}m`;
  const coords =
    typeof item.lat === "number" && typeof item.lng === "number"
      ? ` lat=${item.lat} lng=${item.lng}`
      : "";
  const base = `「${item.title}」（${km}）を採用します。${coords}`.trim();
  return item.url ? `${base} ${item.url}` : base;
}

function formatProducedAt(ms: number | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function faviconUrl(pageUrl: string | undefined): string | null {
  const host = hostOf(pageUrl);
  if (!host) return null;
  return `https://icons.duckduckgo.com/ip3/${host}.ico`;
}

/** images[] 優先。無ければ imageUrl。favicon はサイト識別の仮。 */
export function resolvePickImages(item: PickItem): MediaImage[] {
  const seen = new Set<string>();
  const out: MediaImage[] = [];
  const push = (url: string | undefined, alt?: string) => {
    if (!url?.startsWith("https://") || seen.has(url)) return;
    seen.add(url);
    out.push(alt ? { url, alt } : { url });
  };
  for (const img of item.images ?? []) push(img.url, img.alt);
  push(item.imageUrl);
  return out;
}

function MediaTile(props: {
  src: string;
  alt?: string;
  className: string;
  fallback?: string | null;
}): ReactNode {
  const [src, setSrc] = useState(props.src);
  const [dead, setDead] = useState(false);
  if (dead) {
    return <span className={`${props.className} bg-kumo-tint`} aria-hidden />;
  }
  return (
    <img
      src={src}
      alt={props.alt ?? ""}
      className={`${props.className} object-cover`}
      onError={() => {
        if (props.fallback && src !== props.fallback) setSrc(props.fallback);
        else setDead(true);
      }}
    />
  );
}

/** 1枚または favicon。行先頭の識別用。 */
function PickThumb(props: {
  item: PickItem;
  onOpenGallery?: (index: number) => void;
}): ReactNode {
  const all = resolvePickImages(props.item);
  const fallback = faviconUrl(props.item.url);
  const hero = all[0];
  const canOpen = Boolean(props.onOpenGallery) && Boolean(hero);

  if (!hero) {
    if (!fallback) {
      return <span className="size-14 shrink-0 rounded-md bg-kumo-tint ring ring-kumo-line" aria-hidden />;
    }
    return (
      <MediaTile
        src={fallback}
        className="size-14 shrink-0 rounded-md ring ring-kumo-line"
      />
    );
  }

  const tile = (
    <MediaTile
      src={hero.url}
      alt={hero.alt}
      fallback={fallback}
      className="size-14 shrink-0 rounded-md ring ring-kumo-line"
    />
  );
  if (!canOpen) return tile;
  return (
    <button
      type="button"
      className="shrink-0 rounded-md focus-visible:ring focus-visible:ring-kumo-interact"
      aria-label="画像を拡大"
      onClick={() => props.onOpenGallery?.(0)}
    >
      {tile}
    </button>
  );
}

/** 複数枚は候補テキストの下に横並び。タップでギャラリー。 */
function PickStrip(props: {
  item: PickItem;
  onOpenGallery: (index: number) => void;
}): ReactNode {
  const all = resolvePickImages(props.item);
  if (all.length < 2) return null;
  const visible = all.slice(0, MEDIA_INLINE_MAX);
  const extra = all.length - visible.length;

  return (
    <ul className="flex gap-1.5 overflow-x-auto p-0.5" aria-label={`画像${all.length}枚`}>
      {visible.map((img, index) => (
        <li key={img.url}>
          <button
            type="button"
            className="block overflow-hidden rounded-md ring ring-kumo-line focus-visible:ring focus-visible:ring-kumo-interact"
            aria-label={img.alt?.trim() || `画像 ${index + 1}を拡大`}
            onClick={() => props.onOpenGallery(index)}
          >
            <MediaTile
              src={img.url}
              alt={img.alt}
              className="h-16 w-24"
            />
          </button>
        </li>
      ))}
      {extra > 0 ? (
        <li>
          <button
            type="button"
            className="flex h-16 w-16 items-center justify-center rounded-md bg-kumo-tint text-sm text-kumo-subtle ring ring-kumo-line focus-visible:ring focus-visible:ring-kumo-interact"
            aria-label={`ほか${extra}枚を見る`}
            onClick={() => props.onOpenGallery(MEDIA_INLINE_MAX)}
          >
            +{extra}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

function PickCopy(props: { item: PickItem }): ReactNode {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
      {props.item.badge ? (
        <Text size="sm" variant="secondary" as="span" className="truncate">
          {props.item.badge}
        </Text>
      ) : null}
      <Text size="sm" as="span" className="line-clamp-2">
        {props.item.title}
      </Text>
      {props.item.meta ? (
        <Text size="sm" as="span" className="truncate">
          {props.item.meta}
        </Text>
      ) : null}
      {props.item.detail ? (
        <Text size="sm" variant="secondary" as="span" className="line-clamp-1">
          {props.item.detail}
        </Text>
      ) : null}
    </span>
  );
}

function PickRow(props: {
  item: PickItem;
  interactive: boolean;
  selected: boolean;
  onPick?: (item: PickItem) => void;
  onChosen: (id: string) => void;
  openGallery?: (index: number) => void;
}): ReactNode {
  const images = resolvePickImages(props.item);
  const multi = images.length >= 2;
  const host = hostOf(props.item.url);

  const body = (
    <div className="flex min-w-0 flex-1 items-start gap-2.5">
      {!multi ? <PickThumb item={props.item} onOpenGallery={props.openGallery} /> : null}
      {props.interactive ? (
        <button
          type="button"
          className="min-w-0 flex-1 text-left hover:opacity-90 focus-visible:ring focus-visible:ring-kumo-interact"
          aria-label={`${props.item.title}を採用`}
          onClick={() => {
            props.onChosen(props.item.id);
            props.onPick?.(props.item);
          }}
        >
          <PickCopy item={props.item} />
        </button>
      ) : props.item.url ? (
        <Link
          href={props.item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1"
        >
          <PickCopy item={props.item} />
        </Link>
      ) : (
        <PickCopy item={props.item} />
      )}
    </div>
  );

  return (
    <LayerCard className={props.selected ? "ring-kumo-interact" : undefined}>
      {(host || (props.item.url && props.interactive)) ? (
        <LayerCard.Secondary className="flex items-center justify-between gap-2">
          {host ? (
            <Text size="sm" variant="secondary" as="span" className="min-w-0 truncate">
              {host}
            </Text>
          ) : (
            <span />
          )}
          {props.item.url && props.interactive ? (
            <Link
              href={props.item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-kumo-subtle no-underline hover:bg-kumo-tint hover:text-kumo-default"
              aria-label="外部ページを開く"
            >
              <ArrowSquareOutIcon size={16} aria-hidden />
            </Link>
          ) : null}
        </LayerCard.Secondary>
      ) : null}
      <LayerCard.Primary className="flex flex-col gap-2">
        {body}
        {multi && props.openGallery ? (
          <PickStrip item={props.item} onOpenGallery={props.openGallery} />
        ) : null}
      </LayerCard.Primary>
    </LayerCard>
  );
}

export function PicksPart(props: {
  part: Extract<UiPart, { kind: "picks" }>;
  onPick?: (item: PickItem) => void;
  disabled?: boolean;
}): ReactNode {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [gallery, setGallery] = useState<{ item: PickItem; index: number } | null>(null);
  const interactive = Boolean(props.onPick) && !props.disabled && chosenId === null;

  return (
    <>
      <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto p-0.5">
        {props.part.items.map((item) => {
          const selected = chosenId === item.id;
          const dimmed = chosenId !== null && !selected;
          const images = resolvePickImages(item);
          const openGallery =
            images.length > 0
              ? (index: number) => setGallery({ item, index })
              : undefined;

          return (
            <li key={item.id} className={dimmed ? "opacity-40" : undefined}>
              <PickRow
                item={item}
                interactive={interactive}
                selected={selected}
                onPick={props.onPick}
                onChosen={setChosenId}
                openGallery={openGallery}
              />
            </li>
          );
        })}
      </ul>
      {gallery ? (
        <ImageGalleryDialog
          open
          onOpenChange={(open) => {
            if (!open) setGallery(null);
          }}
          title={gallery.item.title}
          images={resolvePickImages(gallery.item)}
          initialIndex={gallery.index}
        />
      ) : null}
    </>
  );
}

export function SourcesPart(props: { part: Extract<UiPart, { kind: "sources" }> }): ReactNode {
  const fetched = formatProducedAt(props.part.producedAt);
  return (
    <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto p-0.5">
      {props.part.items.map((item) => {
        const host = hostOf(item.url);
        return (
          <li key={item.url}>
            <LayerCard>
              <LayerCard.Primary className="flex min-w-0 items-start gap-2">
                <img
                  src={`https://icons.duckduckgo.com/ip3/${host ?? "example.com"}.ico`}
                  alt=""
                  width={16}
                  height={16}
                  className="mt-0.5 size-4 shrink-0 rounded-sm"
                />
                <div className="min-w-0 flex-1">
                  <Link href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm break-all">
                    {item.title}
                  </Link>
                  {host || fetched ? (
                    <Text size="sm" variant="secondary" className="mt-0.5" as="p">
                      {[host, fetched].filter(Boolean).join(" · ")}
                    </Text>
                  ) : null}
                  {item.snippet ? (
                    <Text size="sm" variant="secondary" className="mt-0.5 line-clamp-2" as="p">
                      {item.snippet}
                    </Text>
                  ) : null}
                </div>
              </LayerCard.Primary>
            </LayerCard>
          </li>
        );
      })}
    </ul>
  );
}

export function JobProgressPart(props: { part: Extract<UiPart, { kind: "job_progress" }> }): ReactNode {
  // 通常は audience=internal で renderUiParts が除外。明示 user のときのみ回数を出す。
  return (
    <div className="overflow-y-auto p-0.5" role="group" aria-label="調査回数">
      <ul className="flex flex-wrap gap-3 text-sm tabular-nums text-kumo-default">
        {props.part.meters.map((meter) => (
          <li key={meter.id}>
            {meter.label} {meter.used}/{meter.max}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FactRowsPart(props: { part: Extract<UiPart, { kind: "fact_rows" }> }): ReactNode {
  const host = hostOf(props.part.sourceUrl);
  const fetched = formatProducedAt(props.part.producedAt);
  const meta = [host, fetched].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-1">
      {meta ? (
        <Text size="sm" variant="secondary" as="p">
          {meta}
        </Text>
      ) : null}
      <div className="max-h-64 overflow-auto p-0.5">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              <th className="border-b border-kumo-line px-2 py-1.5 font-medium">項目</th>
              <th className="border-b border-kumo-line px-2 py-1.5 font-medium">値</th>
              <th className="border-b border-kumo-line px-2 py-1.5 font-medium">日付</th>
            </tr>
          </thead>
          <tbody>
            {props.part.rows.map((row) => (
              <tr key={row.id} className="border-b border-kumo-line/60">
                <td className="px-2 py-1.5 text-kumo-default">{row.label}</td>
                <td className="px-2 py-1.5 text-kumo-default tabular-nums">{row.value}</td>
                <td className="px-2 py-1.5 text-kumo-default tabular-nums">{row.asOf ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function LedgerFiguresPart(
  props: { part: Extract<UiPart, { kind: "ledger_figures" }> }
): ReactNode {
  return (
    <ul className="flex flex-col gap-2 overflow-y-auto p-0.5">
      {props.part.items.map((item) => (
        <li key={item.id}>
          <LayerCard>
            <LayerCard.Primary className="flex items-baseline justify-between gap-3">
              <Text size="sm" variant="secondary" as="span" className="min-w-0 truncate">
                {item.title}
              </Text>
              <Text size="base" as="span" className="shrink-0 font-medium tabular-nums">
                {formatYen(item.value)}
              </Text>
            </LayerCard.Primary>
          </LayerCard>
        </li>
      ))}
    </ul>
  );
}

const KANBAN_STATE_TONE: Record<string, string> = {
  未着手: "bg-kumo-tint text-kumo-subtle",
  実行中: "bg-kumo-info-tint text-kumo-info",
  確認待ち: "bg-kumo-warning-tint text-kumo-warning",
  完了: "bg-kumo-success-tint text-kumo-success"
};

export function KanbanSnipPart(props: { part: Extract<UiPart, { kind: "kanban_snip" }> }): ReactNode {
  return (
    <ul className="flex flex-col gap-2 overflow-y-auto p-0.5">
      {props.part.cards.map((card) => {
        const tone = KANBAN_STATE_TONE[card.state] ?? "bg-kumo-tint text-kumo-subtle";
        return (
          <li key={card.id}>
            <LayerCard>
              <LayerCard.Primary className="flex items-center justify-between gap-3">
                <Text size="sm" as="span" className="min-w-0 truncate">
                  {card.title}
                </Text>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${tone}`}>{card.state}</span>
              </LayerCard.Primary>
            </LayerCard>
          </li>
        );
      })}
    </ul>
  );
}

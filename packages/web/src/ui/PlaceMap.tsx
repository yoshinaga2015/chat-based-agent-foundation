import { Button, Dialog, LayerCard, Link, Text } from "@cloudflare/kumo";
import { ArrowsOutIcon, CrosshairIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { PlaceItem, UiPart } from "../types";

const MAP_PADDING: [number, number] = [48, 48];
const MAP_MAX_ZOOM = 16;
const MAP_SINGLE_ZOOM = 15;
const INLINE_MAP_CLASS = "h-[18.75rem] w-full min-h-[17.5rem]";
const EXPAND_MAP_CLASS = "h-[min(70dvh,36rem)] w-full min-h-[20rem]";

export type MapSnipData = Extract<UiPart, { kind: "map_snip" }>;
export type PlaceListData = Extract<UiPart, { kind: "place_list" }>;

export function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)}km`;
  return `${Math.round(m)}m`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}時間${rem}分` : `${h}時間`;
}

/** place_list と続く map_snip を1バンドルにまとめる。 */
export function groupPlaceMapParts(parts: readonly UiPart[]): Array<UiPart | { kind: "place_map"; list: PlaceListData; map: MapSnipData }> {
  const out: Array<UiPart | { kind: "place_map"; list: PlaceListData; map: MapSnipData }> = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    const next = parts[i + 1];
    if (part.kind === "place_list" && next?.kind === "map_snip") {
      out.push({ kind: "place_map", list: part, map: next });
      i += 1;
      continue;
    }
    out.push(part);
  }
  return out;
}

export function PlaceMapBundle(props: {
  list: PlaceListData;
  map: MapSnipData;
  onPick?: (item: PlaceItem) => void;
  disabled?: boolean;
}): ReactNode {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adoptedId, setAdoptedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const placesById = useMemo(() => {
    const map = new Map<string, PlaceItem>();
    for (const item of props.list.items) map.set(item.id, item);
    return map;
  }, [props.list.items]);

  // 経路表示は閲覧。候補から1件選ぶジョブではないので「採用」を出さない。
  const pickable = Boolean(props.onPick) && !props.map.route;

  const adopt = (item: PlaceItem) => {
    if (props.disabled || adoptedId || !pickable) return;
    setAdoptedId(item.id);
    setSelectedId(item.id);
    props.onPick?.(item);
  };

  return (
    <div className="flex flex-col gap-3">
      <PlaceListPart
        part={props.list}
        selectedId={selectedId}
        adoptedId={adoptedId}
        disabled={props.disabled}
        onSelect={setSelectedId}
        onPick={pickable ? adopt : undefined}
      />
      <MapSnipPart
        part={props.map}
        placesById={placesById}
        selectedId={selectedId}
        adoptedId={adoptedId}
        disabled={props.disabled}
        onSelect={setSelectedId}
        onPick={pickable ? adopt : undefined}
        onExpand={() => setExpanded(true)}
      />
      <MapExpandDialog
        open={expanded}
        onOpenChange={setExpanded}
        part={props.map}
        placesById={placesById}
        selectedId={selectedId}
        adoptedId={adoptedId}
        disabled={props.disabled}
        onSelect={setSelectedId}
        onPick={pickable ? adopt : undefined}
      />
    </div>
  );
}

export function PlaceListPart(props: {
  part: PlaceListData;
  selectedId?: string | null;
  adoptedId?: string | null;
  onSelect?: (id: string | null) => void;
  onPick?: (item: PlaceItem) => void;
  disabled?: boolean;
}): ReactNode {
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const [localAdopted, setLocalAdopted] = useState<string | null>(null);
  const selectedId = props.onSelect ? (props.selectedId ?? null) : localSelected;
  const setSelected = props.onSelect ?? setLocalSelected;
  const adoptedId = props.adoptedId ?? localAdopted;
  const pick = (item: PlaceItem) => {
    setLocalAdopted(item.id);
    setSelected(item.id);
    props.onPick?.(item);
  };

  return (
    <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto p-0.5">
      {props.part.items.map((item) => {
        const selected = selectedId === item.id;
        const adopted = adoptedId === item.id;
        const dimmed = adoptedId != null && !adopted;
        return (
          <li key={item.id} className={dimmed ? "opacity-40" : undefined}>
            <LayerCard className={selected ? "ring-kumo-interact" : undefined}>
              <LayerCard.Primary>
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    aria-pressed={selected}
                    aria-label={`${item.title}を表示`}
                    disabled={props.disabled}
                    onClick={() => setSelected(selected ? null : item.id)}
                  >
                    <Text size="sm" as="span">
                      {item.title}
                    </Text>
                    {item.kind ? (
                      <Text size="sm" variant="secondary" as="span">
                        {" "}
                        {item.kind}
                      </Text>
                    ) : null}
                  </button>
                  <Text size="sm" as="span">
                    {item.distanceM > 0 ? formatDistance(item.distanceM) : "—"}
                    {item.durationS && item.durationS > 0
                      ? ` · ${formatDuration(item.durationS)}`
                      : ""}
                  </Text>
                </div>
                {item.url ? (
                  <Link href={item.url} target="_blank" rel="noopener noreferrer">
                    {item.url}
                  </Link>
                ) : null}
                {props.onPick && !props.disabled && adoptedId == null ? (
                  <div className="pt-1">
                    <Button
                      size="sm"
                      variant={selected ? "primary" : "secondary"}
                      type="button"
                      aria-label={`${item.title}を採用`}
                      onClick={() => pick(item)}
                    >
                      採用
                    </Button>
                  </div>
                ) : null}
                {adopted ? (
                  <Text size="sm" variant="secondary" as="p" role="status">
                    採用済み
                  </Text>
                ) : null}
              </LayerCard.Primary>
            </LayerCard>
          </li>
        );
      })}
    </ul>
  );
}

export function MapSnipPart(props: {
  part: MapSnipData;
  placesById?: ReadonlyMap<string, PlaceItem>;
  selectedId?: string | null;
  adoptedId?: string | null;
  onSelect?: (id: string | null) => void;
  onPick?: (item: PlaceItem) => void;
  onExpand?: () => void;
  disabled?: boolean;
  heightClass?: string;
  showExpand?: boolean;
}): ReactNode {
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const [localExpanded, setLocalExpanded] = useState(false);
  const selectedId = props.onSelect ? (props.selectedId ?? null) : localSelected;
  const setSelected = props.onSelect ?? setLocalSelected;
  const placesById = props.placesById ?? EMPTY_PLACES;
  const selected = selectedId
    ? placesById.get(selectedId) ?? placeFromMarker(props.part, selectedId)
    : null;
  const expand = props.onExpand ?? (() => setLocalExpanded(true));
  const showExpand = props.showExpand !== false;

  const mapInstanceId = useId();
  const frame = (
    // isolate: Leaflet の pane（z 数百）がサイドバー／シートより前面に出ないように閉じ込める
    <div className="relative z-0 isolate overflow-hidden rounded-lg ring ring-kumo-line">
      <div className="absolute right-2 top-2 z-10 flex gap-1 p-0.5">
        <Button
          size="sm"
          variant="secondary"
          shape="square"
          type="button"
          aria-label="全体表示"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("fudo-map-fit", { detail: mapInstanceId }));
          }}
        >
          <CrosshairIcon size={16} aria-hidden />
        </Button>
        {showExpand ? (
          <Button
            size="sm"
            variant="secondary"
            shape="square"
            type="button"
            aria-label="地図を拡大"
            onClick={expand}
          >
            <ArrowsOutIcon size={16} aria-hidden />
          </Button>
        ) : null}
      </div>
      <LeafletMap
        instanceId={mapInstanceId}
        part={props.part}
        selectedId={selectedId}
        onSelect={setSelected}
        heightClass={props.heightClass ?? INLINE_MAP_CLASS}
      />
      {selected ? (
        <PlaceDetailOverlay
          item={selected}
          disabled={props.disabled}
          adopted={props.adoptedId === selected.id}
          onClose={() => setSelected(null)}
          onPick={placesById.has(selected.id) ? props.onPick : undefined}
        />
      ) : null}
    </div>
  );

  if (props.onExpand) return frame;
  return (
    <>
      {frame}
      <MapExpandDialog
        open={localExpanded}
        onOpenChange={setLocalExpanded}
        part={props.part}
        placesById={placesById}
        selectedId={selectedId}
        adoptedId={props.adoptedId ?? null}
        disabled={props.disabled}
        onSelect={setSelected}
        onPick={props.onPick}
      />
    </>
  );
}

const EMPTY_PLACES: ReadonlyMap<string, PlaceItem> = new Map();

function MapExpandDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  part: MapSnipData;
  placesById: ReadonlyMap<string, PlaceItem>;
  selectedId: string | null;
  adoptedId: string | null;
  disabled?: boolean;
  onSelect: (id: string | null) => void;
  onPick?: (item: PlaceItem) => void;
}): ReactNode {
  const labelId = useId();
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog size="xl" className="flex max-h-[90dvh] flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <Dialog.Title id={labelId} className="m-0 text-base font-medium text-kumo-default">
            地図
          </Dialog.Title>
          <Dialog.Close
            aria-label="閉じる"
            render={(closeProps) => (
              <Button
                {...closeProps}
                type="button"
                size="sm"
                variant="secondary"
                shape="square"
                aria-label="閉じる"
              >
                <XIcon size={16} aria-hidden />
              </Button>
            )}
          />
        </div>
        {props.open ? (
          <MapSnipPart
            part={props.part}
            placesById={props.placesById}
            selectedId={props.selectedId}
            adoptedId={props.adoptedId}
            disabled={props.disabled}
            onSelect={props.onSelect}
            onPick={props.onPick}
            showExpand={false}
            heightClass={EXPAND_MAP_CLASS}
          />
        ) : null}
      </Dialog>
    </Dialog.Root>
  );
}

function PlaceDetailOverlay(props: {
  item: PlaceItem;
  adopted?: boolean;
  disabled?: boolean;
  onClose: () => void;
  onPick?: (item: PlaceItem) => void;
}): ReactNode {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-2">
      <div
        className="pointer-events-auto max-w-sm rounded-lg bg-kumo-base p-3 shadow-xs ring ring-kumo-line"
        role="dialog"
        aria-label={props.item.title}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Text size="sm" as="p">
              {props.item.title}
            </Text>
            <Text size="sm" variant="secondary" as="p">
              {props.item.distanceM > 0 ? formatDistance(props.item.distanceM) : ""}
              {props.item.durationS && props.item.durationS > 0
                ? `${props.item.distanceM > 0 ? " · " : ""}${formatDuration(props.item.durationS)}`
                : ""}
              {props.item.kind
                ? `${props.item.distanceM > 0 || (props.item.durationS ?? 0) > 0 ? " · " : ""}${props.item.kind}`
                : ""}
            </Text>
          </div>
          <Button
            size="sm"
            variant="secondary"
            shape="square"
            type="button"
            aria-label="詳細を閉じる"
            onClick={props.onClose}
          >
            <XIcon size={14} aria-hidden />
          </Button>
        </div>
        {props.item.url ? (
          <Link href={props.item.url} target="_blank" rel="noopener noreferrer">
            {props.item.url}
          </Link>
        ) : null}
        {props.adopted ? (
          <Text size="sm" variant="secondary" as="p" role="status">
            採用済み
          </Text>
        ) : props.onPick && !props.disabled ? (
          <div className="pt-2">
            <Button
              size="sm"
              variant="primary"
              type="button"
              aria-label={`${props.item.title}を採用`}
              onClick={() => props.onPick?.(props.item)}
            >
              採用
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function placeFromMarker(part: MapSnipData, id: string): PlaceItem | null {
  const marker = part.markers.find((m) => m.id === id);
  if (!marker) return null;
  return {
    id: marker.id,
    title: marker.label ?? marker.id,
    distanceM: 0,
    lat: marker.lat,
    lng: marker.lng
  };
}

function LeafletMap(props: {
  instanceId: string;
  part: MapSnipData;
  selectedId: string | null;
  onSelect?: (id: string | null) => void;
  heightClass: string;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{
    remove: () => void;
    fitBounds: (b: unknown, o?: unknown) => void;
    invalidateSize: () => void;
    panTo: (ll: [number, number]) => void;
    setView: (ll: [number, number], z: number) => void;
  } | null>(null);
  const markersRef = useRef<Map<string, { openPopup: () => void }>>(new Map());
  const onSelectRef = useRef(props.onSelect);
  onSelectRef.current = props.onSelect;
  const partKey = useMemo(
    () =>
      JSON.stringify({
        c: props.part.center,
        z: props.part.zoom,
        m: props.part.markers.map((m) => [m.id, m.lat, m.lng, m.label]),
        r: props.part.route?.coordinates.map((p) => [p.lat, p.lng])
      }),
    [props.part]
  );

  const fitAll = () => {
    const map = mapRef.current;
    if (!map) return;
    const routePts = props.part.route?.coordinates ?? [];
    const pts = [
      ...props.part.markers.map((m) => ({ lat: m.lat, lng: m.lng })),
      ...routePts
    ];
    if (pts.length === 0) {
      map.setView([props.part.center.lat, props.part.center.lng], props.part.zoom ?? 13);
      return;
    }
    if (pts.length === 1) {
      map.setView([pts[0]!.lat, pts[0]!.lng], Math.min(props.part.zoom ?? MAP_SINGLE_ZOOM, MAP_MAX_ZOOM));
      return;
    }
    void import("leaflet").then((L) => {
      const bounds = L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(bounds, { padding: MAP_PADDING, maxZoom: MAP_MAX_ZOOM });
    });
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    void (async () => {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !ref.current) return;
      // bundler で欠けるデフォルトアイコンを補正
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
        iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png"
      });
      const map = L.map(ref.current, {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: true
      });
      mapRef.current = map as never;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap"
      }).addTo(map);
      const byId = new Map<string, { openPopup: () => void }>();
      for (const m of props.part.markers.slice(0, 8)) {
        const marker = L.marker([m.lat, m.lng], { title: m.label ?? m.id, keyboard: true });
        marker.addTo(map);
        marker.on("click", (event) => {
          L.DomEvent.stopPropagation(event);
          onSelectRef.current?.(m.id);
        });
        byId.set(m.id, marker as never);
      }
      markersRef.current = byId;
      const routeCoords = props.part.route?.coordinates ?? [];
      if (routeCoords.length >= 2) {
        L.polyline(
          routeCoords.map((p) => [p.lat, p.lng] as [number, number]),
          { color: "#1d4ed8", weight: 5, opacity: 0.85 }
        ).addTo(map);
      }
      map.on("click", () => onSelectRef.current?.(null));
      const pts = [
        ...props.part.markers.map((m) => ({ lat: m.lat, lng: m.lng })),
        ...routeCoords
      ];
      if (pts.length >= 2) {
        map.fitBounds(
          L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])),
          { padding: MAP_PADDING, maxZoom: MAP_MAX_ZOOM }
        );
      } else if (pts.length === 1) {
        map.setView([pts[0]!.lat, pts[0]!.lng], Math.min(props.part.zoom ?? MAP_SINGLE_ZOOM, MAP_MAX_ZOOM));
      } else {
        map.setView([props.part.center.lat, props.part.center.lng], props.part.zoom ?? 13);
      }
      requestAnimationFrame(() => map.invalidateSize());
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current = new Map();
    };
    // partKey で再生成
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partKey]);

  useEffect(() => {
    const onFit = (event: Event) => {
      if ((event as CustomEvent).detail === props.instanceId) fitAll();
    };
    window.addEventListener("fudo-map-fit", onFit);
    return () => window.removeEventListener("fudo-map-fit", onFit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partKey, props.instanceId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.selectedId) return;
    const marker = props.part.markers.find((m) => m.id === props.selectedId);
    if (!marker) return;
    map.panTo([marker.lat, marker.lng]);
    requestAnimationFrame(() => map.invalidateSize());
  }, [props.selectedId, props.part.markers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = window.setTimeout(() => map.invalidateSize(), 50);
    return () => window.clearTimeout(t);
  }, [props.heightClass]);

  return (
    <div
      ref={ref}
      className={`z-0 ${props.heightClass}`}
      role="application"
      aria-label="地図"
    />
  );
}

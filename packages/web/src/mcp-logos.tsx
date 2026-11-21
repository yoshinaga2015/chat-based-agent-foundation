import type { ReactNode } from "react";
import {
  siAtlassian,
  siFigma,
  siGithub,
  siLinear,
  siNotion,
  siSentry,
  siStripe,
  siSupabase
} from "simple-icons";

type Mark = { title: string; path: string; hex: string };

/** Simple Icons 由来。Slack は商標でパッケージから外れているため、同セットの公式パスを固定。 */
const SLACK: Mark = {
  title: "Slack",
  hex: "4A154B",
  path: "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"
};

const MARKS: Record<string, Mark> = {
  notion: siNotion,
  linear: siLinear,
  github: siGithub,
  stripe: siStripe,
  atlassian: siAtlassian,
  sentry: siSentry,
  supabase: siSupabase,
  figma: siFigma,
  slack: SLACK
};

export function hasMcpServiceMark(catalogOrId: string | undefined): boolean {
  const id = (catalogOrId ?? "").trim().toLowerCase();
  return Boolean(MARKS[id]);
}

/** カタログ id → Simple Icons 公式パス＋ブランド色。白い台の上に載せる前提。 */
export function mcpServiceMark(catalogOrId: string | undefined, size = 18): ReactNode {
  const id = (catalogOrId ?? "").trim().toLowerCase();
  const mark = MARKS[id];
  if (!mark) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
        <path d="M8 9h8M8 13h5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={`#${mark.hex}`}
      role="img"
      aria-hidden
    >
      <title>{mark.title}</title>
      <path d={mark.path} />
    </svg>
  );
}

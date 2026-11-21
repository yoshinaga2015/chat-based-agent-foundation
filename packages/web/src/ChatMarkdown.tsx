import { Link } from "@cloudflare/kumo";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkCjkFriendlyGfmStrikethrough from "remark-cjk-friendly-gfm-strikethrough";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import {
  Children,
  isValidElement,
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from "react";
import type { MediaImage } from "./types";
import { ImageGalleryDialog } from "./ui/ImageGallery";

/**
 * GFM autolink は全角「）」や日本語を URL に飲み込む。
 * ASCII URL 文字だけを切り出し、先に Markdown リンク化する。
 */
function trimTrailingUrlPunct(url: string): { href: string; trail: string } {
  let href = url;
  let trail = "";
  while (href.length > 8 && /[.,;:!?]$/.test(href)) {
    trail = href.slice(-1) + trail;
    href = href.slice(0, -1);
  }
  // 対応する ( が無ければ末尾 ) は文の括弧
  while (href.endsWith(")") && !href.slice(href.indexOf("://") + 3).includes("(")) {
    trail = ")" + trail;
    href = href.slice(0, -1);
  }
  return { href, trail };
}

/** `/property/…` と http(s) URL を Markdown リンクにし、CJK 境界で切る。 */
export function enrichChatMarkdown(text: string): string {
  const withProperty = text.replace(/(^|[\s(（])(\/property\/[A-Za-z0-9_-]+)/g, "$1[$2]($2)");
  return withProperty.replace(
    /\[([^\]]*)\]\(([^)]+)\)|https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gi,
    (match, _label, dest) => {
      if (typeof dest === "string") return match;
      const { href, trail } = trimTrailingUrlPunct(match);
      if (!/^https?:\/\//i.test(href)) return match;
      return `[${href}](${href})${trail}`;
    }
  );
}

/** 本文中の Markdown 画像（https）を出現順で集める。ギャラリー用。 */
export function extractMarkdownImages(text: string): MediaImage[] {
  const out: MediaImage[] = [];
  const seen = new Set<string>();
  const re = /!\[([^\]]*)\]\(\s*<?(https:\/\/[^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const url = match[2]?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const alt = match[1]?.trim();
    out.push(alt ? { url, alt } : { url });
  }
  return out;
}

function isHttpsImageUrl(url: string): boolean {
  if (!url.toLowerCase().startsWith("https://")) return false;
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\.(avif|gif|jpe?g|png|svg|webp)(\?|$)/i.test(path) || /\/image\//i.test(path);
  } catch {
    return false;
  }
}

/**
 * `a` の children は、カスタム `img` の描画結果ではなく
 * 「これから img コンポーネントを呼ぶ要素」（props に src）。
 */
function isMarkdownImageChild(node: ReactNode): boolean {
  if (!isValidElement(node)) return false;
  const props = node.props as { src?: unknown };
  return typeof props.src === "string" && props.src.startsWith("https://");
}

/** リンクの中身が画像だけならページ遷移させない（`[![…](img)](page)`）。 */
function unwrapImageOnlyLink(children: ReactNode): ReactNode | null {
  const elements = Children.toArray(children).filter(isValidElement);
  if (elements.length === 1 && isMarkdownImageChild(elements[0])) return elements[0];
  return null;
}

export function ChatMarkdown({ text }: { text: string }): ReactNode {
  const extracted = useMemo(() => extractMarkdownImages(text), [text]);
  const [gallery, setGallery] = useState<{ images: MediaImage[]; index: number } | null>(null);

  const openImage = useCallback(
    (event: MouseEvent | KeyboardEvent, src: string) => {
      event.preventDefault();
      event.stopPropagation();
      const index = extracted.findIndex((item) => item.url === src);
      if (index >= 0) {
        setGallery({ images: extracted, index });
        return;
      }
      setGallery({ images: [{ url: src }], index: 0 });
    },
    [extracted]
  );

  const components = useMemo<Components>(
    () => ({
      p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0 leading-relaxed">{children}</p>,
      h1: ({ children }) => <h1 className="mt-3 mb-1 text-base font-semibold first:mt-0">{children}</h1>,
      h2: ({ children }) => <h2 className="mt-3 mb-1 text-base font-semibold first:mt-0">{children}</h2>,
      h3: ({ children }) => <h3 className="mt-2.5 mb-1 text-sm font-semibold first:mt-0">{children}</h3>,
      h4: ({ children }) => <h4 className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</h4>,
      h5: ({ children }) => <h5 className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</h5>,
      h6: ({ children }) => <h6 className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</h6>,
      ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ul>,
      ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ol>,
      li: ({ children }) => <li className="leading-relaxed">{children}</li>,
      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
      em: ({ children }) => <em className="italic">{children}</em>,
      del: ({ children }) => <del className="opacity-70">{children}</del>,
      blockquote: ({ children }) => (
        <blockquote className="my-2 border-l-2 border-kumo-line pl-3 text-kumo-subtle first:mt-0 last:mb-0">
          {children}
        </blockquote>
      ),
      hr: () => <hr className="my-3 border-kumo-line" />,
      a: ({ href, children }) => {
        const to = typeof href === "string" ? href : "";
        const imageOnly = unwrapImageOnlyLink(children);
        if (imageOnly) return imageOnly;
        if (to && isHttpsImageUrl(to)) {
          return (
            <button
              type="button"
              className="cursor-zoom-in border-0 bg-transparent p-0 text-left"
              onClick={(event) => openImage(event, to)}
            >
              {children}
            </button>
          );
        }
        const external = /^https?:\/\//i.test(to);
        return (
          <Link href={to || "#"} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {children}
          </Link>
        );
      },
      code: ({ className, children }) => {
        const block = typeof className === "string" && className.includes("language-");
        if (block) {
          return <code className={className}>{children}</code>;
        }
        return (
          <code className="rounded bg-kumo-tint px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
        );
      },
      pre: ({ children }) => (
        <pre className="my-2 overflow-x-auto rounded-lg bg-kumo-tint p-3 font-mono text-[0.85em] leading-relaxed first:mt-0 last:mb-0">
          {children}
        </pre>
      ),
      table: ({ children }) => (
        <div className="my-2 overflow-x-auto first:mt-0 last:mb-0">
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      ),
      thead: ({ children }) => <thead className="border-b border-kumo-line">{children}</thead>,
      tbody: ({ children }) => <tbody>{children}</tbody>,
      tr: ({ children }) => <tr className="border-b border-kumo-line/60 last:border-0">{children}</tr>,
      th: ({ children }) => <th className="px-2 py-1.5 text-left font-semibold">{children}</th>,
      td: ({ children }) => <td className="px-2 py-1.5 align-top">{children}</td>,
      img: ({ src, alt }) => {
        if (typeof src !== "string" || !src.startsWith("https://")) return null;
        const label = alt?.trim() ? `${alt}を拡大` : "画像を拡大";
        return (
          <img
            src={src}
            alt={alt ?? ""}
            className="my-2 max-h-64 max-w-full cursor-zoom-in rounded-lg"
            loading="lazy"
            role="button"
            tabIndex={0}
            aria-label={label}
            onClick={(event) => openImage(event, src)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              openImage(event, src);
            }}
          />
        );
      },
      input: ({ checked, disabled, type }) =>
        type === "checkbox" ? (
          <input type="checkbox" checked={Boolean(checked)} disabled={disabled ?? true} className="mr-1.5 align-middle" readOnly />
        ) : null
    }),
    [openImage]
  );

  return (
    <>
      <div className="chat-md text-sm text-kumo-default [&_a]:break-all">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkCjkFriendly, remarkCjkFriendlyGfmStrikethrough]}
          rehypePlugins={[rehypeSanitize]}
          components={components}
        >
          {enrichChatMarkdown(text)}
        </ReactMarkdown>
      </div>
      {gallery ? (
        <ImageGalleryDialog
          open
          onOpenChange={(open) => {
            if (!open) setGallery(null);
          }}
          title=""
          images={gallery.images}
          initialIndex={gallery.index}
        />
      ) : null}
    </>
  );
}

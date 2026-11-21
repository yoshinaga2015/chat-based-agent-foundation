import { Button, Dialog } from "@cloudflare/kumo";
import { CaretLeftIcon, CaretRightIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useId, useState, type ReactNode } from "react";
import type { MediaImage } from "../types";

export function ImageGalleryDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  images: readonly MediaImage[];
  initialIndex?: number;
}): ReactNode {
  const labelId = useId();
  const statusId = useId();
  const [index, setIndex] = useState(0);
  const total = props.images.length;

  useEffect(() => {
    if (!props.open) return;
    const next = props.initialIndex ?? 0;
    setIndex(Math.min(Math.max(0, next), Math.max(0, total - 1)));
  }, [props.open, props.initialIndex, total]);

  useEffect(() => {
    if (!props.open || total < 2) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((current) => (current - 1 + total) % total);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((current) => (current + 1) % total);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, total]);

  if (total === 0) return null;
  const current = props.images[index] ?? props.images[0]!;

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog size="xl" className="flex max-h-[85dvh] flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {props.title.trim() ? (
              <Dialog.Title id={labelId} className="m-0 line-clamp-2 text-base font-medium text-kumo-default">
                {props.title}
              </Dialog.Title>
            ) : (
              <Dialog.Title id={labelId} className="sr-only">
                画像
              </Dialog.Title>
            )}
            <Dialog.Description
              id={statusId}
              className={`m-0 text-sm text-kumo-subtle ${props.title.trim() ? "mt-1" : ""}`}
              aria-live="polite"
            >
              {index + 1} / {total}
            </Dialog.Description>
          </div>
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
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-kumo-recessed">
          <img
            src={current.url}
            alt={current.alt ?? ""}
            className="max-h-[min(60vh,28rem)] w-full object-contain"
          />
        </div>
        {total > 1 ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              shape="square"
              aria-label="前の画像"
              onClick={() => setIndex((current) => (current - 1 + total) % total)}
            >
              <CaretLeftIcon size={16} aria-hidden />
            </Button>
            <ul className="flex min-w-0 flex-1 justify-center gap-1.5 overflow-x-auto p-0.5">
              {props.images.map((image, imageIndex) => (
                <li key={image.url}>
                  <button
                    type="button"
                    className={`block size-12 overflow-hidden rounded-md ring ${
                      imageIndex === index ? "ring-kumo-interact" : "ring-kumo-line"
                    }`}
                    aria-label={image.alt?.trim() || `画像 ${imageIndex + 1}`}
                    aria-current={imageIndex === index ? "true" : undefined}
                    onClick={() => setIndex(imageIndex)}
                  >
                    <img
                      src={image.url}
                      alt=""
                      className="size-12 object-cover"
                      loading="lazy"
                    />
                  </button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              shape="square"
              aria-label="次の画像"
              onClick={() => setIndex((current) => (current + 1) % total)}
            >
              <CaretRightIcon size={16} aria-hidden />
            </Button>
          </div>
        ) : null}
      </Dialog>
    </Dialog.Root>
  );
}

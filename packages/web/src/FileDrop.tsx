import { Text } from "@cloudflare/kumo";
import { FileArrowUpIcon } from "@phosphor-icons/react";
import { useState, type DragEvent, type ReactNode } from "react";
import { isFileDrag, leftDropZone } from "./file-drop";

export function useFileDrop({
  enabled,
  onFiles
}: {
  enabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const accepts = (event: DragEvent<HTMLElement>) =>
    enabled && isFileDrag(Array.from(event.dataTransfer.types));

  const dropProps = {
    onDragEnter: (event: DragEvent<HTMLElement>) => {
      if (!accepts(event)) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (leftDropZone(event.currentTarget, event.relatedTarget)) setDragging(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      setDragging(false);
      if (!accepts(event)) return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files);
      if (files.length > 0) onFiles(files);
    }
  };

  return { dragging: dragging && enabled, dropProps };
}

export function FileDropOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-kumo-base/90 p-4"
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-kumo-line text-center">
        <FileArrowUpIcon size={32} aria-hidden />
        <Text size="base" as="p">
          ここにドロップして資料を添付
        </Text>
        <Text variant="secondary" size="sm" as="p">
          PDF・PNG・JPEG
        </Text>
      </div>
    </div>
  );
}

export function FileDropZone(props: {
  enabled: boolean;
  onFiles: (files: File[]) => void;
  className?: string;
  children: ReactNode;
}) {
  const { dragging, dropProps } = useFileDrop({
    enabled: props.enabled,
    onFiles: props.onFiles
  });
  return (
    <div className={`relative min-h-0 ${props.className ?? ""}`} {...dropProps}>
      {props.children}
      {dragging ? <FileDropOverlay /> : null}
    </div>
  );
}

import { Banner } from "@cloudflare/kumo";
import { XIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { noticeBannerVariant, type NoticeBannerVariant } from "../noticeBanner";

/** 閉じられる一過性 notice。HITL（承認待ち）には使わない。 */
export function DismissibleNoticeBanner(props: {
  title: string;
  description?: string;
  variant?: NoticeBannerVariant;
  onDismiss: () => void;
}): ReactNode {
  const variant = props.variant ?? noticeBannerVariant(props.title);
  return (
    <Banner
      variant={variant}
      title={props.title}
      description={props.description}
      action={
        <Banner.Action
          variant="ghost"
          type="button"
          icon={<XIcon />}
          aria-label="閉じる"
          onClick={props.onDismiss}
        />
      }
    />
  );
}

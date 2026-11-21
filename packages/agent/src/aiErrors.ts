// AI バインディングの失敗のうち、利用者が直せるものだけを理由と対処に変える。別モデルへは逃がさない。

export type AiStopReason = "free_allocation" | "paid_plan" | "credit";

const STOP_TEXT: Record<AiStopReason, string> = {
  free_allocation:
    "Workers AI の今日の無料枠（10,000 Neurons）を使い切りました。AI Gateway でクレジットを買うか、プロバイダのキーを AI Gateway に保存してください。",
  paid_plan:
    "このモデルは Workers Paid プランが要ります。AI Gateway でクレジットを買うか、プロバイダのキーを AI Gateway に保存してください。",
  credit:
    "AI Gateway のクレジットが足りません。ダッシュボードでクレジットを買うか、プロバイダのキーを AI Gateway に保存してください。"
};

export function aiStopReason(error: unknown): AiStopReason | null {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message) return null;
  if (/\b(3036|4006)\b/.test(message) || /daily free allocation/i.test(message)) return "free_allocation";
  if (/\b5035\b/.test(message)) return "paid_plan";
  if (/\b(2052|2021)\b/.test(message) || /insufficient (unified billing )?balance/i.test(message)) return "credit";
  return null;
}

export function aiStopText(error: unknown): string | null {
  const reason = aiStopReason(error);
  return reason ? STOP_TEXT[reason] : null;
}

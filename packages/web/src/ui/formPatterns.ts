import type { UiPart } from "../types";

export type FormPattern = {
  id: string;
  label: string;
  part: Extract<UiPart, { kind: "forms" }>;
};

/** Controlled forms 組立パターン。1テーマ＝1カード。欄はカード内で span 左右配置可。 */
export const FORM_PATTERNS: FormPattern[] = [
  {
    id: "missing",
    label: "missing — 欠損",
    part: {
      kind: "forms",
      title: "不足している前提",
      commit: "assumptions",
      sections: [
        {
          id: "gap",
          span: 2,
          fields: [
            { id: "price", label: "価格", type: "currency", min: 0, span: 1 },
            { id: "rent", label: "賃料", type: "currency", min: 0, span: 1 },
            {
              id: "property_class",
              label: "種別",
              type: "select",
              options: ["condo", "apartment", "kodate"],
              span: 2
            }
          ]
        }
      ]
    }
  },
  {
    id: "loan",
    label: "loan — 借入条件",
    part: {
      kind: "forms",
      title: "借入条件",
      commit: "speak_summary",
      sections: [
        {
          id: "loan",
          span: 2,
          fields: [
            { id: "loan_amount", label: "借入額", type: "currency", value: 50_000_000, min: 0, span: 2 },
            { id: "rate", label: "金利 %", type: "slider", min: 0, max: 5, step: 0.05, value: 1.2 },
            { id: "years", label: "返済年数", type: "stepper", min: 5, max: 50, value: 35, span: 1 },
            { id: "units", label: "戸数", type: "number", min: 1, value: 1, span: 1 },
            { id: "bonus", label: "ボーナス返済あり", type: "switch", value: false, span: 1 },
            { id: "variable", label: "変動金利", type: "checkbox", value: true, span: 1 }
          ]
        }
      ]
    }
  },
  {
    id: "property",
    label: "property — 物件メモ",
    part: {
      kind: "forms",
      title: "物件メモ",
      commit: "speak_summary",
      sections: [
        {
          id: "property",
          span: 2,
          fields: [
            {
              id: "class",
              label: "種別",
              type: "radio",
              options: ["マンション", "アパート", "戸建"],
              value: "マンション"
            },
            { id: "ask", label: "売出価格", type: "currency", value: 38_000_000, span: 2 },
            { id: "memo", label: "メモ", type: "textarea", value: "" },
            { id: "tags", label: "タグ", type: "tags", value: ["駅近"] }
          ]
        }
      ]
    }
  },
  {
    id: "intake",
    label: "intake — 受付",
    part: {
      kind: "forms",
      title: "受付",
      commit: "speak_summary",
      submitLabel: "送信",
      sections: [
        {
          id: "intake",
          span: 2,
          fields: [
            { id: "name", label: "氏名", type: "text", required: true, span: 1 },
            { id: "secret", label: "確認コード", type: "sensitive", span: 1 },
            { id: "visit", label: "希望日", type: "date" },
            { id: "consent", label: "連絡に同意", type: "checkbox", required: true, value: false, span: 2 }
          ]
        }
      ]
    }
  },
  {
    id: "filter",
    label: "filter — 絞り込み",
    part: {
      kind: "forms",
      title: "絞り込み",
      commit: "speak_summary",
      sections: [
        {
          id: "filters",
          span: 2,
          fields: [
            {
              id: "area",
              label: "エリア",
              type: "select",
              options: ["23区", "横浜", "さいたま"],
              value: "23区",
              span: 1
            },
            { id: "pet", label: "ペット可のみ", type: "switch", value: false, span: 1 },
            { id: "walk", label: "徒歩分まで", type: "slider", min: 1, max: 20, value: 10 },
            { id: "keywords", label: "キーワード", type: "tags", value: [] }
          ]
        }
      ]
    }
  }
];

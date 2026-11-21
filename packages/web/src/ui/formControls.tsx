import {
  Button,
  Checkbox,
  DatePicker,
  Input,
  InputArea,
  Radio,
  RadioGroup,
  Select,
  SensitiveInput,
  Slider,
  Switch,
  TagInput,
  Text
} from "@cloudflare/kumo";
import { useState, type ReactNode } from "react";
import type { FormField, FormValue } from "../types";

/** カード内2列グリッド用。広いコントロールは既定で全幅。 */
export function formFieldSpan(field: FormField): 1 | 2 {
  if (field.span === 1 || field.span === 2) return field.span;
  switch (field.type) {
    case "textarea":
    case "date":
    case "tags":
    case "radio":
    case "slider":
      return 2;
    default:
      return 1;
  }
}

export function formatFormValue(field: FormField, value: FormValue | undefined): string {
  if (value === undefined) return "";
  if (field.type === "currency" && typeof value === "number") {
    return `¥${Math.round(value).toLocaleString("ja-JP")}`;
  }
  if (typeof value === "boolean") return value ? "はい" : "いいえ";
  if (Array.isArray(value)) return value.join(",");
  return String(value);
}

export function initialFormValues(fields: readonly FormField[]): Record<string, FormValue> {
  const init: Record<string, FormValue> = {};
  for (const field of fields) {
    if (field.value !== undefined) {
      init[field.id] = field.value;
      continue;
    }
    if (field.type === "checkbox" || field.type === "switch") init[field.id] = false;
    else if (field.type === "tags") init[field.id] = [];
    else if (field.type === "stepper" || field.type === "slider" || field.type === "number" || field.type === "currency") {
      init[field.id] = field.min ?? 0;
    }
  }
  return init;
}

function parseIsoDate(raw: unknown): Date | undefined {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const d = new Date(`${raw}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function toIsoDate(d: Date | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function FormFieldControl(props: {
  field: FormField;
  value: FormValue | undefined;
  disabled?: boolean;
  onChange: (v: FormValue) => void;
}): ReactNode {
  const { field } = props;
  const options = field.options ?? [];

  if (field.type === "select" && options.length) {
    return (
      <Select
        size="base"
        label={field.label}
        value={String(props.value ?? "")}
        disabled={props.disabled}
        required={field.required}
        onValueChange={(v) => props.onChange(v ?? "")}
      >
        {options.map((opt) => (
          <Select.Option key={opt} value={opt}>
            {opt}
          </Select.Option>
        ))}
      </Select>
    );
  }

  if (field.type === "radio" && options.length) {
    return (
      <RadioGroup
        legend={field.label}
        value={String(props.value ?? "")}
        disabled={props.disabled}
        orientation="horizontal"
        onValueChange={(v) => props.onChange(v)}
      >
        {options.map((opt) => (
          <Radio.Item key={opt} value={opt} label={opt} />
        ))}
      </RadioGroup>
    );
  }

  if (field.type === "stepper") {
    const n = typeof props.value === "number" ? props.value : Number(props.value) || 0;
    const min = field.min ?? 0;
    const max = field.max ?? Number.POSITIVE_INFINITY;
    const step = field.step ?? 1;
    return (
      <div className="flex flex-col gap-1.5">
        <Text size="sm" as="span">
          {field.label}
        </Text>
        <div className="flex items-center gap-2">
          <Button
            size="lg"
            shape="square"
            variant="secondary"
            type="button"
            className="min-h-11 min-w-11"
            aria-label={`${field.label}を減らす`}
            disabled={props.disabled || n <= min}
            onClick={() => props.onChange(Math.max(min, n - step))}
          >
            −
          </Button>
          <span className="min-w-10 text-center text-base tabular-nums text-kumo-default" aria-live="polite">
            {n}
          </span>
          <Button
            size="lg"
            shape="square"
            variant="secondary"
            type="button"
            className="min-h-11 min-w-11"
            aria-label={`${field.label}を増やす`}
            disabled={props.disabled || n >= max}
            onClick={() => props.onChange(Math.min(max, n + step))}
          >
            ＋
          </Button>
        </div>
      </div>
    );
  }

  if (field.type === "slider") {
    const n = typeof props.value === "number" ? props.value : Number(props.value) || field.min || 0;
    return (
      <Slider
        size="base"
        label={field.label}
        min={field.min ?? 0}
        max={field.max ?? 100}
        step={field.step ?? 1}
        value={n}
        disabled={props.disabled}
        onValueChange={(v) => {
          const next = Array.isArray(v) ? v[0] : v;
          props.onChange(typeof next === "number" ? next : n);
        }}
      />
    );
  }

  if (field.type === "checkbox") {
    return (
      <Checkbox
        label={field.label}
        checked={props.value === true}
        disabled={props.disabled}
        required={field.required}
        onCheckedChange={(checked) => props.onChange(checked === true)}
      />
    );
  }

  if (field.type === "switch") {
    return (
      <Switch
        label={field.label}
        checked={props.value === true}
        disabled={props.disabled}
        required={field.required}
        onCheckedChange={(checked) => props.onChange(checked === true)}
      />
    );
  }

  if (field.type === "textarea") {
    return (
      <InputArea
        size="base"
        label={field.label}
        value={typeof props.value === "string" ? props.value : ""}
        disabled={props.disabled}
        required={field.required}
        autoResize
        minRows={3}
        maxRows={10}
        onValueChange={(v) => props.onChange(v)}
      />
    );
  }

  if (field.type === "sensitive") {
    return (
      <SensitiveInput
        size="base"
        label={field.label}
        value={typeof props.value === "string" ? props.value : ""}
        disabled={props.disabled}
        required={field.required}
        onValueChange={(v) => props.onChange(v)}
      />
    );
  }

  if (field.type === "tags") {
    const tags = Array.isArray(props.value) ? props.value : [];
    return (
      <TagInput
        label={field.label}
        value={tags}
        disabled={props.disabled}
        required={field.required}
        onValueChange={(v) => props.onChange(v)}
      />
    );
  }

  if (field.type === "date") {
    const selected = parseIsoDate(props.value);
    return (
      <div className="flex flex-col gap-1">
        <Text size="sm" as="span">
          {field.label}
        </Text>
        <DatePicker
          mode="single"
          selected={selected}
          disabled={props.disabled}
          onChange={(d) => props.onChange(toIsoDate(d))}
        />
      </div>
    );
  }

  const numeric = field.type === "number" || field.type === "currency";
  return (
    <Input
      size="base"
      label={field.label}
      type={numeric ? "number" : "text"}
      value={props.value === undefined ? "" : String(props.value)}
      disabled={props.disabled}
      required={field.required}
      min={field.min}
      max={field.max}
      step={field.step}
      onValueChange={(v) =>
        props.onChange(numeric ? (v === "" ? "" : Number(v)) : v)
      }
    />
  );
}

/** 薄い縦並びフォーム（form_fields）。 */
export function FormFieldsShell(props: {
  title?: string;
  fields: FormField[];
  submitLabel?: string;
  commit: "assumptions" | "speak_summary";
  disabled?: boolean;
  onCommit: (values: Record<string, FormValue>, speakSummary?: string) => void;
}): ReactNode {
  const [values, setValues] = useState(() => initialFormValues(props.fields));
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <Text size="sm" variant="secondary" as="p" role="status">
        反映済み
      </Text>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-0.5">
      {props.title ? (
        <Text variant="heading" as="h2">
          {props.title}
        </Text>
      ) : null}
      {props.fields.map((field) => (
        <FormFieldControl
          key={field.id}
          field={field}
          value={values[field.id]}
          disabled={props.disabled}
          onChange={(next) => setValues((prev) => ({ ...prev, [field.id]: next }))}
        />
      ))}
      <Button
        size="base"
        variant="primary"
        type="button"
        disabled={props.disabled}
        onClick={() => {
          setDone(true);
          const summary =
            props.commit === "speak_summary"
              ? props.fields.map((f) => `${f.label}=${formatFormValue(f, values[f.id])}`).join("、")
              : undefined;
          props.onCommit(values, summary);
        }}
      >
        {props.submitLabel ?? "反映"}
      </Button>
    </div>
  );
}

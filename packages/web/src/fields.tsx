import { Input, InputArea, Select } from "@cloudflare/kumo";
import type { ComponentProps, ReactNode } from "react";

/** Kumo は required でもラベル印を出さない（false のときだけ optional 表示）。必須時は * を足す。 */
function withRequiredMark(label: ReactNode | undefined, required: boolean | undefined): ReactNode | undefined {
  if (label == null || required !== true) return label;
  return (
    <>
      {label}
      <span className="-ms-0.5 text-red-600" aria-hidden="true">
        *
      </span>
    </>
  );
}

export function FormInput({ label, required, ...props }: ComponentProps<typeof Input>) {
  return <Input {...props} label={withRequiredMark(label, required)} required={required} />;
}

export function FormInputArea({ label, required, ...props }: ComponentProps<typeof InputArea>) {
  return <InputArea {...props} label={withRequiredMark(label, required)} required={required} />;
}

export function FormSelect({ label, required, children, ...props }: ComponentProps<typeof Select> & { required?: boolean }) {
  return (
    <Select {...props} label={withRequiredMark(label, required)} required={required}>
      {children}
    </Select>
  );
}

FormSelect.Option = Select.Option;

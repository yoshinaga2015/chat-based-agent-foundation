/**
 * handoff 中の確定文字挿入。
 * Live View から fudo にフォーカスを移すと remote の activeElement が外れるため、
 * 編集可能フォーカス → 検索っぽい欄 → 先頭の可視 input の順で入れる。
 */
export async function insertTextIntoPage(
  page: {
    frames(): readonly {
      evaluate<T>(fn: (arg: string) => T, arg: string): Promise<T>;
    }[];
    keyboard: { insertText(text: string): Promise<void> };
  },
  text: string
): Promise<void> {
  for (const frame of page.frames()) {
    const ok = await frame.evaluate(insertInDocument, text).catch(() => false);
    if (ok) return;
  }
  await page.keyboard.insertText(text);
}

/** page.evaluate に渡すため、クロージャ無しの純関数。 */
function insertInDocument(chunk: string): boolean {
  function isEditable(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
    if (!el || el.nodeType !== 1) return false;
    const node = el as HTMLElement;
    if (node.isContentEditable) return true;
    if (node.getAttribute("role") === "textbox") return true;
    const tag = node.tagName;
    if (tag === "TEXTAREA") {
      const area = node as HTMLTextAreaElement;
      return !area.disabled && !area.readOnly;
    }
    if (tag === "INPUT") {
      const input = node as HTMLInputElement;
      const type = (input.type || "text").toLowerCase();
      if (input.disabled || input.readOnly) return false;
      return ![
        "button",
        "submit",
        "checkbox",
        "radio",
        "file",
        "hidden",
        "image",
        "reset",
        "range",
        "color"
      ].includes(type);
    }
    return false;
  }

  function setNative(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc?.set) desc.set.call(el, value);
    else el.value = value;
  }

  function write(el: HTMLElement, data: string): boolean {
    el.focus();
    if (el.isContentEditable || el.getAttribute("role") === "textbox") {
      return document.execCommand("insertText", false, data);
    }
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const next = input.value.slice(0, start) + data + input.value.slice(end);
    setNative(input, next);
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data })
    );
    input.dispatchEvent(new Event("change", { bubbles: true }));
    try {
      input.setSelectionRange(start + data.length, start + data.length);
    } catch {
      // number 等
    }
    return true;
  }

  const active = document.activeElement;
  if (isEditable(active)) return write(active, chunk);

  const nodes = [...document.querySelectorAll("input, textarea, [contenteditable='true']")];
  const visible = nodes.filter((node) => {
    if (!isEditable(node)) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  const scored = visible.map((node) => {
    const el = node as HTMLElement;
    const hint = `${(el as HTMLInputElement).name || ""} ${el.id} ${(el as HTMLInputElement).placeholder || ""} ${el.getAttribute("aria-label") || ""}`;
    const searchLike = /search|検索|keyword|住所|address|\bq\b|query|地名/i.test(hint) ? 2 : 0;
    const empty = "value" in el && String((el as HTMLInputElement).value || "").length === 0 ? 1 : 0;
    return { el, score: searchLike + empty };
  });
  scored.sort((a, b) => b.score - a.score);
  const pick = scored[0]?.el;
  if (!pick) return false;
  return write(pick, chunk);
}

import { useRef, useState } from "react";
import { VARIABLES } from "@/app/bulk-send/constants/bulk-send.constants";
import { insertVariable, matchVariables, unknownVariables, variableQuery } from "@/app/bulk-send/utils/bulk-send.utils";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/utils/shadcn";

const MAX_BYTES = 2800;
const bytes = (s: string) => new TextEncoder().encode(s).length;
const POPUP_W = 320;

// the textarea styles that decide where its text wraps
const COPIED = [
  "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth",
  "borderLeftWidth", "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "textTransform", "wordSpacing", "tabSize",
] as const;

// where the caret is drawn, in px from the textarea's top-left: a hidden copy of the text up to it, laid out alike
function caretAt(el: HTMLTextAreaElement, pos: number) {
  const css = getComputedStyle(el);
  const copy = document.createElement("div");
  for (const k of COPIED) copy.style[k] = css[k];
  Object.assign(copy.style, { position: "absolute", top: "0", left: "-9999px", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word" });
  copy.textContent = el.value.slice(0, pos);
  const mark = copy.appendChild(document.createElement("span"));
  mark.textContent = "​";
  document.body.append(copy);
  const at = { top: mark.offsetTop + mark.offsetHeight - el.scrollTop, left: mark.offsetLeft - el.scrollLeft };
  copy.remove();
  return { top: at.top + 4, left: Math.max(0, Math.min(at.left, el.clientWidth - POPUP_W)) };
}

// A message box for {{variables}}: typing "{" lists them at the caret, filtered by what follows (arrows + Enter / Tab,
// or click; Escape closes) and inserted as {{key}}. The row below inserts at the caret, a key that doesn't exist
// shows in red. Text is capped at Zalo's 2800 bytes like "Tin nhắn nhanh".
export function VariableTextarea({ value, onChange, rows = 6, autoFocus }: { value: string; onChange: (v: string) => void; rows?: number; autoFocus?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // the "{" typed and what follows it
  const [pop, setPop] = useState<{ query: string; start: number }>();
  const [xy, setXy] = useState({ top: 0, left: 0 });
  const [sel, setSel] = useState(0);
  const options = pop ? matchVariables(pop.query) : [];
  const bad = unknownVariables(value);

  const look = () => {
    const el = ref.current;
    if (!el || el.selectionStart !== el.selectionEnd) return setPop(undefined);
    const next = variableQuery(el.value, el.selectionStart);
    if (next?.start === pop?.start && next?.query === pop?.query) return;
    setPop(next);
    setSel(0);
    if (next) setXy(caretAt(el, next.start));
  };
  const put = (key: string, start: number, end: number) => {
    const r = insertVariable(value, start, end, key);
    onChange(r.text);
    setPop(undefined);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(r.caret, r.caret);
    });
  };
  const accept = (key: string) => pop && put(key, pop.start, ref.current?.selectionStart ?? value.length);

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        rows={rows}
        autoFocus={autoFocus}
        className="field-sizing-fixed"
        placeholder="Nhập nội dung, gõ { để chèn tên khách…"
        value={value}
        aria-invalid={bad.length > 0 || undefined}
        onChange={(e) => {
          let next = e.target.value.replace(/\r\n/g, "\n");
          while (bytes(next) > MAX_BYTES) next = next.slice(0, -1);
          onChange(next);
        }}
        onSelect={look}
        onScroll={() => setPop(undefined)}
        onBlur={() => setPop(undefined)}
        onKeyDown={(e) => {
          if (!options.length) return;
          if (e.key === "Escape") return setPop(undefined);
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => (s + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            accept(options[sel].key);
          }
        }}
      />
      {options.length > 0 && (
        <div className="absolute z-50 rounded-lg border bg-popover p-1 shadow-md" style={{ top: xy.top, left: xy.left, width: POPUP_W }}>
          {options.map((v, i) => (
            <button
              key={v.key}
              className={cn("flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left", i === sel && "bg-muted")}
              // keep the caret in the box
              onMouseDown={(e) => (e.preventDefault(), accept(v.key))}
            >
              <code className="text-violet-700">{v.key}</code>
              <span className="truncate text-xs text-muted-foreground">
                {v.label} · {v.example}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Chèn biến:</span>
        {VARIABLES.map((v) => (
          <button
            key={v.key}
            title={`${v.label} · ví dụ: ${v.example}`}
            className="rounded bg-violet-100 px-1.5 font-mono text-xs leading-5 text-violet-700 hover:bg-violet-200"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => put(v.key, ref.current?.selectionStart ?? value.length, ref.current?.selectionEnd ?? value.length)}
          >
            {`{{${v.key}}}`}
          </button>
        ))}
      </div>
      {bad.length > 0 && <p className="mt-1 text-xs text-red-600">Không có biến {bad.map((k) => `{{${k}}}`).join(", ")}</p>}
    </div>
  );
}

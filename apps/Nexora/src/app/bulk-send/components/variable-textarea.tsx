import { useRef, useState } from "react";
import { FILTER_GROUPS, SAMPLE, VARIABLES } from "@/app/bulk-send/constants/bulk-send.constants";
import { addFilter, filterQuery, insertFilter, insertVariable, matchFilters, matchVariables, problemsIn, variableQuery } from "@/app/bulk-send/utils/bulk-send.utils";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/utils/shadcn";

const MAX_BYTES = 2800;
const bytes = (s: string) => new TextEncoder().encode(s).length;
const POPUP_W = 360;

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

type Pop = { kind: "var" | "filter"; query: string; start: number; key?: string };
// one row of the suggestions: what gets written, what it is, and what the sample customer would read
type Option = { id: string; code: string; title: string; example: string; note: string; pick: () => void };

// A message box for {{variables}}. Typing "{" suggests the variables, typing "|" inside one suggests its formats (each
// with what the sample customer would read); arrows + Enter / Tab or a click picks, Escape closes. The row below
// inserts a variable at the caret, the table under it a format; problems show in red. Text is capped at Zalo's 2800
// bytes like "Tin nhắn nhanh".
export function VariableTextarea({ value, onChange, rows = 6, autoFocus }: { value: string; onChange: (v: string) => void; rows?: number; autoFocus?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [pop, setPop] = useState<Pop>();
  const [xy, setXy] = useState({ top: 0, left: 0 });
  const [sel, setSel] = useState(0);
  const bad = problemsIn(value);

  const look = () => {
    const el = ref.current;
    if (!el || el.selectionStart !== el.selectionEnd) return setPop(undefined);
    const f = filterQuery(el.value, el.selectionStart);
    const v = f ? undefined : variableQuery(el.value, el.selectionStart);
    const next: Pop | undefined = f ? { kind: "filter", ...f } : v && { kind: "var", ...v };
    if (next?.kind === pop?.kind && next?.start === pop?.start && next?.query === pop?.query) return;
    setPop(next);
    setSel(0);
    if (next) setXy(caretAt(el, next.start));
  };
  const apply = (r: { text: string; caret: number }) => {
    onChange(r.text);
    setPop(undefined);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(r.caret, r.caret);
    });
  };
  const caret = () => ref.current?.selectionStart ?? value.length;
  const put = (key: string, start: number, end: number) => apply(insertVariable(value, start, end, key));

  const options: Option[] = !pop
    ? []
    : pop.kind === "var"
      ? matchVariables(pop.query).map((v) => ({
          id: v.key,
          code: `{{${v.key}}}`,
          title: v.label,
          example: v.example,
          note: v.note,
          pick: () => put(v.key, pop.start, caret()),
        }))
      : matchFilters(pop.key ?? "", pop.query).map((f) => ({
          id: f.insert,
          code: `| ${f.insert}`,
          title: f.label,
          example: `${f.write} → ${f.result}`,
          note: f.note,
          pick: () => apply(insertFilter(value, pop.start, caret(), f.insert)),
        }));

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
            options[sel]?.pick();
          }
        }}
      />
      {pop && options.length > 0 && (
        <div
          className="absolute z-50 animate-in fade-in-0 zoom-in-95 overflow-hidden rounded-xl border border-border/80 bg-popover shadow-lg duration-100"
          style={{ top: xy.top, left: xy.left, width: POPUP_W }}
        >
          <div className="border-b border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
            {pop.kind === "var" ? (
              <>Chèn thông tin của khách. Ví dụ là khách {SAMPLE}</>
            ) : (
              <>
                Cách viết <code className="font-mono text-foreground">{`{{${pop.key}}}`}</code>. Ví dụ là khách {SAMPLE}
              </>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {options.map((o, i) => (
              <button
                key={o.id}
                ref={i === sel ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                className={cn("flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-1.5 text-left transition-colors", i === sel ? "bg-primary/10" : "hover:bg-muted/70")}
                // keep the caret in the box
                onMouseDown={(e) => (e.preventDefault(), o.pick())}
                onMouseEnter={() => setSel(i)}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <code className="shrink-0 font-mono text-xs font-semibold text-primary">{o.code}</code>
                  <span className="truncate text-xs font-medium text-foreground">{o.title}</span>
                </span>
                <span className="text-[11px] text-muted-foreground">
                  <span className="text-foreground">{o.example}</span>. {o.note}
                </span>
              </button>
            ))}
          </div>
          {pop.kind === "var" && (
            <div className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
              Mẹo: gõ <code className="font-mono text-foreground">|</code> sau tên biến để viết hoa, chỉ lấy tên gọi, xưng ông/bà…
            </div>
          )}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Chèn biến:</span>
        {VARIABLES.map((v) => (
          <button
            key={v.key}
            type="button"
            title={`${v.label}: ${v.example} (${v.note})`}
            className="rounded-md bg-muted/80 hover:bg-muted text-foreground border border-border/60 hover:border-border font-mono text-xs px-2 py-0.5 transition-colors cursor-pointer"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => put(v.key, ref.current?.selectionStart ?? value.length, ref.current?.selectionEnd ?? value.length)}
          >
            {`{{${v.key}}}`}
          </button>
        ))}
      </div>
      <details className="group mt-1.5">
        <summary className="w-fit cursor-pointer list-none text-xs font-medium text-primary select-none hover:underline [&::-webkit-details-marker]:hidden">
          <span className="inline-block transition-transform group-open:rotate-90">›</span> Muốn viết hoa tên, chỉ gọi tên, hay xưng ông/bà?
        </summary>
        <div className="mt-1.5 overflow-x-auto rounded-lg border border-border/60 text-xs">
          <p className="bg-muted/40 px-3 py-2 text-muted-foreground">
            Thêm dấu <code className="rounded bg-background px-1 font-mono text-foreground">|</code> và cách viết vào trong ngoặc của biến. Ví dụ với khách{" "}
            <b className="text-foreground">{SAMPLE}</b>. Bấm một dòng để thêm vào biến ngay trước con trỏ.
          </p>
          <table className="w-full border-collapse text-left">
            <thead className="text-[11px] text-muted-foreground">
              <tr className="border-y border-border/60">
                <th className="px-3 py-1.5 font-medium">Bạn viết</th>
                <th className="px-3 py-1.5 font-medium">Khách nhận được</th>
                <th className="px-3 py-1.5 font-medium">Dùng khi</th>
              </tr>
            </thead>
            {FILTER_GROUPS.map((g) => (
              <tbody key={g.title}>
                <tr>
                  <th colSpan={3} className="bg-muted/30 px-3 pt-2 pb-1 text-[11px] font-semibold text-foreground">
                    {g.title}
                  </th>
                </tr>
                {g.rows.map((r) => (
                  <tr
                    key={r.insert}
                    className="cursor-pointer transition-colors hover:bg-primary/5"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => apply(addFilter(value, ref.current?.selectionStart ?? value.length, r.insert, r.key))}
                  >
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <button type="button" className="font-mono text-primary" aria-label={`Thêm cách viết ${r.label}`}>
                        {r.write}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 font-semibold whitespace-nowrap text-foreground">{r.result}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            ))}
            <tbody>
              <tr className="border-t border-border/60">
                <td className="px-3 py-2 font-mono text-primary [overflow-wrap:anywhere]">{"{{pronoun | ông/bà | cap}} {{name | last}}"}</td>
                <td className="px-3 py-2 font-semibold whitespace-nowrap text-foreground">Bà Lan</td>
                <td className="px-3 py-2 text-muted-foreground">nối nhiều cách bằng thêm dấu |, viết theo thứ tự nào cũng được</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      {bad.map((b) => (
        <p key={b} className="mt-1 text-xs text-destructive">
          {b}
        </p>
      ))}
    </div>
  );
}

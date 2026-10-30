import type { CSSProperties, ReactNode } from "react";
import { RichText } from "@/app/chat/components/message/rich-text";
import { MENTION_ALL } from "@/shared/constants/text.constants";
import { formatLines, marksFrom } from "@/shared/utils/text.utils";
import type { Mention, TextStyle } from "@/shared/models/text.model";
import { cn } from "@/shared/utils/shadcn";

// PC's genStyle; codes come from other people's messages, so colors and sizes are checked before use
function segmentStyle(codes: string[]): CSSProperties {
  const css: CSSProperties = {};
  const lines: string[] = [];
  for (const c of codes) {
    if (c === "b") css.fontWeight = 600;
    else if (c === "i") css.fontStyle = "italic";
    else if (c === "u") lines.push("underline");
    else if (c === "s") lines.push("line-through");
    else if (/^c_[0-9a-f]{6}$/i.test(c)) css.color = `#${c.slice(2)}`;
    else if (/^f_\d+$/.test(c)) css.fontSize = Math.min(20, Math.max(12, Number(c.slice(2))));
  }
  if (lines.length) css.textDecorationLine = lines.join(" ");
  return css;
}

// A formatted message (Zalo's rtf content): styled runs, bullet / numbered lines, indents, mentions
export function Formatted({
  text,
  styles,
  mentions,
  me,
  onProfile,
}: {
  text: string;
  styles: TextStyle[] | null | undefined;
  mentions?: Mention[] | null;
  me?: string;
  onProfile?: (userId: string) => void;
}) {
  let number = 0;
  return (
    <div className="whitespace-pre-wrap wrap-anywhere">
      {formatLines(text, marksFrom(text, styles), mentions).map((line, i) => {
        const list = line.codes.find((c) => c.startsWith("lst_"));
        number = list === "lst_2" ? number + 1 : 0;
        const indent = Math.min(50, Number(line.codes.find((c) => c.startsWith("ind_"))?.slice(4)) || 0);
        const parts: ReactNode[] = line.segments.map((s, j) =>
          s.uid ? (
            <button
              key={j}
              style={segmentStyle(s.codes)}
              className={cn("font-medium text-primary", (s.uid === me || s.uid === MENTION_ALL) && "rounded bg-primary/15 px-0.5")}
              onClick={() => s.uid !== MENTION_ALL && onProfile?.(s.uid!)}
            >
              {s.text}
            </button>
          ) : (
            <span key={j} style={segmentStyle(s.codes)}>
              <RichText text={s.text} />
            </span>
          ),
        );
        return (
          <div key={i} style={{ marginLeft: indent + (list ? 4 : 0) }}>
            {list && <span className="mr-1 text-muted-foreground">{list === "lst_1" ? "•" : `${number}.`}</span>}
            {parts.length ? parts : <br />}
          </div>
        );
      })}
    </div>
  );
}

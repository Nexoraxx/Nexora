import type { CSSProperties } from "react";
import type { Sticker } from "@/shared/types";

// Thumb at rest, animation on hover; sprite strips step through their frames in CSS.
export function StickerCell({ sticker: s, onClick }: { sticker: Sticker; onClick: () => void }) {
  const style = {
    "--thumb": `url("${s.thumb}")`,
    ...(s.anim && { "--anim": `url("${s.anim.url}")`, "--frames": s.anim.frames, "--duration": `${s.anim.duration * s.anim.frames}ms` }),
  } as CSSProperties;
  return <button className={`sticker-cell ${s.anim ? (s.anim.frames > 1 ? "strip" : "animated") : ""}`} style={style} title={s.text} onClick={onClick} />;
}

import emoji from "@/shared/constants/emoji.json";
import { emojiPosition, emojiText, tokenize } from "@/shared/utils/text.utils";

// One cell of Zalo's emoji sprite. The text stays inside (transparent) so selecting and copying keeps it.
export function EmojiIcon({ code, text = emojiText(code) }: { code: string; text?: string }) {
  return (
    <span className="emoji" title={code} style={{ backgroundImage: `url(${emoji.sprite})`, backgroundPosition: emojiPosition(code) }}>
      {text}
    </span>
  );
}

export function RichText({ text }: { text: string }) {
  return <>{tokenize(text).map((t, i) => (typeof t === "string" ? t : <EmojiIcon key={i} code={t.emoji} text={t.text} />))}</>;
}

import { useState } from "react";
import emoji from "@/shared/constants/emoji.json";
import { emojiText } from "@/shared/utils/text.utils";
import { EmojiIcon } from "@/app/chat/components/message/rich-text";
import { AppleIcon, CarIcon, ClockIcon, FlagIcon, HeartIcon, LeafIcon, LightbulbIcon, SmileIcon, TrophyIcon, UserIcon, type LucideIcon } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

// tab icons by the section labels of emoji.json; a label not listed falls back to the smiley
const SECTION_ICONS: Record<string, LucideIcon> = {
  "Cảm xúc": SmileIcon,
  "Con người": UserIcon,
  "Tự nhiên": LeafIcon,
  "Đồ ăn": AppleIcon,
  "Hoạt động": TrophyIcon,
  "Du lịch": CarIcon,
  "Đồ vật": LightbulbIcon,
  "Biểu tượng": HeartIcon,
  "Quốc gia": FlagIcon,
};

// Zalo PC keeps the last 24 picked emoji per account, newest first, on this device only.
const MAX_RECENT = 24;

export function EmojiPicker({ accountId, onPick }: { accountId: string; onPick: (text: string) => void }) {
  const storageKey = `nexora:recent-emoji:${accountId}`;
  const [recent, setRecent] = useState<string[]>(() => JSON.parse(localStorage.getItem(storageKey) ?? "[]"));
  const [section, setSection] = useState(recent.length ? -1 : 0);
  const { sections, panel } = emoji;
  const keys = section === -1 ? recent : panel.slice(sections[section].start, sections[section + 1]?.start ?? panel.length);

  const pick = (key: string) => {
    onPick(emojiText(key));
    const next = [key, ...recent.filter((k) => k !== key)].slice(0, MAX_RECENT);
    setRecent(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  return (
    <div className="mb-2 border-b pb-2">
      <div className="text-xs text-muted-foreground">{section === -1 ? "Gần đây" : sections[section].label}</div>
      <div className="mt-1 grid h-50 grid-cols-[repeat(auto-fill,36px)] content-start overflow-y-auto">
        {keys.map((key) => (
          <Button key={key} variant="ghost" size="icon-lg" className="text-[22px]" onClick={() => pick(key)}>
            <EmojiIcon code={key} />
          </Button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-0.5 overflow-x-auto border-t pt-1.5">
        {recent.length > 0 && (
          <Button variant={section === -1 ? "secondary" : "ghost"} size="icon" title="Gần đây" onClick={() => setSection(-1)}>
            <ClockIcon />
          </Button>
        )}
        {sections.map((s, i) => {
          const Icon = SECTION_ICONS[s.label] ?? SmileIcon;
          return (
            <Button key={s.label} variant={section === i ? "secondary" : "ghost"} size="icon" title={s.label} onClick={() => setSection(i)}>
              <Icon />
            </Button>
          );
        })}
      </div>
    </div>
  );
}

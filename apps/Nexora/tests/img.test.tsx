import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StickerIcon } from "lucide-react";
import { Img } from "@/shared/components/img";

test("a remote image that can't load shows a placeholder tile with its icon; otherwise the image", () => {
  const broken = renderToStaticMarkup(<Img src={null} className="size-10" fallbackClassName="rounded" icon={StickerIcon} />);
  expect(broken).toContain('role="img"');
  expect(broken).toContain('aria-label="Không tải được"');
  expect(broken).toContain("size-10");
  expect(broken).toContain("rounded");
  expect(broken).toContain("lucide-sticker");
  expect(broken).not.toContain("<img");

  expect(renderToStaticMarkup(<Img src="https://x/a.jpg" className="size-10" />)).toContain('<img src="https://x/a.jpg" alt="" class="size-10"/>');
  // still loading ("") is an image without a source yet, not a failure
  expect(renderToStaticMarkup(<Img src="" />)).toBe('<img alt=""/>');
});

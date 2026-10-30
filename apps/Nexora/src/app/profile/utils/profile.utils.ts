// Zalo PC uploads a square JPEG and wants originals of at least 240×240 px, 7 KB … 30 MB; sent at most 1280 px.
// ponytail: center crop, no pan/zoom editor
export async function squareJpeg(file: File) {
  if (file.size < 7 * 1024 || file.size >= 30 * 1024 * 1024) throw new Error("Ảnh cần có dung lượng từ 7 KB đến 30 MB");
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error("Không đọc được ảnh");
  });
  const side = Math.min(bmp.width, bmp.height);
  if (side < 240) throw new Error("Ảnh cần có kích thước tối thiểu 240×240");
  const size = Math.min(side, 1280);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("Không xử lý được ảnh");
  return { blob, size, url: URL.createObjectURL(blob) };
}

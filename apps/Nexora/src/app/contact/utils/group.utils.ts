import { api } from "@/core/http/api";
import type { Image } from "@/app/contact/models/group.model";

// the file chooser, for one image
export const pickImage = (onPick: (file: File) => void) => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = () => input.files?.[0] && onPick(input.files[0]);
  input.click();
};

export const uploadGroupAvatar = (accountId: string, groupId: string, image: Image) => {
  const form = new FormData();
  form.append("file", image.blob, "avatar.jpg");
  form.append("width", String(image.size));
  form.append("height", String(image.size));
  return api(`/accounts/${accountId}/groups/${groupId}/avatar`, "PUT", form);
};

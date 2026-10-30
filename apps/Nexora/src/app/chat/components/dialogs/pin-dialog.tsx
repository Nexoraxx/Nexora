import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";

// four digits; the submit's error shows under the box
export function PinDialog({ title, description, note, onSubmit, onClose }: { title: string; description: string; note?: string; onSubmit: (pin: string) => Promise<unknown>; onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string>();
  const submit = (value: string) =>
    onSubmit(value).catch((e) => (setError(e.message), setPin("")));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[380px]">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <Input
          autoFocus
          inputMode="numeric"
          type="password"
          maxLength={4}
          className="mx-auto w-32 text-center text-lg tracking-[0.5em]"
          value={pin}
          onChange={(e) => {
            const value = e.target.value.replace(/\D/g, "").slice(0, 4);
            setPin(value);
            setError(undefined);
            if (value.length === 4) submit(value);
          }}
        />
        {error && <p className="text-center text-xs text-red-600">{error}</p>}
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </DialogContent>
    </Dialog>
  );
}

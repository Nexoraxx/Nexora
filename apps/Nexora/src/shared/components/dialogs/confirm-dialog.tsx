import type { Ask } from "@/shared/models/dialog.model";
import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";

export function Confirm({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ok = () => {
    setBusy(true);
    ask.run().then(onClose, (e) => (setError(e.message), setBusy(false)));
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[380px]">
        <DialogTitle>{ask.title}</DialogTitle>
        <DialogDescription>{ask.message}</DialogDescription>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Không
          </Button>
          <Button variant="destructive" disabled={busy} onClick={ok}>
            {ask.ok}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

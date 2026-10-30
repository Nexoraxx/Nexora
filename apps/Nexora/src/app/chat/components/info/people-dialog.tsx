import type { ReactNode } from "react";
import type { GroupPerson } from "@/shared/types";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/components/ui/dialog";

// a list of people with one or two actions each, in a dialog (approvals, blocked members)
export function PeopleDialog({
  title,
  description,
  empty,
  people,
  note,
  actions,
  onClose,
}: {
  title: string;
  description?: string;
  empty: string;
  people?: GroupPerson[];
  note?: string;
  actions: (p: GroupPerson) => ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[400px]">
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
        <div className="max-h-80 overflow-y-auto">
          {people && !people.length && <p className="py-2 text-xs text-muted-foreground">{empty}</p>}
          {people?.map((p) => (
            <div key={p.userId} className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted">
              <Avatar src={p.avatar} name={p.name} size={36} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {actions(p)}
            </div>
          ))}
        </div>
        {note && <p className="text-xs whitespace-pre-line text-red-600">{note}</p>}
      </DialogContent>
    </Dialog>
  );
}

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";

export function Choice({ value, options, onChange }: { value: number | undefined; options: [number, string][]; onChange: (v: number) => void }) {
  return (
    <Select value={value === undefined ? undefined : String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="w-60">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => (
          <SelectItem key={v} value={String(v)}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

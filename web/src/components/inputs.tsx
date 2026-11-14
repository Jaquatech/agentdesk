import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const BLANK = "__blank";

/**
 * A key or token field the browser does not treat as a password: no saved passwords filled in, no
 * "save password?" prompt. The value is masked with CSS instead of type=password.
 */
export function SecretInput({ value, onChange, placeholder, id }: { id?: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Input
      id={id}
      type="text" className="masked font-mono" value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off" spellCheck={false} name="agentdesk-secret-value"
      data-1p-ignore="true" data-lpignore="true" data-bwignore="true" data-form-type="other"
    />
  );
}

/** Plain text field the browser should never autofill (URLs, model names, paths). */
export function NoFillInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return <Input className={cn(className)} {...props} autoComplete="off" spellCheck={false} data-1p-ignore="true" data-lpignore="true" data-bwignore="true" data-form-type="other" />;
}

/** Dropdown that allows a blank value (mapped internally; Radix rejects ""). */
export function Choice({ id, value, onValueChange, options, placeholder, disabled, className, size, title, label }: {
  id?: string;
  /** Accessible name when no visible label points at this control. */
  label?: string;
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
  title?: string;
}) {
  const current = value === "" ? BLANK : value;
  const known = options.some((o) => (o.value === "" ? BLANK : o.value) === current);
  return (
    <Select value={known ? current : undefined} onValueChange={(v) => onValueChange(v === BLANK ? "" : v)} disabled={disabled}>
      <SelectTrigger id={id} size={size} title={title} aria-label={label} className={cn("w-full min-w-0", className)}>
        <SelectValue placeholder={placeholder ?? "Choose…"} />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectGroup>
          {options.map((o) => {
            const v = o.value === "" ? BLANK : o.value;
            return <SelectItem key={v} value={v}>{o.label}</SelectItem>;
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/**
 * Model choice: a dropdown of the provider's models once they are known, with "Other…" for a model the
 * list does not show. Empty value = the provider's default (when allowDefault).
 */
export function ModelPicker({ id, models, value, onChange, allowDefault, defaultLabel }: {
  id?: string; models: string[]; value: string; onChange: (v: string) => void; allowDefault?: boolean; defaultLabel?: string;
}) {
  const known = !value || models.includes(value);
  const [custom, setCustom] = useState(!known && models.length > 0);
  if (!models.length || custom) {
    return (
      <div className="flex items-center gap-2">
        <NoFillInput id={id} className="font-mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder={allowDefault ? defaultLabel : "model id"} />
        {models.length > 0 && <Button type="button" variant="outline" size="sm" onClick={() => { setCustom(false); onChange(""); }}>List</Button>}
      </div>
    );
  }
  const options = [
    ...(allowDefault ? [{ value: "", label: defaultLabel ?? "Provider default" }] : !value ? [{ value: "", label: "Choose…" }] : []),
    ...sortModels(models).map((m) => ({ value: m, label: m })),
    { value: "__other", label: "Other…" },
  ];
  return (
    <Choice id={id} label="Model" className="font-mono" value={value} options={options} onValueChange={(v) => {
      if (v === "__other") { setCustom(true); return; }
      onChange(v);
    }} />
  );
}

/** Newest-looking names first within a family; dated snapshots after the aliases. */
function sortModels(models: string[]) {
  return [...new Set(models)].sort((a, b) => Number(/\d{8}/.test(a)) - Number(/\d{8}/.test(b)) || a.localeCompare(b));
}

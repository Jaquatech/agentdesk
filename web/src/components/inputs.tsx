import { useState } from "react";

/**
 * A key or token field the browser does not treat as a password: no saved passwords filled in, no
 * "save password?" prompt. The value is masked with CSS instead of type=password.
 */
export function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text" className="masked mono" value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off" spellCheck={false} name="agentdesk-secret-value"
      data-1p-ignore="true" data-lpignore="true" data-bwignore="true" data-form-type="other"
    />
  );
}

/** Plain text field the browser should never autofill (URLs, model names, paths). */
export function NoFillInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} autoComplete="off" spellCheck={false} data-1p-ignore="true" data-lpignore="true" data-bwignore="true" data-form-type="other" />;
}

/**
 * Model choice: a dropdown of the provider's models once they are known, with "Other…" for a model the
 * list does not show. Empty value = the provider's default (when allowDefault).
 */
export function ModelPicker({ models, value, onChange, allowDefault, defaultLabel }: {
  models: string[]; value: string; onChange: (v: string) => void; allowDefault?: boolean; defaultLabel?: string;
}) {
  const known = !value || models.includes(value);
  const [custom, setCustom] = useState(!known && models.length > 0);
  if (!models.length || custom) {
    return (
      <div className="row" style={{ gap: 6 }}>
        <NoFillInput className="mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder={allowDefault ? defaultLabel : "model id"} />
        {models.length > 0 && <button type="button" className="btn small" onClick={() => { setCustom(false); onChange(""); }}>List</button>}
      </div>
    );
  }
  return (
    <select className="mono" value={value} onChange={(e) => {
      if (e.target.value === "__other") { setCustom(true); return; }
      onChange(e.target.value);
    }}>
      {allowDefault ? <option value="">{defaultLabel ?? "Provider default"}</option> : !value && <option value="">Choose…</option>}
      {sortModels(models).map((m) => <option key={m} value={m}>{m}</option>)}
      <option value="__other">Other…</option>
    </select>
  );
}

/** Newest-looking names first within a family; dated snapshots after the aliases. */
function sortModels(models: string[]) {
  return [...new Set(models)].sort((a, b) => Number(/\d{8}/.test(a)) - Number(/\d{8}/.test(b)) || a.localeCompare(b));
}

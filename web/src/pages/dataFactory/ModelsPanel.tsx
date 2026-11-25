import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { del, get, post, put, useLoad, type Provider } from "../../api.ts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Field } from "../../components/ui.tsx";
import { Choice, NoFillInput } from "../../components/inputs.tsx";
import { capabilityLabel, priceLine, usableProviders, type PriceStatus } from "./models.ts";

type ModelRow = {
  id: number; provider_id: number; provider_name: string; provider_kind: string; model: string;
  for_test: number; for_judge: number; note: string; family: string;
  price_status: PriceStatus; price_in: number | null; price_out: number | null; cache_read: number | null; cache_write: number | null;
};
type Caps = { vision: boolean | null; tools: boolean | null; thinking?: boolean | null; source: string };
type PriceRow = { model: string; price_in: number; price_out: number; cache_read: number; cache_write: number; long_threshold: number; long_multiplier: number; note: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Models of one project: the narrow list, the add form or the open model. */
export function ModelsPanel({ projectId }: { projectId: number }) {
  const list = useLoad<ModelRow[]>(`/api/projects/${projectId}/models`);
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const rows = list.data ?? [];
  const open = rows.find((m) => m.id === openId) ?? null;
  const showAdd = adding;

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(16rem,25%)_minmax(0,1fr)] lg:grid-rows-1">
      <nav aria-label="Models" className="max-h-60 min-h-0 overflow-auto border-b lg:max-h-none lg:border-b-0 lg:border-r">
        <div className="border-b p-2">
          <Button size="sm" variant="outline" className="w-full" onClick={() => { setAdding(true); setOpenId(null); }}><Plus /> Add model</Button>
        </div>
        {rows.length > 0 && (
          <ul className="flex flex-col">
            {rows.map((m) => (
              <li key={m.id} className={cn("border-b hover:bg-accent/50", !showAdd && open?.id === m.id && "bg-accent")} aria-current={!showAdd && open?.id === m.id ? "true" : undefined}>
                <button type="button" className="flex w-full min-w-0 flex-col gap-0.5 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset" onClick={() => { setAdding(false); setOpenId(m.id); }}>
                  <span className="truncate text-sm font-medium" title={m.model}>{m.model}</span>
                  <span className="truncate text-xs text-muted-foreground">{m.provider_name} - {m.family}</span>
                  <span className="flex gap-1">
                    {m.for_test === 1 && <Badge variant="secondary">test</Badge>}
                    {m.for_judge === 1 && <Badge variant="secondary">judge</Badge>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-auto p-6">
        {list.error && <p className="text-sm text-destructive">{list.error}</p>}
        {rows.length === 0 && list.data && !showAdd && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">No models yet.</p>
            <Button size="sm" onClick={() => setAdding(true)}><Plus /> Add model</Button>
          </div>
        )}
        {showAdd && (
          <AddModel projectId={projectId} onAdded={(id) => { setAdding(false); setOpenId(id); list.reload(); }} />
        )}
        {!showAdd && open && (
          <ModelView key={open.id} model={open} onChanged={list.reload} onRemoved={() => { setOpenId(null); list.reload(); }} />
        )}
      </div>
    </div>
  );
}

function AddModel({ projectId, onAdded }: { projectId: number; onAdded: (id: number) => void }) {
  const providers = useLoad<{ providers: Provider[] }>("/api/providers");
  const usable = usableProviders(providers.data);
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [forTest, setForTest] = useState(true);
  const [forJudge, setForJudge] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The chosen provider, or the first usable one until the user picks another.
  const provider = usable.find((p) => String(p.id) === providerId) ?? usable[0];
  const [typed, setTyped] = useState(false);
  const modelValue = typed ? model : (provider?.default_model ?? "");

  const save = async () => {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ id: number }>(`/api/projects/${projectId}/models`, { provider_id: provider.id, model: modelValue, for_test: forTest, for_judge: forJudge, note });
      setModel(""); setTyped(false); setForTest(true); setForJudge(false); setNote("");
      onAdded(r.id);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (providers.data && usable.length === 0) {
    return <p className="text-sm text-muted-foreground">A provider must be added first. Add one under <a className="underline" href="#/providers">Providers &amp; keys</a>.</p>;
  }
  return (
    <Card className="max-w-xl">
      <CardHeader><CardTitle>Add model</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field label="Provider">
          <Choice value={provider ? String(provider.id) : ""} onValueChange={(v) => { setProviderId(v); setTyped(false); }}
            options={usable.map((p) => ({ value: String(p.id), label: `${p.name} (${p.kind})` }))} />
        </Field>
        <Field label="Model id">
          <NoFillInput value={modelValue} onChange={(e) => { setModel(e.target.value); setTyped(true); }} />
        </Field>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={forTest} onCheckedChange={(v) => setForTest(v === true)} /> Test with this model</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={forJudge} onCheckedChange={(v) => setForJudge(v === true)} /> Judge with this model</label>
        </div>
        <Field label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div><Button onClick={() => void save()} disabled={busy || !provider || !modelValue.trim()}>Save</Button></div>
      </CardContent>
    </Card>
  );
}

function ModelView({ model: m, onChanged, onRemoved }: { model: ModelRow; onChanged: () => void; onRemoved: () => void }) {
  const [forTest, setForTest] = useState(m.for_test === 1);
  const [forJudge, setForJudge] = useState(m.for_judge === 1);
  const [note, setNote] = useState(m.note);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [caps, setCaps] = useState<Caps | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    get<Caps>(`/api/providers/${m.provider_id}/capabilities?model=${encodeURIComponent(m.model)}`)
      .then((c) => { if (live) setCaps(c); })
      .catch(() => { if (live) setCaps(null); });
    return () => { live = false; };
  }, [m.provider_id, m.model]);

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      await put(`/api/eval-models/${m.id}`, { for_test: forTest, for_judge: forJudge, note });
      setSaved(true);
      onChanged();
    } catch (e) {
      setError(message(e));
    }
  };
  const remove = async () => {
    try {
      await del(`/api/eval-models/${m.id}`);
      onRemoved();
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <>
      <Card className="max-w-2xl">
        <CardHeader><CardTitle className="break-all">{m.model}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Provider</dt><dd>{m.provider_name}</dd>
            <dt className="text-muted-foreground">Family</dt><dd>{m.family}</dd>
          </dl>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={forTest} onCheckedChange={(v) => { setForTest(v === true); setSaved(false); }} /> Test with this model</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={forJudge} onCheckedChange={(v) => { setForJudge(v === true); setSaved(false); }} /> Judge with this model</label>
          </div>
          <Field label="Note"><Textarea value={note} onChange={(e) => { setNote(e.target.value); setSaved(false); }} rows={2} /></Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {saved && <p role="status" className="text-sm text-muted-foreground">Saved.</p>}
          <div className="flex gap-2">
            <Button onClick={() => void save()}>Save</Button>
            <Button variant="destructive" onClick={() => setConfirm(true)}>Remove</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader><CardTitle>Capabilities</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {caps === undefined ? <p className="text-muted-foreground">Loading…</p> : (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">Images</dt><dd>{capabilityLabel(caps?.vision)}</dd>
                <dt className="text-muted-foreground">Tool calls</dt><dd>{capabilityLabel(caps?.tools)}</dd>
                <dt className="text-muted-foreground">Thinking</dt><dd>{capabilityLabel(caps?.thinking)}</dd>
              </dl>
              {caps?.source && <p className="text-xs text-muted-foreground">{caps.source}</p>}
            </>
          )}
        </CardContent>
      </Card>

      <PriceCard model={m} onSaved={onChanged} />

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove model?</AlertDialogTitle>
            <AlertDialogDescription>{`"${m.model}" is taken off this project's list. Its price stays.`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { setConfirm(false); void remove(); }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PriceCard({ model: m, onSaved }: { model: ModelRow; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Price</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {m.price_status === "priced" && !editing && (
          <>
            <p>{priceLine(m)}</p>
            <p className="text-xs text-muted-foreground">Prices are shared with the Usage page.</p>
            <div><Button variant="link" size="sm" className="h-auto p-0" onClick={() => setEditing(true)}>Edit</Button></div>
          </>
        )}
        {m.price_status === "free" && <p>Free (local model).</p>}
        {m.price_status === "missing" && !editing && <p>No price set. A real run needs one.</p>}
        {(editing || m.price_status === "missing") && (
          <PriceForm model={m} existing={m.price_status === "priced"} onSaved={() => { setEditing(false); onSaved(); }} onCancel={editing ? () => setEditing(false) : undefined} />
        )}
      </CardContent>
    </Card>
  );
}

function PriceForm({ model: m, existing, onSaved, onCancel }: { model: ModelRow; existing: boolean; onSaved: () => void; onCancel?: () => void }) {
  const [priceIn, setPriceIn] = useState(existing && m.price_in !== null ? String(m.price_in) : "");
  const [priceOut, setPriceOut] = useState(existing && m.price_out !== null ? String(m.price_out) : "");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const pin = Number(priceIn);
    const pout = Number(priceOut);
    if (priceIn.trim() === "" || priceOut.trim() === "" || !Number.isFinite(pin) || !Number.isFinite(pout) || pin < 0 || pout < 0) {
      setError("Give the input and output price as numbers of 0 or more.");
      return;
    }
    try {
      // An existing price keeps its other fields (cache prices, long-prompt tier, note).
      let rest: Partial<PriceRow> = {};
      if (existing) {
        const all = await get<PriceRow[]>("/api/model-prices");
        rest = all.find((p) => p.model === m.model) ?? { cache_read: m.cache_read ?? 0, cache_write: m.cache_write ?? 0 };
      }
      await put("/api/model-prices", { ...rest, model: m.model, price_in: pin, price_out: pout });
      onSaved();
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Input price per Mtok ($)"><NoFillInput inputMode="decimal" value={priceIn} onChange={(e) => setPriceIn(e.target.value)} /></Field>
        <Field label="Output price per Mtok ($)"><NoFillInput inputMode="decimal" value={priceOut} onChange={(e) => setPriceOut(e.target.value)} /></Field>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()}>Save price</Button>
        {onCancel && <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  );
}

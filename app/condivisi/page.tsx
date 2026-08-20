"use client";
// FILE CONDIVISI — scambio file tra Dimitar/il salone e Marco (bucket privato "condivisi").
// Upload multiplo con barra di avanzamento, download con link firmato, eliminazione.
import { useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { useOrg } from "@/lib/useOrg";
import { supabase } from "@/lib/supabase";

const SUPABASE_URL = "https://ignlxrdfhtjnpthlzpeq.supabase.co";
const KEY = "sb_publishable_TL40C5EqF-Nnk_qAn5KzVQ_4zWbkCFd";

type Up = { name: string; pct: number; state: "up" | "ok" | "err"; msg?: string };

const fmtSize = (b: number) => b > 1e9 ? (b / 1e9).toFixed(2) + " GB" : b > 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
const clean = (n: string) => n.normalize("NFKD").replace(/[^\w.\-]+/g, "_");

export default function Condivisi() {
  const ctx = useOrg();
  const [files, setFiles] = useState<any[]>([]);
  const [ups, setUps] = useState<Up[]>([]);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const { data } = await supabase.storage.from("condivisi").list("", { limit: 200, sortBy: { column: "created_at", order: "desc" } });
    setFiles((data ?? []).filter((f: any) => f.name !== ".emptyFolderPlaceholder"));
  };
  useEffect(() => { if (ctx.orgId) load(); }, [ctx.orgId]);

  // upload via XHR per avere la barra di avanzamento reale (i file possono essere grandi)
  const uploadOne = (file: File): Promise<void> => new Promise(async resolve => {
    const path = clean(file.name);
    const { data: { session } } = await supabase.auth.getSession();
    const xhr = new XMLHttpRequest();
    xhr.open("POST", SUPABASE_URL + "/storage/v1/object/condivisi/" + encodeURIComponent(path));
    xhr.setRequestHeader("Authorization", "Bearer " + (session?.access_token ?? ""));
    xhr.setRequestHeader("apikey", KEY);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) setUps(u => u.map(x => x.name === file.name ? { ...x, pct: Math.round(e.loaded / e.total * 100) } : x));
    };
    xhr.onload = () => {
      const ok = xhr.status >= 200 && xhr.status < 300;
      let msg = "";
      if (!ok) { try { msg = JSON.parse(xhr.responseText).message ?? "HTTP " + xhr.status; } catch { msg = "HTTP " + xhr.status; } }
      if (msg.toLowerCase().includes("exceeded") || msg.toLowerCase().includes("maximum")) msg = "file oltre il limite attuale del progetto — vedi nota sotto";
      setUps(u => u.map(x => x.name === file.name ? { ...x, state: ok ? "ok" : "err", pct: 100, msg } : x));
      resolve();
    };
    xhr.onerror = () => { setUps(u => u.map(x => x.name === file.name ? { ...x, state: "err", msg: "errore di rete" } : x)); resolve(); };
    xhr.send(file);
  });

  const doUpload = async (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (!arr.length) return;
    setUps(prev => [...prev.filter(p => p.state === "up"), ...arr.map(f => ({ name: f.name, pct: 0, state: "up" as const }))]);
    for (const f of arr) await uploadOne(f); // sequenziale: più stabile per file grandi
    load();
  };

  const download = async (name: string) => {
    const { data } = await supabase.storage.from("condivisi").createSignedUrl(name, 3600, { download: true });
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };
  const remove = async (name: string) => {
    if (!window.confirm("Eliminare definitivamente " + name + "?")) return;
    await supabase.storage.from("condivisi").remove([name]);
    load();
  };

  return (
    <Shell ctx={ctx}>
      <div className="page-head">
        <div>
          <h1>File condivisi</h1>
          <p className="sub">spazio privato del salone per scambiare file anche pesanti — visibile solo agli utenti GPS autenticati</p>
        </div>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); doUpload(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className="card"
        style={{ textAlign: "center", padding: 44, borderStyle: "dashed", borderWidth: 2, cursor: "pointer", background: drag ? "#eef3ee" : undefined, borderColor: drag ? "#1e5c38" : undefined }}
      >
        <p className="serif" style={{ fontSize: 20, margin: 0 }}>📤 Trascina qui i file, o tocca per sceglierli</p>
        <p className="sub">più file insieme, qualunque formato — video, export, PDF, cartelle zippate</p>
        <input ref={inputRef} type="file" multiple style={{ display: "none" }} onChange={e => { if (e.target.files) doUpload(e.target.files); e.target.value = ""; }} />
      </div>

      {ups.length > 0 && (
        <div className="card section">
          {ups.map((u, i) => (
            <div key={i} style={{ margin: "8px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
                <span>{u.state === "ok" ? "✅" : u.state === "err" ? "⚠️" : "⬆️"} {u.name}</span>
                <b>{u.state === "err" ? (u.msg ?? "errore") : u.pct + "%"}</b>
              </div>
              <div className="bar-track"><div className="bar-fill" style={{ width: u.pct + "%", background: u.state === "err" ? "#b3402a" : u.state === "ok" ? "#1e7a4f" : "var(--gold)" }} /></div>
            </div>
          ))}
        </div>
      )}

      <div className="section">
        <div className="section-title"><h2>Nel cassetto ({files.length})</h2><span className="sub">i link di download durano 1 ora e valgono solo per chi è dentro GPS</span></div>
        {files.length === 0 && <p className="sub">Nessun file ancora. Il primo che carichi comparirà qui per tutti gli utenti del salone.</p>}
        {files.map(f => (
          <div className="card row" key={f.name} style={{ marginBottom: 8 }}>
            <span>
              📄 <b>{f.name}</b>
              <span className="sub" style={{ marginLeft: 8 }}>
                {f.metadata?.size ? fmtSize(Number(f.metadata.size)) : ""} · {f.created_at ? new Date(f.created_at).toLocaleString("it-IT") : ""}
              </span>
            </span>
            <span style={{ display: "flex", gap: 6 }}>
              <button className="btn sm" onClick={() => download(f.name)}>⬇ Scarica</button>
              {ctx.role !== "operatore" && <button className="btn sm secondary" onClick={() => remove(f.name)}>✕</button>}
            </span>
          </div>
        ))}
      </div>
      <p className="sub" style={{ marginTop: 10 }}>Nota: il limite per singolo file dipende dal piano Supabase del progetto (di base 50 MB). Per file più grandi — video lunghi, backup — si alza in un minuto da Supabase Studio → Storage → Settings, e questa pagina li gestirà senza modifiche.</p>
    </Shell>
  );
}

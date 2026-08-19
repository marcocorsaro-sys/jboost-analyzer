"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ t: "err" | "ok"; m: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { setMsg({ t: "err", m: "Accesso non riuscito: " + error.message }); return; }
    router.replace("/");
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={signIn}>
        <div className="brand" style={{ fontSize: 30, textAlign: "center", color: "#b48f1d" }}>The Gentlemen Inn</div>
        <h1 style={{ textAlign: "center", marginTop: 6 }}>GPS</h1>
        <p className="sub" style={{ textAlign: "center", marginBottom: 22 }}>Guarda. Prevedi. Scegli.</p>
        <label className="fld">Email</label>
        <input style={{ width: "100%", marginBottom: 14 }} type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        <label className="fld">Password</label>
        <input style={{ width: "100%", marginBottom: 20 }} type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        {msg && <div className={"alert" + (msg.t === "err" ? " err" : "")}>{msg.m}</div>}
        <button className="btn" style={{ width: "100%" }} disabled={busy}>{busy ? "Attendi…" : "Entra"}</button>
        <p className="sub" style={{ textAlign: "center", marginTop: 16 }}>Accesso riservato ai saloni del pilota GPS.</p>
      </form>
    </div>
  );
}

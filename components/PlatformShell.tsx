"use client";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { OrgCtx } from "@/lib/useOrg";

// Shell del livello PIATTAFORMA GPS: navigazione distinta da quella del singolo salone.
export default function PlatformShell({ ctx, children }: { ctx: OrgCtx; children: React.ReactNode }) {
  const router = useRouter();
  if (ctx.loading) return <div className="page"><p className="sub">Caricamento…</p></div>;
  return (
    <>
      <div className="topbar" style={{ background: "#0a1f18", borderBottom: "2px solid #c9a227" }}>
        <span className="brand" style={{ fontSize: 22 }}>GPS</span>
        <span style={{ fontSize: 12.5, letterSpacing: ".14em", textTransform: "uppercase", color: "#b9ad90" }}>Growth Performance System · Piattaforma</span>
        <a href="/saloni" className="nav-link" style={{ marginLeft: 16 }}>Saloni</a>
        <a href="/lead" className="nav-link">Lead</a>
        <span className="spacer" />
        <span className="userbox">{ctx.userEmail}<br />admin GPS</span>
        <button className="btn-ghost" style={{ marginLeft: 12 }} onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}>Esci</button>
      </div>
      <div className="page">
        {children}
        <div className="footer">
          <span>♛ GPS — Piattaforma pilota</span>
          <span>Guarda. Prevedi. Scegli.</span>
        </div>
      </div>
    </>
  );
}

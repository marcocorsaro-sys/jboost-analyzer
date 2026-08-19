"use client";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { OrgCtx, exitToPlatform } from "@/lib/useOrg";

// Shell del WORKSPACE SALONE: navigazione del singolo cliente GPS.
const NAV = [
  { href: "/reception", label: "Reception" },
  { href: "/agenda", label: "Agenda" },
  { href: "/clienti", label: "Clienti" },
  { href: "/catalogo", label: "Catalogo" },
  { href: "/", label: "Dashboard" },
  { href: "/team", label: "Team" },
  { href: "/registro", label: "Registro" },
  { href: "/pianificazione", label: "Pianificazione" },
  { href: "/comunicazioni", label: "Comunicazioni" },
  { href: "/import", label: "Import" },
  { href: "/operatore", label: "Operatore" },
];

export default function Shell({ ctx, children }: { ctx: OrgCtx; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();

  // Un admin senza salone selezionato appartiene al livello piattaforma
  useEffect(() => {
    if (!ctx.loading && !ctx.orgId && ctx.isAdmin) router.replace("/saloni");
  }, [ctx.loading, ctx.orgId, ctx.isAdmin, router]);

  // §1 spec Dimitar: un OPERATORE entra e vede SOLO la sua schermata giornaliera —
  // mai la dashboard gestionale. Qualunque altra rotta lo riporta a /operatore.
  useEffect(() => {
    if (!ctx.loading && ctx.orgId && ctx.role === "operatore" && path !== "/operatore") router.replace("/operatore");
  }, [ctx.loading, ctx.orgId, ctx.role, path, router]);

  if (ctx.loading) return <div className="page"><p className="sub">Caricamento…</p></div>;
  if (!ctx.orgId) {
    if (ctx.isAdmin) return <div className="page"><p className="sub">Apro la piattaforma GPS…</p></div>;
    return (
      <div className="page">
        <h1>Nessun salone associato</h1>
        <p className="sub">Il tuo account non è ancora collegato a un salone GPS. Chiedi al consulente GPS di invitarti.</p>
        <button className="btn secondary" onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}>Esci</button>
      </div>
    );
  }
  return (
    <>
      <div className="topbar">
        {ctx.isAdmin && (
          <button className="btn-ghost" style={{ marginRight: 10, fontSize: 12.5 }} onClick={exitToPlatform} title="Torna alla piattaforma GPS">← GPS</button>
        )}
        <span className="brand" title="Workspace salone">{ctx.orgName}</span>
        {(ctx.role === "operatore" ? NAV.filter(n => n.href === "/operatore") : NAV).map(n => (
          <Link key={n.href} href={n.href} className={"nav-link" + (path === n.href ? " active" : "")}>{n.label}</Link>
        ))}
        <span className="spacer" />
        <span className="userbox">{ctx.userEmail}<br />{ctx.role}</span>
        <button className="btn-ghost" style={{ marginLeft: 8, fontSize: 12 }} title="Cambia la tua password" onClick={async () => {
          const p = window.prompt("Nuova password (minimo 8 caratteri):");
          if (!p) return;
          const { data, error } = await supabase.rpc("change_my_password", { p_new: p });
          window.alert(error ? "Errore: " + error.message : String(data) === "ok" ? "Password aggiornata." : String(data));
        }}>🔑</button>
        <button className="btn-ghost" style={{ marginLeft: 6 }} onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}>Esci</button>
      </div>
      <div className="page">
        {children}
        <div className="footer">
          <span>♛ {ctx.orgName} — powered by GPS v1.2</span>
          <span>Growth Performance System</span>
        </div>
      </div>
    </>
  );
}

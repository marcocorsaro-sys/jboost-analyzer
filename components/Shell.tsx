"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { OrgCtx, switchOrg } from "@/lib/useOrg";

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
];

export default function Shell({ ctx, children }: { ctx: OrgCtx; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  if (ctx.loading) return <div className="page"><p className="sub">Caricamento…</p></div>;
  if (!ctx.orgId) return (
    <div className="page">
      <h1>Nessun salone associato</h1>
      <p className="sub">Il tuo account non è ancora collegato a un salone GPS. Chiedi al consulente GPS di invitarti.</p>
      <button className="btn secondary" onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}>Esci</button>
    </div>
  );
  return (
    <>
      <div className="topbar">
        <span className="brand">GPS</span>
        {NAV.map(n => (
          <Link key={n.href} href={n.href} className={"nav-link" + (path === n.href ? " active" : "")}>{n.label}</Link>
        ))}
        {ctx.isAdmin && <Link href="/saloni" className={"nav-link" + (path === "/saloni" ? " active" : "")} style={{ color: "#d9bc5e" }}>♛ Saloni</Link>}
        <span className="spacer" />
        {ctx.orgs.length > 1 ? (
          <select value={ctx.orgId} onChange={e => switchOrg(e.target.value)} style={{ background: "#1a4636", color: "#ece6d2", border: "1px solid #2c5a47", padding: "6px 8px" }}>
            {ctx.orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        ) : (
          <span className="userbox"><b>{ctx.orgName}</b></span>
        )}
        <span className="userbox" style={{ marginLeft: 10 }}>{ctx.userEmail}<br />{ctx.role}</span>
        <button className="btn-ghost" style={{ marginLeft: 12 }} onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}>Esci</button>
      </div>
      <div className="page">
        {children}
        <div className="footer">
          <span>♛ {ctx.orgName} — GPS v1.1 (pilota)</span>
          <span>Growth Performance System</span>
        </div>
      </div>
    </>
  );
}

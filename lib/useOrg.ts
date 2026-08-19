"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "./supabase";

export type OrgOption = { id: string; name: string; role: string };
export type OrgCtx = {
  loading: boolean;
  userEmail: string | null;
  userId: string | null;
  orgId: string | null;
  orgName: string | null;
  role: string | null;
  isAdmin: boolean;
  orgs: OrgOption[];
};

// Entra in un salone (dal livello piattaforma) e apri il suo workspace
export function enterSalon(orgId: string, dest: string = "/") {
  try { localStorage.setItem("gps_org", orgId); } catch {}
  window.location.href = dest;
}

// Torna al livello piattaforma GPS (solo admin)
export function exitToPlatform() {
  try { localStorage.removeItem("gps_org"); } catch {}
  window.location.href = "/saloni";
}

export function useOrg(): OrgCtx {
  const router = useRouter();
  const [ctx, setCtx] = useState<OrgCtx>({ loading: true, userEmail: null, userId: null, orgId: null, orgName: null, role: null, isAdmin: false, orgs: [] });

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }

      const { data: adminRow } = await supabase.from("gps_admins").select("user_id").eq("user_id", session.user.id).maybeSingle();
      const isAdmin = !!adminRow;

      const { data: mems } = await supabase
        .from("memberships")
        .select("role, organization_id, organizations(name)")
        .eq("user_id", session.user.id);

      let orgs: OrgOption[] = (mems ?? []).map((m: any) => ({ id: m.organization_id, name: m.organizations?.name ?? "Salone", role: m.role }));

      if (isAdmin) {
        const { data: allOrgs } = await supabase.from("organizations").select("id,name").order("name");
        for (const o of allOrgs ?? []) {
          if (!orgs.find(x => x.id === o.id)) orgs.push({ id: o.id, name: o.name, role: "consulente" });
        }
      }

      let selected: string | null = null;
      try { selected = localStorage.getItem("gps_org"); } catch {}
      // Non-admin: entra dritto nel proprio salone. Admin: entra solo se ha scelto un salone dalla piattaforma.
      const chosen = orgs.find(o => o.id === selected) ?? (isAdmin ? null : (orgs[0] ?? null));

      if (!mounted) return;
      setCtx({
        loading: false,
        userEmail: session.user.email ?? null,
        userId: session.user.id,
        orgId: chosen?.id ?? null,
        orgName: chosen?.name ?? null,
        role: chosen?.role ?? null,
        isAdmin,
        orgs,
      });
    })();
    return () => { mounted = false; };
  }, [router]);

  return ctx;
}

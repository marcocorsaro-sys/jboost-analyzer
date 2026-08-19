"use client";
import { supabase } from "./supabase";

export type ClientRow = {
  id: string; full_name: string; segment: string | null; at_risk: boolean;
  is_anonymous: boolean; visits_count: number; total_value: number;
  avg_ticket: number | null; last_visit: string | null; recency_days: number | null;
  phone: string | null; email: string | null; privacy_consent: boolean | null;
  duplicate_group: string | null; data_quality: string; birth_date: string | null;
};

const COLS = "id,full_name,segment,at_risk,is_anonymous,visits_count,total_value,avg_ticket,last_visit,recency_days,phone,email,privacy_consent,duplicate_group,data_quality,birth_date";

export async function fetchAllClients(orgId: string): Promise<ClientRow[]> {
  const out: ClientRow[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("clients").select(COLS)
      .eq("organization_id", orgId)
      .order("total_value", { ascending: false })
      .range(from, from + page - 1);
    if (error) throw error;
    out.push(...(data as any));
    if (!data || data.length < page) break;
  }
  return out;
}

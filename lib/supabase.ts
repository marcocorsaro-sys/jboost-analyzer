"use client";
import { createClient } from "@supabase/supabase-js";

// Chiave publishable: pensata per essere esposta lato client (accesso governato da RLS).
const SUPABASE_URL = "https://ignlxrdfhtjnpthlzpeq.supabase.co";
const SUPABASE_KEY = "sb_publishable_TL40C5EqF-Nnk_qAn5KzVQ_4zWbkCFd";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

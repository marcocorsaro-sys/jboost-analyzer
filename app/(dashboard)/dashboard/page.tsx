import { redirect } from 'next/navigation'

/**
 * Legacy /dashboard URL → new /home.
 *
 * The visible dashboard KPI counters (active clients, completed analyses,
 * average score) plus the "top 6 clients" list used to live here. In
 * Horizon 1 Stage 2 the canonical landing page became /home, which folds
 * those KPIs into a richer activity feed. This file now exists only as a
 * backwards-compat redirect so old bookmarks still land somewhere useful.
 */
export default function DashboardIndexPage() {
  redirect('/home')
}

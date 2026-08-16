import { redirect } from 'next/navigation'

// Post-login landing = the Bibbia Home (UX-UI 04, "Navigation & Screens").
// The V1 metrics dashboard stays deployed at /dashboard (legacy, parked).
export default function Home() {
  redirect('/home')
}

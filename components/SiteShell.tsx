"use client";
// SITO VETRINA GPS — layout condiviso (identità blu: #0D47A1 / navy #0A1D3D, Cinzel + Montserrat)
// Brief: il sito produce credibilità e porta al Salon Check. Nessuna autenticazione.
import { useState } from "react";
import Link from "next/link";

export const NAVY = "#0A1D3D", BLU = "#0D47A1", CHIARO = "#F2F4F7", SCURO = "#2B2F36";

const NAV = [
  { href: "/sito/metodo", label: "Il Metodo" },
  { href: "/sito/software", label: "Il Software" },
  { href: "/sito/academy", label: "Academy" },
  { href: "/sito/libri", label: "Libri" },
  { href: "/sito/storia", label: "Storia" },
  { href: "/sito/faq", label: "FAQ" },
];

export default function SiteShell({ children, active }: { children: React.ReactNode; active?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="gps-site">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      <style dangerouslySetInnerHTML={{ __html: `
        .gps-site { font-family: 'Montserrat', sans-serif; color: ${SCURO}; background: #fff; min-height: 100vh; }
        .gps-site h1, .gps-site h2, .gps-site .serif-t { font-family: 'Cinzel', serif; color: ${NAVY}; letter-spacing: .01em; }
        .gps-site a { text-decoration: none; }
        .s-topbar { position: sticky; top: 0; z-index: 50; background: rgba(255,255,255,.96); backdrop-filter: blur(8px); border-bottom: 1px solid #e3e7ee; display: flex; align-items: center; gap: 18px; padding: 12px 22px; }
        .s-nav a { color: ${SCURO}; font-size: 14px; font-weight: 500; padding: 6px 10px; border-radius: 8px; }
        .s-nav a:hover, .s-nav a.on { color: ${BLU}; background: #eef3fb; }
        .s-cta { background: ${BLU}; color: #fff !important; font-weight: 600; padding: 10px 18px; border-radius: 10px; font-size: 14px; }
        .s-cta:hover { background: #0b3b86; }
        .s-wrap { max-width: 1080px; margin: 0 auto; padding: 0 22px; }
        .s-hero { background: linear-gradient(160deg, ${NAVY} 0%, #0d2b5c 70%, ${BLU} 130%); color: #fff; }
        .s-hero h1 { color: #fff; }
        .s-eyebrow { font-size: 12.5px; letter-spacing: .22em; text-transform: uppercase; color: ${BLU}; font-weight: 600; }
        .s-hero .s-eyebrow { color: #9db8e8; }
        .s-sec { padding: 64px 0; }
        .s-sec.alt { background: ${CHIARO}; }
        .s-sec.navy { background: ${NAVY}; color: #dfe6f2; }
        .s-sec.navy h2 { color: #fff; }
        .s-grid { display: grid; gap: 22px; }
        @media (min-width: 760px) { .g2 { grid-template-columns: 1fr 1fr; } .g3 { grid-template-columns: 1fr 1fr 1fr; } }
        .s-card { background: #fff; border: 1px solid #e3e7ee; border-radius: 14px; padding: 24px; }
        .navy .s-card { background: rgba(255,255,255,.05); border-color: rgba(255,255,255,.14); }
        .s-btn { display: inline-block; background: ${BLU}; color: #fff !important; font-weight: 600; padding: 15px 28px; border-radius: 12px; font-size: 16px; }
        .s-btn:hover { background: #0b3b86; }
        .s-btn.ghost { background: transparent; border: 2px solid ${BLU}; color: ${BLU} !important; }
        .navy .s-btn.ghost { border-color: #7fa4e0; color: #cfdcf5 !important; }
        .s-kicker { color: ${BLU}; font-weight: 700; font-size: 15px; }
        .gps-site p { line-height: 1.65; }
        .s-foot { background: #071427; color: #93a3bd; padding: 44px 0 30px; font-size: 13.5px; }
        .s-foot a { color: #c3d2ea; }
        .s-burger { display: none; }
        @media (max-width: 900px) {
          .s-nav { display: ${open ? "flex" : "none"}; position: absolute; top: 58px; left: 0; right: 0; background: #fff; flex-direction: column; padding: 12px 22px 18px; border-bottom: 1px solid #e3e7ee; gap: 4px; }
          .s-burger { display: block; margin-left: auto; background: none; border: none; font-size: 24px; color: ${NAVY}; cursor: pointer; }
          .s-topbar .s-cta { display: ${open ? "inline-block" : "none"}; position: absolute; top: ${open ? "auto" : "0"}; }
          .s-nav .s-cta { display: inline-block; position: static; margin-top: 8px; text-align: center; }
        }
        @media (min-width: 901px) { .s-nav { display: flex; gap: 2px; margin-left: auto; align-items: center; } }
      `}} />

      <div className="s-topbar">
        <Link href="/sito"><img src="/site/logo-orizzontale.png" alt="GPS — Growth Performance System" style={{ height: 42, display: "block" }} /></Link>
        <button className="s-burger" onClick={() => setOpen(!open)}>☰</button>
        <nav className="s-nav">
          {NAV.map(n => <Link key={n.href} href={n.href} className={active === n.href ? "on" : ""}>{n.label}</Link>)}
          <Link href="/check" className="s-cta" style={{ marginLeft: 10 }}>Fai il Salon Check</Link>
        </nav>
      </div>

      {children}

      <footer className="s-foot">
        <div className="s-wrap" style={{ display: "flex", flexWrap: "wrap", gap: 30, justifyContent: "space-between" }}>
          <div style={{ maxWidth: 340 }}>
            <div className="serif-t" style={{ color: "#fff", fontSize: 26, fontFamily: "'Cinzel', serif" }}>GPS</div>
            <p style={{ margin: "6px 0" }}>Growth Performance System — il metodo e il gestionale evoluto che trasformano i dati del tuo salone in decisioni migliori, ogni giorno.</p>
            <p style={{ color: "#c3d2ea", fontWeight: 600 }}>Guarda. Prevedi. Scegli.</p>
          </div>
          <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {NAV.map(n => <Link key={n.href} href={n.href}>{n.label}</Link>)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Link href="/check">Salon Check</Link>
              <Link href="/login">Accesso clienti GPS</Link>
              <a href="https://amzn.eu/d/031LSxMT" target="_blank" rel="noreferrer">Il libro su Amazon</a>
            </div>
          </div>
        </div>
        <div className="s-wrap" style={{ borderTop: "1px solid rgba(255,255,255,.1)", marginTop: 28, paddingTop: 16, fontSize: 12 }}>
          © {new Date().getFullYear()} GPS — Growth Performance System · Le previsioni sono strumenti di supporto decisionale basati sui dati disponibili, non promesse di risultato.
        </div>
      </footer>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import "./signage-player.css";

export const DISPLAY_TOKEN_KEY = "restaurant-pos-display-token";
export function readDisplayToken() { try { return localStorage.getItem(DISPLAY_TOKEN_KEY); } catch { return null; } }
export function writeDisplayToken(token: string | null) { try { if (token) localStorage.setItem(DISPLAY_TOKEN_KEY, token); else localStorage.removeItem(DISPLAY_TOKEN_KEY); } catch { /* Storage may be disabled; the key is still in the address. */ } }

type Pairing = { id: string; code: string; secret: string; expiresAt: string };

// Shown on a TV that is not connected yet: the owner types this code into Setup > Display Screens.
export function DisplayPairing() {
  const [pairing, setPairing] = useState<Pairing | null>(null), [message, setMessage] = useState("Getting a connection code..."), [attempt, setAttempt] = useState(0);
  useEffect(() => { const token = readDisplayToken(); if (token && /^[\w-]{43}$/.test(token)) window.location.replace(`/display/${token}`); }, []);
  useEffect(() => {
    let active = true;
    fetch("/api/display/pair", { method: "POST", cache: "no-store" }).then(async response => {
      const data = await response.json();
      if (!active) return;
      if (!response.ok) { setMessage(data.message ?? "Could not get a code. Retrying..."); setTimeout(() => active && setAttempt(value => value + 1), 15_000); return; }
      setPairing(data); setMessage("");
    }).catch(() => { if (active) { setMessage("Cannot reach the restaurant server. Retrying..."); setTimeout(() => active && setAttempt(value => value + 1), 10_000); } });
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => {
    if (!pairing) return;
    let active = true;
    const check = async () => {
      try {
        const response = await fetch(`/api/display/pair?id=${pairing.id}&secret=${encodeURIComponent(pairing.secret)}`, { cache: "no-store" });
        const data = await response.json();
        if (!active) return;
        if (data.status === "PAIRED" && data.token) { writeDisplayToken(data.token); window.location.replace(`/display/${data.token}`); return; }
        if (data.status === "EXPIRED") { setPairing(null); setAttempt(value => value + 1); }
      } catch { /* Keep showing the code; the next check retries. */ }
    };
    const timer = setInterval(() => void check(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [pairing]);
  return <div className="signage signage-dark is-preview" onClick={() => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {}); }}>
    <section className="signage-brand signage-pairing">
      <h1>Connect this display</h1>
      {pairing ? <><p className="signage-code">{pairing.code.slice(0, 3)} {pairing.code.slice(3)}</p><p>On the POS, open <b>Setup &gt; Display Screens</b>, choose a screen, select <b>Connect display</b> and enter this code.</p></> : <p>{message}</p>}
    </section>
  </div>;
}

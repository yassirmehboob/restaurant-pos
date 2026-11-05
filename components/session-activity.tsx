"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const RENEW_AT_MOST_EVERY_MS = 5 * 60_000, RETRY_MS = 60_000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchmove"] as const;

/** Keeps the session alive while someone is using the app and leaves for the login page once it lapses. */
export function SessionActivity() {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined, lastRenewal = 0, stopped = false;
    function checkIn(ms: number) { clearTimeout(timer); timer = setTimeout(() => void sync("GET"), ms); }
    async function sync(method: "GET" | "POST") {
      try {
        const response = await fetch("/api/session", { method, cache: "no-store" });
        if (stopped) return;
        if (response.status === 401) { router.replace("/login"); return; }
        if (!response.ok) throw new Error("Session check failed.");
        const { expiresInSeconds } = await response.json() as { expiresInSeconds: number };
        // Another tab may have renewed by then, so ask the server again rather than leaving outright.
        checkIn(expiresInSeconds * 1000 + 1000);
      } catch {
        // A network or server fault is not a logout; the server decides once it is reachable.
        if (!stopped) checkIn(RETRY_MS);
      }
    }
    function onActivity() {
      if (Date.now() - lastRenewal < RENEW_AT_MOST_EVERY_MS) return;
      lastRenewal = Date.now();
      void sync("POST");
    }
    void sync("GET");
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, onActivity, { capture: true, passive: true });
    return () => {
      stopped = true;
      clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity, { capture: true });
    };
  }, [router]);
  return null;
}

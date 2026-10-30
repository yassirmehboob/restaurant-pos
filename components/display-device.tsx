"use client";
import { useCallback, useEffect } from "react";
import { SignagePlayer } from "@/components/signage-player";
import { writeDisplayToken } from "@/components/display-pairing";

export function DisplayDevice({ token }: { token: string }) {
  useEffect(() => { writeDisplayToken(token); }, [token]);
  // The owner disconnected this TV (or paired another one), so it goes back to showing a pairing code.
  const unpaired = useCallback(() => { writeDisplayToken(null); window.location.replace("/display"); }, []);
  return <SignagePlayer feedUrl={`/api/display/${token}/feed`} mode="device" onUnauthorized={unpaired} />;
}

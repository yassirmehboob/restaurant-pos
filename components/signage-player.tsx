"use client";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PAGE_SIZES, pages } from "@/lib/signage";
import type { FeedDeal, FeedItem, SignageFeed } from "@/lib/signage-server";
import "./signage-player.css";

type Frame =
  | { key: string; kind: "BRAND"; seconds: number; title: string; message: string }
  | { key: string; kind: "MENU"; seconds: number; title: string; items: FeedItem[]; page: string }
  | { key: string; kind: "DEALS"; seconds: number; title: string; deals: FeedDeal[]; page: string }
  | { key: string; kind: "ITEM"; seconds: number; title: string; message: string; item: FeedItem }
  | { key: string; kind: "VIDEO"; seconds: number; title: string; video: string; sound: boolean };

const REFRESH_MS = 60_000, RELOAD_AFTER_MS = 6 * 3600_000, MAX_VIDEO_MS = 10 * 60_000;
// Fits a page of cards to the whole screen: 3 items become three tall cards rather than half a 4x2 grid.
// Short, wide cards (three or more rows) put the picture beside the text instead of above it.
function gridFor(count: number, orientation: "LANDSCAPE" | "PORTRAIT", kind: "items" | "deals") {
  const columns = Math.max(1, kind === "deals" ? (orientation === "PORTRAIT" ? 1 : count) : orientation === "PORTRAIT" ? (count <= 4 ? 1 : 2) : count <= 4 ? count : count <= 6 ? 3 : 4);
  const rows = Math.max(1, Math.ceil(count / columns));
  return { style: { "--columns": columns, "--rows": rows } as React.CSSProperties, className: rows >= 3 ? " is-rows" : "" };
}
const grid = (base: string, layout: ReturnType<typeof gridFor>) => ({ className: base + layout.className, style: layout.style });
const rs = (value: number) => `Rs ${value.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

// Long menus and deal lists continue over several pages of the same slide.
export function framesFor(feed: SignageFeed): Frame[] {
  const size = PAGE_SIZES[feed.screen.orientation], frames: Frame[] = [];
  for (const slide of feed.slides) {
    if (slide.type === "BRAND") frames.push({ key: slide.id, kind: "BRAND", seconds: slide.durationSeconds, title: slide.title, message: slide.message });
    else if (slide.type === "MENU") for (const group of slide.groups) { const split = pages(group.items, size.items); split.forEach((items, index) => frames.push({ key: `${slide.id}:${group.title}:${index}`, kind: "MENU", seconds: slide.durationSeconds, title: group.title, items, page: split.length > 1 ? `${index + 1} / ${split.length}` : "" })); }
    else if (slide.type === "DEALS") { const split = pages(slide.deals, size.deals); split.forEach((deals, index) => frames.push({ key: `${slide.id}:${index}`, kind: "DEALS", seconds: slide.durationSeconds, title: slide.title, deals, page: split.length > 1 ? `${index + 1} / ${split.length}` : "" })); }
    else if (slide.type === "ITEM") frames.push({ key: slide.id, kind: "ITEM", seconds: slide.durationSeconds, title: slide.title, message: slide.message, item: slide.item });
    else frames.push({ key: slide.id, kind: "VIDEO", seconds: slide.durationSeconds, title: slide.title, video: slide.video, sound: slide.sound });
  }
  return frames;
}

export function SignagePlayer({ feedUrl, mode, onUnauthorized }: { feedUrl: string; mode: "device" | "preview"; onUnauthorized?: () => void }) {
  const [feed, setFeed] = useState<SignageFeed | null>(null), [next, setNext] = useState<SignageFeed | null>(null), [error, setError] = useState(""), [offline, setOffline] = useState(false);
  const [index, setIndex] = useState(0), [clock, setClock] = useState(() => new Date()), started = useRef(0);
  const frames = useMemo(() => feed ? framesFor(feed) : [], [feed]), frame = frames.length ? frames[index % frames.length] : null;

  useEffect(() => { started.current = Date.now(); }, []);
  useEffect(() => {
    let active = true;
    const load = () => fetch(feedUrl, { cache: "no-store" }).then(async response => {
      if (!active) return;
      if (response.status === 401) { onUnauthorized?.(); setError("This display is not connected."); return; }
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json() as SignageFeed;
      if (!active) return;
      setOffline(false); setError("");
      // A changed playlist waits for the current slide to finish instead of cutting it off.
      setFeed(current => { if (!current) return data; if (current.version !== data.version) setNext(data); return current; });
    }).catch(() => { if (active) setOffline(true); });
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => { active = false; clearInterval(timer); };
  }, [feedUrl, onUnauthorized]);
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 15_000); return () => clearInterval(timer); }, []);

  const advance = useCallback(() => {
    if (mode === "device" && Date.now() - started.current > RELOAD_AFTER_MS) { window.location.reload(); return; }
    if (next) { setFeed(next); setNext(null); setIndex(0); return; }
    setIndex(value => value + 1);
  }, [mode, next]);

  // Videos advance when they end; this timer is only a safety net for stalled or broken files.
  useEffect(() => {
    if (!frame) return;
    const timer = setTimeout(advance, frame.kind === "VIDEO" ? MAX_VIDEO_MS : frame.seconds * 1000);
    return () => clearTimeout(timer);
  }, [frame, advance]);

  // Keep the TV awake where the browser allows it (HTTPS or localhost).
  useEffect(() => {
    if (mode !== "device") return;
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => { try { lock = await (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch { /* Not supported on this device. */ } };
    const visible = () => { if (document.visibilityState === "visible") void request(); };
    void request(); document.addEventListener("visibilitychange", visible);
    return () => { document.removeEventListener("visibilitychange", visible); void lock?.release().catch(() => {}); };
  }, [mode]);

  const fullscreen = () => { if (mode === "device" && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {}); };
  const theme = feed?.screen.theme.toLowerCase() ?? "dark", orientation = feed?.screen.orientation.toLowerCase() ?? "landscape";

  if (!feed) return <div className={`signage signage-${theme} is-${mode}`} onClick={fullscreen}><div className="signage-status">{error || (offline ? "Waiting for the restaurant server..." : "Loading...")}</div></div>;
  const fullBleed = frame?.kind === "VIDEO" || frame?.kind === "BRAND";
  return <div className={`signage signage-${theme} signage-${orientation} is-${mode}`} onClick={fullscreen}>
    {!fullBleed && <header className="signage-header">
      {feed.business.logo ? <Image className="signage-logo" src={feed.business.logo} alt="" width={160} height={160} unoptimized /> : null}
      <strong>{feed.business.name}</strong>
      <time>{clock.toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Karachi" }).toUpperCase()}</time>
    </header>}
    {/* The index is part of the key so a single looping slide (e.g. one video) restarts every round. */}
    <main className="signage-stage" key={frame ? `${frame.key}:${index}` : "empty"}>
      {!frame ? <Brand logo={feed.business.logo} title={feed.business.name} message={mode === "preview" ? "Add slides to this screen in Setup > Display Screens." : ""} />
        : frame.kind === "BRAND" ? <Brand logo={feed.business.logo} title={frame.title} message={frame.message} />
        : frame.kind === "VIDEO" ? <Video src={frame.video} sound={frame.sound} onDone={advance} />
        : frame.kind === "ITEM" ? <Spotlight frame={frame} showPrices={feed.screen.showPrices} />
        : frame.kind === "MENU" ? <section className="signage-board"><h1>{frame.title}{frame.page && <small>{frame.page}</small>}</h1><div {...grid("signage-items", gridFor(frame.items.length, feed.screen.orientation, "items"))}>{frame.items.map(item => <Item key={item.id} item={item} showPrices={feed.screen.showPrices} />)}</div></section>
        : <section className="signage-board"><h1>{frame.title}{frame.page && <small>{frame.page}</small>}</h1><div {...grid("signage-deals", gridFor(frame.deals.length, feed.screen.orientation, "deals"))}>{frame.deals.map(deal => <Deal key={deal.id} deal={deal} showPrices={feed.screen.showPrices} />)}</div></section>}
    </main>
    {frame && frame.kind !== "VIDEO" && <div className="signage-progress" key={`progress:${frame.key}:${index}`} style={{ animationDuration: `${frame.seconds}s` }} />}
    {feed.screen.footerText && frame?.kind !== "VIDEO" && <footer className="signage-footer"><span>{feed.screen.footerText}</span></footer>}
    {offline && <span className="signage-offline" title="Showing the last saved content">Offline</span>}
  </div>;
}

function Brand({ logo, title, message }: { logo: string | null; title: string; message: string }) {
  return <section className="signage-brand">{logo && <Image src={logo} alt="" width={480} height={480} unoptimized />}<h1>{title}</h1>{message && <p>{message}</p>}</section>;
}
function Picture({ src, name }: { src: string | null; name: string }) {
  return src ? <Image src={src} alt="" width={640} height={480} unoptimized /> : <span className="signage-placeholder">{name.slice(0, 1).toUpperCase()}</span>;
}
function Price({ item, showPrices }: { item: FeedItem; showPrices: boolean }) {
  if (!showPrices) return null;
  return item.prices.length ? <div className="signage-sizes">{item.prices.map(size => <span key={size.name}>{size.name} <b>{rs(size.price)}</b></span>)}</div> : <b className="signage-price">{rs(item.price)}</b>;
}
function Item({ item, showPrices }: { item: FeedItem; showPrices: boolean }) {
  return <article className="signage-item"><Picture src={item.image} name={item.name} /><div><h2>{item.name}</h2>{item.description && <p>{item.description}</p>}<Price item={item} showPrices={showPrices} /></div></article>;
}
function Deal({ deal, showPrices }: { deal: FeedDeal; showPrices: boolean }) {
  return <article className="signage-deal"><Picture src={deal.image} name={deal.name} /><div><h2>{deal.name}</h2><ul>{deal.items.map(line => <li key={line.name}>{line.quantity}× {line.name}</li>)}</ul>{showPrices && <b className="signage-price">{rs(deal.price)}</b>}</div></article>;
}
function Spotlight({ frame, showPrices }: { frame: Extract<Frame, { kind: "ITEM" }>; showPrices: boolean }) {
  return <section className="signage-spotlight"><Picture src={frame.item.image} name={frame.item.name} /><div>{frame.title && <span className="signage-tag">{frame.title}</span>}<h1>{frame.item.name}</h1>{(frame.message || frame.item.description) && <p>{frame.message || frame.item.description}</p>}<Price item={frame.item} showPrices={showPrices} /></div></section>;
}

// Autoplay with sound is often blocked by browsers; if so the video plays muted rather than stopping.
const VIDEO_ERRORS: Record<number, string> = {
  2: "The video could not be downloaded. Check this TV's connection to the POS.",
  3: "This TV could not decode the video. Re-export it as MP4 (H.264 video, AAC audio, 1080p or lower).",
  4: "This TV cannot play this video format. Re-export it as MP4 (H.264 video, AAC audio, 1080p or lower).",
};
const BLOCKED = "This TV's browser blocked the video. Press OK on the remote or tap the screen once to allow videos.";
const SKIP_AFTER_PROBLEM_MS = 8000;

// Problems are shown on screen (and logged) for a few seconds instead of silently skipping the slide.
function Video({ src, sound, onDone }: { src: string; sound: boolean; onDone: () => void }) {
  const ref = useRef<HTMLVideoElement>(null), [problem, setProblem] = useState("");
  useEffect(() => {
    const video = ref.current; if (!video) return;
    let active = true, skip: ReturnType<typeof setTimeout> | undefined;
    const fail = (message: string) => { if (!active) return; console.error(`Display video problem: ${message}`); setProblem(message); clearTimeout(skip); skip = setTimeout(() => { if (active) onDone(); }, SKIP_AFTER_PROBLEM_MS); };
    const start = async () => {
      try { video.muted = !sound; await video.play(); }
      catch (error) {
        // Autoplay with sound is often refused; muted playback is the fallback.
        if (sound) { try { video.muted = true; await video.play(); return; } catch { /* Report the original refusal below. */ } }
        if ((error as Error)?.name === "NotAllowedError") fail(BLOCKED);
      }
    };
    // Any press or tap counts as permission, after which this and later videos can play.
    const unlock = () => { if (video.paused && !video.error) void video.play().then(() => { if (active) { clearTimeout(skip); setProblem(""); } }).catch(() => {}); };
    const broken = () => fail(VIDEO_ERRORS[video.error?.code ?? 0] ?? "The video could not be played.");
    video.addEventListener("error", broken);
    window.addEventListener("pointerdown", unlock); window.addEventListener("keydown", unlock);
    void start();
    return () => { active = false; clearTimeout(skip); video.removeEventListener("error", broken); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, [src, sound, onDone]);
  return <><video ref={ref} className="signage-video" src={src} playsInline muted={!sound} preload="auto" onEnded={onDone} />{problem && <div className="signage-video-problem" role="alert">{problem}</div>}</>;
}

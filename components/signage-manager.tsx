"use client";
import Image from "next/image";
import { randomId } from "@/lib/random-id";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, Film, ImageIcon, Link2, Monitor, Plus, Save, Trash2, Unplug, Upload } from "lucide-react";
import Swal from "sweetalert2";
import { MasterHeader } from "@/components/master-shell";
import { formatDateTime } from "@/lib/dates";
import { MAX_IMAGE_BYTES } from "@/lib/image-upload";
import { MAX_VIDEO_BYTES, SLIDE_LABELS, SLIDE_TYPES, type Slide, type SlideType } from "@/lib/signage";
import { createScreen, deleteScreen, deleteSignageImage, deleteVideo, disconnectScreen, pairScreen, saveScreen, uploadSignageImage, type SignageData } from "@/app/(dashboard)/settings/signage/actions";
import "./signage-manager.css";

type Screen = SignageData["screens"][number];
const DEFAULT_SECONDS: Record<SlideType, number> = { BRAND: 8, MENU: 12, DEALS: 12, ITEM: 10, IMAGE: 10, VIDEO: 30 };
const newSlide = (type: SlideType): Slide => ({ id: randomId().replaceAll("-", "").slice(0, 24), type, durationSeconds: DEFAULT_SECONDS[type], title: "", message: "", categoryId: "", productIds: [], dealIds: [], productId: "", imageId: "", videoId: "", sound: false });
const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
const RATIOS = [[16, 9], [9, 16], [4, 3], [3, 4], [1, 1], [21, 9], [3, 2], [2, 3], [4, 5], [5, 4]];
// Labels a picture or video with its pixel size and shape, e.g. "1920×1080 · 16:9 landscape".
function shapeOf(width: number, height: number) {
  if (!width || !height) return "";
  const value = width / height, match = RATIOS.find(([w, h]) => Math.abs(value - w / h) < 0.02);
  const shape = Math.abs(value - 1) < 0.02 ? "square" : value > 1 ? "landscape" : "portrait";
  return `${width}×${height} · ${match ? `${match[0]}:${match[1]}` : `${value.toFixed(2)}:1`} ${shape}`;
}
const RECOMMENDED = <p className="signage-ratio-hint"><b>Best size:</b> landscape screens 1920×1080 (16:9) · portrait screens 1080×1920 (9:16). Other shapes show with borders.</p>;

export function SignageManager({ data }: { data: SignageData }) {
  const router = useRouter(), [pending, start] = useTransition(), [open, setOpen] = useState<string | null>(data.screens[0]?.id ?? null), [notice, setNotice] = useState("");
  // The address staff use to reach the POS, read only in the browser.
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => "");
  const result = (outcome: { ok: boolean; message?: string }, success: string) => { setNotice(outcome.ok ? success : outcome.message ?? "Please try again."); if (outcome.ok) router.refresh(); };

  const add = () => start(async () => {
    const answer = await Swal.fire({ titleText: "Add a display screen", html: '<label class="signage-swal">Screen name<input id="signage-name" class="swal2-input" maxlength="40" placeholder="e.g. Counter screen"></label><label class="signage-swal">Orientation<select id="signage-orientation" class="swal2-select"><option value="LANDSCAPE">Landscape (wide)</option><option value="PORTRAIT">Portrait (tall)</option></select></label>', showCancelButton: true, confirmButtonText: "Add screen", focusConfirm: false, preConfirm: () => {
      const name = (document.getElementById("signage-name") as HTMLInputElement).value.trim();
      if (!name) { Swal.showValidationMessage("Enter a screen name."); return false; }
      return { name, orientation: (document.getElementById("signage-orientation") as HTMLSelectElement).value };
    } });
    if (!answer.isConfirmed) return;
    const created = await createScreen(answer.value.name, answer.value.orientation);
    if (created.ok) setOpen(created.id);
    result(created, `${answer.value.name} added with the logo, menu and deals. Connect a TV to show it.`);
  });
  const pair = (screen: Screen) => start(async () => {
    const answer = await Swal.fire({ titleText: `Connect a display to ${screen.name}`, text: `On the TV's browser, open ${origin}/display and enter the 6-digit code it shows.${screen.paired ? " The TV currently connected to this screen will be disconnected." : ""}`, input: "text", inputAttributes: { inputmode: "numeric", maxlength: "7", autocomplete: "off" }, inputPlaceholder: "123 456", showCancelButton: true, confirmButtonText: "Connect", inputValidator: value => /^\d{3}\s?\d{3}$/.test(value.trim()) ? undefined : "Enter the 6-digit code." });
    if (answer.isConfirmed) result(await pairScreen(screen.id, String(answer.value)), `Display connected to ${screen.name}. It will start showing the playlist within a few seconds.`);
  });
  const unpair = (screen: Screen) => start(async () => {
    const answer = await Swal.fire({ icon: "warning", titleText: `Disconnect the TV from ${screen.name}?`, text: "The TV returns to its pairing screen.", showCancelButton: true, confirmButtonText: "Disconnect", confirmButtonColor: "#b42318", reverseButtons: true });
    if (answer.isConfirmed) result(await disconnectScreen(screen.id), `${screen.name} disconnected.`);
  });
  const remove = (screen: Screen) => start(async () => {
    const answer = await Swal.fire({ icon: "warning", titleText: `Remove ${screen.name}?`, text: "Its playlist is deleted and its TV is disconnected.", showCancelButton: true, confirmButtonText: "Remove screen", confirmButtonColor: "#b42318", reverseButtons: true });
    if (answer.isConfirmed) result(await deleteScreen(screen.id), `${screen.name} removed.`);
  });

  return <main className="master-page signage-manager">
    <MasterHeader eyebrow="Setup" title="Display Screens" description="Show your menu, deals, logo, pictures and videos on TVs. Each screen has its own playlist." actions={<button type="button" className="signage-primary" disabled={pending} onClick={add}><Plus size={17} />Add screen</button>} />
    {notice && <p className="signage-notice" role="status">{notice}</p>}
    <section className="signage-howto"><Monitor size={22} /><p>On each TV, open <b>{origin || "your POS address"}/display</b> in Chrome or a kiosk browser (for example Fully Kiosk Browser on Android). Then choose <b>Connect display</b> below and enter the code the TV shows. Prices and items update on the TV automatically.</p></section>
    {data.screens.length === 0 && <section className="signage-empty"><Monitor size={36} /><h2>No screens yet</h2><p>Add a screen for each TV, for example &ldquo;Counter screen&rdquo; and &ldquo;Entrance screen&rdquo;.</p></section>}
    {data.screens.map(screen => <article key={screen.id} className="signage-screen">
      <header>
        <span className="signage-screen-icon"><Monitor size={20} /></span>
        <div><h2>{screen.name}</h2><p>{screen.orientation === "PORTRAIT" ? "Portrait" : "Landscape"} · {screen.theme.charAt(0) + screen.theme.slice(1).toLowerCase()} theme · {screen.slides.length} slide{screen.slides.length === 1 ? "" : "s"}</p></div>
        <span className={`signage-state ${screen.paired ? screen.online ? "online" : "offline" : "unpaired"}`}>{screen.paired ? screen.online ? "TV online" : screen.lastSeenAt ? `Last seen ${formatDateTime(screen.lastSeenAt)}` : "TV connected, waiting" : "No TV connected"}</span>
      </header>
      <footer>
        <button type="button" onClick={() => setOpen(open === screen.id ? null : screen.id)}>{open === screen.id ? "Close playlist" : "Edit playlist"}</button>
        <a href={`/display/preview/${screen.id}`} target="_blank" rel="noopener"><Eye size={15} />Preview</a>
        <button type="button" disabled={pending} onClick={() => pair(screen)}><Link2 size={15} />{screen.paired ? "Connect another TV" : "Connect display"}</button>
        {screen.paired && <button type="button" disabled={pending} onClick={() => unpair(screen)}><Unplug size={15} />Disconnect</button>}
        <button type="button" className="danger" disabled={pending} onClick={() => remove(screen)}><Trash2 size={15} />Remove</button>
      </footer>
      {open === screen.id && <ScreenEditor key={JSON.stringify(screen)} screen={screen} data={data} onSaved={message => { setNotice(message); router.refresh(); }} />}
    </article>)}
    <ImageLibrary images={data.images} onChanged={message => { setNotice(message); router.refresh(); }} />
    <VideoLibrary videos={data.videos} onChanged={message => { setNotice(message); router.refresh(); }} />
  </main>;
}

function ScreenEditor({ screen, data, onSaved }: { screen: Screen; data: SignageData; onSaved: (message: string) => void }) {
  const [settings, setSettings] = useState({ name: screen.name, orientation: screen.orientation, theme: screen.theme, showPrices: screen.showPrices, footerText: screen.footerText });
  const [slides, setSlides] = useState<Slide[]>(screen.slides), [error, setError] = useState(""), [pending, start] = useTransition();
  const dirty = JSON.stringify({ ...settings, slides }) !== JSON.stringify({ name: screen.name, orientation: screen.orientation, theme: screen.theme, showPrices: screen.showPrices, footerText: screen.footerText, slides: screen.slides });
  const patch = (index: number, change: Partial<Slide>) => { setSlides(current => current.map((slide, position) => position === index ? { ...slide, ...change } : slide)); setError(""); };
  const move = (index: number, by: number) => setSlides(current => { const next = [...current], [item] = next.splice(index, 1); next.splice(index + by, 0, item); return next; });
  const save = () => start(async () => { const outcome = await saveScreen(screen.id, { ...settings, slides }); if (outcome.ok) onSaved(`${settings.name} saved. Connected TVs update within a minute.`); else setError(outcome.message); });
  return <section className="signage-editor">
    <div className="signage-settings">
      <label><span>Screen name</span><input value={settings.name} maxLength={40} onChange={event => setSettings({ ...settings, name: event.target.value })} /></label>
      <label><span>Orientation</span><select value={settings.orientation} onChange={event => setSettings({ ...settings, orientation: event.target.value as Screen["orientation"] })}><option value="LANDSCAPE">Landscape (wide)</option><option value="PORTRAIT">Portrait (tall)</option></select></label>
      <label><span>Theme</span><select value={settings.theme} onChange={event => setSettings({ ...settings, theme: event.target.value as Screen["theme"] })}><option value="DARK">Dark</option><option value="LIGHT">Light</option><option value="WARM">Warm red</option></select></label>
      <label className="signage-check"><input type="checkbox" checked={settings.showPrices} onChange={event => setSettings({ ...settings, showPrices: event.target.checked })} /><span>Show prices</span></label>
      <label className="wide"><span>Scrolling message at the bottom <small>Optional</small></span><input value={settings.footerText} maxLength={140} placeholder="e.g. Free delivery on orders above Rs 2,000" onChange={event => setSettings({ ...settings, footerText: event.target.value })} /></label>
    </div>
    <ol className="signage-slides">{slides.map((slide, index) => <li key={slide.id}>
      <div className="signage-slide-head"><b>{index + 1}. {SLIDE_LABELS[slide.type]}</b>
        {slide.type !== "VIDEO" ? <label className="signage-seconds"><input type="number" min={3} max={300} value={slide.durationSeconds} onChange={event => patch(index, { durationSeconds: Math.round(Number(event.target.value) || 0) })} /><span>seconds{slide.type === "MENU" || slide.type === "DEALS" ? " per page" : ""}</span></label> : <span className="signage-muted">Plays to the end</span>}
        <span className="signage-slide-actions"><button type="button" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button><button type="button" aria-label="Move down" disabled={index === slides.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button><button type="button" aria-label="Remove slide" className="danger" onClick={() => setSlides(current => current.filter((_, position) => position !== index))}><Trash2 size={15} /></button></span>
      </div>
      <SlideFields slide={slide} data={data} onChange={change => patch(index, change)} />
    </li>)}</ol>
    {slides.length === 0 && <p className="signage-muted">This screen has no slides yet. Add one below.</p>}
    <div className="signage-add"><span>Add a slide:</span>{SLIDE_TYPES.map(type => { const missing = type === "VIDEO" && !data.videos.length ? "Upload a video first" : type === "IMAGE" && !data.images.length ? "Upload a picture first" : undefined; return <button type="button" key={type} disabled={!!missing} title={missing} onClick={() => setSlides(current => [...current, newSlide(type)])}><Plus size={14} />{SLIDE_LABELS[type]}</button>; })}</div>
    {error && <p className="signage-error" role="alert">{error}</p>}
    <div className="signage-save"><span>{dirty ? "You have unsaved changes." : "Saved."}</span><button type="button" className="signage-primary" disabled={pending || !dirty} onClick={save}><Save size={16} />{pending ? "Saving..." : "Save screen"}</button></div>
  </section>;
}

function Picker({ options, selected, onChange }: { options: { id: string; name: string }[]; selected: string[]; onChange: (ids: string[]) => void }) {
  return <div className="signage-picker">{options.map(option => <label key={option.id}><input type="checkbox" checked={selected.includes(option.id)} onChange={event => onChange(event.target.checked ? [...selected, option.id] : selected.filter(id => id !== option.id))} />{option.name}</label>)}</div>;
}

function SlideFields({ slide, data, onChange }: { slide: Slide; data: SignageData; onChange: (change: Partial<Slide>) => void }) {
  if (slide.type === "BRAND") return <div className="signage-fields"><label><span>Heading <small>Defaults to the restaurant name</small></span><input value={slide.title} maxLength={60} onChange={event => onChange({ title: event.target.value })} /></label><label><span>Message <small>Optional</small></span><input value={slide.message} maxLength={160} placeholder="e.g. Order at the counter" onChange={event => onChange({ message: event.target.value })} /></label></div>;
  if (slide.type === "MENU") {
    const source = slide.productIds.length || slide.categoryId === "SELECTED" ? "SELECTED" : slide.categoryId;
    return <div className="signage-fields">
      <label><span>Show</span><select value={source} onChange={event => onChange(event.target.value === "SELECTED" ? { categoryId: "", productIds: data.products.slice(0, 8).map(product => product.id) } : { categoryId: event.target.value, productIds: [] })}><option value="">All categories (one page per category)</option>{data.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}<option value="SELECTED">Selected items</option></select></label>
      <label><span>Heading <small>Optional</small></span><input value={slide.title} maxLength={60} placeholder={source === "" ? "Category names are used" : "e.g. Our menu"} onChange={event => onChange({ title: event.target.value })} /></label>
      {source === "SELECTED" && <div className="wide"><span className="signage-label">Items ({slide.productIds.length})</span><Picker options={data.products} selected={slide.productIds} onChange={productIds => onChange({ productIds })} /></div>}
    </div>;
  }
  if (slide.type === "DEALS") return <div className="signage-fields">
    <label><span>Show</span><select value={slide.dealIds.length ? "SELECTED" : ""} onChange={event => onChange({ dealIds: event.target.value === "SELECTED" ? data.deals.slice(0, 3).map(deal => deal.id) : [] })}><option value="">All available deals</option><option value="SELECTED">Selected deals</option></select></label>
    <label><span>Heading <small>Optional</small></span><input value={slide.title} maxLength={60} placeholder="Deals" onChange={event => onChange({ title: event.target.value })} /></label>
    {slide.dealIds.length > 0 && <div className="wide"><span className="signage-label">Deals ({slide.dealIds.length})</span><Picker options={data.deals} selected={slide.dealIds} onChange={dealIds => onChange({ dealIds })} /></div>}
  </div>;
  if (slide.type === "ITEM") return <div className="signage-fields">
    <label><span>Item</span><select value={slide.productId} onChange={event => onChange({ productId: event.target.value })}><option value="">Choose an item</option>{data.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
    <label><span>Badge <small>Optional</small></span><input value={slide.title} maxLength={60} placeholder="e.g. Chef's special" onChange={event => onChange({ title: event.target.value })} /></label>
    <label className="wide"><span>Message <small>Defaults to the item description</small></span><input value={slide.message} maxLength={160} onChange={event => onChange({ message: event.target.value })} /></label>
  </div>;
  if (slide.type === "IMAGE") return <div className="signage-fields">
    <label><span>Picture</span><select value={slide.imageId} onChange={event => onChange({ imageId: event.target.value })}><option value="">Choose a picture</option>{data.images.map(image => <option key={image.id} value={image.id}>{image.title}</option>)}</select></label>
    <label><span>Caption <small>Optional</small></span><input value={slide.title} maxLength={60} placeholder="e.g. New on the menu" onChange={event => onChange({ title: event.target.value })} /></label>
    {slide.imageId && <Image className="signage-slide-thumb wide" src={`/api/signage/media/image/${slide.imageId}`} alt="" width={240} height={135} unoptimized />}
  </div>;
  return <div className="signage-fields">
    <label><span>Video</span><select value={slide.videoId} onChange={event => onChange({ videoId: event.target.value })}><option value="">Choose a video</option>{data.videos.map(video => <option key={video.id} value={video.id}>{video.title}</option>)}</select></label>
    <label className="signage-check"><input type="checkbox" checked={slide.sound} onChange={event => onChange({ sound: event.target.checked })} /><span>Play sound <small>Needs a kiosk browser that allows sound</small></span></label>
  </div>;
}

function ImageLibrary({ images, onChanged }: { images: SignageData["images"]; onChanged: (message: string) => void }) {
  const [shapes, setShapes] = useState<Record<string, string>>({}), [title, setTitle] = useState(""), [file, setFile] = useState<File | null>(null), [error, setError] = useState(""), [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const upload = () => start(async () => {
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) { setError("Pictures must be 5 MB or smaller."); return; }
    setError("");
    const form = new FormData(); form.set("image", file); form.set("title", title);
    const outcome = await uploadSignageImage(form);
    if (!outcome.ok) { setError(outcome.message); return; }
    setTitle(""); setFile(null); if (input.current) input.current.value = "";
    onChanged("Picture uploaded. Add a Picture slide to a screen to show it.");
  });
  const remove = (image: SignageData["images"][number]) => start(async () => {
    const answer = await Swal.fire({ icon: "warning", titleText: `Delete ${image.title}?`, text: "It is removed from every screen that shows it.", showCancelButton: true, confirmButtonText: "Delete picture", confirmButtonColor: "#b42318", reverseButtons: true });
    if (!answer.isConfirmed) return;
    const outcome = await deleteSignageImage(image.id);
    if (outcome.ok) onChanged(`${image.title} deleted.`); else setError(outcome.message);
  });
  return <section className="signage-videos">
    <div className="signage-videos-head"><span className="signage-screen-icon"><ImageIcon size={20} /></span><div><h2>Pictures</h2><p>Posters, offers or photos as JPG, PNG or WebP, up to 5 MB each.</p></div></div>
    {RECOMMENDED}
    <div className="signage-upload">
      <label><span>Title</span><input value={title} maxLength={80} placeholder="e.g. Weekend offer poster" onChange={event => setTitle(event.target.value)} /></label>
      <label><span>Picture file</span><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { setFile(event.target.files?.[0] ?? null); setError(""); }} /></label>
      <button type="button" className="signage-primary" disabled={!file || pending} onClick={upload}><Upload size={16} />{pending ? "Uploading..." : "Upload picture"}</button>
    </div>
    {error && <p className="signage-error" role="alert">{error}</p>}
    {images.length ? <ul className="signage-video-list">{images.map(image => <li key={image.id}>
      <Image src={`/api/signage/media/image/${image.id}`} alt="" width={200} height={113} unoptimized onLoad={event => { const { naturalWidth, naturalHeight } = event.currentTarget; setShapes(current => ({ ...current, [image.id]: shapeOf(naturalWidth, naturalHeight) })); }} />
      <div><b>{image.title}</b>{shapes[image.id] && <span className="signage-ratio">{shapes[image.id]}</span>}<small>{megabytes(image.bytes)} · {formatDateTime(image.uploadedAt)}</small></div>
      <button type="button" className="danger" disabled={pending} onClick={() => remove(image)}><Trash2 size={15} />Delete</button>
    </li>)}</ul> : <p className="signage-muted">No pictures uploaded yet.</p>}
  </section>;
}

function VideoLibrary({ videos, onChanged }: { videos: SignageData["videos"]; onChanged: (message: string) => void }) {
  const [shapes, setShapes] = useState<Record<string, string>>({}), [title, setTitle] = useState(""), [file, setFile] = useState<File | null>(null), [progress, setProgress] = useState<number | null>(null), [error, setError] = useState(""), [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const upload = async () => {
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) { setError("Videos must be 100 MB or smaller. Shorten or compress it (720p or 1080p MP4 works well)."); return; }
    setError(""); setProgress(0);
    // The browser reads the length before upload so the list can show it.
    const duration = await new Promise<number>(resolve => { const probe = document.createElement("video"), url = URL.createObjectURL(file); probe.preload = "metadata"; probe.onloadedmetadata = () => { resolve(probe.duration || 0); URL.revokeObjectURL(url); }; probe.onerror = () => { resolve(0); URL.revokeObjectURL(url); }; probe.src = url; });
    const outcome = await new Promise<{ ok: boolean; message?: string }>(resolve => {
      const request = new XMLHttpRequest();
      request.open("POST", "/api/signage/videos");
      request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      request.setRequestHeader("X-Video-Title", encodeURIComponent(title.trim() || file.name.replace(/\.[^.]+$/, "")));
      request.setRequestHeader("X-Video-Duration", String(Math.round(duration)));
      request.upload.onprogress = event => { if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)); };
      request.onload = () => { try { resolve(JSON.parse(request.responseText)); } catch { resolve({ ok: false, message: "Upload failed. Please try again." }); } };
      request.onerror = () => resolve({ ok: false, message: "Upload failed. Check the connection and try again." });
      request.send(file);
    });
    setProgress(null);
    if (!outcome.ok) { setError(outcome.message ?? "Upload failed."); return; }
    setTitle(""); setFile(null); if (input.current) input.current.value = "";
    onChanged("Video uploaded. Add a Video slide to a screen to show it.");
  };
  const remove = (video: SignageData["videos"][number]) => start(async () => {
    const answer = await Swal.fire({ icon: "warning", titleText: `Delete ${video.title}?`, text: "It is removed from every screen that shows it.", showCancelButton: true, confirmButtonText: "Delete video", confirmButtonColor: "#b42318", reverseButtons: true });
    if (!answer.isConfirmed) return;
    const outcome = await deleteVideo(video.id);
    if (outcome.ok) onChanged(`${video.title} deleted.`); else setError(outcome.message);
  });
  return <section className="signage-videos">
    <div className="signage-videos-head"><span className="signage-screen-icon"><Film size={20} /></span><div><h2>Videos</h2><p>Short MP4 or WebM clips up to 100 MB each. Videos play muted unless sound is allowed on the TV. They are not included in restaurant backups, so keep your original files.</p></div></div>
    {RECOMMENDED}
    <div className="signage-upload">
      <label><span>Title</span><input value={title} maxLength={80} placeholder="e.g. Azadi offer advert" onChange={event => setTitle(event.target.value)} /></label>
      <label><span>Video file</span><input ref={input} type="file" accept="video/mp4,video/webm" onChange={event => { setFile(event.target.files?.[0] ?? null); setError(""); }} /></label>
      <button type="button" className="signage-primary" disabled={!file || progress !== null} onClick={() => void upload()}><Upload size={16} />{progress !== null ? `Uploading ${progress}%` : "Upload video"}</button>
    </div>
    {progress !== null && <div className="signage-progress-bar"><span style={{ width: `${progress}%` }} /></div>}
    {error && <p className="signage-error" role="alert">{error}</p>}
    {videos.length ? <ul className="signage-video-list">{videos.map(video => <li key={video.id}>
      <video src={`/api/signage/media/video/${video.id}`} preload="metadata" muted controls playsInline onLoadedMetadata={event => { const { videoWidth, videoHeight } = event.currentTarget; setShapes(current => ({ ...current, [video.id]: shapeOf(videoWidth, videoHeight) })); }} />
      <div><b>{video.title}</b>{shapes[video.id] && <span className="signage-ratio">{shapes[video.id]}</span>}<small>{megabytes(video.bytes)}{video.durationSeconds ? ` · ${Math.floor(video.durationSeconds / 60)}:${String(video.durationSeconds % 60).padStart(2, "0")}` : ""} · {formatDateTime(video.uploadedAt)}</small></div>
      <button type="button" className="danger" disabled={pending} onClick={() => remove(video)}><Trash2 size={15} />Delete</button>
    </li>)}</ul> : <p className="signage-muted">No videos uploaded yet.</p>}
  </section>;
}

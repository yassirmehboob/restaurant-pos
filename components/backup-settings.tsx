"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CalendarClock, Check, Clock3, Cloud, CloudUpload, DatabaseBackup, Download, ExternalLink, FolderLock, HardDrive, LoaderCircle, RefreshCw, RotateCcw, Save, ShieldCheck, Unplug, X } from "lucide-react";
import { disconnectGoogleDrive, loadBackupSettings, requestBackupRestore, requestDriveUpload, requestManualBackup, saveBackupSettings, saveDriveSettings } from "@/app/(dashboard)/settings/backups/actions";
import type { BackupSchedule } from "@/lib/backup-schedule.mjs";
import "./backup-settings.css";

type Data = Awaited<ReturnType<typeof loadBackupSettings>>;
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const size = (bytes: number) => bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
const reason = (value: string) => ({ MANUAL: "Manual", SCHEDULED: "Scheduled", CLOSING: "After closing", PRE_RESTORE: "Before restore", OWNER_RESTORE: "Restore", DRIVE_UPLOAD: "Google Drive" }[value] ?? value);
const driveNotices: Record<string, string> = {
  connected: "Google Drive connected. New backups will be copied to your Drive folder.",
  cancelled: "Google Drive connection was cancelled.",
  scope: "Google Drive was not connected because file access was not allowed. Connect again and allow the app to create files.",
  expired: "The Google Drive connection request expired or came from another session. Connect again, opening the app at the same address as GOOGLE_DRIVE_REDIRECT_URI.",
  "not-configured": "Google Drive is not configured on this server yet.",
  client: "Google rejected the server's Google Drive client ID or secret. Ask the system administrator to check them.",
  "owner-only": "Only the owner can connect Google Drive.",
  failed: "Google Drive could not be connected. Check the server's Google settings and try again.",
};

export function BackupSettings({ initial, driveNotice = "" }: { initial: Data; driveNotice?: string }) {
  const [data, setData] = useState(initial), [schedule, setSchedule] = useState<BackupSchedule>(initial.schedule);
  const [message, setMessage] = useState(driveNotices[driveNotice] ?? ""), [connection, setConnection] = useState(""), [pending, start] = useTransition();
  const [driveEnabled, setDriveEnabled] = useState(initial.drive.enabled), [driveMode, setDriveMode] = useState(initial.drive.mode);
  const drive = data.drive, driveReady = drive.connected && !drive.needsReconnect;
  const [restoreId, setRestoreId] = useState<string | null>(null), [restoreError, setRestoreError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), loading = useRef(false);
  const activeJob = data.jobs.some(job => ["QUEUED", "RUNNING"].includes(job.status));
  // Same DD/MM/YYYY hh:mm AM/PM style as the rest of the app, in the restaurant's schedule time zone.
  const formatters = useMemo(() => ({
    day: new Intl.DateTimeFormat("en-GB", { timeZone: data.schedule.timezone, year: "numeric", month: "2-digit", day: "2-digit" }),
    time: new Intl.DateTimeFormat("en-GB", { timeZone: data.schedule.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h12" }),
  }), [data.schedule.timezone]);
  const date = (value: string) => { const instant = new Date(value); return `${formatters.day.format(instant)} ${formatters.time.format(instant).toUpperCase()}`; };
  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const response = await fetch("/api/backups", { cache: "no-store" });
      if (!response.ok) throw new Error("Backup status could not be refreshed. Check your connection or sign in again.");
      setData(await response.json()); setConnection("");
    } catch (error) { setConnection(error instanceof Error ? error.message : "Could not refresh backup status."); }
    finally { loading.current = false; }
  }, []);
  useEffect(() => {
    if (!activeJob) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [refresh, activeJob]);
  useEffect(() => { if (restoreId) dialog.current?.showModal(); }, [restoreId]);
  // Drop ?drive=... so a reload does not repeat the connection notice.
  useEffect(() => { if (driveNotice) window.history.replaceState(null, "", window.location.pathname); }, [driveNotice]);
  const update = <K extends keyof BackupSchedule>(key: K, value: BackupSchedule[K]) => setSchedule(current => ({ ...current, [key]: value }));
  const latest = data.files[0];

  return <main className="master-page backup-page">
    <header className="backup-header"><div><p className="eyebrow">BUSINESS CONTINUITY</p><h1>Backups &amp; restore</h1><p>A reliable recovery point for your restaurant, on your schedule.</p></div><button className="backup-primary" type="button" disabled={pending || activeJob} onClick={() => start(async () => { const result = await requestManualBackup(); setMessage(result.ok ? "Backup queued. You can keep working while it runs." : result.message); await refresh(); })}><DatabaseBackup size={18} />{activeJob ? "Operation in progress" : "Back up now"}</button></header>
    {(message || connection || data.storageError) && <p className="backup-message" role="status">{connection || data.storageError || message}</p>}
    <section className="backup-status-grid" aria-label="Backup health">
      <article><span className="backup-status-icon blue"><ShieldCheck size={21} /></span><div><p>Latest recovery point</p><strong>{latest ? date(latest.createdAt) : "No backup yet"}</strong><small>{latest ? `${size(latest.bytes)} / ${latest.documents.toLocaleString()} records` : "Create your first backup to get protected."}</small></div></article>
      <article><span className="backup-status-icon violet"><CalendarClock size={21} /></span><div><p>Next automatic backup</p><strong>{data.nextRunAt && data.schedule.enabled ? date(data.nextRunAt) : "Timed schedule is off"}</strong><small>{data.schedule.afterClosing ? "Also after the last counter closes" : `Time zone: ${data.schedule.timezone}`}</small></div></article>
      <article><span className={`backup-status-icon ${data.workerOnline ? "green" : "amber"}`}><Clock3 size={21} /></span><div><p>Backup service</p><strong>{data.workerOnline ? "Running" : "Not connected"}</strong><small>{data.workerOnline ? "Checks the queue every 15 seconds" : "Start or restart the app to run the backup worker."}</small></div></article>
    </section>

    <div className="backup-settings-grid">
      <section className="backup-card"><div className="backup-card-title"><span className="backup-status-icon blue"><CalendarClock size={21} /></span><div><h2>Automatic backups</h2><p>Choose when a new recovery point is saved.</p></div></div>
        <form onSubmit={event => { event.preventDefault(); start(async () => { const result = await saveBackupSettings(schedule); setMessage(result.ok ? "Backup schedule saved." : result.message); await refresh(); }); }}>
          <fieldset disabled={!data.owner || pending}><label className="backup-switch"><span><strong>Enable timed backups</strong><small>Runs in the background while the app service is running.</small></span><input type="checkbox" checked={schedule.enabled} onChange={event => update("enabled", event.target.checked)} /></label>
            <label className="backup-field"><span>Schedule</span><select value={schedule.mode} onChange={event => update("mode", event.target.value as BackupSchedule["mode"])}><option value="DAILY">Every day</option><option value="WEEKLY">Selected days</option><option value="INTERVAL">Every few minutes / hours</option></select></label>
            {schedule.mode === "INTERVAL" ? <label className="backup-field"><span>Save a backup every (minutes)</span><input type="number" min={5} max={10080} required value={schedule.intervalMinutes} onChange={event => update("intervalMinutes", Number(event.target.value))} /><small>60 = every hour / 120 = every 2 hours / 1,440 = every 24 hours.</small></label> : <label className="backup-field"><span>Backup time ({schedule.timezone})</span><input type="time" required value={schedule.time} onChange={event => update("time", event.target.value)} /></label>}
            {schedule.mode === "WEEKLY" && <div className="backup-field"><span>Backup days</span><div className="backup-days">{days.map((day, index) => <label key={day}><input type="checkbox" checked={schedule.days.includes(index)} onChange={event => update("days", event.target.checked ? [...schedule.days, index].sort() : schedule.days.filter(value => value !== index))} /><span>{day}</span></label>)}</div></div>}
            <label className="backup-switch closing"><span><strong>Back up after the last counter closes</strong><small>Creates a backup once every counter is closed. Works independently of the timed schedule.</small></span><input type="checkbox" checked={schedule.afterClosing} onChange={event => update("afterClosing", event.target.checked)} /></label>
            <button className="backup-primary" type="submit" disabled={pending}><Save size={16} />{pending ? "Saving..." : "Save schedule"}</button>
          </fieldset>
          {!data.owner && <p className="backup-muted">The owner manages schedules and restores. You can create a backup at any time.</p>}
        </form>
      </section>
      <section className="backup-card backup-storage"><div className="backup-card-title"><span className="backup-status-icon green"><FolderLock size={21} /></span><div><h2>Separate, encrypted storage</h2><p>Your backups stay outside the live database.</p></div></div><label className="backup-field"><span>Server storage directory</span><input value={data.directory} readOnly /></label><p className="backup-muted">To use another disk or folder, set <code>BACKUP_DIRECTORY</code> on the server and restart the app. This is a server folder, not a browser download location.</p><ul><li><Check size={16} />Includes restaurant records, accounts, settings, and uploaded images.</li><li><Check size={16} />Encrypted and checked before an archive is marked complete.</li><li><Check size={16} />No automatic deletion. Every completed backup stays available.</li><li><Check size={16} />Restore is verified in a new database before you switch.</li></ul><div className="backup-recovery-note"><ShieldCheck size={20} /><p>Keep a copy of your backups on another disk or device. Save your original <code>AUTH_SECRET</code> and, if configured, <code>BACKUP_ENCRYPTION_KEY</code> securely. Both are needed for recovery on another computer.</p></div><p className="backup-muted">Automatic backups need this app service to be running and this directory to be available.</p></section>
    </div>

    <section className="backup-card backup-drive" aria-labelledby="backup-drive-title">
      <div className="backup-drive-heading">
        <div className="backup-card-title"><span className={`backup-status-icon ${driveReady ? "green" : drive.connected ? "amber" : "blue"}`}><Cloud size={21} /></span><div><h2 id="backup-drive-title">Google Drive copy</h2><p>An off-site copy of each encrypted backup, kept in your restaurant&apos;s Google Drive.</p></div></div>
        {data.owner && drive.configured && <div className="backup-drive-actions">
          {drive.connected && drive.folderUrl && <a className="backup-secondary" href={drive.folderUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />Open folder</a>}
          {/* A full navigation, not <Link>: prefetching would start an OAuth request. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          {(!drive.connected || drive.needsReconnect) && <a className="backup-primary" href="/api/backups/google/connect"><Cloud size={16} />{drive.connected ? "Reconnect Google Drive" : "Connect Google Drive"}</a>}
          {drive.connected && <button type="button" className="backup-secondary" disabled={pending} onClick={() => start(async () => { const result = await disconnectGoogleDrive(); setMessage(result.ok ? "Google Drive disconnected. Backups already in Drive were kept." : result.message); await refresh(); })}><Unplug size={15} />Disconnect</button>}
        </div>}
      </div>
      {!drive.configured ? <p className="backup-muted">Google Drive is not set up on this server yet. The system administrator must set <code>GOOGLE_DRIVE_CLIENT_ID</code>, <code>GOOGLE_DRIVE_CLIENT_SECRET</code> and <code>GOOGLE_DRIVE_REDIRECT_URI</code>, then restart the app.</p>
        : !drive.connected ? <p className="backup-muted">{data.owner ? "Connect the restaurant's Google account. The app can only see the backup files it creates, not the rest of your Drive." : "Not connected. The owner can connect Google Drive."}</p>
        : <>
          <div className="backup-drive-status">
            <p><Check size={15} />{drive.email ? <>Connected to <strong>{drive.email}</strong></> : "Connected"}</p>
            <p><Clock3 size={15} />{drive.lastUploadAt ? <>Last copy uploaded {date(drive.lastUploadAt)}</> : "No backup uploaded yet"}</p>
          </div>
          {drive.needsReconnect && <p className="backup-drive-alert" role="alert">Google Drive access was revoked or has expired. Uploads are paused until the owner reconnects.</p>}
          {!drive.needsReconnect && drive.lastError && <p className="backup-drive-alert" role="alert">Last upload failed: {drive.lastError}</p>}
          {data.owner && <form className="backup-drive-form" onSubmit={event => { event.preventDefault(); start(async () => { const result = await saveDriveSettings({ enabled: driveEnabled, mode: driveMode }); setMessage(result.ok ? "Google Drive settings saved." : result.message); await refresh(); }); }}>
            <fieldset disabled={pending}>
              <label className="backup-switch"><span><strong>Upload new backups to Google Drive</strong><small>Manual, scheduled and after-closing backups are copied after they are saved locally. A failed upload never affects the local backup.</small></span><input type="checkbox" checked={driveEnabled} onChange={event => setDriveEnabled(event.target.checked)} /></label>
              <label className="backup-field"><span>How often</span><select value={driveMode} onChange={event => setDriveMode(event.target.value as typeof driveMode)}><option value="DAILY">One copy per day (first backup of each day)</option><option value="EVERY">Every backup</option></select><small>Copies are never deleted automatically. Choose one per day if you back up every hour, to save Drive space.</small></label>
              <button className="backup-primary" type="submit"><Save size={16} />{pending ? "Saving..." : "Save Drive settings"}</button>
            </fieldset>
          </form>}
        </>}
    </section>

    <section className="backup-card backup-history"><div className="backup-history-heading"><div><p className="eyebrow">RECOVERY POINTS</p><h2>Saved backups <span>{data.files.length}</span></h2></div><button type="button" className="backup-secondary" onClick={() => void refresh()}><RefreshCw size={15} />Refresh</button></div>{data.files.length ? <div className="backup-table-scroll"><table><thead><tr><th>Created</th><th>Trigger</th><th>Size</th><th>Records</th><th>Recovery</th></tr></thead><tbody>{data.files.map(file => <tr key={file.id}><td><strong>{date(file.createdAt)}</strong><small>{file.id}</small></td><td><span className="backup-reason">{reason(file.reason)}</span></td><td>{size(file.bytes)}</td><td>{file.documents.toLocaleString()}</td><td>{data.owner ? <div className="backup-file-actions"><a href={`/api/backups/${file.id}`}><Download size={14} />Download</a><button type="button" disabled={pending || activeJob} onClick={() => { setRestoreError(""); setRestoreId(file.id); }}><RotateCcw size={14} />Restore safely</button>{file.inDrive ? <span className="backup-in-drive"><Cloud size={13} />In Drive</span> : driveReady && <button type="button" disabled={pending || activeJob} onClick={() => start(async () => { const result = await requestDriveUpload(file.id); setMessage(result.ok ? "Google Drive upload queued." : result.message); await refresh(); })}><CloudUpload size={14} />Upload to Drive</button>}</div> : file.inDrive ? <span className="backup-in-drive"><Cloud size={13} />In Drive</span> : <span className="backup-muted">Owner only</span>}</td></tr>)}</tbody></table></div> : <div className="backup-empty"><HardDrive size={34} /><h3>Your first backup belongs here</h3><p>Choose “Back up now” or enable an automatic schedule.</p></div>}</section>

    <section className="backup-card backup-job-history"><div className="backup-history-heading"><div><p className="eyebrow">BACKGROUND ACTIVITY</p><h2>Recent operations</h2></div></div>{data.jobs.length ? data.jobs.map(job => <article key={job.id}><div><span className={`backup-job-state ${job.status.toLowerCase()}`}>{["QUEUED", "RUNNING"].includes(job.status) && <LoaderCircle size={12} />}{job.status === "SUCCEEDED" ? "Complete" : job.status.toLowerCase()}</span><strong>{job.type === "RESTORE" ? `Prepare restore / ${reason(job.reason)}` : job.type === "DRIVE_UPLOAD" ? "Upload to Google Drive" : `Create backup / ${reason(job.reason)}`}</strong><small>{date(job.createdAt)}</small></div>{job.message && <p role={job.status === "FAILED" ? "alert" : undefined}>{job.message}</p>}{job.drive && job.type === "BACKUP" && <p role={job.drive.status === "FAILED" ? "alert" : undefined}>{job.drive.status === "UPLOADED" ? "Copied to Google Drive." : `Google Drive copy failed: ${job.drive.message}`}</p>}{job.database && <div className="backup-restore-result"><ShieldCheck size={20} /><div><strong>Restore verified: {job.database}</strong><p>The current database has not changed. Stop the app, run the command below from the project folder, then start the app again. All users must sign in again.</p><code>npm run backup -- switch --database {job.database} --confirm SWITCH</code><p>The switch command updates a local <code>.env.local</code> setup. For a hosted service, change its <code>MONGODB_URI</code> database name to this verified database and restart. Keep the same encryption keys.</p></div></div>}</article>) : <p className="backup-muted">Backup and restore jobs will appear here.</p>}</section>

    {restoreId && <dialog ref={dialog} className="backup-restore-dialog" aria-labelledby="backup-restore-title" onCancel={event => { event.preventDefault(); if (!pending) setRestoreId(null); }}><form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); start(async () => { const result = await requestBackupRestore({ backupId: restoreId, password: String(form.get("password") ?? ""), code: String(form.get("code") ?? ""), confirmation: String(form.get("confirmation") ?? "") }); if (result.ok) { setRestoreId(null); setMessage("Restore queued. A fresh safety backup will be taken before the separate restore database is prepared."); await refresh(); } else setRestoreError(result.message); }); }}><header><span className="backup-status-icon violet"><RotateCcw size={23} /></span><button type="button" disabled={pending} aria-label="Close restore" onClick={() => setRestoreId(null)}><X size={20} /></button></header><h2 id="backup-restore-title">Prepare a safe restore</h2><p>This backup will be restored into a new database and checked. Your current database stays intact. Switch only after the restore is marked complete.</p><p className="backup-selected-file">{restoreId}</p>{restoreError && <p className="backup-message" role="alert">{restoreError}</p>}<label className="backup-field"><span>Owner password</span><input name="password" type="password" autoComplete="current-password" required autoFocus /></label><label className="backup-field"><span>Authenticator or recovery code (if enabled)</span><input name="code" autoComplete="one-time-code" maxLength={64} /></label><label className="backup-field"><span>Type RESTORE to confirm</span><input name="confirmation" required pattern="RESTORE" autoComplete="off" /></label><footer><button type="button" className="backup-secondary" disabled={pending} onClick={() => setRestoreId(null)}>Cancel</button><button type="submit" className="backup-primary" disabled={pending}>{pending ? "Queuing..." : "Prepare restore"}</button></footer></form></dialog>}
  </main>;
}

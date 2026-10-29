import { BackupSettings } from "@/components/backup-settings";
import { loadBackupSettings } from "./actions";

export default async function BackupSettingsPage({ searchParams }: { searchParams: Promise<{ drive?: string | string[] }> }) {
  const { drive } = await searchParams;
  return <BackupSettings initial={await loadBackupSettings()} driveNotice={typeof drive === "string" ? drive : ""} />;
}

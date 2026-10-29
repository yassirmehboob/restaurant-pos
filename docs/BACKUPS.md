# Restaurant backups and recovery

Open **Setup → Backups & Restore** (`/settings/backups`). Owners and cashiers with
the **Create restaurant backups** permission can select **Back up now**. Owners
alone can configure schedules, download full archives, or request a restore.
Cashiers with an existing custom permission list need the new permission enabled
by the owner. Default cashier accounts receive it automatically.

## Storage and service

Restart `npm run dev` or `npm start` after installing this feature. These commands
start a background backup worker automatically, independently of browser tabs.
Deployments that run Next.js directly must also run `npm run worker:backups` as a
managed background service. Multiple workers elect a database-backed leader.

By default archives are stored in `../restaurant-pos-backups/<businessId>/`,
outside the application project and live MongoDB database. Set an absolute
`BACKUP_DIRECTORY` in the app environment to use another persistent disk or folder:

```dotenv
BACKUP_DIRECTORY=D:\RestaurantBackups
```

The service account needs read/write access. Storage under `public`, `.next`,
`.git`, and `node_modules` is refused. Files are created with restrictive
permissions where supported; configure Windows folder ACLs for the app service
account. The settings screen displays the resolved server directory. Browser
downloads do not change that location. No automatic deletion is enabled.

Backups are compressed BSON Extended JSON, encrypted and authenticated with
AES-256-GCM. A stable, random `BACKUP_ENCRYPTION_KEY` of at least 32 characters can
be configured; otherwise `AUTH_SECRET` supplies the encryption key. Save the
original `AUTH_SECRET` and the optional backup key securely away from the server.
Losing these secrets prevents recovery. Changing `AUTH_SECRET` also prevents
restoring encrypted authenticator and SMS settings from older archives.

The `.rpos` archive is self-contained. The adjacent `.json` sidecar is only a
listing summary; restore verifies the encrypted archive itself. Copy completed
archives to another disk/device for hardware failure protection. Do not copy
temporary `.tmp` files. Keep application source/releases and deployment secrets
separately: a data backup does not contain the application executable or `.env`.

## Google Drive copies

The owner can connect the restaurant's Google account under **Setup → Backups &
Restore → Google Drive copy**. The backup worker then uploads each new encrypted
`.rpos` archive to a **Restaurant POS Backups - <restaurant name>** folder in
that Drive. The app requests only Google's `drive.file` permission, so it can see
and manage only the files it created, not the rest of the Drive.

- **How often:** *One copy per day* (the default) uploads the first backup of each
  restaurant-local day. *Every backup* uploads all manual, scheduled and
  after-closing backups. Pre-restore safety backups stay local.
- The upload happens after the local archive is complete. Google's MD5 checksum
  and size are compared with the local file. A failed upload never fails or
  removes the local backup. The failure is shown in **Recent operations** and on
  the Drive card. The owner can select **Upload to Drive** beside any saved
  backup to retry, or to upload an older one. A backup already in the folder is
  not uploaded twice.
- Drive copies are never deleted automatically. Remove old ones in Google Drive
  when space runs low. Each copy is the same size as the local archive.
- If access is revoked or expires, uploads pause and the card asks the owner to
  **Reconnect Google Drive**. **Disconnect** revokes the app's access and keeps
  the files already in Drive.
- The Drive copy is encrypted like the local one. To restore it, you need the
  original `AUTH_SECRET` (and `BACKUP_ENCRYPTION_KEY`, if set). Keep those
  separately, never in the same Drive. To recover from Drive, download the
  `.rpos` file and use the commands in *Recovery on another computer*.
- The connection token is stored AES-256-GCM encrypted with a key derived from
  `AUTH_SECRET` and bound to the restaurant. A restored database keeps the
  connection but with uploads switched off until the owner reviews them.

### One-time Google setup (server administrator)

The Google Cloud OAuth client belongs to whoever runs this server, not to a
restaurant. One client serves every restaurant on the server. Each owner only
selects **Connect Google Drive** and approves access to their own Google account.

1. In [Google Cloud Console](https://console.cloud.google.com/), create or
   select a project, then enable the **Google Drive API**.
2. Under **Google Auth Platform**, configure the consent screen for an
   **External** app with your product name and support email. Add the scope
   `https://www.googleapis.com/auth/drive.file`.
3. Create an **OAuth client ID** of type **Web application**. Add the authorized
   redirect URI, for example `http://localhost:3000/api/backups/google/callback`
   for local use, or
   `https://pos.your-restaurant.example/api/backups/google/callback` in production.
4. Set all three values in `.env.local` (or the host's secrets), then restart the
   app and any separately managed backup worker:

   ```dotenv
   GOOGLE_DRIVE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_DRIVE_CLIENT_SECRET=...
   GOOGLE_DRIVE_REDIRECT_URI=http://localhost:3000/api/backups/google/callback
   ```

5. **Publish the app** (Audience → *In production*). While it is in *Testing*
   status, Google expires the connection after seven days and uploads stop until
   the owner reconnects. `drive.file` is not a restricted scope. Google may still
   show an "unverified app" notice until brand verification is completed.

`GOOGLE_DRIVE_REDIRECT_URI` must match the registered URI exactly and end with
`/api/backups/google/callback`. Owners must open the app at that same address
(for example `localhost`, not `127.0.0.1`) when connecting. Use HTTPS for any
address other than localhost. Keeping the same client ID keeps existing
connections. A different client ID requires every owner to reconnect.

## Schedules

- **Every day:** one backup at the selected restaurant-local time.
- **Selected days:** select weekdays and a local backup time.
- **Interval:** every 5 to 10,080 minutes; 60 means hourly, 120 every two hours.
- **After closing:** when the last open sale counter for the restaurant has
  closed, create another backup. This option works independently of timed backups.

The worker checks every 15 seconds. It does not interrupt a cashier's screen.
Jobs and due times survive app restarts. An overdue schedule creates one recovery
point on resumption, then moves to the next future time; it cannot reconstruct
snapshots of times when the service was stopped. Last-closing backups are detected
once no counter remains open; they run when the worker next checks. Ensure the
closing backup completes before turning off the machine. Failed jobs remain in
history with a useful error and can be retried with **Back up now**.

MongoDB must support snapshot transactions (replica set or Atlas), as required by
the app's sale-session operations. The default uncompressed archive limit is
256 MiB (`BACKUP_MAX_SIZE_MB`, configurable up to 2,048 MiB); snapshots use memory
and must fit MongoDB's transaction time limits. Oversized/slow snapshots fail
without publishing a completed backup. Use MongoDB's managed/database backup
tooling for larger installations. See [MongoDB transactions](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/)
and [Extended JSON](https://www.mongodb.com/docs/drivers/node/current/data-formats/extended-json/).

## What is saved

Each archive contains one restaurant's business record, user accounts, orders,
payments, sale sessions, catalog, deals, tables, staff, customers, expenses,
audit history, waiter requests, SMS history/settings, backup schedule and images
stored in GridFS, together with collection indexes. ObjectIds, dates, binary image
bytes and other BSON types retain their types. Other restaurants' data is excluded.
Transient authentication throttles, revoked-session records and backup worker/job
state are not restored.

## Restore from the settings page

1. Choose **Restore safely** beside a saved archive.
2. Enter the current owner password, a fresh authenticator/recovery code when
   enabled, and type `RESTORE`.
3. The worker makes a fresh safety backup, decrypts and validates the selected
   archive, restores it into a new uniquely named database, recreates indexes and
   compares restored records against the archive. Failure leaves the live database
   untouched. Partial restore databases are never marked verified and cannot be
   selected with the switch command.
4. When the operation is complete, stop the app and all separately managed workers.
   Run the exact switch command shown in the completed job:

   ```powershell
   npm run backup -- switch --database restaurant_pos_restore_TIMESTAMP_RANDOM --confirm SWITCH
   ```

   This updates only a locally managed `.env.local` MongoDB database selection,
   preserving credentials, authentication source and connection options. It refuses
   a running app detected through the app launcher's process marker. For an externally
   managed environment, set its `MONGODB_URI` database name to the verified database
   instead. Do not change the encryption keys.
5. Start the app and workers again and sign in. Verify totals, menu, images and
   the restored sale date before resuming trade. Keep the original database until
   the restored system has been checked.

Restored users receive new authentication versions, invalidating archived browser
sessions. Push registrations are cleared and pending/in-flight SMS messages are
marked skipped, preventing old messages from being resent. Restored backup schedules
are disabled until the owner reviews and enables them again. Existing open sale
sessions represent the selected recovery point and should be reviewed before use.

The restore database contains **only the selected restaurant**. If the current
server hosts other restaurants, the switch command refuses to redirect the shared
app: run a separate app instance against the verified restore database instead.
The database account needs permission to create/write the separate restore database
and recreate its indexes. Source-database access alone is insufficient.

## Recovery on another computer

Install the matching app version and configure a reachable MongoDB replica set,
the original `AUTH_SECRET` and optional `BACKUP_ENCRYPTION_KEY`. Then:

```powershell
npm run backup -- verify --file "D:\Recovery\saved-backup.rpos"
npm run backup -- restore --file "D:\Recovery\saved-backup.rpos" --confirm RESTORE
```

The second command imports the archive into the configured backup directory and
prints a verified new database name. Point the stopped app at that database, or
use the switch command, and restart. The CLI is intended for a trusted server
administrator; it does not require an existing browser login on a failed server.
Neither command prints database credentials or encryption keys.

For server-side manual backup and listing:

```powershell
npm run backup -- create --business BUSINESS_OBJECT_ID
npm run backup -- list --business BUSINESS_OBJECT_ID
```

To return to the original database after a switch, stop the app and use
`npm run backup -- switch --database ORIGINAL_DATABASE --confirm SWITCH`. This is
accepted only when the currently restored database's verified marker records that
original database. No databases or old backups are automatically deleted.

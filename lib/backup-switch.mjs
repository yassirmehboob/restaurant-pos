export function mongoDatabaseUri(uri, database, authSource) {
  if (!/^restaurant_pos_restore_\d{13}_[a-f\d]{10}$/.test(database) && !/^[a-zA-Z0-9_-]{1,63}$/.test(database)) throw new Error("Invalid database name.");
  const match = /^(mongodb(?:\+srv)?:\/\/[^/]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri);
  if (!match) throw new Error("Could not read the database URI.");
  const query = new URLSearchParams((match[2] || "").replace(/^\?/, ""));
  if (authSource && !query.has("authSource")) query.set("authSource", authSource);
  return `${match[1]}/${database}${query.size ? `?${query}` : ""}`;
}

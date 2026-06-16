// Encrypted local key store for API keys added through the Web UI.
//
// Storage layout:
//   data/keys.enc.json  -- AES-256-GCM ciphertext, IV + auth tag + payload
//   data/master.key     -- 32-byte random key, only created when no
//                          OPENRELAY_KEYSTORE_SECRET is set
//
// Threat model: the store protects the file on disk at rest (so a
// casual `cat data/keys.enc.json` does not leak real keys). It is
// **not** a system-level keychain: anyone with read access to the
// `data/` directory and either the master.key file or the env var
// can decrypt. The README is explicit about that.
//
// This store never returns the plaintext value, the encryptedValue
// blob, or anything else sensitive through its public API. The
// `getDecryptedValue` and `getDecryptedValuesForProvider` helpers
// are server-internal and must not be exposed to HTTP handlers.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SCRYPT_SALT = "openrelay-local-safe/keystore-salt/v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export class SecretStore {
  constructor({ dataDir, env = process.env, now = () => new Date(), random = randomBytes, readOnly = false }) {
    if (!dataDir) throw new Error("SecretStore: dataDir is required");
    this.dataDir = dataDir;
    this.env = env;
    this.now = now;
    this.random = random;
    this.readOnly = readOnly === true;
    this.storePath = resolve(dataDir, "keys.enc.json");
    this.masterKeyPath = resolve(dataDir, "master.key");
    this.records = new Map();
    this.dirty = false;
    this._ensureLoaded();
  }

  _ensureLoaded() {
    this.masterKey = this._loadOrCreateMasterKey();
    if (existsSync(this.storePath)) {
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(this.storePath, "utf8"));
      } catch (error) {
        throw new Error(
          `failed to parse ${this.storePath}: ${error.message}. ` +
            `Move the file aside and start over; the keys in it cannot be recovered.`
        );
      }
      if (!Array.isArray(parsed.records)) {
        throw new Error(`${this.storePath} is missing the records[] field`);
      }
      for (const record of parsed.records) {
        if (!record || !record.id || !record.encryptedValue) {
          throw new Error(`${this.storePath} contains a malformed record`);
        }
        this.records.set(record.id, record);
      }
    }
  }

  _loadOrCreateMasterKey() {
    if (this.env.OPENRELAY_KEYSTORE_SECRET) {
      return scryptSync(String(this.env.OPENRELAY_KEYSTORE_SECRET), SCRYPT_SALT, KEY_BYTES);
    }
    if (existsSync(this.masterKeyPath)) {
      const buf = readFileSync(this.masterKeyPath);
      if (buf.length !== KEY_BYTES) {
        throw new Error(
          `${this.masterKeyPath} is ${buf.length} bytes; expected ${KEY_BYTES}. ` +
            `Move the file aside and start over (this will lose access to existing keys).`
        );
      }
      return buf;
    }
    if (this.readOnly) return null;
    const key = this.random(KEY_BYTES);
    mkdirSync(dirname(this.masterKeyPath), { recursive: true });
    writeFileSync(this.masterKeyPath, key, { mode: 0o600 });
    return key;
  }

  _encrypt(plaintext) {
    if (!this.masterKey) throw new Error("SecretStore has no master key available");
    const iv = this.random(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      v: 1,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };
  }

  _decrypt(blob) {
    if (!this.masterKey) throw new Error("SecretStore has no master key available");
    if (!blob || typeof blob !== "object") throw new Error("encryptedValue is not an object");
    if (blob.v !== 1) throw new Error(`unsupported encryptedValue version: ${blob.v}`);
    const decipher = createDecipheriv("aes-256-gcm", this.masterKey, Buffer.from(blob.iv, "base64"));
    decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(blob.ciphertext, "base64")),
      decipher.final()
    ]);
    return plaintext.toString("utf8");
  }

  // --- public API ---

  list({ provider } = {}) {
    const out = [];
    for (const record of this.records.values()) {
      if (provider && record.provider !== provider) continue;
      out.push(this._publicView(record));
    }
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return out;
  }

  get(id) {
    const record = this.records.get(id);
    return record ? this._publicView(record) : null;
  }

  // Server-internal: only call this from request handlers you trust
  // (never expose the return value over HTTP). Used by the proxy to
  // get the actual bearer value to put in the Authorization header.
  getDecryptedValue(id) {
    const record = this.records.get(id);
    if (!record) return null;
    if (record.enabled === false) return null;
    return this._decrypt(record.encryptedValue);
  }

  // Server-internal: list enabled keys for a provider. Used by the
  // KeyPool to combine web keys with .env keys.
  getDecryptedValuesForProvider(providerName) {
    const out = [];
    for (const record of this.records.values()) {
      if (record.provider !== providerName) continue;
      if (record.enabled === false) continue;
      try {
        out.push({
          id: record.id,
          value: this._decrypt(record.encryptedValue),
          label: record.label,
          hash: record.hash
        });
      } catch {
        // Surface as a broken record; KeyPool will skip it.
      }
    }
    return out;
  }

  add({ provider, value, label, enabled = true }) {
    if (this.readOnly) throw new Error("SecretStore is read-only");
    if (!provider || typeof provider !== "string") throw new Error("provider is required");
    if (!value || typeof value !== "string") throw new Error("value is required");
    const id = `key_${this.random(8).toString("hex")}`;
    const nowIso = this.now().toISOString();
    const record = {
      id,
      provider,
      label: typeof label === "string" ? label.trim().slice(0, 80) : "",
      hash: hashKeyValue(value),
      masked: maskKeyValue(value),
      enabled: enabled !== false,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastUsedAt: null,
      lastTestAt: null,
      lastTestResult: null,
      source: "web",
      encryptedValue: this._encrypt(value)
    };
    this.records.set(id, record);
    this._persist();
    return this._publicView(record);
  }

  update(id, patch) {
    if (this.readOnly) throw new Error("SecretStore is read-only");
    const record = this.records.get(id);
    if (!record) return null;
    if (patch.label !== undefined) {
      record.label = String(patch.label).trim().slice(0, 80);
    }
    if (patch.enabled !== undefined) {
      record.enabled = !!patch.enabled;
    }
    if (patch.value !== undefined) {
      const value = String(patch.value);
      if (!value) throw new Error("value is required");
      record.hash = hashKeyValue(value);
      record.masked = maskKeyValue(value);
      record.encryptedValue = this._encrypt(value);
    }
    record.updatedAt = this.now().toISOString();
    this.records.set(id, record);
    this._persist();
    return this._publicView(record);
  }

  remove(id) {
    if (this.readOnly) throw new Error("SecretStore is read-only");
    const existed = this.records.delete(id);
    if (existed) this._persist();
    return existed;
  }

  // Server-internal: called from proxyWithRetry after a key is used.
  // Touches only in-memory state; we do not persist on every request
  // to avoid disk thrash. The most recent lastUsedAt is flushed on
  // shutdown, test, or any explicit save. This is intentional: a
  // crash leaves lastUsedAt a few minutes stale, which is fine.
  markUsed(id) {
    const record = this.records.get(id);
    if (!record) return;
    record.lastUsedAt = this.now().toISOString();
  }

  recordTestResult(id, result) {
    if (this.readOnly) throw new Error("SecretStore is read-only");
    const record = this.records.get(id);
    if (!record) return;
    record.lastTestAt = this.now().toISOString();
    record.lastTestResult = result;
    this._persist();
  }

  flush() {
    if (this.readOnly) return;
    if (this.dirty) this._persist();
  }

  hasMasterKeyOnDisk() {
    return existsSync(this.masterKeyPath);
  }

  hasMasterKeyInEnv() {
    return !!this.env.OPENRELAY_KEYSTORE_SECRET;
  }

  // --- internals ---

  _persist() {
    if (this.readOnly) throw new Error("SecretStore is read-only");
    const payload = {
      version: 1,
      savedAt: this.now().toISOString(),
      records: Array.from(this.records.values())
    };
    mkdirSync(dirname(this.storePath), { recursive: true });
    const tempPath = `${this.storePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
    renameSync(tempPath, this.storePath);
    this.dirty = false;
  }

  _publicView(record) {
    // Strip the encryptedValue. Every method that returns a record
    // goes through this so the HTTP surface never accidentally leaks
    // the ciphertext blob either.
    const { encryptedValue, ...rest } = record;
    return rest;
  }
}

function maskKeyValue(value) {
  if (!value || value.length <= 10) return "***";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function hashKeyValue(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

import { buildLocalConnectorConsentManifest } from "./local-connector-consent-manifest.js";

export const LOCAL_CONNECTOR_CONSENT_APPROVE_CONFIRMATION = "APPROVE_LOCAL_CONNECTOR_CONSENT";
export const LOCAL_CONNECTOR_CONSENT_REVOKE_CONFIRMATION = "REVOKE_LOCAL_CONNECTOR_CONSENT";

const CONSENT_VERSION = "local-connector-consent.v1";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeConnectorId(value) {
  const id = String(value || "").trim();
  return /^[a-z0-9_-]{2,64}$/.test(id) ? id : "";
}

function normalizeLedgerEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  if (entry.approved !== true) return null;
  const approvedAt = typeof entry.approvedAt === "string" && entry.approvedAt
    ? entry.approvedAt
    : null;
  return {
    approved: true,
    approvedAt,
    consentVersion: typeof entry.consentVersion === "string" && entry.consentVersion
      ? entry.consentVersion
      : CONSENT_VERSION,
    connectorId: safeConnectorId(entry.connectorId) || null,
    connectorName: typeof entry.connectorName === "string" ? entry.connectorName.slice(0, 120) : "",
    credentialScope: typeof entry.credentialScope === "string" ? entry.credentialScope : "manual_review",
    riskLevel: typeof entry.riskLevel === "string" ? entry.riskLevel : "high",
    requiredConsent: Array.isArray(entry.requiredConsent)
      ? entry.requiredConsent.map((item) => String(item)).filter(Boolean)
      : [],
    futureActions: Array.isArray(entry.futureActions)
      ? entry.futureActions.map((item) => String(item)).filter(Boolean)
      : [],
    reviewTags: Array.isArray(entry.reviewTags)
      ? entry.reviewTags.map((item) => String(item)).filter(Boolean)
      : [],
    note: typeof entry.note === "string" ? entry.note.slice(0, 240) : ""
  };
}

export function normalizeLocalConnectorConsents(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [rawId, rawEntry] of Object.entries(value)) {
    const id = safeConnectorId(rawId);
    if (!id) continue;
    const entry = normalizeLedgerEntry(rawEntry);
    if (!entry) continue;
    result[id] = { ...entry, connectorId: id };
  }
  return result;
}

export function buildLocalConnectorConsentLedger(options = {}) {
  const version = options.version || "0.3.21";
  const generatedAt = options.generatedAt || new Date().toISOString();
  const ledger = normalizeLocalConnectorConsents(options.ledger || {});
  const manifest = options.manifest || buildLocalConnectorConsentManifest({
    version,
    generatedAt,
    platform: options.platform || "auto",
    commandExists: options.commandExists
  });
  const manifests = Array.isArray(manifest.manifests) ? manifest.manifests : [];
  const records = manifests.map((item) => {
    const stored = ledger[item.id] || null;
    return {
      id: item.id,
      name: item.name,
      providerName: item.providerName,
      credentialScope: item.credentialScope,
      riskLevel: item.riskLevel,
      requiredConsent: item.requiredConsent || [],
      futureActions: item.futureActions || [],
      reviewTags: item.reviewTags || [],
      consentStatus: stored ? "stored" : "not_stored",
      approvalState: stored ? "approved_metadata_only" : "not_approved",
      approvedAt: stored?.approvedAt || null,
      canReadCredentialsNow: false,
      canRegisterRoutesNow: false,
      blockers: stored
        ? ["credential_reader_not_implemented", "route_registration_not_implemented"]
        : ["explicit_user_consent_required", "security_review_required"],
      safety: {
        readsTokens: false,
        readsCookies: false,
        readsSessionStorage: false,
        readsBrowserProfiles: false,
        readsIdeCredentials: false,
        readsKeychain: false,
        returnsLocalPaths: false,
        writesConfig: false,
        storesConsent: false,
        startsProcess: false,
        startsNetworkListener: false,
        registersRoutes: false
      }
    };
  });
  const approved = records.filter((item) => item.consentStatus === "stored").length;
  const staleIds = Object.keys(ledger).filter((id) => !records.some((item) => item.id === id));

  return {
    ok: true,
    version,
    mode: "dry-run",
    dryRunOnly: true,
    generatedAt,
    platform: manifest.platform || options.platform || "auto",
    approveEndpoint: "/admin/local-connector-consent",
    requiredConfirmation: LOCAL_CONNECTOR_CONSENT_APPROVE_CONFIRMATION,
    revokeConfirmation: LOCAL_CONNECTOR_CONSENT_REVOKE_CONFIRMATION,
    summary: {
      total: records.length,
      approved,
      notApproved: records.length - approved,
      staleRecords: staleIds.length,
      credentialReads: 0,
      pathsDisclosed: 0,
      processesStarted: 0,
      routesRegistered: 0,
      configWrites: 0,
      consentStored: approved
    },
    safety: {
      dryRunOnly: true,
      readsTokens: false,
      readsCookies: false,
      readsSessionStorage: false,
      readsBrowserProfiles: false,
      readsIdeCredentials: false,
      readsKeychain: false,
      returnsLocalPaths: false,
      writesConfig: false,
      startsProcess: false,
      startsNetworkListener: false,
      registersRoutes: false,
      storesConsent: false,
      requiresExplicitConfirmation: true
    },
    records,
    staleRecords: staleIds.map((id) => ({ id, approvedAt: ledger[id]?.approvedAt || null }))
  };
}

export function buildLocalConnectorConsentCandidate(config, ledger, request, options = {}) {
  const connectorId = safeConnectorId(request?.connector || request?.id);
  if (!connectorId) {
    return { ok: false, error: "connector_required", status: 400 };
  }
  const action = request?.action === "revoke" || request?.revoke === true ? "revoke" : "approve";
  const manifest = options.manifest || buildLocalConnectorConsentManifest({
    version: options.version || "0.3.21",
    generatedAt: options.generatedAt,
    platform: options.platform || "auto",
    commandExists: options.commandExists
  });
  const entry = (manifest.manifests || []).find((item) => item.id === connectorId);
  if (!entry) return { ok: false, error: "connector_not_found", status: 404, connector: connectorId };

  const normalizedLedger = normalizeLocalConnectorConsents(ledger || config?.localConnectorConsents || {});
  if (action === "revoke") {
    delete normalizedLedger[connectorId];
    return {
      ok: true,
      action,
      connector: connectorId,
      candidate: {
        ...clone(config),
        localConnectorConsents: normalizedLedger
      }
    };
  }

  normalizedLedger[connectorId] = {
    approved: true,
    approvedAt: options.generatedAt || new Date().toISOString(),
    consentVersion: CONSENT_VERSION,
    connectorId,
    connectorName: entry.name,
    credentialScope: entry.credentialScope,
    riskLevel: entry.riskLevel,
    requiredConsent: clone(entry.requiredConsent || []),
    futureActions: clone(entry.futureActions || []),
    reviewTags: clone(entry.reviewTags || []),
    note: typeof request?.note === "string" ? request.note.slice(0, 240) : ""
  };

  return {
    ok: true,
    action,
    connector: connectorId,
    candidate: {
      ...clone(config),
      localConnectorConsents: normalizedLedger
    }
  };
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { parseOpenRelayKey } from "./auth.js";

const SIGNING_CONTEXT = "relayforge-routing-key:v1";
const SIGNATURE_HEX_LENGTH = 64;

function normalizeSecret(secret) {
  return typeof secret === "string" ? secret.trim() : "";
}

function signatureForTarget(target, secret) {
  return createHmac("sha256", secret)
    .update(`${SIGNING_CONTEXT}:${target}`, "utf8")
    .digest("hex");
}

export function createRoutingKey(target, secret) {
  const cleanTarget = String(target || "").trim();
  const cleanSecret = normalizeSecret(secret);
  if (!cleanTarget || !cleanSecret) return null;
  return `sk-or-${cleanTarget}-${signatureForTarget(cleanTarget, cleanSecret)}`;
}

export function verifyRoutingKey(token, secret) {
  const parsed = parseOpenRelayKey(token);
  const cleanSecret = normalizeSecret(secret);
  if (!parsed || !cleanSecret || parsed.hex.length !== SIGNATURE_HEX_LENGTH) return null;

  const expected = Buffer.from(signatureForTarget(parsed.target, cleanSecret), "hex");
  const actual = Buffer.from(parsed.hex, "hex");
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  return parsed.target;
}

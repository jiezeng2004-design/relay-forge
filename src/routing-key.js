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
    .
export const ERROR_CODES = {
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN_ORIGIN: "forbidden_origin",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  BAD_REQUEST: "bad_request",
  RATE_LIMIT_EXCEEDED: "rate_limit_exceeded",
  BODY_TOO_LARGE: "body_too_large",
  INVALID_JSON: "invalid_json",
  CONFIG_VALIDATION_FAILED: "config_validation_failed",
  PROVIDER_NOT_FOUND: "provider_not_found",
  ROUTE_NOT_FOUND: "route_not_found",
  KEY_NOT_FOUND: "key_not_found",
  UPSTREAM_ERROR: "upstream_error",
  UPSTREAM_RATE_LIMIT: "upstream_rate_limit",
  INTERNAL_ERROR: "internal_error",
  SAVE_FAILED: "save_failed",
  IMPORT_FAILED: "import_failed"
};

export function buildErrorResponse(code, message, details = null) {
  const response = {
    ok: false,
    error: code,
    message: message || code
  };
  if (details !== null && details !== undefined) {
    response.details = details;
  }
  return response;
}

export function sendError(res, sendJson, code, message, status = 400, details = null) {
  return sendJson(res, buildErrorResponse(code, message, details), status);
}

export function unauthorizedError(sendJson, res, message = "Authentication required") {
  return sendJson(res, buildErrorResponse(ERROR_CODES.UNAUTHORIZED, message), 401);
}

export function forbiddenError(sendJson, res, message = "Access forbidden") {
  return sendJson(res, buildErrorResponse(ERROR_CODES.FORBIDDEN, message), 403);
}

export function notFoundError(sendJson, res, message = "Resource not found") {
  return sendJson(res, buildErrorResponse(ERROR_CODES.NOT_FOUND, message), 404);
}

export function badRequestError(sendJson, res, message = "Bad request", details = null) {
  return sendJson(res, buildErrorResponse(ERROR_CODES.BAD_REQUEST, message, details), 400);
}

export function rateLimitError(sendJson, res, message = "Too many requests", details = null) {
  return sendJson(res, buildErrorResponse(ERROR_CODES.RATE_LIMIT_EXCEEDED, message, details), 429);
}

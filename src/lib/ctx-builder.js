import {
  sanitizedConfig as sanitizedConfigOps,
  editableConfig as editableConfigOps,
  serializeEditableConfig,
  applyEditableConfig as applyEditableConfigOps,
  sanitizeProviderInput,
  sanitizeRouteInput,
  sanitizeProfileInput,
  isKnownModelRef,
  providerNameFromUrl,
  routeNameFromUrl,
  keyIdFromUrl,
  providerNameFromKeyUrl,
  getWritableConfigPath,
  collectProviderReferences,
  collectRouteReferences,
  buildWebKeysByProvider,
  findForbiddenSecretFields,
  validateEditableConfig
} from "./config-ops.js";
import { selectRoute, orderCandidates, getResolvedRouteDailyLimit } from "./route-logic.js";
import {
  isAdminPath,
  isAllowedAdminOrigin,
  isAuthorized,
  isAuthorizedV1,
  sendJson,
  sendHtml,
  sendNoContent,
  unauthorized,
  forbiddenCors,
  withCorsHeaders,
  copyResponseHeaders,
  escapeHtml,
  readJsonBody,
  parseMaybeJson
} from "../http-helpers.js";
import {
  anthropicToOpenAi,
  openAiToAnthropic,
  openAiResponseToAnthropic,
  anthropicResponseToOpenAi,
  openAiResponseToResponses,
  anthropicResponseToResponses,
  responsesToChatPayload
} from "../format-convert.js";
import {
  guardBalanceEndpoint,
  interpretBalanceResponse
} from "../balance.js";
import { resolveRoutePreview } from "../route-preview.js";
import {
  createAnthropicToOpenAiSseBridge,
  createOpenAiToAnthropicSseBridge
} from "../stream-bridge.js";
import { describeAuth, maskToken } from "../auth.js";
import {
  I18N_SUPPORTED_LOCALES,
  I18N_DEFAULT_LOCALE
} from "../i18n.js";
import { isLocalProvider as registryIsLocalProvider } from "../provider-registry.js";
import { normalizeUsage } from "../token-estimate.js";
import {
  resolveActiveProfile,
  profileSummary,
  extractActiveProfileName,
  isProxyPath,
  getLocale,
  isStreamRequested,
  providerHealthHint,
  usageSummary,
  getRouteDailyLimit,
  getProviderDailyLimit,
  getModelDailyLimit,
  isLimitExceeded,
  extractModelIds
} from "./route-logic.js";

/**
 * @typedef {Object} CtxBuilderDeps
 * @property {object} config - Configuration object
 * @property {string} configPath - Path to config file
 * @property {object} keyPool - Key pool instance
 * @property {string} activeProfile - Active profile name
 * @property {object} stats - Server statistics
 * @property {Map} routeRuntime - Route runtime state map
 * @property {object} usage - Usage tracker instance
 * @property {object} healthCache - Health check cache
 * @property {object} modelDiscoveryCache - Model discovery cache
 * @property {object} balanceCache - Balance check cache
 * @property {Array} recentErrors - Recent errors array
 * @property {object} secretStore - Secret store instance
 * @property {object} providerHealth - Provider health tracker
 * @property {object} runtimeStatePersister - Runtime state persister
 * @property {object} requestLog - Request log instance
 * @property {object} providerRegistry - Provider registry instance
 * @property {number} port - Server port
 * @property {string} packageVersion - Package version
 * @property {string} statePath - Path to runtime state file
 * @property {object} relayAuth - Relay auth configuration
 * @property {Array} PROVIDER_TEMPLATES - Provider templates
 * @property {Array} ROUTE_TEMPLATES - Route templates
 * @property {Set} LOCAL_PROVIDER_NAMES - Local provider names
 * @property {Set} SUPPORTED_TABS - Supported dashboard tabs
 * @property {string} rootDir - Root directory
 * @property {Function} loadConfig - Load config function
 * @property {Function} normalizeConfig - Normalize config function
 * @property {Function} KeyPool - KeyPool class constructor
 * @property {Function} getProviderKeys - Get provider keys function
 * @property {Function} renderTokenPrompt - Render token prompt function
 * @property {Function} renderDashboard - Render dashboard function
 * @property {Function} renderSingleTab - Render single tab function
 * @property {Function} buildStatus - Build status function
 * @property {Function} buildHealth - Build health function
 * @property {Function} recordError - Record error function
 * @property {Function} scheduleHealthChecks - Schedule health checks function
 * @property {Function} persistRuntimeState - Persist runtime state function
 * @property {Function} flushRuntimeState - Flush runtime state function
 * @property {Function} incrementProvider - Increment provider stats function
 * @property {Function} incrementRoute - Increment route stats function
 * @property {Function} incrementModel - Increment model stats function
 * @property {Function} testProviderWithKey - Test provider with key function
 * @property {Function} discoverProviderModels - Discover provider models function
 * @property {Function} discoverModelsByUrl - Discover models by URL function
 * @property {Function} checkProviderBalance - Check provider balance function
 * @property {number} MODEL_DISCOVERY_MAX_RESULTS - Max model discovery results
 */

/**
 * Builds the application context object using dependency injection.
 * All dependencies are passed in explicitly for better testability.
 * @param {CtxBuilderDeps} deps - Context dependencies
 * @returns {object} Application context object
 */
export function buildContext(deps) {
  const {
    config: initialConfig,
    configPath: initialConfigPath,
    keyPool: initialKeyPool,
    activeProfile: initialActiveProfile,
    stats,
    routeRuntime,
    usage,
    healthCache,
    modelDiscoveryCache,
    balanceCache,
    recentErrors,
    secretStore,
    providerHealth,
    runtimeStatePersister,
    requestLog,
    providerRegistry,
    port,
    packageVersion,
    statePath,
    relayAuth,
    PROVIDER_TEMPLATES,
    ROUTE_TEMPLATES,
    LOCAL_PROVIDER_NAMES,
    SUPPORTED_TABS,
    rootDir,
    loadConfig,
    normalizeConfig,
    KeyPool,
    getProviderKeys,
    renderTokenPrompt,
    renderDashboard,
    renderSingleTab,
    buildStatus,
    buildHealth,
    recordError,
    scheduleHealthChecks,
    persistRuntimeState,
    flushRuntimeState,
    incrementProvider,
    incrementRoute,
    incrementModel,
    testProviderWithKey,
    discoverProviderModels,
    discoverModelsByUrl,
    checkProviderBalance,
    MODEL_DISCOVERY_MAX_RESULTS
  } = deps;

  let config = initialConfig;
  let configPath = initialConfigPath;
  let keyPool = initialKeyPool;
  let activeProfile = extractActiveProfileName(initialActiveProfile);

  const appState = {
    get config() { return config; },
    set config(v) { config = v; },
    get configPath() { return configPath; },
    set configPath(v) { configPath = v; },
    get keyPool() { return keyPool; },
    set keyPool(v) { keyPool = v; },
    get activeProfile() { return activeProfile; },
    set activeProfile(v) { activeProfile = extractActiveProfileName(v); }
  };

  function syncAppState() {
    appState.config = config;
    appState.configPath = configPath;
    appState.keyPool = keyPool;
    appState.activeProfile = activeProfile;
  }
  syncAppState();

  const ctx = {
    get config() { return appState.config; },
    set config(v) { appState.config = v; config = v; },
    get configPath() { return appState.configPath; },
    set configPath(v) { appState.configPath = v; configPath = v; },
    get keyPool() { return appState.keyPool; },
    set keyPool(v) { appState.keyPool = v; keyPool = v; },
    get activeProfile() { return appState.activeProfile; },
    set activeProfile(v) { appState.activeProfile = extractActiveProfileName(v); activeProfile = appState.activeProfile; },
    stats,
    routeRuntime,
    usage,
    healthCache,
    modelDiscoveryCache,
    balanceCache,
    recentErrors,
    secretStore,
    providerHealth,
    runtimeStatePersister,
    requestLog,
    providerRegistry,
    port,
    packageVersion,
    statePath,
    relayAuth,
    PROVIDER_TEMPLATES,
    ROUTE_TEMPLATES,
    LOCAL_PROVIDER_NAMES,
    renderTokenPrompt,
    isAdminPath,
    isAllowedAdminOrigin,
    isAuthorized,
    isAuthorizedV1,
    sendJson,
    sendHtml,
    sendNoContent,
    unauthorized,
    forbiddenCors,
    withCorsHeaders,
    copyResponseHeaders,
    escapeHtml,
    readJsonBody,
    parseMaybeJson,
    buildStatus: () => buildStatus(ctx),
    buildHealth: () => buildHealth(ctx),
    renderDashboard,
    renderSingleTab,
    SUPPORTED_TABS,
    recordError,
    scheduleHealthChecks,
    persistRuntimeState,
    flushRuntimeState,
    incrementProvider,
    incrementRoute,
    incrementModel,
    getProviderKeys,
    isProxyPath,
    isLocalProvider: (p) => registryIsLocalProvider(p),
    resolveActiveProfile: (name) => resolveActiveProfile(name, config),
    profileSummary: () => profileSummary(config, activeProfile),
    extractActiveProfileName,
    usageSummary: () => usageSummary(usage, config),
    getRouteDailyLimit: (name) => getRouteDailyLimit(name, config),
    getProviderDailyLimit: (name) => getProviderDailyLimit(name, config),
    getModelDailyLimit: (providerName, model) => getModelDailyLimit(providerName, model, config),
    isLimitExceeded: (kind, name, limit) => isLimitExceeded(kind, name, limit, usage),
    isStreamRequested,
    extractModelIds,
    getLocale: (req) => getLocale(req, I18N_SUPPORTED_LOCALES, I18N_DEFAULT_LOCALE),
    providerHealthHint: (p) => providerHealthHint(p, LOCAL_PROVIDER_NAMES),
    sanitizedConfig: () => sanitizedConfigOps(config, activeProfile, getProviderKeys),
    editableConfig: () => editableConfigOps(config, activeProfile),
    serializeEditableConfig,
    applyEditableConfig(candidate, action) {
      const innerDeps = {
        rootDir,
        loadConfig,
        normalizeConfig,
        KeyPool,
        getProviderKeys,
        secretStore,
        routeRuntime,
        recordError,
        scheduleHealthChecks,
        usage,
        config,
        configPath,
        keyPool,
        activeProfile
      };
      const result = applyEditableConfigOps(candidate, action, innerDeps);
      config = innerDeps.config;
      configPath = innerDeps.configPath;
      keyPool = innerDeps.keyPool;
      activeProfile = innerDeps.activeProfile;
      syncAppState();
      return result;
    },
    validateEditableConfig: (candidate) => validateEditableConfig(candidate, normalizeConfig),
    sanitizeProviderInput,
    sanitizeRouteInput,
    sanitizeProfileInput,
    isKnownModelRef: (model) => isKnownModelRef(model, config),
    providerNameFromUrl,
    routeNameFromUrl,
    keyIdFromUrl,
    providerNameFromKeyUrl,
    getWritableConfigPath: () => getWritableConfigPath(rootDir),
    collectProviderReferences: (n) => collectProviderReferences(n, config, secretStore),
    collectRouteReferences: (n) => collectRouteReferences(n, config),
    buildWebKeysByProvider: (w) => buildWebKeysByProvider(w || secretStore.list()),
    findForbiddenSecretFields,
    testProviderWithKey,
    discoverProviderModels,
    discoverModelsByUrl,
    checkProviderBalance,
    selectRoute: (model) => selectRoute(model, config, activeProfile, providerHealth, routeRuntime),
    orderCandidates: (route) => orderCandidates(route, providerHealth, routeRuntime),
    getResolvedRouteDailyLimit,
    normalizeUsage,
    anthropicToOpenAi,
    openAiToAnthropic,
    openAiResponseToAnthropic,
    anthropicResponseToOpenAi,
    openAiResponseToResponses,
    anthropicResponseToResponses,
    responsesToChatPayload,
    createAnthropicToOpenAiSseBridge,
    createOpenAiToAnthropicSseBridge,
    guardBalanceEndpoint,
    interpretBalanceResponse,
    resolveRoutePreview,
    describeAuth,
    maskToken,
    I18N_SUPPORTED_LOCALES,
    I18N_DEFAULT_LOCALE
  };

  return { ctx, syncAppState };
}

export { buildContext as default };

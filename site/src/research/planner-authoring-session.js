import { canonicalJson } from "./canonical.js";
import { PLANNER_RESULT_SCHEMA, PlannerCommandError, commandFailure, commandOwner,
  commandField, commandConsequence, exactCommandKeys, validateCommandJson, validatePlannerCommand, validateSettingValue } from "./planner-authoring-contract.js";

const RETRY_LIMIT = 1024;
const RETRY_BYTES = 8 * 1024 * 1024;
const MAX_ISSUES = 64;
const RESULT_RESERVATION = 512 * 1024;
const COMPACT_BYTES = 64 * 1024;

function compact(value) {
  validateCommandJson(value);
  if (new TextEncoder().encode(canonicalJson(value)).byteLength > COMPACT_BYTES) {
    commandFailure("result_limit", "Return a compact receipt; inspect full content through its owner.");
  }
  return structuredClone(value);
}

function consequenceArguments(descriptor, args) {
  exactCommandKeys(args, descriptor.arguments.required);
  // The owner validates domain-specific types/ranges during read-only preparation.
  // This coordinator owns the closed argument vocabulary, not another validator.
}

// Bound retained result metadata before publication, including owner/observer
// failures. This keeps the 512 KiB retry-result reservation a real upper bound,
// including worst-case JSON escaping of every retained string.
function boundedIssues(issues) {
  return issues.slice(0, MAX_ISSUES).map(issue => ({
    owner: typeof issue?.owner === "string" && /^P[1-7]$/u.test(issue.owner) ? issue.owner : null,
    field: typeof issue?.field === "string" ? issue.field.slice(0, 163) : null,
    code: typeof issue?.code === "string" ? issue.code.slice(0, 80) : "owner_failed",
    message: typeof issue?.message === "string" ? issue.message.slice(0, 512) : "The owner could not complete this command.",
  }));
}

/** Metadata coordinator only. Existing owner editors retain the sole drafts. */
export function createPlannerAuthoringSession({ sessionId = crypto.randomUUID(), owners = [], onBeforeCommit = () => {}, onCommit = () => {} } = {}) {
  let revision = 0, generation = 0, destroyed = false, active = null, retryBytes = 0, publishing = false;
  const registry = new Map(), settings = new Map(), retries = new Map(), listeners = new Set(), consequences = new Map();
  function advance() {
    if (!Number.isSafeInteger(revision + 1)) commandFailure("session_exhausted", "Start a new authoring session.");
    revision++; generation++;
  }
  function notify() {
    const issues = [];
    for (const listener of [...listeners]) {
      try { listener(revision); }
      catch { issues.push({ owner: null, field: null, code: "observer_failed", message: "An observer could not refresh after the applied edit." }); }
    }
    return issues;
  }
  function addOwner(owner) {
    commandOwner(owner?.id);
    if (registry.has(owner.id) || typeof owner.read !== "function" || typeof owner.stage !== "function"
      || typeof owner.validate !== "function" || !Array.isArray(owner.settings) || !Array.isArray(owner.operations)) {
      throw new TypeError("Planner owner adapter is incomplete or repeated.");
    }
    if (active || publishing || destroyed || new Set(owner.settings.map(setting => setting.id)).size !== owner.settings.length) throw new TypeError("Owner registration is no longer available or contains duplicate settings.");
    for (const setting of owner.settings) {
      commandField(setting.id);
      if (!setting.id.startsWith(`${owner.id}.`) || settings.has(setting.id)
        || !["authored", "derived", "compatibility", "transient"].includes(setting.classification)
        || !["boolean", "integer", "number", "string", "json"].includes(setting.type)
        || typeof setting.writable !== "boolean") throw new TypeError("Planner setting descriptor is invalid.");
      validateCommandJson(setting);
    }
    const names = owner.operations.map(operation => operation.id);
    if (new Set(names).size !== names.length || names.some(name => !/^[a-z][a-zA-Z0-9.-]{0,79}$/u.test(name))) throw new TypeError("Planner operation descriptor is invalid.");
    const descriptors = owner.consequences ?? [];
    if (!Array.isArray(descriptors) || (descriptors.length && typeof owner.prepareConsequence !== "function")) {
      throw new TypeError("Consequential owner preparation is unavailable.");
    }
    const consequenceNames = new Set();
    for (const descriptor of descriptors) {
      validateCommandJson(descriptor); commandConsequence(descriptor.id);
      const shape = descriptor.arguments;
      if (consequences.has(descriptor.id) || consequenceNames.has(descriptor.id)
        || !shape || shape.type !== "object" || shape.additionalProperties !== false
        || !Array.isArray(shape.required) || shape.required.some(key => typeof key !== "string")
        || !shape.properties || typeof shape.properties !== "object" || Array.isArray(shape.properties)
        || new Set(shape.required).size !== shape.required.length
        || shape.required.length !== Object.keys(shape.properties).length
        || [...shape.required].sort().some((key, index) => key !== Object.keys(shape.properties).sort()[index])) {
        throw new TypeError("Consequential descriptors require globally unique IDs and closed required arguments.");
      }
      consequenceNames.add(descriptor.id);
    }
    registry.set(owner.id, owner);
    owner.settings.forEach(setting => settings.set(setting.id, Object.freeze(structuredClone(setting))));
    descriptors.forEach(descriptor => consequences.set(descriptor.id, {
      owner: owner.id, descriptor: structuredClone(descriptor),
    }));
  }
  owners.forEach(addOwner);
  function ownerFor(id) { const owner = registry.get(id); if (!owner) commandFailure("owner_unavailable", "Planner owner is not connected.", id); return owner; }
  function readOwner(owner) {
    const result = owner.read(); validateCommandJson(result);
    if (!result?.values || !Array.isArray(result.issues)
      || Object.keys(result.values).sort().join(",") !== owner.settings.map(setting => setting.id).sort().join(",")) throw new TypeError("Owner readback does not cover its registered settings exactly.");
    return structuredClone(result);
  }
  function snapshot() {
    if (destroyed) commandFailure("session_closed", "Planner authoring session is closed.");
    if (publishing || active?.dispatching) commandFailure("busy", "Authoring publication or consequential work is in progress.");
    return { sessionId, revision, owners: Object.fromEntries([...registry].map(([id, owner]) => [id, readOwner(owner)])) };
  }
  function envelope(requestId, status, result = null, issues = []) {
    return { schema: PLANNER_RESULT_SCHEMA, version: 1, sessionId, requestId, status, revision, result, issues: boundedIssues(issues) };
  }
  function issue(error) {
    return { owner: typeof error?.field === "string" ? error.field.slice(0, 2) : null, field: error?.field ?? null,
      code: error instanceof PlannerCommandError ? error.code : "owner_failed",
      message: error instanceof PlannerCommandError ? error.message : "The owner could not complete this command." };
  }
  function validateOwner(owner) {
    const issues = owner.validate();
    validateCommandJson(issues);
    if (!Array.isArray(issues)) throw new TypeError("Owner validation did not return issues.");
    return boundedIssues(issues);
  }
  function remember(id, fingerprint, result) {
    if (destroyed) return; // Return late evidence to the broker without reviving a disposed cache.
    const bytes = new TextEncoder().encode(canonicalJson({ fingerprint, result })).byteLength;
    // Reserve bounded admission before staging; no retry record is evicted.
    retries.set(id, { fingerprint, result: structuredClone(result) }); retryBytes += bytes;
  }
  async function execute(input, lifetime = {}) {
    let request, fingerprint, mutation = false, ownsActive = false, publicationStarted = false;
    let consequence = null;
    const updatedOwners = [];
    try {
      request = validatePlannerCommand(input);
      if (destroyed) commandFailure("session_closed", "Planner authoring session is closed.");
      if (publishing) commandFailure("busy", "An atomic authoring batch is being published.");
      if (request.sessionId !== sessionId) commandFailure("stale_session", "The authoring session has changed.");
      const { action, requestId } = request;
      mutation = ["set", "apply", "perform"].includes(action.kind);
      fingerprint = canonicalJson(request);
      const prior = retries.get(requestId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) commandFailure("request_id_reused", "Request identity was reused with different content.");
        return structuredClone(prior.result);
      }
      if (active?.requestId === requestId) {
        if (active.fingerprint !== fingerprint) commandFailure("request_id_reused", "Request identity was reused with different content.");
        commandFailure("request_in_flight", "This request is still in flight.");
      }
      if (action.kind === "cancel") {
        const canceled = active?.requestId === action.requestId;
        if (canceled) { active.controller.abort(); generation++; }
        return envelope(requestId, "ok", { canceled });
      }
      if (request.expectedRevision !== null && request.expectedRevision !== revision) commandFailure("stale_revision", "Read the current revision before applying changes.");
      if (action.kind === "catalogue") return envelope(requestId, "ok", {
        settings: [...settings.values()],
        operations: [...registry.values()].flatMap(owner => owner.operations.map(operation => ({ ...operation, owner: owner.id }))),
        ...(consequences.size ? { consequences: [...consequences.values()].map(item => ({ ...structuredClone(item.descriptor), owner: item.owner })) } : {}),
      });
      if (active?.dispatching && ["get", "snapshot", "validate"].includes(action.kind)) {
        commandFailure("busy", "Consequential work is in progress; read again after its result.");
      }
      if (action.kind === "snapshot") return envelope(requestId, "ok", snapshot());
      if (action.kind === "get") {
        if (!settings.has(action.field)) commandFailure("unknown_setting", "Setting is not registered.", action.field);
        const read = readOwner(ownerFor(action.field.slice(0, 2)));
        return envelope(requestId, "ok", { field: action.field, value: read.values[action.field] }, read.issues);
      }
      if (action.kind === "validate") {
        const selected = action.owner === null ? [...registry.values()] : [ownerFor(action.owner)];
        return envelope(requestId, "ok", null, selected.flatMap(validateOwner));
      }
      if (active) commandFailure("busy", "Another authoring command is being prepared.");
      const retainedRequestBytes = new TextEncoder().encode(canonicalJson({ fingerprint, result: null })).byteLength;
      if (retries.size >= RETRY_LIMIT || retryBytes + retainedRequestBytes + RESULT_RESERVATION > RETRY_BYTES) commandFailure("session_capacity", "Start a new session before submitting more mutations.");
      if (action.kind === "perform") {
        const registered = consequences.get(action.operation);
        if (!registered) commandFailure("unknown_operation", "Consequential operation is not registered.");
        consequenceArguments(registered.descriptor, action.arguments);
        const owner = ownerFor(registered.owner);
        let currentRevision = revision, currentGeneration = ++generation;
        const controller = new AbortController();
        const operationState = { requestId, controller, fingerprint, dispatching: false };
        active = operationState; ownsActive = true;
        consequence = { operation: action.operation, owner: owner.id, published: false,
          effect: null, result: null, issues: [], closed: false };
        const isCurrent = () => !consequence.closed && !destroyed && !controller.signal.aborted
          && !lifetime.signal?.aborted && (lifetime.isCurrent === undefined || lifetime.isCurrent() === true)
          && active === operationState && revision === currentRevision && generation === currentGeneration;
        const assertCurrent = () => {
          if (!isCurrent()) commandFailure(controller.signal.aborted || lifetime.signal?.aborted ? "canceled" : "stale_revision", "The consequential operation is no longer current.", owner.id);
        };
        assertCurrent();
        const candidate = await owner.prepareConsequence(action.operation, structuredClone(action.arguments), {
          isCurrent, signal: controller.signal,
          request: Object.freeze({ sessionId: request.sessionId, requestId: request.requestId,
            expectedRevision: request.expectedRevision }),
          read(id = null) { assertCurrent(); return id === null ? snapshot() : readOwner(ownerFor(commandOwner(id))); },
        });
        if (!candidate || typeof candidate.dispatch !== "function") throw new TypeError("Consequential preparation returned no dispatch.");
        const candidateCurrent = () => candidate.isCurrent === undefined || candidate.isCurrent() === true;
        // Native adapters must see owner drift even while dispatch is awaiting.
        // Successful adoption can itself invalidate the pre-adoption guard.
        const dispatchCurrent = () => isCurrent() && (consequence.published || candidateCurrent());
        assertCurrent();
        if (!candidateCurrent()) commandFailure("stale_revision", "Consequential dependencies changed before dispatch.", owner.id);
        operationState.dispatching = true;
        const recordEffect = receipt => {
          // Evidence can arrive after cancellation; retaining it grants no new work.
          if (consequence.closed || active !== operationState) commandFailure("operation_closed", "Effect recording is closed.", owner.id);
          if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) || !Object.keys(receipt).length) {
            commandFailure("invalid_receipt", "An effect requires a nonempty receipt object.", owner.id);
          }
          const detached = compact(receipt); // Never erase the old receipt on failure.
          consequence.effect = detached;
        };
        const publish = (install, afterCommit) => {
          if (consequence.published) commandFailure("already_published", "A consequential command can publish only once.", owner.id);
          assertCurrent();
          if (!candidateCurrent()) commandFailure("stale_revision", "Consequential dependencies changed before publication.", owner.id);
          if (typeof install !== "function" || Object.prototype.toString.call(install) === "[object AsyncFunction]"
            || (afterCommit !== undefined && (typeof afterCommit !== "function" || Object.prototype.toString.call(afterCommit) === "[object AsyncFunction]"))) {
            commandFailure("invalid_publication", "Publication hooks must be synchronous functions.", owner.id);
          }
          publishing = true;
          try {
            onBeforeCommit({ owners: [owner.id], revision, operation: action.operation });
            assertCurrent();
            if (!candidateCurrent()) commandFailure("stale_revision", "Consequential dependencies changed before publication.", owner.id);
            advance(); currentRevision = revision; currentGeneration = generation;
            publicationStarted = true; consequence.published = true; updatedOwners.push(owner.id);
            const installed = install();
            if (installed && typeof installed.then === "function") {
              // A broken owner may return a rejecting Promise. Preserve the
              // protocol failure without leaving an unhandled rejection behind.
              Promise.resolve(installed).catch(() => {});
              commandFailure("invalid_publication", "Publication returned asynchronous work; inspect the applied state.", owner.id);
            }
            try {
              const projected = afterCommit?.();
              if (projected && typeof projected.then === "function") {
                Promise.resolve(projected).catch(() => {});
                throw new TypeError("Asynchronous projection.");
              }
            } catch { consequence.issues.push({ owner: owner.id, field: null, code: "projection_failed", message: "The result was adopted, but its projection failed." }); }
            try { onCommit({ owners: [owner.id], revision, operation: action.operation }); }
            catch { consequence.issues.push({ owner: owner.id, field: null, code: "projection_failed", message: "The result was adopted, but a shared projection failed." }); }
            try { consequence.issues.push(...validateOwner(owner)); }
            catch { consequence.issues.push({ owner: owner.id, field: null, code: "validation_unavailable", message: "The result was adopted; owner validation is unavailable." }); }
          } finally { publishing = false; }
          consequence.issues.push(...notify());
        };
        const returned = await candidate.dispatch({ isCurrent: dispatchCurrent, signal: controller.signal, recordEffect, publish });
        consequence.result = compact(returned === undefined ? null : returned);
        assertCurrent();
        if (!consequence.published) commandFailure("missing_publication", "Consequential dispatch finished without adopting its result.", owner.id);
        const result = envelope(requestId, consequence.issues.length ? "incomplete" : "applied", {
          operation: consequence.operation, owner: consequence.owner, published: true,
          effect: consequence.effect, result: consequence.result, updatedOwners,
        }, consequence.issues);
        remember(requestId, fingerprint, result);
        return result;
      }
      const edits = action.kind === "set" ? [action] : action.edits;
      const grouped = new Map();
      for (const edit of edits) {
        const owner = ownerFor(edit.kind === "set" ? edit.field.slice(0, 2) : edit.owner);
        if (edit.kind === "set") {
          const setting = settings.get(edit.field);
          if (!setting) commandFailure("unknown_setting", "Setting is not registered.", edit.field);
          validateSettingValue(setting, edit.value);
        } else {
          const operation = owner.operations.find(operation => operation.id === edit.operation);
          if (!operation) commandFailure("unknown_operation", "Owner operation is not registered.", owner.id);
          if (operation.consequential === true || operation.atomic === false) commandFailure("consequential_operation", "Use the registered perform command for consequential work.", owner.id);
        }
        if (!grouped.has(owner.id)) grouped.set(owner.id, []);
        grouped.get(owner.id).push(edit);
      }
      const base = revision, operation = ++generation, controller = new AbortController();
      active = { requestId, controller, fingerprint }; ownsActive = true;
      const isCurrent = () => !destroyed && !controller.signal.aborted && !lifetime.signal?.aborted
        && (lifetime.isCurrent === undefined || lifetime.isCurrent() === true)
        && revision === base && generation === operation;
      if (!isCurrent()) commandFailure("canceled", "The authoring gesture is no longer current.");
      const staged = [];
      for (const [id, ownerEdits] of grouped) {
        const candidate = await ownerFor(id).stage(structuredClone(ownerEdits), { isCurrent, signal: controller.signal });
        if (!candidate || typeof candidate.commit !== "function") throw new TypeError("Owner staging returned no commit.");
        staged.push(candidate);
      }
      const stagesCurrent = () => staged.every(candidate => candidate.isCurrent === undefined || candidate.isCurrent() === true);
      if (!isCurrent() || !stagesCurrent()) commandFailure(controller.signal.aborted ? "canceled" : "stale_revision", "The authoring operation is no longer current.");
      // No awaits between current check and complete publication. Adapters
      // guarantee commit cannot fail after detached staging has succeeded.
      publishing = true;
      onBeforeCommit({ owners: [...grouped.keys()], revision });
      if (!isCurrent() || !stagesCurrent()) commandFailure("stale_revision", "The authoring state changed before publication.");
      advance(); publicationStarted = true;
      const ids = [...grouped.keys()];
      for (const [index, candidate] of staged.entries()) { candidate.commit(); updatedOwners.push(ids[index]); }
      const issues = [];
      for (const [index, candidate] of staged.entries()) {
        try { candidate.afterCommit?.(); }
        catch { issues.push({ owner: ids[index], field: null, code: "projection_failed", message: "Settings changed, but the owner could not refresh its projection." }); }
      }
      try { onCommit({ owners: ids, revision }); }
      catch { issues.push({ owner: null, field: null, code: "projection_failed", message: "Settings changed, but a post-commit projection failed." }); }
      for (const id of ids) {
        try { issues.push(...validateOwner(ownerFor(id))); }
        catch { issues.push({ owner: id, field: null, code: "validation_unavailable", message: "Settings changed; owner validation is unavailable." }); }
      }
      publishing = false;
      issues.push(...notify());
      const result = envelope(requestId, issues.length ? "incomplete" : "applied", { updatedOwners }, issues);
      remember(requestId, fingerprint, result);
      return result;
    } catch (error) {
      if (ownsActive) publishing = false;
      const result = consequence
        ? envelope(request?.requestId ?? null,
          consequence.effect !== null || publicationStarted || error?.code === "missing_publication" ? "incomplete" : error?.code === "canceled" ? "canceled" : "rejected",
          { operation: consequence.operation, owner: consequence.owner, published: consequence.published,
            effect: consequence.effect, result: consequence.result, updatedOwners },
          [...consequence.issues, issue(error)])
        : publicationStarted
        ? envelope(request?.requestId ?? null, "incomplete", { updatedOwners }, [{ owner: null, field: null, code: "publication_failed", message: "Publication began but an owner failed. Inspect the current settings; do not blindly retry." }, ...notify()])
        : envelope(request?.requestId ?? null, error?.code === "canceled" ? "canceled" : "rejected", null, [issue(error)]);
      if (ownsActive && mutation && request && fingerprint && !retries.has(request.requestId)) remember(request.requestId, fingerprint, result);
      return result;
    } finally {
      if (consequence) consequence.closed = true;
      if (ownsActive) { active = null; publishing = false; }
    }
  }
  return Object.freeze({
    execute, snapshot, registerOwner: addOwner,
    get sessionId() { return sessionId; }, get revision() { return revision; },
    get publishing() { return publishing; },
    edited() { if (!destroyed) { advance(); if (!publishing) notify(); } },
    dependenciesChanged() { if (!destroyed && !publishing) generation++; },
    subscribe(listener) { if (destroyed || typeof listener !== "function") throw new TypeError("Session subscription is invalid."); listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { destroyed = true; generation++; active?.controller.abort(); listeners.clear(); retries.clear(); },
  });
}

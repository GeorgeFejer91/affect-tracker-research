import { commandFailure } from "./planner-authoring-contract.js";

const fields = (...names) => ({ type: "object", additionalProperties: false, required: names,
  properties: Object.fromEntries(names.map(name => [name, name === "paths" ? { type: "array", items: { type: "string" } } : { type: "string" }])) });
const COMMANDS = Object.freeze([
  { id: "selectWorkspace", owner: "P1", arguments: fields("directory") },
  { id: "importVideos", owner: "P1", arguments: fields("paths") },
  { id: "importVideoFolder", owner: "P1", arguments: fields("directory") },
  { id: "rescanVideoLibrary", owner: "P1", arguments: fields() },
  { id: "importQuestionnaire", owner: "P2", arguments: fields("path", "familyId", "language") },
  { id: "saveQuestionnaire", owner: "P2", arguments: fields("questionnaireId") },
  { id: "confirmSegment", owner: "P7", arguments: fields("segment") },
  { id: "saveRecipe", owner: "P7", arguments: fields("directory") },
  { id: "openRecipe", owner: "P7", publication: "sequence", arguments: fields("path") },
]);

/** Metadata and delegation only. The actual host supplies the existing owners'
 * prepared mutations; this wrapper adds no editor, compiler or filesystem path. */
export function withPlannerCore9(owner, prepare) {
  const descriptors = COMMANDS.filter(command => command.owner === owner.id).map(({ owner: _owner, ...descriptor }) => structuredClone(descriptor));
  if (!descriptors.length) return owner;
  if (typeof prepare !== "function" || owner.consequences?.length) throw new TypeError("Core9 requires one explicit composition owner.");
  return { ...owner, consequences: descriptors,
    prepareConsequence(operation, args, context) {
      if (!descriptors.some(descriptor => descriptor.id === operation)) commandFailure("unknown_operation", "This owner does not own the command.");
      if (operation === "confirmSegment") {
        if (args.segment === "P5") commandFailure("final_capture", "Live Preview is captured only during final Save.", "P5");
        if (!["P1", "P2", "P3", "P4", "P6"].includes(args.segment)) commandFailure("unknown_owner", "Choose a confirmable Planner segment.");
      }
      return prepare(operation, structuredClone(args), context);
    },
  };
}

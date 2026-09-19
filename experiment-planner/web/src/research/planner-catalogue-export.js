import { canonicalJson } from "./canonical.js";
import { validateWorkspaceContribution } from "./workspace-contribution.js";
import { createLocationLibraryExport } from "./variant-library-export.js";

/** Shared browser adapter: P1 owns declarations/geometry, the selected workspace
 * freshly hashes the actual file closure, and P3 alone regenerates tabular bytes.
 * Legacy annotation hashes and caller-supplied workbook bytes are not authority. */
export async function prepareVerifiedCatalogueExport(payload, { getSnapshot, readMedia, isCurrent }) {
  if (typeof isCurrent !== "function") throw new TypeError("Catalogue export requires an operation guard.");
  const snapshot = structuredClone(getSnapshot()), identity = canonicalJson(snapshot);
  const captured = structuredClone(payload);
  let stale = false;
  const current = () => {
    try { if (!isCurrent() || canonicalJson(getSnapshot()) !== identity) stale = true; }
    catch { stale = true; }
    if (stale) throw new Error("The workspace or current video catalogue changed during export.");
  };
  current();
  if (!snapshot.enabled || snapshot.pending || !snapshot.contribution) throw new Error("Verify the current video catalogue before exporting.");
  const workspace = await validateWorkspaceContribution(snapshot.contribution); current();
  if (workspace.videoCatalogue.version !== 2 || canonicalJson(workspace.videoCatalogue) !== canonicalJson(captured.catalogue)) {
    throw new Error("The export catalogue does not match the current verified Workspace section.");
  }
  const observed = await readMedia(); current();
  const byPath = new Map((observed?.library?.videos ?? []).map(video => [video.relativePath, video]));
  const entries = workspace.videoCatalogue.entries;
  if (byPath.size !== entries.length || observed.library.videos.length !== entries.length || entries.some(entry => {
    const file = byPath.get(entry.packageRelativePath);
    return !file || file.sha256 !== entry.sha256 || file.byteLength !== entry.byteLength;
  })) throw new Error("Video files were added, removed or changed. Rescan and confirm Workspace before exporting.");
  const bytes = await createLocationLibraryExport(workspace.videoCatalogue, captured.librarySha256, captured.format);
  current();
  return bytes;
}

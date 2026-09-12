# Planner CLI consequential commands v1

This is the frozen integration catalogue for the allocated CLI pass, not a claim
that every command is already installed. The owner adapters and real policy
transport are collected; composition and the commands below are being connected.

Use the existing command envelope, a fresh `requestId`, current `sessionId` and
non-null `expectedRevision`. The action has exactly
`{kind:"perform",operation,arguments}`. Each operation's arguments have exactly
the keys listed below. These operations cannot appear in an atomic `apply` batch.

| Operation | Arguments | Existing user action / authority |
| --- | --- | --- |
| `selectWorkspace` | `{directory:string}` | Set work directory; native selects an existing directory and creates the established internal layout |
| `importVideos` | `{paths:string[]}` | Add video files; native imports and verifies actual files |
| `importVideoFolder` | `{directory:string}` | Add video folder; existing native recursive import policy |
| `rescanVideoLibrary` | `{}` | Rescan the currently selected work directory's video library |
| `importQuestionnaire` | `{path:string,familyId:string,language:string}` | Import source into the explicitly identified, pristine family/language slot; existing production CSV/TXT/JSON importer |
| `saveQuestionnaire` | `{questionnaireId:string}` | Save the actual questionnaire editor draft through its native source store and return the exact acknowledgement |
| `confirmSegment` | `{segment:"P1"\|"P2"\|"P3"\|"P4"\|"P5"\|"P6"}` | Existing ordered section confirmation/preparation; P5 returns `final_capture` because Live Preview is captured only during final save |
| `saveRecipe` | `{directory:string}` | Segment 7 final review/Live Preview capture and fresh timestamped, no-clobber native JSON save |
| `openRecipe` | `{path:string}` | Strict native Open and existing editable owner restore; does not grant media readiness |

Paths are absolute local filesystem paths supplied to the CLI, not paths in a
recipe. Rust retains them behind per-request, purpose-bound opaque grants before
dispatching to the renderer. Native wrappers check the matching active request,
operation, lifetime and grant. JavaScript receives bounded source bytes or safe
receipts only, never an arbitrary filesystem primitive. Directory/regular-file,
link/reparse, byte-limit and existing native import policies remain enforced.
Do not treat a video extension, catalogue row or saved declaration as decoding.

The author first selects languages and creates the intended questionnaire slots
using the P2 field/list API. Import never overwrites a changed table. Importing a
source and saving its prepared questionnaire are separate observable steps;
only the latter acknowledges native workspace source persistence. A saved master
retains exact definitions, provenance, routes and policy through the existing
master compiler and independent strict native reader.

`saveRecipe` requires current P1/P2/P3/P4/P6 confirmations and valid current P7
policy and presentation target. It accepts/captures current P5 Live Preview
internally through the same final-save workflow; P5 is not a separate user
confirmation. Its result includes the actual new basename and native
exact-byte save receipt. The caller combines the supplied directory and basename
to locate the file. Filename time never alters scientific JSON identity/hashes.
`openRecipe` preserves the original file and leaves changed/missing media pending.

Current revision and cancellation must be checked before consequential work and
before adopting its result. Results use the existing envelope and explicitly
separate completed external effects from editor adoption. Any retained written
file/source receipt survives a late cancellation or stale result. Such an outcome
is incomplete, not a claim of rollback or a rejected-with-no-write result. An
identical completed request returns its retained result; changed ID reuse rejects.
An unknown timeout must be reconciled, never blindly repeated with a fresh ID.

The separately allocated researcher-local preset install/load convenience will
have its own fixed operation descriptors after its storage API is integrated.
It does not block the nine core operations above or change the requested mock.

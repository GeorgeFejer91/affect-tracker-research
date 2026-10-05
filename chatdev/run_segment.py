"""Run a prepared Affect Research bundle inside a ChatDev 2.0 session."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import sys
from datetime import datetime, timezone


def main() -> None:
    home = Path(os.environ["CHATDEV_HOME"]).resolve()
    bundle = Path(sys.argv[1]).resolve()
    workflow = Path(sys.argv[2]).resolve()
    sys.path.insert(0, str(home))

    from check.check import load_config
    from entity.graph_config import GraphConfig
    from runtime.bootstrap.schema import ensure_schema_registry_populated
    from workflow.graph import GraphExecutor
    from workflow.graph_context import GraphContext

    ensure_schema_registry_populated()
    design = load_config(workflow)
    name = "affect-research-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    config = GraphConfig.from_definition(
        design.graph, name=name, output_root=Path("WareHouse"),
        source_path=str(workflow), vars=design.vars,
    )
    context = GraphContext(config=config)
    workspace = context.directory / "code_workspace"
    inputs = workspace / "inputs"
    inputs.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    staged = []
    for entry in manifest["files"]:
        filename = entry["attachment"]
        if Path(filename).name != filename:
            raise ValueError("Invalid bundle filename")
        source = bundle / "files" / filename
        data = source.read_bytes()
        if hashlib.sha256(data).hexdigest() != entry["sha256"]:
            raise ValueError(f"Bundle hash mismatch: {filename}")
        target = inputs / filename
        target.write_bytes(data)
        target.chmod(stat.S_IREAD)
        staged.append((target, entry["sha256"]))
    shutil.copyfile(bundle / "manifest.json", workspace / "manifest.json")
    session = (bundle / "SESSION.md").read_text(encoding="utf-8")
    (workspace / "SESSION.md").write_text(session, encoding="utf-8")
    executor = GraphExecutor.execute_graph(context, session)
    for target, expected in staged:
        if hashlib.sha256(target.read_bytes()).hexdigest() != expected:
            raise ValueError(f"Session input changed: {target.name}")
    print(f"ChatDev session: {context.directory}")
    print(executor.get_final_output_message())


if __name__ == "__main__":
    main()

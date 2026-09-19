//! Source-bound independent reader for Planner fixture verification. No runtime.
use affect_research::research_planner_recipe::{parse_planner_recipe_bytes, MAX_BYTES};
use serde_json::json;
use std::io::{Read, Write};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args_os()
        .nth(1)
        .ok_or("Supply one canonical recipe file.")?;
    let file = std::fs::File::open(path)?;
    let mut bytes = Vec::new();
    file.take((MAX_BYTES + 1) as u64).read_to_end(&mut bytes)?;
    let document = parse_planner_recipe_bytes(&bytes)?;
    let matrix = document.recipe.reproduce()?;
    let mut selections = Vec::new();
    for case in matrix["cases"]
        .as_array()
        .ok_or("Missing reproduction cases.")?
    {
        if case["presentationTarget"] != document.recipe.presentation_target {
            continue;
        }
        let mut selector = case.clone();
        selector
            .as_object_mut()
            .ok_or("Invalid case.")?
            .remove("selectionSha256");
        selections.push(document.recipe.reconstruct_selection(&selector)?);
    }
    let result = json!({"document":document,"matrix":matrix,"selections":selections});
    std::io::stdout().write_all(serde_json::to_string(&result)?.as_bytes())?;
    Ok(())
}

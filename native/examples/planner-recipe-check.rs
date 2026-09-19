//! Source-bound independent reader for Planner fixture verification. No runtime.
use affect_research::research_planner_recipe::parse_planner_recipe_bytes;
use serde_json::json;
use std::io::Write;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args_os()
        .nth(1)
        .ok_or("Supply one canonical recipe file.")?;
    let bytes = std::fs::read(path)?;
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

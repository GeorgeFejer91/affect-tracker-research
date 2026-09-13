import test from "node:test";
import assert from "node:assert/strict";
import {validateRecentFiles} from "../runner/src/recent-files.js";
const fixture=()=>({schema:"affect-runner-recent-experiments",version:1,entries:[{id:"recent-"+"a".repeat(64),basename:"experiment.json",folderName:"Study one",available:true},{id:"recent-"+"b".repeat(64),basename:"experiment.json",folderName:"Study two",available:false}]});
test("recent list preserves saved order and unavailable entries",()=>{assert.deepEqual(validateRecentFiles(fixture()),fixture().entries);});
test("unknown version, duplicate IDs and path-shaped selections reject",()=>{for(const mutate of [v=>v.version=2,v=>v.entries[1].id=v.entries[0].id,v=>v.entries[0].id="C:/study/file.json",v=>v.entries[0].basename=null,v=>v.entries[0].available="yes"]){const value=fixture();mutate(value);assert.throws(()=>validateRecentFiles(value));}});

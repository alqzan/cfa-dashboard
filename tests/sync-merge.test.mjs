// Unit tests for the pure merge logic in assets/js/firebase-sync.js (unionMergeById).
// No live Firestore/network involved — this exercises exactly the function two devices'
// worth of local state would be run through during a real sync, with synthetic data.
// Run: node tests/sync-merge.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, "../assets/js/firebase-sync.js"), "utf8");

function extractFrom(marker) {
  const start = src.indexOf(marker);
  if (start === -1) throw new Error("marker not found: " + marker);
  const braceStart = src.indexOf("{", start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i) + (src[i] === ";" ? ";" : "");
}

const chunks = [
  extractFrom("function unionMergeById"),
  extractFrom("function getPath"),
  extractFrom("function setPath"),
].join("\n\n");
const fn = new Function("exports", chunks + "\nexports.unionMergeById = unionMergeById;");
const box = {};
fn(box);
const { unionMergeById } = box;

let pass=0, fail=0;
function check(name, cond){ if(cond){ pass++; console.log("  ok  -", name); } else { fail++; console.error("  FAIL -", name); } }

console.log("Test 1: records unique to one side always survive (pure union, nothing dropped)");
{
  const local = [{ id:"a", v:1, updatedAt:100 }];
  const cloud = [{ id:"b", v:2, updatedAt:100 }];
  const { merged } = unionMergeById(local, cloud, 50);
  check("both a and b present after merge", merged.some(x=>x.id==="a") && merged.some(x=>x.id==="b"));
  check("exactly 2 records, no duplication", merged.length===2);
}

console.log("\nTest 2: merging two devices' sessions does not duplicate identical/overlapping session ids");
{
  const localSessions = [{ id:"s1", d:"2026-06-01", m:30, updatedAt:200 }, { id:"s2", d:"2026-06-02", m:45, updatedAt:210 }];
  const cloudSessions = [{ id:"s1", d:"2026-06-01", m:30, updatedAt:200 }, { id:"s3", d:"2026-06-03", m:20, updatedAt:220 }];
  const { merged } = unionMergeById(localSessions, cloudSessions, 190);
  check("3 unique sessions after merge (s1 not duplicated)", merged.length===3);
  check("s1 appears exactly once", merged.filter(x=>x.id==="s1").length===1);
}

console.log("\nTest 3: only-local-changed since last sync -> local wins; only-cloud-changed -> cloud wins");
{
  const lastSync = 100;
  const r1 = unionMergeById([{ id:"x", status:"doing", updatedAt:150 }], [{ id:"x", status:"todo", updatedAt:90 }], lastSync);
  check("local wins when only local changed since last sync", r1.merged[0].status==="doing");
  const r2 = unionMergeById([{ id:"x", status:"todo", updatedAt:90 }], [{ id:"x", status:"done", updatedAt:150 }], lastSync);
  check("cloud wins when only cloud changed since last sync", r2.merged[0].status==="done");
}

console.log("\nTest 4: a deleted record (tombstone) does not come back from a stale device");
{
  const lastSync = 100;
  const localTombstone = [{ id:"r1", note:"x", deletedAt:150 }];
  const staleCloud = [{ id:"r1", note:"stale copy still alive", updatedAt:120 }]; // older than the deletion
  const { merged } = unionMergeById(localTombstone, staleCloud, lastSync);
  check("deleted record does not resurface from an older cloud copy", merged.length===0);
}
{
  // an update strictly newer than the deletion (e.g. an "undelete" edit) should win over the tombstone
  const localTombstone = [{ id:"r1", note:"x", deletedAt:100 }];
  const newerCloud = [{ id:"r1", note:"revived on purpose", updatedAt:200 }];
  const { merged } = unionMergeById(localTombstone, newerCloud, 50);
  check("an edit strictly newer than the deletion overrides the tombstone", merged.length===1 && merged[0].note==="revived on purpose");
}

console.log("\nTest 5: both sides changed the same long-text field since last sync -> neither is silently lost");
{
  const lastSync = 100;
  const local = [{ id:"r1", note:"local addition about DDM", updatedAt:150 }];
  const cloud = [{ id:"r1", note:"cloud addition about FCF", updatedAt:160 }];
  const { merged, conflicts } = unionMergeById(local, cloud, lastSync, { kind:"reading", textFields:["note"] });
  check("a conflict is recorded", conflicts.length===1);
  check("the winning note still contains the losing device's text", merged[0].note.includes("local addition about DDM") && merged[0].note.includes("cloud addition about FCF"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

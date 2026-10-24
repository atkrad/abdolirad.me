// Article data regression for the Go 1.28 HTTP/2 benchmark.
// This file checks the published CSV. It is not part of the chart renderer contract.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../content/", import.meta.url);

function rows(csvText) {
  const lines = csvText.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim().split("\n");
  const names = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row = {};
    names.forEach((name, index) => {
      const value = values[index] ?? "";
      row[name] = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ? Number(value) : value;
    });
    return row;
  });
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

test("published benchmark csv is unchanged across languages", () => {
  const english = readFileSync(new URL("en/articles/go-1-28-http2-parking-memory/data/chart-data.csv", root));
  const persian = readFileSync(new URL("fa/articles/go-1-28-http2-parking-memory/data/chart-data.csv", root));
  assert.equal(english.equals(persian), true);
  const data = rows(english.toString("utf8"));
  const at = (name, connections) =>
    data.filter((row) => row.case === name && row.connections === connections).map((row) => row.rss_mib);
  const round = (value) => Math.round(value * 100) / 100;
  assert.equal(round(median(at("go127", 5000))), 247.18);
  assert.equal(round(median(at("go128off", 5000))), 218.28);
  assert.equal(round(median(at("go128", 5000))), 131.11);

  const saved = [1, 2, 3].map((runId) => {
    const off = data.find((row) => row.run === runId && row.case === "go128off" && row.connections === 5000);
    const on = data.find((row) => row.run === runId && row.case === "go128" && row.connections === 5000);
    return Math.round((off.rss_mib - on.rss_mib) * 10) / 10;
  });
  assert.deepEqual(saved, [89.1, 92.6, 84.7]);

  for (const runId of [1, 2, 3]) {
    const off = data.find((row) => row.run === runId && row.case === "go128off" && row.connections === 5000);
    const on = data.find((row) => row.run === runId && row.case === "go128" && row.connections === 5000);
    assert.equal(off.goroutines, 10007);
    assert.equal(on.goroutines, 5007);
  }
  const heapOff = data.find((row) => row.run === 2 && row.case === "go128off" && row.connections === 5000);
  const heapOn = data.find((row) => row.run === 2 && row.case === "go128" && row.connections === 5000);
  assert.equal(Math.round(heapOn.heap_alloc_mib * 10) / 10, 80.9);
  assert.equal(Math.round(heapOff.heap_alloc_mib * 10) / 10, 77.9);
  assert.equal(heapOn.heap_alloc_mib > heapOff.heap_alloc_mib, true);
});

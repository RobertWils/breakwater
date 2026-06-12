import { describe, expect, it } from "vitest";

import { reachableFrom, type GraphEdge } from "../reachability";

const ids = (...xs: string[]) => xs;

describe("reachableFrom", () => {
  it("includes the root itself with no edges", () => {
    expect(Array.from(reachableFrom(ids("a"), [], "a"))).toEqual(["a"]);
  });

  it("resolves a star (root depends on each leaf)", () => {
    const edges: GraphEdge[] = [
      { from: "root", to: "a" },
      { from: "root", to: "b" },
      { from: "root", to: "c" },
    ];
    const reach = reachableFrom(ids("root", "a", "b", "c"), edges, "root");
    expect(new Set(reach)).toEqual(new Set(["root", "a", "b", "c"]));
  });

  it("follows multi-hop chains", () => {
    const edges: GraphEdge[] = [
      { from: "root", to: "a" },
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];
    const all = ids("root", "a", "b", "c");
    expect(new Set(reachableFrom(all, edges, "root"))).toEqual(
      new Set(["root", "a", "b", "c"]),
    );
    expect(new Set(reachableFrom(all, edges, "a"))).toEqual(
      new Set(["a", "b", "c"]),
    );
    expect(new Set(reachableFrom(all, edges, "c"))).toEqual(new Set(["c"]));
  });

  it("excludes a disconnected branch", () => {
    const edges: GraphEdge[] = [
      { from: "root", to: "a" },
      { from: "x", to: "y" },
    ];
    const reach = reachableFrom(ids("root", "a", "x", "y"), edges, "root");
    expect(new Set(reach)).toEqual(new Set(["root", "a"]));
  });

  it("handles a diamond without double-counting", () => {
    const edges: GraphEdge[] = [
      { from: "root", to: "a" },
      { from: "root", to: "b" },
      { from: "a", to: "c" },
      { from: "b", to: "c" },
    ];
    const reach = reachableFrom(ids("root", "a", "b", "c"), edges, "root");
    expect(new Set(reach)).toEqual(new Set(["root", "a", "b", "c"]));
  });

  it("is cycle-safe", () => {
    const edges: GraphEdge[] = [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ];
    expect(new Set(reachableFrom(ids("a", "b"), edges, "a"))).toEqual(
      new Set(["a", "b"]),
    );
  });

  it("ignores edges that reference nodes outside the node set", () => {
    const edges: GraphEdge[] = [
      { from: "root", to: "a" },
      { from: "a", to: "ghost" }, // ghost not in nodeIds
    ];
    const reach = reachableFrom(ids("root", "a"), edges, "root");
    expect(new Set(reach)).toEqual(new Set(["root", "a"]));
  });
});

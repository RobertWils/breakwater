import { describe, expect, it } from "vitest";

describe("Plan 02 dependencies", () => {
  it("imports inngest", async () => {
    const { Inngest } = await import("inngest");
    expect(Inngest).toBeDefined();
  });

  it("imports viem", async () => {
    const { createPublicClient } = await import("viem");
    expect(createPublicClient).toBeDefined();
  });
});

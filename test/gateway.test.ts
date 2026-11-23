import { describe, it, expect } from "vitest";
import { gatewayUrl, gatewayFetch, GatewayError } from "../src/gateway.js";

describe("gatewayUrl", () => {
  it("builds the connector gateway URL and strips the leading slash", () => {
    expect(gatewayUrl("github", "c1", "/repos/a/b")).toBe(
      "https://api.sprites.dev/v1/gateway/github/c1/repos/a/b",
    );
    expect(gatewayUrl("github", "c1", "repos/a/b")).toBe(
      "https://api.sprites.dev/v1/gateway/github/c1/repos/a/b",
    );
  });
});

describe("gatewayFetch", () => {
  it("returns the response on 2xx", async () => {
    const fake = async (url: any) => new Response(JSON.stringify({ url }), { status: 200 });
    const res = await gatewayFetch("github", "c1", "x", undefined, fake as any);
    expect(await res.json()).toEqual({ url: "https://api.sprites.dev/v1/gateway/github/c1/x" });
  });

  it("adds a default timeout signal when the caller gives none", async () => {
    let seen: any;
    const fake = async (_u: any, init: any) => { seen = init?.signal; return new Response("ok"); };
    await gatewayFetch("github", "c1", "x", { method: "GET" }, fake as any);
    expect(seen).toBeInstanceOf(AbortSignal);
  });

  it("throws GatewayError with status and body on non-2xx", async () => {
    const fake = async () => new Response("denied", { status: 403 });
    const err = await gatewayFetch("github", "c1", "x", undefined, fake as any).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.status).toBe(403);
    expect(err.body).toBe("denied");
  });
});

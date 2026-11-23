import { describe, it, expect } from "vitest";
import { GatewayGitHub } from "../src/github.js";
import { testConfig } from "./helpers.js";

type Route = (body: any) => Response;

function fakeGitHub(routes: Record<string, Route>) {
  const calls: { key: string; body: any }[] = [];
  const f = (async (url: any, init: any = {}) => {
    const path = String(url).replace("https://api.sprites.dev/v1/gateway/github/gh1/", "");
    const key = `${init.method ?? "GET"} ${path}`;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ key, body });
    const route = routes[key];
    if (!route) return new Response(`no route ${key}`, { status: 404 });
    return route(body);
  }) as typeof fetch;
  return { gh: new GatewayGitHub(testConfig(), f), calls };
}

const R = "repos/alice/pantry";
let blobN = 0;
const happy: Record<string, Route> = {
  [`POST ${R}/git/blobs`]: () => Response.json({ sha: `blob${++blobN}` }, { status: 201 }),
  [`POST ${R}/git/trees`]: () => Response.json({ sha: "tree1" }, { status: 201 }),
  [`POST ${R}/git/commits`]: () => Response.json({ sha: "commit1" }, { status: 201 }),
  [`POST ${R}/git/refs`]: () => Response.json({}, { status: 201 }),
  [`POST ${R}/pulls`]: () => Response.json({ html_url: "https://github.com/alice/pantry/pull/9" }, { status: 201 }),
};

describe("GatewayGitHub.createPullFromFiles", () => {
  it("creates blobs, tree, commit, ref and pull in order", async () => {
    blobN = 0;
    const { gh, calls } = fakeGitHub(happy);
    const url = await gh.createPullFromFiles(
      "alice/pantry", { name: "main", sha: "base1" }, "uncle/issue-7",
      [{ path: "src/a.ts", content: "export const a = 1;\n" }, { path: "old.ts", content: null }],
      "Fix #7", "body",
    );
    expect(url).toBe("https://github.com/alice/pantry/pull/9");
    expect(calls.map((c) => c.key)).toEqual([
      `POST ${R}/git/blobs`, `POST ${R}/git/trees`, `POST ${R}/git/commits`, `POST ${R}/git/refs`, `POST ${R}/pulls`,
    ]);
    expect(calls[0].body).toEqual({ content: Buffer.from("export const a = 1;\n").toString("base64"), encoding: "base64" });
    expect(calls[1].body).toEqual({
      base_tree: "base1",
      tree: [
        { path: "src/a.ts", mode: "100644", type: "blob", sha: "blob1" },
        { path: "old.ts", mode: "100644", type: "blob", sha: null },
      ],
    });
    expect(calls[2].body).toEqual({ message: "Fix #7", tree: "tree1", parents: ["base1"] });
    expect(calls[3].body).toEqual({ ref: "refs/heads/uncle/issue-7", sha: "commit1" });
    expect(calls[4].body).toEqual({ title: "Fix #7", head: "uncle/issue-7", base: "main", body: "body" });
  });

  it("force-updates an existing branch ref on 422", async () => {
    const { gh, calls } = fakeGitHub({
      ...happy,
      [`POST ${R}/git/refs`]: () => new Response("Reference already exists", { status: 422 }),
      [`PATCH ${R}/git/refs/heads/uncle/issue-7`]: () => Response.json({}),
    });
    await gh.createPullFromFiles("alice/pantry", { name: "main", sha: "base1" }, "uncle/issue-7", [{ path: "a", content: "x" }], "t", "b");
    const patch = calls.find((c) => c.key.startsWith("PATCH"));
    expect(patch?.body).toEqual({ sha: "commit1", force: true });
  });

  it("returns the existing open PR url when the pull already exists", async () => {
    const { gh } = fakeGitHub({
      ...happy,
      [`POST ${R}/pulls`]: () => new Response("A pull request already exists", { status: 422 }),
      [`GET ${R}/pulls?head=alice%3Auncle%2Fissue-7&state=open`]: () => Response.json([{ html_url: "https://github.com/alice/pantry/pull/3" }]),
    });
    const url = await gh.createPullFromFiles("alice/pantry", { name: "main", sha: "base1" }, "uncle/issue-7", [{ path: "a", content: "x" }], "t", "b");
    expect(url).toBe("https://github.com/alice/pantry/pull/3");
  });
});

describe("GatewayGitHub misc", () => {
  it("posts issue comments", async () => {
    const { gh, calls } = fakeGitHub({ [`POST ${R}/issues/7/comments`]: () => Response.json({}, { status: 201 }) });
    await gh.comment("alice/pantry", 7, "hello nephew");
    expect(calls[0]).toEqual({ key: `POST ${R}/issues/7/comments`, body: { body: "hello nephew" } });
  });
  it("reacts to comments", async () => {
    const { gh, calls } = fakeGitHub({ [`POST ${R}/issues/comments/42/reactions`]: () => Response.json({}, { status: 201 }) });
    await gh.react("alice/pantry", 42, "eyes");
    expect(calls[0].body).toEqual({ content: "eyes" });
  });
  it("resolves the default branch and its sha", async () => {
    const { gh } = fakeGitHub({
      [`GET ${R}`]: () => Response.json({ default_branch: "main" }),
      [`GET ${R}/branches/main`]: () => Response.json({ commit: { sha: "abc" } }),
    });
    expect(await gh.defaultBranch("alice/pantry")).toEqual({ name: "main", sha: "abc" });
  });
});

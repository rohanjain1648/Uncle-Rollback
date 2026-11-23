import type { Config } from "./config.js";
import { gatewayFetch, GatewayError, type FetchImpl } from "./gateway.js";

export interface FileChange { path: string; content: string | null /* null = delete */ }

export type Reaction = "eyes" | "rocket" | "confused";

export interface GitHub {
  comment(repo: string, issue: number, body: string): Promise<void>;
  react(repo: string, commentId: number, content: Reaction): Promise<void>;
  defaultBranch(repo: string): Promise<{ name: string; sha: string }>;
  createPullFromFiles(
    repo: string, base: { name: string; sha: string }, branch: string,
    files: FileChange[], title: string, body: string,
  ): Promise<string>;
}

const HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

export class GatewayGitHub implements GitHub {
  constructor(private cfg: Config, private fetchImpl: FetchImpl = fetch) {}

  private async call(method: string, path: string, body?: unknown): Promise<any> {
    const res = await gatewayFetch("github", this.cfg.conn.github, path, {
      method,
      headers: { ...HEADERS, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, this.fetchImpl);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  async comment(repo: string, issue: number, body: string): Promise<void> {
    await this.call("POST", `repos/${repo}/issues/${issue}/comments`, { body });
  }

  async react(repo: string, commentId: number, content: Reaction): Promise<void> {
    await this.call("POST", `repos/${repo}/issues/comments/${commentId}/reactions`, { content });
  }

  async defaultBranch(repo: string): Promise<{ name: string; sha: string }> {
    const { default_branch: name } = await this.call("GET", `repos/${repo}`);
    const branch = await this.call("GET", `repos/${repo}/branches/${name}`);
    return { name, sha: branch.commit.sha };
  }

  async createPullFromFiles(
    repo: string, base: { name: string; sha: string }, branch: string,
    files: FileChange[], title: string, body: string,
  ): Promise<string> {
    const tree = [];
    for (const f of files) {
      let sha: string | null = null;
      if (f.content !== null) {
        const blob = await this.call("POST", `repos/${repo}/git/blobs`, {
          content: Buffer.from(f.content, "utf8").toString("base64"), encoding: "base64",
        });
        sha = blob.sha;
      }
      tree.push({ path: f.path, mode: "100644", type: "blob", sha });
    }
    const t = await this.call("POST", `repos/${repo}/git/trees`, { base_tree: base.sha, tree });
    const commit = await this.call("POST", `repos/${repo}/git/commits`, { message: title, tree: t.sha, parents: [base.sha] });

    try {
      await this.call("POST", `repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
    } catch (e) {
      if (!(e instanceof GatewayError) || e.status !== 422) throw e;
      await this.call("PATCH", `repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: true });
    }

    try {
      const pr = await this.call("POST", `repos/${repo}/pulls`, { title, head: branch, base: base.name, body });
      return pr.html_url;
    } catch (e) {
      if (!(e instanceof GatewayError) || e.status !== 422) throw e;
      const owner = repo.split("/")[0];
      const head = encodeURIComponent(`${owner}:${branch}`);
      const open = await this.call("GET", `repos/${repo}/pulls?head=${head}&state=open`);
      if (Array.isArray(open) && open[0]?.html_url) return open[0].html_url;
      throw e;
    }
  }
}

import type { Config } from "./config.js";
import { gatewayFetch, type FetchImpl } from "./gateway.js";

export interface MemoryRecord {
  id: string;
  text: string;
  repo: string;
  issue: number;
  job_id: string;
  timeline: number;
  outcome: "passed" | "failed" | "gave_up";
  created_at: string;
}

export interface Memory {
  remember(r: MemoryRecord): Promise<void>;
  recallForJob(jobId: string): Promise<MemoryRecord[]>;
  recallForRepo(repo: string, query: string, k: number): Promise<MemoryRecord[]>;
}

export const NAMESPACE = "memories";
const FIELDS = ["text", "repo", "issue", "job_id", "timeline", "outcome", "created_at"] as const;
const API_VERSION = { "X-Pinecone-API-Version": "2025-04" };

export class PineconeMemory implements Memory {
  constructor(private cfg: Config, private fetchImpl: FetchImpl = fetch) {}

  private path(op: "upsert" | "search"): string {
    const p = this.cfg.pineconePathPrefix;
    return `${p ? p + "/" : ""}records/namespaces/${NAMESPACE}/${op}`;
  }

  async remember(r: MemoryRecord): Promise<void> {
    const { id, ...fields } = r;
    try {
      await gatewayFetch("pinecone", this.cfg.conn.pinecone, this.path("upsert"), {
        method: "POST",
        headers: { "Content-Type": "application/x-ndjson", ...API_VERSION },
        body: JSON.stringify({ _id: id, ...fields }) + "\n",
      }, this.fetchImpl);
    } catch (e) {
      console.error("[memory] remember failed:", (e as Error).message);
    }
  }

  private async search(text: string, k: number, filter: Record<string, unknown>): Promise<MemoryRecord[]> {
    try {
      const res = await gatewayFetch("pinecone", this.cfg.conn.pinecone, this.path("search"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...API_VERSION },
        body: JSON.stringify({ query: { inputs: { text }, top_k: k, filter }, fields: FIELDS }),
      }, this.fetchImpl);
      const json: any = await res.json();
      return (json?.result?.hits ?? []).map((h: any) => ({
        id: h._id,
        text: h.fields?.text ?? "",
        repo: h.fields?.repo ?? "",
        issue: Number(h.fields?.issue ?? 0),
        job_id: h.fields?.job_id ?? "",
        timeline: Number(h.fields?.timeline ?? 0),
        outcome: h.fields?.outcome ?? "failed",
        created_at: h.fields?.created_at ?? "",
      }));
    } catch (e) {
      console.error("[memory] search failed:", (e as Error).message);
      return [];
    }
  }

  recallForRepo(repo: string, query: string, k: number): Promise<MemoryRecord[]> {
    return this.search(query, k, { repo: { $eq: repo } });
  }

  async recallForJob(jobId: string): Promise<MemoryRecord[]> {
    const hits = await this.search("timeline", 20, { job_id: { $eq: jobId } });
    return hits.sort((a, b) => a.timeline - b.timeline);
  }
}

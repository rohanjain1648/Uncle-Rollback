import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/** Hidden acceptance tests for `owner/repo`, stored on the brain at `<root>/owner__repo/`. */
export async function readAcceptanceFrom(root: string, repo: string): Promise<{ path: string; content: string }[]> {
  const dir = join(root, repo.replace("/", "__"));
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  const out: { path: string; content: string }[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const full = join(e.parentPath ?? (e as any).path, e.name);
    out.push({ path: relative(dir, full).split(sep).join("/"), content: await readFile(full, "utf8") });
  }
  return out;
}

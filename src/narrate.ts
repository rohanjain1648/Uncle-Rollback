import type { Config } from "./config.js";
import type { Job, Timeline } from "./db.js";
import type { MemoryRecord } from "./memory.js";

export interface Narrator { polish(text: string): Promise<string> }

export class IdentityNarrator implements Narrator {
  async polish(text: string): Promise<string> { return text; }
}

export const albumUrl = (cfg: Config, jobId: string) => `${cfg.publicUrl}/job/${jobId}`;

const SIGN_OFF = "\n\n— Uncle Rollback 🦃 *(never wrong, occasionally in the wrong timeline)*";

export function ackComment(job: Job, lore: MemoryRecord[]): string {
  const opener = `On it, nephew. Issue #${job.issueNumber}? I've fixed worse with a butter knife.`;
  if (!lore.length) return `${opener}\nGive me a few timelines. What could go wrong.${SIGN_OFF}`;
  const latest = [...lore].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return [
    opener,
    `Now, last time I was in this repo (issue #${latest.issue}) — and I want to be clear this timeline never officially happened — ${latest.text}`,
    "I remember everything. Nobody else does. That's the burden.",
  ].join("\n\n") + SIGN_OFF;
}

export function busyComment(active: Job): string {
  return `I'm already elbow-deep in this one (job \`${active.id}\`). One crisis at a time, nephew.${SIGN_OFF}`;
}

export function noTestsComment(): string {
  return [
    "I looked everywhere. No tests. Not one.",
    "How am I supposed to know when I'm right? (I'm always right, but I like proof.)",
    "Add a `test:` line to `.uncle.yml`, or a `test` script in package.json, and call me again.",
  ].join("\n\n") + SIGN_OFF;
}

function historyLines(tls: Timeline[]): string[] {
  return tls.filter((t) => t.outcome === "failed").map(
    (t) => `- **Timeline ${t.n}** — ${t.approach || "(lost to history)"}. *Rewound: ${t.failReason ?? "unknown"}.*${t.quote ? ` "${t.quote}"` : ""}`,
  );
}

export function prBody(job: Job, tls: Timeline[], albumUrl: string): string {
  const winner = tls.find((t) => t.outcome === "passed");
  const history = historyLines(tls);
  return [
    `Fixes #${job.issueNumber}`,
    "## What I did",
    winner ? winner.approach : "(see diff)",
    winner?.quote ? `> ${winner.quote}` : "",
    job.testCommand ? `Tests: \`${job.testCommand}\` — all green, including the ones you didn't show me.` : "",
    "## Family History",
    history.length
      ? ["These timelines were rewound. The garage has no memory of them. I do.", ...history].join("\n")
      : "Got it on the first try. Write that down somewhere. Nobody ever writes it down.",
    `📸 Full family album: ${albumUrl}`,
  ].filter(Boolean).join("\n\n") + SIGN_OFF;
}

export function prComment(prUrl: string, albumUrl: string): string {
  return `Fixed. Here's your PR: ${prUrl}\n\nThe family album, with all the timelines we don't talk about: ${albumUrl}${SIGN_OFF}`;
}

export function giveUpComment(job: Job, tls: Timeline[], albumUrl: string): string {
  const lines = tls.map((t) => `- **Timeline ${t.n}** — ${t.approach || "(lost to history)"}. *${t.failReason ?? "unknown"}.*`);
  return [
    `I gave issue #${job.issueNumber} ${tls.length} timelines. The universe gave me nothing back.`,
    "For the record, this is not my fault. Here's everything I tried, so whoever comes next doesn't repeat my genius:",
    lines.join("\n"),
    `Album: ${albumUrl}`,
  ].join("\n\n") + SIGN_OFF;
}

export function errorComment(): string {
  return `My garage is on fire. Not a metaphor — something broke on my end. I'll be back.${SIGN_OFF}`;
}

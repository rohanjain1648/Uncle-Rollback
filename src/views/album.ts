import type { Job, JobStatus, Timeline } from "../db.js";

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STATUS: Record<JobStatus, { label: string; tone: string }> = {
  queued: { label: "Waiting by the door", tone: "gold" },
  running: { label: "In the garage", tone: "gold" },
  passed: { label: "Fixed it", tone: "avocado" },
  gave_up: { label: "Gave up (not his fault)", tone: "red" },
  no_tests: { label: "No tests found", tone: "red" },
  interrupted: { label: "Interrupted", tone: "red" },
  error: { label: "Garage fire", tone: "red" },
};

const CSS = `
:root{--leather:#3B2418;--page:#4A2E1F;--photo:#FFFDF8;--gold:#D9A13B;--red:#C2261B;--avocado:#6B7A34;--ink:#2A1A10;--muted:#B89B7E}
*{box-sizing:border-box}
html{background:var(--leather)}
body{margin:0;color:var(--photo);font:17px/1.6 "Spectral",Georgia,serif;
  background:radial-gradient(ellipse at top,#523320 0%,var(--leather) 70%);min-height:100vh}
a{color:var(--gold)}
a:focus-visible,summary:focus-visible{outline:3px solid var(--gold);outline-offset:3px}
.wrap{max-width:760px;margin:0 auto;padding:40px 16px 80px}
h1{font:400 clamp(2.4rem,7vw,3.6rem)/1.05 "Shrikhand",Georgia,serif;color:var(--gold);margin:0 0 8px;
  text-shadow:0 2px 0 #1e110a}
.sub{color:var(--muted);margin:0 0 36px;max-width:60ch}
.hand{font-family:"Kalam",cursive}
.sticker{display:inline-block;padding:2px 12px;border-radius:999px;font:700 .9rem/1.6 "Kalam",cursive;
  transform:rotate(-2deg);color:var(--ink)}
.sticker.gold{background:var(--gold)}.sticker.avocado{background:#A9B86A}.sticker.red{background:#E9A79F}
.jobs{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.jobs a.row{display:grid;grid-template-columns:1fr auto;gap:4px 16px;padding:16px 18px;text-decoration:none;
  color:var(--photo);background:var(--page);border-left:6px solid var(--gold);border-radius:3px}
.jobs a.row:hover{background:#56361f}
.row .meta{grid-column:1/-1;color:var(--muted);font-size:.92rem}
.row strong{font-weight:600}
.empty{background:var(--page);padding:28px;border-radius:3px}
.issue{background:var(--page);padding:20px 22px;border-radius:3px;margin-bottom:40px}
.issue h2{margin:0 0 6px;font:600 1.4rem/1.3 "Spectral",serif}
.issue p{margin:6px 0;color:var(--muted)}
.strip{position:relative;display:grid;gap:44px;padding-left:0}
.polaroid{position:relative;background:var(--photo);color:var(--ink);padding:14px 14px 18px;border-radius:2px;
  box-shadow:0 10px 24px rgba(20,10,4,.55);max-width:620px}
.polaroid:nth-child(odd){transform:rotate(-1.2deg)}
.polaroid:nth-child(even){transform:rotate(1deg);margin-left:auto}
.polaroid::before,.polaroid::after{content:"";position:absolute;width:26px;height:26px;background:var(--gold);opacity:.9}
.polaroid::before{top:-6px;left:-6px;clip-path:polygon(0 0,100% 0,0 100%)}
.polaroid::after{bottom:-6px;right:-6px;clip-path:polygon(100% 0,100% 100%,0 100%)}
.shot{background:#1f1611;color:#e8dccb;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:12px;
  height:170px;overflow:hidden;white-space:pre;border-radius:1px;position:relative}
.shot.blank{display:grid;place-items:center;white-space:normal;font:1.1rem "Kalam",cursive;color:#a8977f}
.caption{margin:12px 4px 0;font:1.25rem/1.35 "Kalam",cursive}
.facts{margin:8px 4px 0;font-size:.95rem;color:#5b4636}
.facts b{color:var(--ink)}
.rewound{background:#EFE6D6}
.rewound .shot{filter:sepia(.8) brightness(.55) contrast(.8)}
.rewound .caption,.rewound .facts{opacity:.8}
.rewound .scrawl{position:absolute;inset:14px 14px auto 14px;height:170px;display:grid;place-items:center;pointer-events:none;overflow:hidden}
.rewound .scrawl span{position:relative;z-index:1;font:700 clamp(1.7rem,6vw,2.6rem)/1 "Kalam",cursive;color:#FF5A47;
  transform:rotate(-8deg);text-shadow:0 2px 0 #1f1611,0 0 10px #1f1611}
.rewound .scrawl::before,.rewound .scrawl::after{content:"";position:absolute;left:8%;right:8%;top:50%;
  border-top:5px solid var(--red);border-radius:4px;opacity:.9}
.rewound .scrawl::before{transform:rotate(14deg)}.rewound .scrawl::after{transform:rotate(-14deg)}
.star{position:absolute;z-index:2;top:-24px;right:18px;width:58px;height:58px;background:var(--gold);
  clip-path:polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%);
  filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))}
.developing .shot{animation:develop 2.4s ease-in-out infinite alternate}
@keyframes develop{from{filter:brightness(.35) sepia(.6)}to{filter:brightness(.9) sepia(.2)}}
@media (prefers-reduced-motion:reduce){.developing .shot{animation:none}}
details{margin:10px 4px 0}
summary{cursor:pointer;color:#5b4636;font-size:.92rem}
details pre{background:#f1ebe0;color:var(--ink);padding:10px;overflow:auto;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;max-height:320px}
.pr{margin-top:44px;background:var(--avocado);color:var(--photo);padding:18px 22px;border-radius:3px;font-size:1.1rem}
.pr a{color:var(--photo);font-weight:600}
@media (max-width:560px){.polaroid:nth-child(even){margin-left:0}.jobs a.row{grid-template-columns:1fr}}
`;

function page(title: string, body: string, extraHead = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Kalam:wght@400;700&family=Shrikhand&family=Spectral:wght@400;600&display=swap" rel="stylesheet">
<style>${CSS}</style>${extraHead}</head><body><main class="wrap">${body}</main></body></html>`;
}

const sticker = (s: JobStatus) => `<span class="sticker ${STATUS[s].tone}">${esc(STATUS[s].label)}</span>`;
const secs = (ms: number) => (ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)} s`);

export function renderIndex(jobs: Job[]): string {
  const rows = jobs.map((j) => `<li><a class="row" href="/job/${esc(j.id)}">
    <strong>${esc(j.issueTitle)}</strong>${sticker(j.status)}
    <span class="meta">${esc(j.repo)} #${j.issueNumber}, started ${esc(j.createdAt.slice(0, 16).replace("T", " "))} UTC</span></a></li>`).join("");
  return page("Uncle Rollback's family album", `
    <h1>Uncle Rollback's family album</h1>
    <p class="sub">Every fix Uncle attempted, including the timelines he rewound. The garage forgets them. He doesn't.</p>
    ${jobs.length ? `<ul class="jobs">${rows}</ul>`
      : `<div class="empty"><p class="hand" style="font-size:1.3rem;margin:0">Nothing in the album yet.</p>
         <p style="margin:6px 0 0;color:var(--muted)">Comment <code>@uncle fix this</code> on an issue in an allowlisted repo to start the first job.</p></div>`}`);
}

function polaroid(t: Timeline): string {
  const cls = t.outcome === "failed" ? "rewound" : t.outcome === "running" ? "developing" : "won";
  const shot = t.diff.trim()
    ? `<div class="shot">${esc(t.diff.split("\n").slice(0, 14).join("\n"))}</div>`
    : `<div class="shot blank">${t.outcome === "running" ? "Developing…" : "No changes in this photo"}</div>`;
  const outcome = t.outcome === "failed"
    ? `<b>Rewound:</b> ${esc(t.failReason ?? "unknown")}`
    : t.outcome === "passed" ? "<b>Passed</b> every test, hidden ones included" : "<b>In progress</b>";
  return `<article class="polaroid ${cls}" aria-label="Timeline ${t.n}">
    ${t.outcome === "passed" ? '<div class="star" aria-hidden="true"></div>' : ""}
    ${shot}
    ${t.outcome === "failed" ? '<div class="scrawl" aria-hidden="true"><span>never happened</span></div>' : ""}
    <p class="caption">Timeline ${t.n}${t.quote ? `: “${esc(t.quote)}”` : ""}</p>
    <p class="facts">${t.approach ? `${esc(t.approach)}<br>` : ""}${outcome}${t.durationMs ? `, ${secs(t.durationMs)}` : ""}</p>
    ${t.diff.trim() ? `<details><summary>Full diff</summary><pre>${esc(t.diff)}</pre></details>` : ""}
    ${t.testTail.trim() ? `<details><summary>Test output</summary><pre>${esc(t.testTail)}</pre></details>` : ""}
  </article>`;
}

export function renderJob(job: Job, tls: Timeline[]): string {
  const live = job.status === "queued" || job.status === "running";
  const poll = live ? `<script>
    (function(){var last=${JSON.stringify(job.updatedAt)},n=${tls.length};
    setInterval(function(){fetch("/api/job/${esc(job.id)}").then(function(r){return r.json()}).then(function(d){
      if(d.job.updatedAt!==last||d.timelines.length!==n){location.reload()}}).catch(function(){})},3000)})();
    </script>` : "";
  const baseline = job.baseline
    ? `<article class="polaroid" aria-label="Timeline 0"><div class="shot">${esc(job.baseline.split("\n").slice(-12).join("\n"))}</div>
       <p class="caption">Timeline 0: how I found it</p>
       <p class="facts">Tests before Uncle touched anything (<code>${esc(job.testCommand ?? "")}</code>)</p></article>`
    : "";
  return page(`${job.issueTitle} | Uncle Rollback`, `
    <p><a href="/">Back to the album</a></p>
    <h1>Issue #${job.issueNumber}</h1>
    <section class="issue">
      <h2>${esc(job.issueTitle)}</h2>
      <p>${esc(job.repo)}</p>
      <p>${sticker(job.status)}</p>
    </section>
    <section class="strip">${baseline}${tls.map(polaroid).join("")}</section>
    ${job.prUrl ? `<p class="pr">Uncle opened a pull request: <a href="${esc(job.prUrl)}">${esc(job.prUrl)}</a></p>` : ""}
    ${!tls.length && live ? '<p class="hand" style="font-size:1.3rem">Uncle is rolling up his sleeves. Photos will appear here as he works.</p>' : ""}
  `, poll);
}

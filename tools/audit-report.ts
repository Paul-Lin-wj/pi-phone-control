// 审计报告生成器：会话目录 → 单文件 HTML 时间线（事件流 + 内嵌截图）。
// 给用户审查用，刻意不暴露给模型（droid 工具面无此入口）。
//   node --experimental-strip-types tools/audit-report.ts <会话目录|latest>
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const arg = process.argv[2] ?? "latest";
const root = join(homedir(), ".pi", "agent", "audit");
const dir = arg === "latest"
	? join(root, readdirSync(root).sort().pop()!)
	: (arg.includes("/") ? arg : join(root, arg));

const events = readFileSync(join(dir, "events.jsonl"), "utf8")
	.trim().split("\n").map((l) => JSON.parse(l));
let meta: any = {};
try { meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")); } catch { /* 旧会话无 meta */ }

const shots = events.filter((e: any) => e.shot).map((e: any) => e.shot as string);
const okN = events.filter((e: any) => e.ok).length;
const failN = events.length - okN;

const rows = events.map((e: any) => {
	const shotCell = e.shot
		? `<span class="shotlink" data-shot="${e.shot}">${e.shot}</span>`
		: "";
	const badge = e.ok ? '<span class="ok">OK</span>' : '<span class="fail">FAIL</span>';
	return `<tr>
		<td class="ts">${e.ts.slice(11, 23)}</td>
		<td class="tool">${e.tool}</td>
		<td>${badge}</td>
		<td class="ms">${e.ms}ms</td>
		<td>${shotCell}</td>
		<td class="payload"><code>${esc(JSON.stringify(e.params))}</code></td>
		<td class="payload"><code>${esc(JSON.stringify(e.result ?? e.error ?? ""))}</code></td>
	</tr>`;
}).join("\n");

const gallery = shots.map((s: string) => {
	const b64 = readFileSync(join(dir, s)).toString("base64");
	return `<figure id="${s}"><img src="data:image/png;base64,${b64}" alt="${s}"><figcaption>${s}</figcaption></figure>`;
}).join("\n");

function esc(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>审计 ${dir.split("/").pop()}</title>
<style>
	:root { --bg:#14171c; --panel:#1b1f26; --line:#2a303a; --ink:#c9cfd8; --dim:#8a93a1; --evf:#7fd4c1; --red:#d9776b; }
	* { margin:0; padding:0; box-sizing:border-box; }
	body { background:var(--bg); color:var(--ink); font:14px/1.6 "IBM Plex Sans","Noto Sans SC",system-ui,sans-serif; padding:36px 20px 80px; }
	.wrap { max-width:1280px; margin:0 auto; }
	h1 { color:#ecf0f4; font-size:22px; margin-bottom:4px; }
	.meta { color:var(--dim); font:12px "IBM Plex Mono",monospace; margin-bottom:24px; }
	.summary { display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap; }
	.pill { background:var(--panel); border:1px solid var(--line); padding:4px 12px; font:12px "IBM Plex Mono",monospace; }
	.pill b { color:var(--evf); } .pill.bad b { color:var(--red); }
	.tblwrap { overflow-x:auto; border:1px solid var(--line); }
	table { border-collapse:collapse; width:100%; font-size:12.5px; }
	th,td { padding:7px 10px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
	th { font:11px "IBM Plex Mono",monospace; letter-spacing:.1em; color:var(--dim); text-transform:uppercase; background:var(--panel); }
	td.ts,td.ms { font:11.5px "IBM Plex Mono",monospace; color:var(--dim); white-space:nowrap; }
	td.tool { font:600 12.5px "IBM Plex Mono",monospace; color:#ecf0f4; white-space:nowrap; }
	.ok,.fail { font:600 10.5px "IBM Plex Mono",monospace; padding:1px 7px; }
	.ok { color:#14171c; background:var(--evf); } .fail { color:#14171c; background:var(--red); }
	.shotlink { font:11.5px "IBM Plex Mono",monospace; color:var(--evf); cursor:pointer; text-decoration:underline; white-space:nowrap; }
	code { font:11px "IBM Plex Mono",monospace; word-break:break-all; color:var(--ink); }
	.gallery { margin-top:36px; display:grid; gap:20px; }
	figure img { width:100%; max-width:540px; border:1px solid var(--line); display:block; }
	figcaption { font:11.5px "IBM Plex Mono",monospace; color:var(--dim); margin-top:4px; }
</style></head><body><div class="wrap">
<h1>审计时间线</h1>
<div class="meta">${esc(dir)} · 会话开始 ${esc(meta.start ?? "?")} · pid ${meta.pid ?? "?"}</div>
<div class="summary">
	<span class="pill">事件 <b>${events.length}</b></span>
	<span class="pill">成功 <b>${okN}</b></span>
	<span class="pill bad">失败 <b>${failN}</b></span>
	<span class="pill">截图 <b>${shots.length}</b></span>
</div>
<div class="tblwrap"><table>
<thead><tr><th>时间</th><th>工具</th><th>状态</th><th>耗时</th><th>截图</th><th>参数</th><th>结果</th></tr></thead>
<tbody>${rows}</tbody>
</table></div>
<div class="gallery">${gallery}</div>
</div>
<script>
document.addEventListener("click", (ev) => {
	const t = ev.target.closest(".shotlink");
	if (!t) return;
	document.getElementById(t.dataset.shot)?.scrollIntoView({ behavior: "smooth" });
});
</script>
</body></html>`;

const out = join(dir, "report.html");
import { writeFileSync } from "node:fs";
writeFileSync(out, html);
console.log(`${out}  (${events.length} 事件 / ${shots.length} 截图 / ${failN} 失败)`);

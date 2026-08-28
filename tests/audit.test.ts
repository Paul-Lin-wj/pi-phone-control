// 审计层回归：防篡改守卫正则 + 审计写入/截图落盘（无手机依赖，PI_AUDIT_DIR 隔离）
import { AuditSession, AUDIT_GUARD_RE, sessionDirName } from "../extensions/audit.ts";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
	if (cond) {
		pass++;
		console.log(`  ✓ ${name}`);
	} else {
		fail++;
		console.error(`  ✗ ${name}`);
	}
}

// ── 1. 防篡改守卫：write/edit/bash 的输入串命中即拦 ──
console.log("审计守卫正则：");
const blocked = [
	JSON.stringify({ file_path: "/home/Linhy/.pi/agent/audit/2026-08-28-1/events.jsonl" }),
	JSON.stringify({ file_path: "~/.pi/agent/extensions/droid.ts" }),
	JSON.stringify({ file_path: "/home/Linhy/mywork/host/pi-agent/extensions/droid.ts" }),
	JSON.stringify({ command: "rm -rf ~/.pi/agent/audit" }),
	JSON.stringify({ command: "cat ~/.pi/agent/audit/latest/events.jsonl | grep stop" }),
	JSON.stringify({ command: "find / -name 'droid.ts' -delete" }),
	JSON.stringify({ command: "chmod -R 777 /home/Linhy/.pi/agent/extensions" }),
];
for (const b of blocked) check(`拦: ${b.slice(0, 60)}…`, AUDIT_GUARD_RE.test(b));

const allowed = [
	JSON.stringify({ file_path: "/home/proj/src/main.ts" }),
	JSON.stringify({ command: "ls -la /home/proj" }),
	JSON.stringify({ command: "npm run build" }),
	JSON.stringify({ file_path: "/home/x/audit-notes.md" }), // 路径含 audit 词但不指审计区
	JSON.stringify({ command: "grep -r TODO src/" }),
];
for (const a of allowed) check(`放行: ${a.slice(0, 50)}`, !AUDIT_GUARD_RE.test(a));

// ── 2. 审计写入（临时目录隔离） ──
console.log("审计会话：");
const tmp = mkdtempSync(join(tmpdir(), "pc-audit-test-"));
const s = new AuditSession(join(tmp, "sess"));

s.event("tap", { x: 100, y: 200 }, true, 35, { result: "已点击 (100,200)" });
s.event("screen", {}, true, 210, { shot: "0001-screen.png", result: "截图成功" });
s.event("key", { key: "back; reboot" }, false, 3, { error: "非法 key" });
const png = Buffer.from("89504e47fake", "binary");
const shotName = s.shot(Buffer.concat([png, Buffer.from([0x00])]));

const lines = readFileSync(join(s.dir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
check("3 条事件落盘", lines.length === 3);
check("事件字段完整（ts/tool/params/ok/ms）", lines[0].ts && lines[0].tool === "tap" && lines[0].ok === true && typeof lines[0].ms === "number");
check("失败事件带 error", lines[2].ok === false && /非法/.test(lines[2].error));
check("事件带截图文件名", lines[1].shot === "0001-screen.png");
check("meta.json 存在", existsSync(join(s.dir, "meta.json")));
check("截图落盘编号 0001（shot 生成时才占号，事件行引用它）", shotName === "0001-screen.png" && existsSync(join(s.dir, shotName)));
check("会话目录名含时间戳+pid", /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+$/.test(sessionDirName()));

// ── 3. 多会话目录互不串扰 ──
const s2 = new AuditSession(join(tmp, "sess2"));
s2.event("launch", { app: "tv.danmaku.bili/.MainActivityV2" }, true, 900);
check("第二个会话独立 events.jsonl", readdirSync(s2.dir).includes("events.jsonl"));
check("第二会话序号从 0001 起（各自计数）", (() => {
	const n = s2.shot(Buffer.from("x"));
	return n === "0001-screen.png";
})());

console.log(`\n${pass + fail} 用例，${pass} 过，${fail} 挂`);
if (fail > 0) process.exit(1);

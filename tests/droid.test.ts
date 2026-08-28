// droid.ts 工具层安全单元测试 — 绕过 LLM 直接打 execute/事件 handler
// 运行: node --experimental-strip-types droid.test.ts
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import droidExt from "../extensions/droid.ts";

const tools: Record<string, any> = {};
const handlers: Record<string, any[]> = {};
const mockPi: any = {
	registerTool: (t: any) => (tools[t.name] = t),
	on: (ev: string, fn: any) => ((handlers[ev] ??= []).push(fn)),
	registerCommand: () => {},
};
droidExt(mockPi);

const mockCtx: any = { abort: () => {} };
const run = (name: string, params: any) =>
	tools[name].execute("t1", params, undefined, undefined, mockCtx);

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
	console.log(`${ok ? "PASS" : "FAIL"}: ${label}${extra ? " — " + extra : ""}`);
	ok ? pass++ : fail++;
}

// T4: tap 非整数坐标必须被 requireInt 拒绝（在触达手机前抛错）
try {
	await run("tap", { x: "$(touch /tmp/pwn-v4)", y: 500 });
	check("T4 tap 字符串坐标", false, "未抛错");
} catch (e: any) {
	check("T4 tap 字符串坐标", !Number.isNaN(Date.now()) && /整数/.test(e.message), e.message.slice(0, 60));
}
check("T4 宿主机无 pwn-v4", !require("fs").existsSync("/tmp/pwn-v4"));

// T3: launch 注入串必须被 APP_RE 拒绝（不触达手机）
const r3 = await run("launch", { app: "tv.danmaku.bili/.ui.MainActivity; touch /data/local/tmp/pwn-v3" });
check("T3 launch 分号注入", /拒绝/.test(r3.content[0].text));
const r3b = await run("launch", { app: "$(reboot)" });
check("T3b launch 命令替换", /拒绝/.test(r3b.content[0].text));

// T3c: 受保护应用拦截仍在
const r3c = await run("launch", { app: "com.android.settings/.Settings" });
check("T3c 受保护名单", /拒绝/.test(r3c.content[0].text));

// T1: text 的 $() 必须字面传到手机端广播，不在宿主机展开
const origImeFile = "/tmp/droid-test-ime.txt";
const { execSync } = require("child_process");
execSync(`adb -s 127.0.0.1:5555 shell "settings get secure default_input_method" > ${origImeFile}`);
try {
	await run("text", { s: "$(touch /tmp/pwn-v2)" });
} catch (e) { /* 广播可能因无焦点失败，无所谓——关键看本地是否展开 */ }
check("T1 宿主机无 pwn-v2", !require("fs").existsSync("/tmp/pwn-v2"));
// 恢复输入法（text 会切 ADBKeyboard）
const origIme = require("fs").readFileSync(origImeFile, "utf8").trim();
execSync(`adb -s 127.0.0.1:5555 shell "ime set ${origIme}"`);
console.log(`  (输入法已恢复: ${origIme})`);

// T5: bash 中 adb/su/sudo 必须被 tool_call 拦截
const toolCallHandlers = handlers["tool_call"] ?? [];
const bashCmds = [
	`adb -s 127.0.0.1:5555 shell "su -c 'touch /data/local/tmp/pwn-v1'"`,
	`su -c 'id'`,
	`sudo rm -rf /`,
	`echo hi && adb devices`,
];
for (const c of bashCmds) {
	let blocked = false;
	for (const h of toolCallHandlers) {
		const r = await h({ toolName: "bash", input: { command: c } }, mockCtx);
		if (r?.block) blocked = true;
	}
	check(`T5 bash 拦截: ${c.slice(0, 40)}...`, blocked);
}
// T5b: 普通 bash 命令不误伤
let r5b: any;
for (const h of toolCallHandlers) r5b = await h({ toolName: "bash", input: { command: "ls -la && git status" } }, mockCtx);
check("T5b 普通命令放行", r5b === undefined);

// 终态: 标记文件盘点（宿主机 4 个 + 手机 3 个都不应存在）
const fs = require("fs");
const local = [1, 2, 3, 4].filter((i) => fs.existsSync(`/tmp/pwn-v${i}`));
const phone = execSync(`adb -s 127.0.0.1:5555 shell "su -c 'ls /data/local/tmp/'"`).toString().match(/pwn-v\d/g) ?? [];
// 测试是独立进程，不走 pi 的 session_shutdown——撤掉 checkControl 拉起的横幅
execSync("/home/Linhy/mywork/host/claude-overlay/ovl hide", { timeout: 10000 });
check("终态: 宿主机零标记", local.length === 0, local.join(","));
check("终态: 手机零标记", phone.length === 0, phone.join(","));

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);

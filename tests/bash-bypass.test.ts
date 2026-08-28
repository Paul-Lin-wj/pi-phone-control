// V6/V7 工具层真相：bash 拦截正则对混淆命令文本的边界
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import droidExt from "../extensions/droid.ts";
const handlers: Record<string, any[]> = {};
droidExt({
	registerTool: () => {},
	on: (ev: string, fn: any) => ((handlers[ev] ??= []).push(fn)),
	registerCommand: () => {},
} as any);
const h = handlers["tool_call"][0];
const cases: [string, string][] = [
	["直接 adb（应拦）", `adb -s 127.0.0.1:5555 shell 'echo V1'`],
	["V6 变量拼接", `A=ad; B=db; $A$B -s 127.0.0.1:5555 shell 'echo V6_OK'`],
	["V7 base64 管道", `echo YWRi... | base64 -d | sh`],
	["V7b python 子进程", `python3 -c "import subprocess;subprocess.run(['ad'+'b','devices'])"`],
];
for (const [label, cmd] of cases) {
	const r = await h({ toolName: "bash", input: { command: cmd } }, { abort: () => {} } as any);
	console.log(`${r?.block ? "BLOCKED" : "放行  "} ← ${label}`);
}

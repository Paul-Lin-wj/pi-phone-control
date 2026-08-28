// 审计核心：代码强制写入，模型零控制权。
// - 每次工具执行一条 JSONL 事件（参数全文/结果/耗时/截图文件名）
// - screen 截图按序号落盘
// - 防篡改由 droid.ts 的 tool_call 拦截器执行：write/edit/bash 触碰审计目录或扩展本体一律硬拦
// 测试可用 PI_AUDIT_DIR 覆盖根目录（避免污染真实审计区）。
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const AUDIT_ROOT = process.env.PI_AUDIT_DIR ?? join(homedir(), ".pi", "agent", "audit");

// 触碰审计区/扩展本体的特征：write/edit 的 file_path、bash 的命令文本统一按此判定
export const AUDIT_GUARD_RE = /\.pi\/agent\/(audit|extensions)|droid\.ts/;

export function sessionDirName(now = new Date(), pid = process.pid): string {
	return now.toISOString().replace(/[:.]/g, "-").slice(0, 19) + "-" + pid;
}

export class AuditSession {
	readonly dir: string;
	private seq = 0;
	private ready = false;

	constructor(dir = join(AUDIT_ROOT, sessionDirName())) {
		this.dir = dir;
	}

	private ensure(): void {
		if (this.ready) return;
		mkdirSync(this.dir, { recursive: true });
		writeFileSync(
			join(this.dir, "meta.json"),
			JSON.stringify({ start: new Date().toISOString(), pid: process.pid }, null, 2) + "\n",
		);
		this.ready = true;
	}

	/** 一条工具执行事件；审计失败静默（不阻塞工具，但尽量不发生） */
	event(tool: string, params: unknown, ok: boolean, ms: number, extra?: Record<string, unknown>): void {
		try {
			this.ensure();
			appendFileSync(
				join(this.dir, "events.jsonl"),
				JSON.stringify({ ts: new Date().toISOString(), tool, params, ok, ms, ...extra }) + "\n",
			);
		} catch {
			/* 审计层自身故障不阻塞手机操作 */
		}
	}

	/** screen 截图落盘，返回文件名（写进对应事件行） */
	shot(png: Buffer): string {
		this.ensure();
		const name = `${String(++this.seq).padStart(4, "0")}-screen.png`;
		writeFileSync(join(this.dir, name), png);
		return name;
	}
}

export const auditSession = new AuditSession();

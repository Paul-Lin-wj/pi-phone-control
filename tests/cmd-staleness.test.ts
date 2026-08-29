// 横幅按钮指令新鲜度回归（2026-08-29 误停 bug）：
// 用户在任务间隙点 ⏹/⏸ 写入 cmd，无消费者；下一个任务首次检查点吃到残留 → 误终止。
// 修复：cmd mtime 早于本任务激活时刻（taskEpoch，手机端时钟）的指令静默丢弃。
// 场景依据：pi -p 会话 12s 注入 stop 正常终止（wall 13s）；任务前注入 stop 被丢弃正常执行。
import { isStaleCmd } from "../extensions/droid.ts";

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

console.log("按钮指令新鲜度：");
const epoch = 1787975493; // 本任务激活时刻（手机端时钟秒）
check("残留：mtime 早于激活时刻 → 丢弃", isStaleCmd(epoch - 4, epoch));
check("残留：与激活时刻同秒 → 丢弃（宁弃不误停）", isStaleCmd(epoch, epoch));
check("新鲜：mtime 晚于激活时刻 → 放行（任务中终止必须生效）", !isStaleCmd(epoch + 1, epoch));
check("无 mtime（文件缺失/取不到，0）→ 不拦", !isStaleCmd(0, epoch));

console.log(`\n${pass + fail} 用例，${pass} 过，${fail} 挂`);
if (fail > 0) process.exit(1);

import { createRequire } from "module";
const require = createRequire(import.meta.url);
import droidExt from "../extensions/droid.ts";
const tools: Record<string, any> = {};
droidExt({ registerTool: (t: any) => (tools[t.name] = t), on: () => {}, registerCommand: () => {} } as any);
await tools.banner.execute("t1", { message: "横幅'单引号'显示测试 ✓" }, undefined, undefined, { abort: () => {} } as any);
console.log("banner 已调用");

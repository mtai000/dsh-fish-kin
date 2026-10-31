/**
 * tool.js —— 注册工具用的那个「定义函数」
 *
 * 与 dsh-fish `lib/tool.js` 同一结论：**不要 import 宿主那个 dsh-tools 包**。
 * 插件以 `link:` 装时从源码目录往上找不到它，import 失败；以 npm 装时能找到，
 * 但那个实现要的是「简写 DSL」，拿到完整 JSON Schema 会报
 * `unsupported JSON schema: parameters.type must be a value schema object`，
 * 于是工具全部注册失败，而插件看起来好好的。
 *
 * 所以这里就是个恒等函数：注册时直接交标准 JSON Schema，由 registry 原样发给 provider。
 */
export const defineTool = (spec) => spec

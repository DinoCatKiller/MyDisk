# @MyDISK/config · TS 编译基线，全仓 `extends` 的源头

|        |                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------- |
| 状态   | ✅ 已落地（P0）                                                                                   |
| 边界   | 只提供 `tsconfig.base.json`；**不含**任何运行时逻辑、构建脚本或可导入代码（它不是一个可运行的包） |
| 上游   | 无                                                                                                |
| 下游   | 所有 `packages/*` 与 `apps/*` 的 `tsconfig.json` 通过 `extends` 依赖它                            |
| 何时读 | 改 TS 编译选项                                                                                    |

## 这个 crate 是什么

全仓的**公共地基**：不产出任何功能，只保证所有包按同一套 TS 规则编译。

## 核心内容

| 项                   | 说明                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `tsconfig.base.json` | `target`/`module` = `ESNext`、`moduleResolution: bundler`、`strict`、`verbatimModuleSyntax`、`resolveJsonModule`、`isolatedModules` |
| 严格性开关           | `noUncheckedIndexedAccess`、`noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch`                                    |
| `types`              | 固定 `["bun"]`                                                                                                                      |

## 必须知道的三个设计决定

1. **`types` 固定 `["bun"]`**：全仓跑在 Bun 上，统一注入 `@types/bun`，各包不必各自声明，避免类型来源不一致。
2. **默认开启 `noUncheckedIndexedAccess` 与 `noUnused*`**：用编译期严格换运行时安全——索引访问返回 `T | undefined`，未用变量直接报错。
3. **它没有 `exports` / `scripts`**：config 只做「被 `extends` 的配置集合」，别在这里加运行时代码或构建流程。

## 相关

- `A1` §2（依赖方向 `apps/* → packages/* → packages/config`）
- 地图 → `AGENTS.md` §2

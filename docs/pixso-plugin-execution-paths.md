# Pixso 插件执行路径核验

## Executive Summary

`PASS: a working Pixso plugin execution path was identified and P0-B can resume without unresolved environment assumptions.`

在 Pixso Desktop `2.3.0` 中，打包后的本地插件可通过开发插件管理面板上传 `manifest.json` 并直接运行。最小 smoke 插件成功执行主线程并创建唯一的 synthetic Frame `ACC_00_SMOKE`（`100 × 100`）；同一时间 `127.0.0.1:5201` 没有监听进程。因此，5201 不是当前 P0-B 的必要依赖。

上一轮 `apps/pixso-layout-probe` 的原始代码和 manifest 也通过相同路径成功复现：插件读取当前页面并导出 probe JSON。当前页面没有 `AL_` 节点，所以本次导出的 `sampleCount` 为 `0`；这只验证执行路径，不重复或替代上一轮 22 个受控样本的语义结论。

## Execution Path Matrix

| Path | Mechanism | Needs local server | Main thread works | Smoke node works | Status |
| --- | --- | ---: | ---: | ---: | --- |
| A Desktop local plugin | 构建 `dist/main.js` 与 `dist/ui.html`，在 Desktop 开发插件面板上传本地 `manifest.json` 后运行 | No | Yes | Yes：`ACC_00_SMOKE`，`100 × 100` | `PASS` |
| B prior probe path | 原样构建并上传 `apps/pixso-layout-probe/manifest.json`，从本地插件列表运行 | No | Yes：读取当前页并完成 JSON 导出 | N/A：该 probe 不创建节点 | `PASS` |
| C plugin-cli dev | 当前仓库没有 Pixso CLI、dev script 或 hot-reload 配置 | N/A | N/A | N/A | `NOT-NEEDED` |

当前 P0-B 首选路径是 **A：Desktop 本地打包/JSON 插件**。正式 Pixso migration 插件与两个已验证插件的 manifest 结构一致，除 `name` 和 `id` 外均为：

```json
{
  "api": "1.0.0",
  "main": "dist/main.js",
  "ui": "dist/ui.html",
  "editorType": ["pixso"]
}
```

这说明正式插件具备沿同一加载机制启动的配置前提。本轮依照范围限制没有运行正式 exporter，也没有重跑 P0-B。

## Path A — Desktop Local Plugin

验证过程使用仓库内新增的 `apps/pixso-plugin-smoke`：

1. 正常构建插件产物；
2. 在 Pixso Desktop 的“插件 → 开发插件 → 管理开发中的插件”入口上传本地 `manifest.json`；
3. 从本地插件列表运行 `Pixso Plugin Execution Smoke`；
4. 主线程调用 `pixso.createFrame()`，只创建一个 synthetic 节点；
5. 画布选中 `ACC_00_SMOKE`，插件 UI 显示 `PASS: ACC_00_SMOKE 100×100`。

该流程不读取业务数据、不联网、不上传、不导出文件。执行前后均未发现 5201 监听进程。

## Path B — Previous Layout Probe

提交 `05d1549840c167bc37dd6cc16f1b991bf1916047` 中的 `apps/pixso-layout-probe` 使用普通 TypeScript/esbuild 构建，产物由 `manifest.json` 指向 `dist/main.js` 和 `dist/ui.html`。上一轮实际成功路径也是 Pixso Desktop 本地插件管理面板上传 manifest 后运行，并非 `plugin-cli dev`。

本轮没有修改 probe，按原 manifest 再次运行并得到：

| Field | Actual value |
| --- | --- |
| `reportVersion` | `1` |
| `sourceTool` | `pixso-plugin-api` |
| `sourceEnvironment.pluginApiVersion` | `2.0.0` |
| `sourceEnvironment.fileName` | `P0-B Pixso-Figma E2E Acceptance Fixture` |
| `expectedSamplePrefix` | `AL_` |
| `sampleCount` | `0` |

导出对话框出现且插件 UI 报告“导出完成”，证明 main thread、页面读取和导出消息链均已执行。`sampleCount=0` 与当前测试页没有 `AL_` 节点一致，不是 probe 失败。本轮没有重新建立上一轮 22 个受控 Auto Layout 节点，因此只把 B 标为“执行路径复现 PASS”，不声称再次完成 22/22 语义验收。

## Path C — plugin-cli / Hot Reload

仓库审计结果：

- `@pixso/plugin-cli`：未安装，版本为 `not-installed`；
- `@pixso/plugin-typings`：未安装，版本为 `not-installed`；
- `dev` script：不存在；
- Pixso dev server：未配置、未启动；
- CLI listener / port / protocol / client target：`not-established`。

仓库中的 `@figma/plugin-typings` 是 Figma 类型依赖，不能记录为 Pixso typings。由于 A 和 B 均已成功，C 对当前 P0-B 不是必要路径，分类为 `NOT-NEEDED`。没有为了得到 5201 而新增依赖或修改端口配置。

## 5201 Classification

```text
necessity: not-required
source/role: obsolete-or-unconfirmed
```

证据：

- `127.0.0.1:5201` 无监听时，A 的主线程仍创建了 smoke 节点；
- 同样无 5201 监听时，B 的主线程仍读取页面并完成 JSON 导出；
- 当前仓库没有把 5201 写入 manifest、脚本或项目配置；
- 当前仓库没有 Pixso plugin CLI 或 hot-reload 配置可证明 5201 的所有者。

因此可以确认“当前 P0-B 不需要 5201”，但不能仅凭这组证据把 5201 进一步断言为 dev-only、官方固定端口或旧版本默认端口。先前 P0-B 报告把 5201 缺失当作平台级硬阻塞的结论已被本轮实测推翻。

Pixso 进程另有一个动态本地监听端口；只读探测中根路径返回认证错误，`/mcp` 和 `/plugin` 均未提供对应服务。该端口的用途未确认，不应记录为插件通道或 Local MCP。

## Local MCP

分类：`not-configured`。

- `127.0.0.1:3667/mcp` 当前没有监听服务；
- 已检查的 Pixso Desktop 菜单中没有发现已配置的 Local MCP 入口或开关；
- 没有取得通过 Local MCP 读取当前设计节点的证据；
- 因此只把它保留为未配置的 Stage A snapshot 候选，不把它当作 migration plugin 写入/导出能力的替代品。

该结论表示“当前环境未配置”，不表示 Pixso Desktop 产品在其他版本或配置中一定不支持 Local MCP。

## P0-B Decision

`CAN RESUME`。

下一轮应直接使用已验证的 Desktop 本地打包插件路径，构建正式 Pixso migration 插件并从其 `manifest.json` 运行未修改的 P0-B 端到端验收。不需要先修复或逆向 5201，也不需要为正式插件增加 WebSocket fallback、私有 API 或端口硬编码。

本轮到此停止，等待审核后再执行完整 P0-B。

## Privacy

- 仓库只新增 synthetic smoke 插件和脱敏执行摘要；
- 没有提交 `.pix`、`.fig`、`.sketch`、解包资产或导出的本地 probe JSON；
- 没有提交本地绝对路径、登录信息、cookie、token、业务名称或真实设计内容；
- 所有实测文件都只保留在本地临时目录，不属于 Git 产物。

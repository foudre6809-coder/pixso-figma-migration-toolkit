# P0-B Pixso → Figma 端到端迁移验收

> 后续执行路径核验已确认：Pixso Desktop 可通过本地打包插件的 `manifest.json` 直接执行主线程，且不需要 `127.0.0.1:5201`。本文以下内容保留为当次 STOP 的历史记录；其中“必须恢复 5201”的环境判断已被实测推翻。P0-B 可在审核后沿已验证路径重跑，详见 [Pixso 插件执行路径核验](./pixso-plugin-execution-paths.md)。

## Executive Summary

- 结果：`STOP`
- Migration Value：`NO`（仅表示本次环境未能建立可执行的迁移价值证据，不是对产品迁移质量的判定）
- 阻塞阶段：`Stage A — Pixso Source`
- 阻塞原因：Pixso 客户端的本地插件桥接服务未监听，插件主线程无法运行，因此无法生成可信的 source snapshot、migration-map 或后续 Sketch/Figma 阶段数据。

本轮未执行产品修复，也未生成或推断任何迁移覆盖率。按照任务的 STOP 规则，当前环境无法运行 Pixso 端插件时必须停止，不能使用空值或人工构造结果替代端到端证据。

## Fixture

已在 Pixso 中建立独立的脱敏草稿容器，名称为 `P0-B Pixso-Figma E2E Acceptance Fixture`。由于插件主线程未执行，代表性场景没有被成功创建：

| 项目 | 结果 |
| --- | --- |
| 顶层场景数 | `not-established` |
| 总节点数 | `not-established` |
| synthetic 命名 | 计划使用 `ACC_01_...`，未写入文档 |
| 真实业务数据 | 未使用 |

该空草稿不是合格的 Representative Migration Acceptance Fixture，因此没有继续导出 Sketch 或创建 Figma C/D1/D2 文件。

## Blocker Evidence

环境：Pixso Desktop `2.3.0`。

1. 在已登录且文档编辑器完成初始化后，Pixso 本地插件桥接端口 `127.0.0.1:5201` 没有监听进程。
2. Pixso DevTools 报告本地 WebSocket 连接失败：`ws://127.0.0.1:5201/plugin`，错误为 `ERR_CONNECTION_REFUSED`。
3. 开发插件 iframe 可以显示，但插件主线程消息处理器没有执行；最小烟雾插件无法创建单个 `ACC_00_SMOKE` Frame。
4. 通过系统进程管理完整退出 Pixso，重新启动，并分别完成主页与编辑器登录后，桥接端口仍未监听。
5. 重启后的编辑器可正常打开脱敏草稿，但“开发插件”入口无法打开可运行的本地插件管理流程。

上述现象说明阻塞发生在 source snapshot 生成之前。生产 Pixso migration 插件依赖同一插件桥接，因此不能绕过该故障取得可信验收数据。

## Stage Comparison

| Metric | Source | Fresh | Conservative | Structural |
| --- | ---: | ---: | ---: | ---: |
| 执行状态 | blocked | not-run | not-run | not-run |
| source node count | null | null | null | null |
| imported node count | null | null | null | null |
| high-confidence matched | null | null | null | null |
| hierarchy exact | null | null | null | null |
| appearance correct/recovered | null | null | null | null |
| Auto Layout retained/recovered | null | null | null | null |
| geometry regression rate | null | null | null | null |

`null` 表示没有执行数据，不能解释为零失败或零覆盖。

## Coverage

- Node matching：`not-assessed`
- Hierarchy：`not-assessed`
- Appearance：`not-assessed`
- Auto Layout：`not-assessed`
- Text：`not-assessed`
- Vector：`not-assessed`
- Image：`not-assessed`
- Component / Instance：`not-assessed`

## Geometry

- median：`null`
- p95：`null`
- max：`null`
- regression rate：`null`

未取得 Fresh Import 与 Repair 快照，禁止计算或推断几何漂移。

## Repair Value

- Conservative 增量：`not-assessed`
- Structural 增量：`not-assessed`

没有运行 Figma repair，不能声明恢复了任何能力。

## Top 5 Failures

不排名。没有端到端样本数据，任何产品失败排序都会是伪造结论。已确认的唯一事项是执行环境阻塞，不属于迁移能力 failure taxonomy。

## Regressions

`not-assessed`。没有 Fresh、Conservative、Structural 三份独立 Figma 文件。

## Manual Intervention

- automatic：`null`
- minor：`null`
- major：`null`
- unrecoverable：`null`

## Next Priority

### P0

恢复 Pixso Desktop 本地插件桥接，使 `127.0.0.1:5201/plugin` 可连接；先验证单节点烟雾插件，再原样重跑本轮 P0-B 流程。该动作只恢复验收执行条件，不扩张迁移产品能力。

### P1

`deferred`。在取得四阶段可信数据前，不根据本轮阻塞推导产品 P1。

### P2

`deferred`。在取得四阶段可信数据前，不根据本轮阻塞推导产品 P2。

## Privacy

- 未提交 `.pix`、`.fig`、`.sketch` 或解包资产。
- 未提交真实业务名称、客户数据、业务文本或敏感图片。
- 报告仅包含 synthetic 名称、客户端版本和本机回环地址的脱敏故障摘要。
- 临时本地烟雾插件不属于仓库产物，未纳入提交。

## STOP

阻塞点为 `Stage A — Pixso Source`。在 Pixso 插件桥接恢复前停止；不继续 Sketch 导出、Figma 导入、repair、失败排名或产品功能修复。

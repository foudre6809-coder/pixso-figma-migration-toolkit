# Pixso → Figma Migration Architecture Benchmark

研究日期：2026-08-11
范围：只读架构研究；未修改 migration schema、Pixso/Figma 插件或 `.pix` 解析逻辑。

本文使用以下证据标签：

- **源码确认**：可由当前仓库或固定 commit 的公开源码直接证明。
- **推断**：由多个源码事实推导，但项目未明确作出该声明。
- **建议**：面向本项目的架构决策，不是外部项目现状。

## 1. Executive Summary

**结论：ADJUST。** 当前“Sketch 承载视觉 + migration-map 承载语义 + Figma 插件修复”的双通道方向合理，无需推倒重来；问题在于主数据源优先级、中间模型完整度和 target adapter 职责尚未明确。

**建议**以 Pixso Plugin API 作为 Primary source adapter，以版本化 normalized migration IR 作为唯一语义合同，以验证器输出覆盖率、丢失项和 fallback 原因，再由 Figma target adapter 同时支持“匹配/修复既有 Sketch 导入节点”和“直接创建已确认支持的节点”。

`.pix parser` 定位为 **Secondary**：只补 Plugin API 未暴露且经受控差分确认的字段；必须版本门控、保留来源与置信度、不得静默覆盖 API 原生值。它不是默认入口，也不能仅凭解码成功被称为通用 `.pix` 解析器。

Sketch 定位为 **Gradually replace**：当前继续承担视觉载体与复杂内容兜底；当 IR、资产管线和 Figma builder 的端到端验收达到门槛后，按能力逐项转为直接创建，而不是一次性移除 Sketch。

下一阶段唯一 P0 是端到端迁移验收。现有兼容性文档仍把 clean-import 视觉验收列为待完成；在没有节点级覆盖率、视觉差异和 fallback 报告前，继续扩字段或二进制逆向无法证明迁移成功率。

## 2. Projects Reviewed

| Project | Purpose | Similarity | Useful Parts |
| --- | --- | --- | --- |
| [`penpot/penpot-exporter-figma-plugin`](https://github.com/penpot/penpot-exporter-figma-plugin/tree/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e) | Figma 插件抽取设计数据并构造 Penpot 可导入文档 | 极高：source plugin → normalized document → target importer | 节点类型分派、标准化文档、ID 映射、布局/组件/样式/变量/资产转换、诊断、大文件策略 |
| [`JovanHsu/pixso-node-exporter`](https://github.com/JovanHsu/pixso-node-exporter/tree/11b85d84b4ff50a219417f493df7de604e384002) | 通过 Pixso Plugin API 遍历、搜索和探测节点 | 高：同一源工具 API | page/selection 递归、文本、reactions/prototype、可枚举属性 probe |
| [`larkes-cyber/PixsoMovePlugin`](https://github.com/larkes-cyber/PixsoMovePlugin/tree/1777a5fa7a3a1a7d0420472a1deea2c7df3834c7) | Pixso 节点序列化与选择导出 | 高：Pixso → JSON source adapter | 丰富节点模型、绝对/本地几何、样式与组件字段、安全序列化、取消/yield、预览与数据分离 |
| [`sketch-hq/fig2sketch`](https://github.com/sketch-hq/fig2sketch/tree/1b9eaf293efe22f60d6e2c2eccf223cc124b4a2d) | `.fig` → `.sketch` 转换器 | 高：跨设计工具并使用 Sketch 作为目标/载体 | 源/目标语义不等价时的显式转换、warnings、实例 override 退化、图片与文本处理 |
| [`OpenFig-org/openfig-core`](https://github.com/OpenFig-org/openfig-core/tree/0d67354fcd6d14c37b89c42f55330faf0a79e1ce) | `.fig/.deck/.jam` Kiwi 二进制读写 | 中高：与 `.pix` Kiwi 研究方法同类 | 自描述 schema 解码、树重建、资产拆分、round-trip/invariant 测试、版本漂移警告 |
| [`sketch-hq/sketch-document`](https://github.com/sketch-hq/sketch-document/tree/4493900abbfa49ae82fbcb8ad85cccf2cc2256b0) | 官方 `.sketch` 格式 schema、类型和读写 API | 高：当前视觉中转格式 | 公开 zipped JSON/binary 规范、图层/样式/资产 schema、格式验证边界 |

新增的三个项目都回答一个必要问题，而非扩大仓库清单：`fig2sketch` 验证 Sketch 中转的真实语义损失；`openfig-core` 展示二进制解析要进入产品所需的长期维护成本；`sketch-document` 说明 Sketch 作为暂时载体为何比私有二进制更容易检查和验证。

### 2.1 Penpot：实际源码路径

- **源码确认**：README 明确选择 Figma plugin，是因为跨工具迁移面对 closed/non-standard formats，并由插件生成 Penpot 可导入 ZIP；当前列出的支持范围包括基础节点、vector、mask、text、components/sets/instances、Auto Layout、styles、variants 和 external libraries，prototyping 未支持。[README](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/README.md)
- **源码确认**：normalized document 是正式类型，不只是节点数组；包含 pages、components、paint/text styles、tokens、component properties、external libraries、missing fonts，图片通过独立消息流传输。[`ui-src/types/penpotDocument.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/ui-src/types/penpotDocument.ts) [`buildPenpotDocument.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/transformers/buildPenpotDocument.ts)
- **源码确认**：导出入口会在每次运行前清空状态，报告当前 step/layer，并根据编辑器类型构建 document。[`handleMessage.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/handleMessage.ts) [`libraries.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/libraries.ts)
- **源码确认**：节点转换按类型分派；Frame 再组合 ID、paint、layout、corner、effect、constraint、position、dimension、children、override 和 variable consumption 等 partial transformer。[`transformSceneNode.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/transformers/transformSceneNode.ts) [`transformFrameNode.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/transformers/transformFrameNode.ts)
- **源码确认**：文本不是 `styleSummary`，而是 characters + styled segments/runs；vector 有 path/region 翻译；component、component set 和 instance 分开处理并维护 property/variant/override/library 关系。[`buildTextContent.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/translators/text/buildTextContent.ts) [`translateTextSegments.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/translators/text/translateTextSegments.ts) [`transformVectorNode.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/transformers/transformVectorNode.ts) [`transformComponentNode.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/transformers/transformComponentNode.ts) [`transformComponentSetNode.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/transformers/transformComponentSetNode.ts) [`transformInstanceNode.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/transformers/transformInstanceNode.ts)
- **源码确认**：ID、Auto Layout、full paint/stroke arrays、effects、variables/styles 和 assets 都有独立转换/处理边界。[`transformIds.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/transformers/partials/transformIds.ts) [`translateLayout.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/translators/translateLayout.ts) [`translateFills.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/translators/fills/translateFills.ts) [`translateStrokes.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/translators/translateStrokes.ts) [`processTokens.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/processors/processTokens.ts) [`processImages.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/processors/processImages.ts)
- **源码确认**：大文件策略包括有限并发、图片逐个传输并释放、页面异步加载、进度缓冲和 LRU cache。[`asyncPool.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/common/asyncPool.ts) [`messageBuffer.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/common/messageBuffer.ts) [`Cache.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/Cache.ts) [`processPages.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/processors/processPages.ts)

### 2.2 Pixso Plugin API 项目：实际源码路径

- **源码确认**：`pixso-node-exporter` 通过 `pixso.currentPage.children` 或 selection 递归读取 id/name/type/visible/tree/text，并尝试读取 reactions、transition 和 prototype interactions；property probe 还会枚举节点可见属性。[`main.js`](https://github.com/JovanHsu/pixso-node-exporter/blob/11b85d84b4ff50a219417f493df7de604e384002/main.js)
- **源码确认**：`PixsoMovePlugin` 的 `SerializedNode` 包含本地与绝对几何、rotation、layout、constraints、paint/effect arrays、text style、component/instance/variant、plugin data、visibility/locked/mask 等字段，明显宽于当前 migration schema。[`src/main/types.ts`](https://github.com/larkes-cyber/PixsoMovePlugin/blob/1777a5fa7a3a1a7d0420472a1deea2c7df3834c7/src/main/types.ts)
- **源码确认**：它递归序列化时周期性 yield 并检查 cancellation，且将 preview bytes 与 JSON payload 分离。[`serialization.ts`](https://github.com/larkes-cyber/PixsoMovePlugin/blob/1777a5fa7a3a1a7d0420472a1deea2c7df3834c7/src/main/serialization.ts) [`exportPayload.ts`](https://github.com/larkes-cyber/PixsoMovePlugin/blob/1777a5fa7a3a1a7d0420472a1deea2c7df3834c7/src/main/exportPayload.ts) [`plugin.ts`](https://github.com/larkes-cyber/PixsoMovePlugin/blob/1777a5fa7a3a1a7d0420472a1deea2c7df3834c7/src/main/plugin.ts)
- **推断**：对于 tree/identity/local+absolute geometry/layout/constraints/basic paints/effects/text/component identity/visibility/locked/mask/interactions，继续先做受控 Pixso API capability probe，比默认转向 `.pix` binary 更安全。是否所有 Pixso 版本和私有部署都暴露这些属性，仍需本项目在运行时验证，不能仅因社区项目存在就视为保证。

## 3. Current Architecture

### 3.1 已确认现状

```text
Pixso
├─ Sketch Export ──────────────→ Figma import ─┐
│                                              ├─→ Figma repair plugin
└─ Pixso capability/export plugin → migration-map ┘

.pix parser → 已确认二进制字段 / research diagnostics
```

- **源码确认**：当前架构明确采用 Sketch 视觉迁移与 migration-map 语义修复双通道。[`docs/architecture.md`](architecture.md)
- **源码确认**：schema 已有版本号、node identity/tree、rect、基本 layout、component identity、text/asset summary、单一 solid fill/stroke、radius/opacity/effect summary、risk flags，并为字段保留 `native | inferred | unavailable` 来源。[`packages/migration-schema/src/index.ts`](../packages/migration-schema/src/index.ts)
- **源码确认**：Pixso exporter 已通过公共 API 递归导出 page/selection，并直接读取 layout、component、text、fill/stroke、radius、visibility、mask、opacity 和 effects 等能力；stroke diagnostics 还能记录 style/variable identity（若 API 暴露）。[`apps/pixso-plugin/src/main.ts`](../apps/pixso-plugin/src/main.ts) [`apps/pixso-plugin/src/node-data.ts`](../apps/pixso-plugin/src/node-data.ts)
- **源码确认**：Figma 端目前主要匹配并修复由 Sketch 导入的现有节点，保守修复 appearance，并对 layout/group/component conversion 使用实验或显式 opt-in；它不是完整 node builder。[`apps/figma-plugin/src/main.ts`](../apps/figma-plugin/src/main.ts)
- **源码确认**：variables、variants、constraints、prototype 尚未完整恢复，clean-import 视觉验收仍是待验证项。[`docs/compatibility.md`](compatibility.md)

### 3.2 判断

- **建议**：保留“双通道”，但把它从两条松散流程调整为同一个 IR 与 validator 管理的 source/target adapters。
- **推断**：当前主要结构问题不是 Sketch 本身，而是 `migration-map` 既像摘要、又像 patch 参数、又被期待成为迁移文档；这会让 source capability、语义转换、fallback 和 target execution 混在一起。
- **建议**：IR 必须表达完整源语义、转换后的目标语义、字段来源/置信度、unsupported/fallback 与资产引用；Figma repair policy 不应反向定义 IR 的能力上限。

## 4. External Architecture Patterns

### 4.1 Penpot 为什么使用 Plugin API，而不是直接解析 `.fig`

1. **源码确认**：README 把 closed/non-standard formats 视为迁移难点，并明确采用 Figma plugin 生成 Penpot importer 可消费的 ZIP，而不是声明一个通用 `.fig` parser。[README](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/README.md)
2. **源码确认**：插件 API 可直接给出语义对象，并允许异步解析 main component、remote libraries、variables/styles、fonts 和 image bytes；这些不仅是“某个二进制字段”，还包含 API 已解释的关系和权限边界。[`transformInstanceNode.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/transformers/transformInstanceNode.ts) [`processTokens.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/processors/processTokens.ts) [`processImages.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/processors/processImages.ts)
3. **源码确认**：即使源数据语义已知，Penpot 仍构造 normalized target document，因为 Figma 与 Penpot 的 layout、component、paint、text 和 vector 语义并不一一对应。[`translateLayout.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/translators/translateLayout.ts) [`translateStrokes.ts`](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/plugin-src/translators/translateStrokes.ts)
4. **推断**：插件 API 的真正优势不是“字段多”，而是让源工具承担 schema 解码、关系解析和兼容性；迁移器把精力放在明确的语义映射、降级和验证上。
5. **建议**：该模式适用于本项目，但 IR 应保持 source-neutral，而不是直接复制 Penpot target schema；否则会把目标工具的限制提前固化进源数据。

### 4.2 二进制 parser 的产品化门槛

- **源码确认**：`openfig-core` 需要解 ZIP、解析 prelude/version、解压内嵌 Kiwi schema 与 message、重建 flat nodeChanges tree、处理资产，并提供 encode/round-trip 与 invariants。[`src/parser.ts`](https://github.com/OpenFig-org/openfig-core/blob/0d67354fcd6d14c37b89c42f55330faf0a79e1ce/src/parser.ts) [`src/encoder.ts`](https://github.com/OpenFig-org/openfig-core/blob/0d67354fcd6d14c37b89c42f55330faf0a79e1ce/src/encoder.ts) [`docs/invariants.md`](https://github.com/OpenFig-org/openfig-core/blob/0d67354fcd6d14c37b89c42f55330faf0a79e1ce/docs/invariants.md)
- **源码确认**：其研究文档明确记录 schema version drift、树关系与 schema consistency 可能造成静默损坏。[`docs/research.md`](https://github.com/OpenFig-org/openfig-core/blob/0d67354fcd6d14c37b89c42f55330faf0a79e1ce/docs/research.md)
- **推断**：本项目 `.pix` 解码/re-encode 成功是很强的研究证据，但离“主要数据源”仍差跨版本 corpus、unknown-field preservation、完整资产/关系语义和持续兼容预算。

### 4.3 跨工具语义转换必须显式承认损失

- **源码确认**：`fig2sketch` README 明确说明 `.fig` 与 `.sketch` 数据类型不完全相同；nested Frame、styled Frame、fixed text 和 instance overrides 需要转换或退化。[README](https://github.com/sketch-hq/fig2sketch/blob/1b9eaf293efe22f60d6e2c2eccf223cc124b4a2d/README.md) [`converter/frame.py`](https://github.com/sketch-hq/fig2sketch/blob/1b9eaf293efe22f60d6e2c2eccf223cc124b4a2d/src/converter/frame.py) [`converter/instance.py`](https://github.com/sketch-hq/fig2sketch/blob/1b9eaf293efe22f60d6e2c2eccf223cc124b4a2d/src/converter/instance.py)
- **源码确认**：`.sketch` 是公开的 zipped JSON + binary assets，且官方仓库提供 schema/types/read-write APIs；其 layer schema 原生表达 visibility、locked、constraints、mask、boolean、style 和 flow 等。[README](https://github.com/sketch-hq/sketch-document/blob/4493900abbfa49ae82fbcb8ad85cccf2cc2256b0/README.md) [`abstract-layer.schema.yaml`](https://github.com/sketch-hq/sketch-document/blob/4493900abbfa49ae82fbcb8ad85cccf2cc2256b0/packages/file-format/schema/layers/abstract-layer.schema.yaml) [`style.schema.yaml`](https://github.com/sketch-hq/sketch-document/blob/4493900abbfa49ae82fbcb8ad85cccf2cc2256b0/packages/file-format/schema/objects/style.schema.yaml)
- **建议**：任何中转或直接创建都必须输出 per-capability diagnostics；“文件能打开”不等于组件、布局或文本语义可编辑地保留。

## 5. Gap Analysis

状态定义：**支持**表示 schema 与导出/消费路径都存在；**部分**表示只有摘要、单一子集、仅源端或仅修复端；**缺失**表示当前正式 IR 无对应表达。外部做法主要引用 Penpot exporter 的 transformer/translator 分层与 `PixsoMovePlugin` 的 source serialization；并不表示应复制其 target-specific schema。

| 能力 | 当前支持 | 外部项目做法 | 建议 |
| --- | --- | --- | --- |
| Node identity | 支持：migration/original ID、name/type/path | Penpot 建 deterministic ID map；PixsoMove 保留 source id | 保留 source ID；另设稳定 migration ID 和 target ID map，禁止跨工具直接复用 |
| parent / children | 支持：parent ID + child IDs | Penpot 独立 children transform；binary parser 重建 parent refs | 增加顺序、orphan/cycle 校验和 unsupported child 占位 |
| local geometry | 支持：x/y/w/h | Penpot position/dimension partial；PixsoMove local x/y/w/h | 继续作为所有节点基础字段 |
| absolute geometry | 缺失 | PixsoMove 同时导出 `absoluteBoundingBox` | 加为验证/匹配字段，不替代 local geometry |
| transforms | 缺失 | Penpot 独立 matrix/rotation 工具；binary parser保留 transform | 表达 2D affine matrix、rotation、flip 与坐标空间 |
| fills | 部分：单一 solid fill / summary | Penpot full paint array：solid/gradient/image | 建 full ordered Paint[]、blend/opacity/transform/style/variable refs |
| strokes | 部分：单一 solid、weight、align、summary | Penpot multiple strokes、paint、dash、cap、stack order | 建 full ordered Stroke[]；把 inline/style/variable source 分开 |
| effects | 部分：summary | Penpot shadow/blur 独立翻译 | 建 typed effects 数组，保留顺序、visible、blend 和变量来源 |
| opacity | 支持基础值 | 两个 Pixso 项目均直接取节点/paint opacity | 区分 node opacity、paint opacity 与 effect opacity |
| radius | 部分：四角数值 | Penpot corner partial；兼容 uniform/mixed | 增加 smoothing 与 target fallback |
| text | 部分：characters + style summary | Penpot characters + styled segments/runs | 建 rich text runs、paragraph/list、range-level style 与 fallback |
| font | 缺失正式模型 | Penpot font family/style/weight、missingFonts；PixsoMove 直接读 text fields | 增加 font refs、missing/substitution diagnostics，不嵌入未授权字体 |
| Auto Layout | 部分：mode/padding/gap/alignment | Penpot 映射 wrap/grid、child attrs、min/max 并记录语义差异 | 补 wrap、counter/primary align、absolute child、layout sizing/positioning |
| sizing | 部分：HUG/FILL/FIXED 与 min/max | Penpot container/child sizing 分离 | 明确 source semantics 与 target resolution；不要仅存最终尺寸 |
| constraints | 缺失 | Penpot constraints translator；PixsoMove 读取 constraints | 先由 API probe，加入水平/垂直 constraints 与 fixed-to-viewport |
| Component | 部分：key/main ID | Penpot 注册 component root、properties、library identity | 建 first-class component definition、library origin、fallback strategy |
| Instance | 部分：instanceOf | Penpot async main component、orphan、remote library、overrides | 建 instance ref、override set、orphan/remote diagnostics |
| Component properties | 缺失 | Penpot 注册 property definitions/values | 建 typed properties（text/boolean/instance swap/variant） |
| Variant | 缺失 | Penpot component set + variant properties | 建 component set、axis、option、selected tuple 与 target fallback |
| variables | 部分：stroke diagnostics 中可能出现 identity，正式 IR 不完整 | Penpot collection/mode/alias/scope/value 与 applied tokens | 建 collection/mode/value/alias/binding；API 值优先，binary 只补确认字段 |
| styles | 部分：summary/identity | Penpot paint/text styles 与 external libraries 分开 | 建 style definition、reference、resolved fallback、library origin |
| image assets | 部分：hash/scale/summary，无 bytes 管线 | Penpot image bytes 独立流式传输并释放 | 建 content-addressed asset manifest + 独立 bundle，不内联大二进制 JSON |
| SVG / vectors | 部分：summary | Penpot path/region/vector transformer；fig2sketch 解 vector network | 建 normalized path/paint/winding；无法编辑时提供 SVG/raster fallback |
| interactions | 缺失 | pixso-node-exporter 尝试 reactions/actions/destination；Penpot 暂未支持 prototype | 先做 API capability probe，IR 可表达但 target adapter 分阶段支持 |
| prototype | 缺失 | pixso-node-exporter 可探测 transition/prototype；Penpot 标为不支持 | 与 interactions 同一 graph model，未支持时明确 diagnostic |
| visibility | 支持 | 外部项目均保留 | 保留节点与 paint/effect 的分层 visibility |
| locked | 缺失 | PixsoMove 与 Sketch schema 均保留 | 增加 locked；不影响渲染但影响编辑保真 |
| masks | 仅 risk/probe，正式表达不足 | Penpot mask node；Sketch schema 有 clipping mask | 建 mask chain、mask type、clip behavior 与 flatten fallback |
| boolean | 缺失 | Penpot boolean transformer；Sketch schema有 booleanOperation | 建 operation + operands；无法映射时保留 vector/SVG fallback |
| metadata | 部分：note/path/risk | PixsoMove 可读 plugin/shared plugin data；Penpot维护 external library/missing font | 只保留迁移所需且可脱敏的元数据；默认排除业务/plugin data |
| source confidence | 支持：native/inferred/unavailable | Penpot 以 warning/error step 表示转换状态 | 扩成 per-field provenance：adapter、source version、confidence、evidence |
| fallback information | 部分：riskFlags/note | fig2sketch 有 conversion warnings 与 detach/ignore；Penpot有 unsupported warning | 建 typed fallback：reason、action、visual/editability impact、target node IDs |

### 5.1 最大结构差距

1. IR 只表达“可修复摘要”，未完整表达 ordered paints/effects、transforms、rich text、assets、component/instance/variant/style/variable graph。
2. source adapter 与 IR transformation 未完全分层，容易把 Pixso API、binary 推断和 Figma repair policy 混进同一字段。
3. target adapter 主要 repair 既有节点，缺 first-class asset/component/direct node builder 与可重复执行事务边界。
4. validator 缺节点级 coverage、unsupported/fallback、视觉/编辑性差异和 ID/reference integrity 报告。
5. 缺端到端验收门槛，尚不能判断继续补字段是否真正提升迁移成功率。

## 6. `.pix Parser Positioning`

### 决策：Secondary

**不选 Primary：**

- **源码确认**：当前 Plugin API exporter 已能直接读取不少节点/布局/外观/组件字段，而两个 Pixso 社区项目进一步证明 API 表面可能更宽；先用 API 避免重复解释私有二进制。[`node-data.ts`](../apps/pixso-plugin/src/node-data.ts) [`pixso-node-exporter/main.js`](https://github.com/JovanHsu/pixso-node-exporter/blob/11b85d84b4ff50a219417f493df7de604e384002/main.js) [`PixsoMovePlugin/types.ts`](https://github.com/larkes-cyber/PixsoMovePlugin/blob/1777a5fa7a3a1a7d0420472a1deea2c7df3834c7/src/main/types.ts)
- **源码确认**：同类 Kiwi parser 的产品化需要处理 schema drift、flat tree、assets、unknown fields、invariants 和 round-trip；当前 `.pix` 研究只确认了一部分受控语义。[`openfig-core/docs/research.md`](https://github.com/OpenFig-org/openfig-core/blob/0d67354fcd6d14c37b89c42f55330faf0a79e1ce/docs/research.md) [`docs/pix-binary-research.md`](pix-binary-research.md)

**不选 Research-only：**

- **源码确认**：本项目已经确认 `.pix` 容器、zstd/Kiwi、记录边界、identity、size、local transform/pure-translation composition、padding、basic stroke 和 shared stroke style identity，并保留 decode → re-encode 证据。[`docs/pix-binary-research.md`](pix-binary-research.md)
- **推断**：这些 confirmed 字段可在“API 缺失且版本匹配”时作为只读补证来源；完全丢弃会浪费已经建立的可验证能力。

**进入正式 Secondary adapter 的硬规则：**

1. 只有受控差分达到 `confirmed` 的字段可进入 IR；`inferred` 只进 diagnostics。
2. 必须记录 `.pix` container/binary/schema/app version fingerprint；未知版本 fail closed。
3. 字段优先级固定为 `Plugin API native > binary confirmed > unavailable`；binary 不得覆盖 API 原生值，冲突必须报告。
4. parser 只读，不上传、不原地改写；unknown fields 与真实资产不进入日志/仓库。
5. 每个字段带 adapter、field path、source version、confidence 和限制；不把 decode 成功包装为通用格式支持。
6. Secondary adapter 故障不得阻断 API-only 迁移，只降低 coverage 并产生诊断。

## 7. Sketch Strategy

### 决策：Gradually replace

| 能力 | Sketch 中转当前价值 | 主要损失/风险 | 建议 |
| --- | --- | --- | --- |
| Geometry | 高：成熟导入链路可快速保留大部分视觉位置/尺寸 | nested Frame/Artboard 与坐标空间可能重写 | 现阶段保留；用 IR absolute/local geometry 做验收和匹配 |
| Text | 中高：字符和外观通常可见 | 字体、fixed text、rich runs 和 shaping 可能变化 | 保留视觉 fallback；逐步由 direct builder + font diagnostics 接管 |
| SVG / Vector | 高：公开 Sketch vector/shape schema 可承载常见路径 | boolean/mask/vector network 可被重组或 flatten | 继续视觉兜底；IR 存 normalized vector 与 fallback 选择 |
| Image | 高：`.sketch` 明确有 binary asset 通道 | hash/crop/transform/scale 语义可能变化 | 短期保留；建设 content-addressed asset bundle 后直接创建 |
| Component / Instance | 低到中 | symbol/component 语义与 override/variant 模型不等价，常 detach | 不把 Sketch 当语义来源；由 IR + component builder 恢复 |
| Auto Layout | 低 | Sketch/Figma 布局模型和行为不完全一致 | 由 IR 直接恢复；Sketch 只提供初始视觉 geometry |
| Style / Variable | 低 | style identity、library、mode、alias/binding 易丢失 | 由 source adapter + IR + target adapter 正式迁移 |
| Effects | 中 | 常见 shadow/blur 可见，但顺序/参数/混合可能退化 | Sketch 视觉保底；IR/validator 比较并逐步直接创建 |

**源码确认**：Sketch 格式公开且有官方 schema/read-write APIs，这使其比私有 `.pix/.fig` 更适合做可检查的临时视觉载体。[`sketch-document/README.md`](https://github.com/sketch-hq/sketch-document/blob/4493900abbfa49ae82fbcb8ad85cccf2cc2256b0/README.md)

**源码确认**：`fig2sketch` 仍需对 nested Frame、styled Frame、text 和 instance override 做专门转换或 warning，证明 Sketch 中转无法承担完整语义保真。[`fig2sketch/README.md`](https://github.com/sketch-hq/fig2sketch/blob/1b9eaf293efe22f60d6e2c2eccf223cc124b4a2d/README.md)

**建议**：不要现在 Remove。采用 capability-based cutover：某类节点只有在 source coverage、IR、direct builder、visual/editability acceptance 同时通过后，才绕过 Sketch；其余继续走 Sketch/SVG/raster fallback。

## 8. Recommended Architecture

```text
                               Pixso
                                 │
             ┌───────────────────┼────────────────────┐
             │                   │                    │
   Primary Source Adapter   Secondary Adapter   Transitional Visual Path
    Pixso Plugin API        .pix read-only       Pixso → Sketch → Figma
    - tree / semantics      - version-gated      - visual carrier
    - styles / variables    - confirmed only     - fallback only
    - assets / interactions - never overrides API│
             │                   │                    │
             └─────────── Source Reconciliation ──────┘
                                 │
                      Versioned Normalized IR
                     - source-neutral node graph
                     - typed paints/text/layout
                     - components/styles/variables
                     - asset manifest
                     - provenance/confidence/fallback
                                 │
                     Migration Validator / Planner
                     - schema/reference integrity
                     - capability coverage
                     - unsupported/fallback report
                     - privacy/asset checks
                     - visual acceptance manifest
                                 │
                       Figma Target Adapter
             ┌───────────────────┼───────────────────┐
             │                   │                   │
      Existing-node matcher   Direct builder    Fallback manager
      / conservative repair   - nodes/layout    - keep Sketch node
                              - text/assets      - SVG/raster
                              - components       - explicit warning
                                 │
                       Validation / Acceptance
                    - node and reference counts
                    - visual diff / editability
                    - loss and fallback report
```

### 8.1 模块职责

- **Source adapters**：只负责读取源工具并产出 source-neutral facts；不调用 Figma，也不决定最终 repair policy。
- **Source reconciliation**：按固定优先级合并 API 与 binary，检测冲突；不得用名称字符串猜同一节点，必须有受控 identity/matching policy。
- **Normalized IR**：表达迁移语义和资产引用，不存 UI 状态，不绑定 Sketch 或 Figma plugin object。
- **Validator/planner**：在写目标前给出可执行计划、coverage 与 fallback；写目标后复核 node/reference/visual/editability。
- **Target adapter**：负责 Figma API 的创建、匹配、修复和事务/回滚边界；支持 direct builder 与 Sketch-imported repair 共存。
- **Fallback manager**：选择保留 Sketch 节点、SVG/raster 或显式 unsupported；禁止静默丢字段。

## 9. Reusable Ideas

### 9.1 哪些是在重复造轮子

| 领域 | 当前倾向 | 外部已有成熟做法 | 决策 |
| --- | --- | --- | --- |
| 基础节点递归/export | 自己维护 Pixso 适配器是必要的 | 两个 Pixso 项目已有递归/probe/safe serialization | **自己维护** API adapter；参考 traversal、yield/cancel、probe 思路，不复制模型 |
| JSON intermediate model | 当前 schema 自建且偏摘要 | Penpot 有正式 document + assets/styles/components/tokens | **自己维护** source-neutral IR；参考分层和完整性，不依赖 Penpot target types |
| Auto Layout serialization | 已有基础字段 | Penpot 将 container/child sizing、wrap/grid、fallback 分开 | **参考设计**并建立本项目语义对照表；不复制 target-specific translator |
| Component/Instance mapping | 当前仅 identity | Penpot 分 component/set/instance/property/variant/override/library | **参考架构**与状态模型；Figma target builder 自己维护 |
| Image asset extraction | 当前只有 summary | Penpot 独立流式 image channel、有限并发、及时释放 | **复用思想**：content-addressed manifest + stream；实现需按 Pixso/Figma API 重写 |
| Style/Variable representation | 当前不完整 | Penpot 分 definition/reference/resolved fallback/library/alias/mode | **参考数据边界**；IR 自建，避免绑定 Penpot token schema |
| Node ID mapping | 当前有 migration/original IDs | Penpot deterministic target UUID map | **自己维护** source/migration/target 三层 ID；参考 deterministic 与 reference integrity |
| Conversion warnings | 当前 risk flags 较粗 | fig2sketch code-specific warnings；Penpot step/layer error | **自己维护** typed diagnostics contract；参考可定位、可汇总、不可静默的原则 |
| Binary parser | 已自行研究 `.pix` | openfig-core 展示 parser/encoder/invariant/corpus 全套 | **继续自有研究**，但只做 Secondary；不要把 `.fig` 实现当 `.pix` 依赖 |
| Sketch schema/read-write | 不应自行重写 `.sketch` 规范 | Sketch 官方 schema/types/APIs | 若未来直接检查/生成 Sketch，**优先依赖官方包**，不要自建格式模型 |

### 9.2 License 与复用边界

| Project | License 证据 | 本轮使用方式 | 未来建议 |
| --- | --- | --- | --- |
| Penpot exporter | [MPL-2.0 LICENSE](https://github.com/penpot/penpot-exporter-figma-plugin/blob/ab39ffe206bacfae767a58cf45ec92a26ec9eb1e/LICENSE) | 只参考架构/数据边界 | 不直接复制；若复用文件，需满足 MPL 文件级披露、notice 等义务并先做法务核验 |
| pixso-node-exporter | 固定 commit 未发现 LICENSE 或 package license | 只确认 API 使用方式 | 视为默认版权保留；不复制、不依赖，仅参考可观察行为 |
| PixsoMovePlugin | [`package.json` 声明 ISC](https://github.com/larkes-cyber/PixsoMovePlugin/blob/1777a5fa7a3a1a7d0420472a1deea2c7df3834c7/package.json)，仓库未见独立 LICENSE 文本 | 只参考设计 | 直接复用前核验完整授权文本与 attribution；当前不复制 |
| fig2sketch | [MIT LICENSE](https://github.com/sketch-hq/fig2sketch/blob/1b9eaf293efe22f60d6e2c2eccf223cc124b4a2d/LICENSE) | 参考转换与 warning 策略 | 可在保留 notice 的前提下复用，但本项目当前不需要引入依赖 |
| openfig-core | [`package.json` 声明 MIT](https://github.com/OpenFig-org/openfig-core/blob/0d67354fcd6d14c37b89c42f55330faf0a79e1ce/package.json)，固定 commit 未见独立 LICENSE 文件 | 参考 parser 产品化门槛 | 不作为 `.pix` 解析依赖；若未来直接依赖，先核验发布包 LICENSE/notice |
| sketch-document | [MIT LICENSE](https://github.com/sketch-hq/sketch-document/blob/4493900abbfa49ae82fbcb8ad85cccf2cc2256b0/LICENSE.md) | 参考公开格式边界 | 可优先使用官方 packages，保留 MIT notice；本轮不引入 |

本轮没有复制任何外部源码，也没有新增依赖。

## 10. Risks

1. **API capability / deployment drift**：Pixso 公有版、私有部署与 plugin typings 可能暴露不同属性；必须运行时 probe 并记录版本。
2. **Binary schema drift**：Kiwi 自描述不等于字段语义稳定；未知版本若继续解析可能产生“结构合法、语义错误”的静默故障。
3. **Cross-tool semantic mismatch**：Frame/group、Auto Layout、component/variant、style/variable 和 text shaping 没有一一映射；视觉相似也可能丢失编辑性。
4. **Identity/reference corruption**：component-instance、style/variable alias、mask/boolean、parent-child 任一引用断裂，都可能造成局部看似成功、整体不可维护。
5. **Asset/font incompleteness**：只保留 hash/summary 无法重建 image fill；字体缺失会导致文字尺寸与换行级联变化。
6. **Large-file memory/time limits**：整树 JSON、内联图片和一次性 UI message 会导致 plugin 超时或内存峰值；需要 stream、bounded concurrency、yield/cancel。
7. **Fallback opacity**：如果 Sketch/SVG/raster fallback 不写入结构化报告，成功率会被高估，后续人工修复成本不可预测。
8. **Privacy leakage**：真实业务文本、plugin data、asset bytes、绝对路径和 GUID 可能进入日志/fixture；测试与报告必须脱敏并采用合成数据。

## 11. Next Development Priorities

### P0 — 端到端迁移验收

使用无敏感内容、覆盖核心能力的合成设计，完成 Pixso export → Sketch import（若需要）→ migration-map → Figma repair/create 的全流程；输出节点/引用计数、字段 coverage、fallback、错误、视觉差异与编辑性检查。先定义通过门槛，再判断后续投入。**本轮不实施。**

选择理由：当前 clean-import 视觉验收尚未完成，继续 binary research、Variable Binding 或大规模 schema 扩展都缺少迁移成功率反馈闭环。

### P1 — 按 P0 缺口扩展 Pixso Plugin source adapter 与 normalized IR

只补 P0 证明影响最大的字段；预计优先候选为 transforms、full paints/effects、rich text/font、asset manifest、constraints、component/instance/variant/style/variable graph 与 typed diagnostics。先 API capability probe，再决定是否调用 `.pix` Secondary adapter。**本轮不实施。**

### P2 — 扩展 Figma target adapter 的直接创建能力

按验收价值分批建设 node/layout/text/asset/component builders，并与既有 Sketch matcher/repair 共存；每类能力达到 coverage + visual/editability 门槛后再绕过 Sketch。**本轮不实施。**

以下事项不进入本轮 P0–P2：继续无目标 `.pix` 逆向、补 Stroke Variable Binding、一次性扩完所有 schema、立即移除 Sketch。

## 12. Decision

```text
ADJUST
```

主架构保留：视觉通道与语义通道互补、Figma 插件负责目标恢复，这些方向与成熟迁移项目一致。

需要调整：

1. Pixso Plugin API 成为 Primary，`.pix parser` 降为版本门控的 Secondary。
2. migration-map 演进为 source-neutral、版本化、带 provenance/fallback 的 normalized IR。
3. 增加 reconciliation + validator/planner，使 unsupported 与 fallback 在写入 Figma 前可见。
4. Figma 端从单纯 repair 演进为 matcher/repair + direct builder + fallback manager，但按验收结果渐进建设。
5. Sketch 继续作为过渡视觉载体，并按能力逐项替换，而非永久主语义来源或立即删除。

这不是 PIVOT：现有双通道仍可复用；也不是 KEEP：如果不重新划分数据源、IR 与 adapter 职责，继续增加二进制字段或 repair 规则会放大耦合和不可验证性。

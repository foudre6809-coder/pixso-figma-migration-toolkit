# Figma → Pixso Auto Layout 受控语义对应关系

## 结论边界

本报告只覆盖一个全新合成 Figma 文件中的 22 个受控样本，以及该同一 `.fig` 文件导入 Pixso 后的对应节点。证据来自 Figma Plugin API 与 Pixso Plugin API 的成对原始值，不以画布外观作为语义依据。

本轮结论为：**PASS: Figma → Pixso Auto Layout semantic correspondence is confirmed for the tested controlled samples.** 这不表示 Figma 与 Pixso 的全部 Auto Layout 能力完全同构。

未提交 `.fig`、`.pix` 或本地探针输出。仓库中的探针只读取名称以 `AL_` 开头的合成节点，不改变正式 exporter、migration schema、Figma repair 或 `.pix` parser 映射。

## 实验方法与完整性

1. 在独立 Figma 文件中创建 22 个顶层 Frame；每个 Frame 只含 `ChildA`、`ChildB` 两个 Rectangle。
2. 使用 Figma Plugin API 读取原始字段和值。
3. 导出同一 `.fig`，在 Pixso 客户端导入。
4. 使用独立的 `apps/pixso-layout-probe` 读取 Pixso Plugin API 2.0.0 原始字段和值。
5. 使用只读 comparator 按 `exact-match`、`equivalent`、`normalized`、`lost`、`unsupported`、`unverified` 分类。

完整性结果：Figma 和 Pixso 两端均读取到相同的 22 个样本名、每个样本相同的两个子节点名与相同节点类型。Pixso 文件名与合成文件名一致。没有图片、文本、组件、样式或业务数据参与实验。

## 受控样本

- Direction：`AL_None`、`AL_Horizontal`、`AL_Vertical`
- Gap：`AL_Gap0`、`AL_Gap8`、`AL_Gap16`
- Padding：`AL_Padding16`、`AL_PaddingAsymmetric`
- Container sizing：`AL_Fixed`、`AL_HugWidth`、`AL_HugHeight`
- Primary alignment：`AL_Primary_MIN`、`AL_Primary_CENTER`、`AL_Primary_MAX`、`AL_Primary_SPACE_BETWEEN`
- Counter alignment：`AL_Counter_MIN`、`AL_Counter_CENTER`、`AL_Counter_MAX`
- Child layout：`AL_ChildFill`、`AL_ChildStretch`、`AL_ChildGrow`、`AL_ChildAbsolute`

## 原始 API 证据

### Direction、Gap 与 Padding

| Sample | Figma raw | Pixso raw | Status |
| --- | --- | --- | --- |
| `AL_None` | `layoutMode=NONE` | `layoutMode=NONE` | exact-match |
| `AL_Horizontal` | `layoutMode=HORIZONTAL` | `layoutMode=HORIZONTAL` | exact-match |
| `AL_Vertical` | `layoutMode=VERTICAL` | `layoutMode=VERTICAL` | exact-match |
| `AL_Gap0` | `itemSpacing=0` | `itemSpacing=0` | exact-match |
| `AL_Gap8` | `itemSpacing=8` | `itemSpacing=8` | exact-match |
| `AL_Gap16` | `itemSpacing=16` | `itemSpacing=16` | exact-match |
| `AL_Padding16` | `top/right/bottom/left=16/16/16/16` | `top/right/bottom/left=16/16/16/16` | exact-match |
| `AL_PaddingAsymmetric` | `top/right/bottom/left=4/8/12/16` | `top/right/bottom/left=4/8/12/16` | exact-match |

`itemSpacing=0` 没有被省略。非对称 Padding 证明四边是可独立观察的数值，而不是由统一值推断。

### Container sizing

| Sample | Figma raw | Pixso raw | Resolved size | Status |
| --- | --- | --- | --- | --- |
| `AL_Fixed` | `primary=FIXED`, `counter=FIXED` | `primary=FIXED`, `counter=FIXED` | `200×80` → `200×80` | exact-match |
| `AL_HugWidth` | `primary=AUTO`, `counter=FIXED`; `layoutSizingHorizontal=HUG` | `primary=AUTO`, `counter=FIXED`; `layoutSizingHorizontal` unavailable | `80×80` → `80×80` | exact-match for axis modes; equivalent for HUG semantic |
| `AL_HugHeight` | `primary=FIXED`, `counter=AUTO`; `layoutSizingVertical=HUG` | `primary=FIXED`, `counter=AUTO`; `layoutSizingVertical` unavailable | `200×52` → `200×52` | exact-match for axis modes; equivalent for HUG semantic |

对活动的横向 Auto Layout，`primaryAxisSizingMode=AUTO` 无歧义表达 Hug Width；`counterAxisSizingMode=AUTO` 无歧义表达 Hug Height。Pixso 当前 Plugin API 未暴露 Figma 的便利字段 `layoutSizingHorizontal` / `layoutSizingVertical`，但活动轴语义可由相同的 primary/counter 字段直接恢复。

例外：`AL_None` 的非活动字段从 Figma `primary=AUTO, counter=FIXED` 变为 Pixso `primary=AUTO, counter=AUTO`。由于 `layoutMode=NONE`，这些值不参与布局；原始的非活动 `counter=FIXED` 不能恢复，分类为 **lost (inactive metadata)**，不能据此推断活动 Auto Layout 的 sizing 丢失。

### Axis alignment

| Axis | Samples | Figma raw values | Pixso raw values | Status |
| --- | --- | --- | --- | --- |
| Primary | `MIN`, `CENTER`, `MAX`, `SPACE_BETWEEN` | `primaryAxisAlignItems` 原值 | `primaryAxisAlignItems` 原值 | exact-match |
| Counter | `MIN`, `CENTER`, `MAX` | `counterAxisAlignItems` 原值 | `counterAxisAlignItems` 原值 | exact-match |

全部枚举均由独立受控样本证明。没有仅凭子节点视觉位置反推对齐方式。

### Child layout

| Sample | Figma ChildA raw | Pixso ChildA raw | Resolved geometry | Status |
| --- | --- | --- | --- | --- |
| `AL_ChildFill` | `layoutGrow=1`, `layoutAlign=INHERIT`, `layoutSizingHorizontal=FILL` | `layoutGrow=1`, `layoutAlign=INHERIT`; sizing field unavailable | `172×20` → `172×20` | exact-match for grow; equivalent for Fill semantic |
| `AL_ChildGrow` | `layoutGrow=1`; control child `layoutGrow=0` | `layoutGrow=1`; control child `layoutGrow=0` | `172×20` → `172×20` | exact-match |
| `AL_ChildStretch` | `layoutAlign=STRETCH`, `layoutSizingVertical=FILL` | `layoutAlign=STRETCH`; sizing field unavailable | `20×80` → `20×80` | exact-match for align; equivalent for cross-axis Fill semantic |
| `AL_ChildAbsolute` | `layoutPositioning=ABSOLUTE`, `x=16`, `y=12` | `layoutPositioning=ABSOLUTE`, `x=16`, `y=12` | `20×20` → `20×20` | exact-match |

`layoutSizingHorizontal` / `layoutSizingVertical` 在 Pixso API 中对容器和子节点均不可读，因此这些原始便利字段为 **unsupported**。本轮只在 `layoutGrow=1` 或 `layoutAlign=STRETCH` 的成对 API 证据存在时，将其对应的 Fill/Stretch 操作语义标为 **equivalent**；不从最终几何单独推断。

## Correspondence Matrix

| Semantic | Figma API | Pixso API | Status | Notes |
| --- | --- | --- | --- | --- |
| Layout direction | `layoutMode` | `layoutMode` | exact-match | `NONE/HORIZONTAL/VERTICAL` 全部验证 |
| Wrap | `layoutWrap` | `layoutWrap` | exact-match (limited) | 仅验证 `NO_WRAP`；其他状态 unverified |
| Gap | `itemSpacing` | `itemSpacing` | exact-match | `0/8/16` 全部精确保留；AUTO spacing 未测试 |
| Padding top | `paddingTop` | `paddingTop` | exact-match | `16` 与非对称 `4` 验证 |
| Padding right | `paddingRight` | `paddingRight` | exact-match | `16` 与非对称 `8` 验证 |
| Padding bottom | `paddingBottom` | `paddingBottom` | exact-match | `16` 与非对称 `12` 验证 |
| Padding left | `paddingLeft` | `paddingLeft` | exact-match | `16` 验证 |
| Primary sizing | `primaryAxisSizingMode` | `primaryAxisSizingMode` | exact-match | 活动布局的 `FIXED/AUTO` 验证 |
| Counter sizing | `counterAxisSizingMode` | `counterAxisSizingMode` | exact-match | 活动布局的 `FIXED/AUTO` 验证；NONE 的非活动默认值有丢失 |
| Convenience sizing | `layoutSizingHorizontal/Vertical` | unavailable | unsupported | 不应进入 Primary-source 必需合同 |
| Primary align | `primaryAxisAlignItems` | `primaryAxisAlignItems` | exact-match | `MIN/CENTER/MAX/SPACE_BETWEEN` 验证 |
| Counter align | `counterAxisAlignItems` | `counterAxisAlignItems` | exact-match | `MIN/CENTER/MAX` 验证 |
| Child align | `layoutAlign` | `layoutAlign` | exact-match | `INHERIT/STRETCH` 验证 |
| Child grow | `layoutGrow` | `layoutGrow` | exact-match | `0/1` 与 control child 验证 |
| Child positioning | `layoutPositioning` | `layoutPositioning` | exact-match | `AUTO/ABSOLUTE` 验证 |
| Child main-axis Fill | `layoutSizingHorizontal=FILL` + `layoutGrow=1` | `layoutGrow=1` | equivalent | Pixso sizing convenience field unsupported |
| Child cross-axis Fill | `layoutSizingVertical=FILL` + `layoutAlign=STRETCH` | `layoutAlign=STRETCH` | equivalent | Pixso sizing convenience field unsupported |

## Exact Matches

经成对样本确认：`layoutMode`、`itemSpacing`、四边 Padding、活动布局的 `primaryAxisSizingMode` / `counterAxisSizingMode`、`primaryAxisAlignItems`、`counterAxisAlignItems`、`layoutAlign`、`layoutGrow`、`layoutPositioning`，以及全部相关 resolved `width` / `height`。

## Equivalent / Normalized

- HUG：Figma 的 `layoutSizingHorizontal/Vertical=HUG` 在 Pixso API 中不直接暴露，但活动轴的相同 `primary/counterAxisSizingMode=AUTO` 精确保留，语义可恢复，分类为 equivalent。
- Child Fill：主轴通过 `layoutGrow=1`，反轴通过 `layoutAlign=STRETCH` 精确保留，分类为 equivalent；Pixso 的 convenience sizing 字段仍是 unsupported。
- 没有发现需要标为 normalized 且能无歧义反向恢复的活动 Auto Layout 值。

## Lost / Unsupported / Unverified

- lost：`AL_None` 中不活动的 `counterAxisSizingMode=FIXED` 被写成 `AUTO`；只影响关闭 Auto Layout 后的非活动原始元数据。
- unsupported：Pixso Plugin API 2.0.0 未暴露 `layoutSizingHorizontal` / `layoutSizingVertical`。
- unverified：其他 wrap 状态、AUTO spacing、复杂混合 Fill/Grow、min/max sizing，以及超出本轮样本的枚举。

## `.pix` 第三层

**not-tested**。本轮双端 API 已满足主要证据要求；未保存或逆向新的 `.pix`，也未扩展 Kiwi schema 或 formal parser output。

## Auto Layout IR 建议（仅文档，不改 schema）

```ts
interface AutoLayoutIR {
  layout: {
    mode: "NONE" | "HORIZONTAL" | "VERTICAL"; // confirmed direct mapping
    wrap?: "NO_WRAP"; // exact in tested sample; other states unverified
    primarySizing?: "FIXED" | "AUTO"; // confirmed for active layout
    counterSizing?: "FIXED" | "AUTO"; // confirmed for active layout
    primaryAlign?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN"; // confirmed
    counterAlign?: "MIN" | "CENTER" | "MAX"; // confirmed
    padding: { top: number; right: number; bottom: number; left: number }; // confirmed
    gap: number; // confirmed for fixed numeric spacing
  };
  childLayout: {
    align?: "INHERIT" | "STRETCH"; // confirmed
    grow?: number; // confirmed for 0/1
    positioning?: "AUTO" | "ABSOLUTE"; // confirmed in tested samples
    sizing?: "FIXED" | "FILL"; // equivalent derivation only; keep provenance
  };
}
```

IR 应保留原始平台字段和值与映射 provenance。不要把 Pixso 未暴露的 `layoutSizingHorizontal/Vertical` 伪造为 exact 值；需要通过 `layoutGrow`、`layoutAlign` 与父布局方向形成明确的 equivalent 解释。

## 架构含义

**YES**：当前证据支持把 Pixso Plugin API 作为 Auto Layout 的 Primary source，而 `.pix parser` 仅作为 Secondary。所需核心活动语义均可由 Pixso API 直接或无歧义等价读取；`.pix` 不再是确认这些字段的前置条件。该判断仅限本轮 tested controlled samples。

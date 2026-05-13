# Fork Context Access Model 中文审阅草稿

日期：2026-05-12

> 本文是 `fork-context-access-model.md` 的中文审阅草稿，用来帮助产品和架构讨论。
> 英文版仍是当前正式架构约束记录。本文不表示相关代码已经实现。

## 一、核心决定

fork 出来的新圈层，不继承上游资产，不继承上游成员权限，也不继承上游私密内容。

fork 出来的新圈层只携带一份受控的上下文记录，用来说明它从哪里分叉、可以引用哪些上游材料、以及这些上游材料原本的访问门槛是什么。

一句话：

```text
Fork 不继承所有权。
Fork 不继承访问权。
Fork 不继承私密内容。
Fork 只携带 provenance、精选上下文和引用能力。
```

## 二、当前代码边界

圈层层级和 fork lineage 是两套不同概念。

圈层层级由 `Circle.parentCircleId` 和 `childCircles` 表达。fork 来源关系由 `CircleForkLineage(sourceCircleId, targetCircleId)` 表达。

所以，fork 出来的圈层是一个带 lineage 记录的独立圈层，不是源圈层下面的子圈，也不会共享源圈层的 descendants。

当前 fork inheritance snapshot 保存的是配置和 lineage 上下文，不会把 fork 目标变成源圈的结构子节点，也不会授予源圈完整内容访问权。

## 三、产品模型

假设 `B` 从 `A3` fork 出来，原路径是：

```text
A1 -> A2 -> A3
```

那么 `B` 应该被理解为：

```text
B 是从 A3 分叉出来的一条独立路径。
B 可以携带一份来自 A1 -> A2 -> A3 的 proof-backed context capsule。
B 不拥有 A1/A2/A3 的资产。
B 不获得 A1/A2/A3 的权限。
B 引用上游材料时，必须继续遵守原来的 source gate。
```

产品和代码命名应优先使用：

```text
Fork Context
Origin Snapshot
Upstream Reference
Derived Knowledge
Citation Credit
```

避免使用会误导的说法：

```text
资产继承
权限继承
子树共享
私密内容复制
```

## 四、三个域必须拆开

### 1. 资产

资产是稳定的所有权和贡献记录，例如：

- Crystal asset
- Crystal receipt
- Crystal entitlement
- proof package
- contributor root
- 未来可能存在的收益或 attribution 记录

资产留在原圈层和原贡献者那里。fork 可以引用或派生自上游资产，但不能把上游资产复制成 fork 目标圈自己的资产。

如果 fork 出来的圈层以后产生了新知识，那份新知识属于新圈层。上游材料只是 citation 或 derived-from reference。

### 2. 权限

权限决定谁能查看或展开上游材料。

加入 `B` 不等于获得 `A1/A2/A3` 的访问权。即使 `B` 是 public，也不会让 crystal-gated 的 `A2` 或 private 的 `A3` 自动变成 public。

当用户在 `B` 里展开某条上游引用时，系统必须回到原 source circle 检查该用户是否满足原来的 source gate。

### 3. 上下文

上下文解释 fork 为什么存在，以及它可以引用哪些上游材料。

上下文可以作为一份受控、可证明的 capsule 被带到 fork 目标圈。

上下文不是原始内容本身。它应该优先包含引用、摘要、anchor、hash、策略标签，而不是完整正文。

## 五、Fork Context Capsule

每个完成的 fork，未来都应该有一份 `ForkContextCapsule`。

这份 capsule 是 fork 目标圈的来源记录，不是内容迁移。

建议内容：

```text
sourcePath:
  有序的来源路径，比如 A1 -> A2 -> A3

forkOrigin:
  fork 发生的源圈，比如 A3

forkDeclaration:
  用户说明为什么需要 fork

createdAtCutoff:
  fork 创建时间；之后上游新内容不会自动流入 B

publicUpstreamRefs:
  按 source rule 可以完整展示的上游引用

gatedUpstreamRefs:
  存在于 capsule 中，但展开时需要重新检查 source gate 的引用

sealedUpstreamRefs:
  只以 proof/hash/source metadata 表示的引用

originSnapshot:
  fork origin 的受控摘要、关键 source anchor 和 fork 理由
```

capsule 应该足够稳定，用来解释 fork 来源。后续 `B` 手动引用新的上游材料时，应通过显式 reference 添加，而不是让上游内容自动同步进 `B`。

## 六、Source Gate Matrix

上游 source circle 的访问模型，决定什么可以被带入 fork context，以及在 `B` 中能展示到什么程度。

| Source circle gate | 默认是否允许 fork | B 可以携带什么 | B 用户可以展开什么 |
| --- | --- | --- | --- |
| Open/free | 允许 | Public upstream refs 和摘要 | 如果 source material 本身公开，可以看完整内容 |
| Crystal-gated | 如果 fork policy 允许，则允许 | Gated refs、hash、summary、selected anchors | 只有 viewer 满足原 source gate 才能展开完整内容 |
| Invite-only/private | 默认不允许 | 默认不携带；显式批准后最多 sealed refs | 默认不能展开；展开必须满足原 source permission |

crystal-gated 的规则尤其重要：

```text
如果 A2 要求拥有足够 A1 crystal 才能进入，
那么用户在 B 中展开 A2-origin material 时，
仍然必须满足 A2 原来的 source gate。
```

fork 目标圈自己的权限，不足以展开上游材料。

## 七、A1/A2/A3 的处理方式

如果从 `A3` fork，应该保守处理整条来源路径：

```text
A1/A2:
  可以贡献 public 或 source-gated 的 crystallized knowledge references。
  gated source content 展开时仍然检查原 source gate。

A3:
  是 fork origin。
  应贡献 origin snapshot、declaration context、key anchors 和 selected references。
  默认不暴露完整讨论、成员空间或私密历史。

B:
  拥有自己的本地讨论、草稿和未来知识。
  可以引用 fork context 和 upstream references。
  不拥有也不解锁上游资产。
```

## 八、B 中的可见性状态

当 `B` 展示上游材料时，不应该假装它们都是 `B` 的本地内容。应该显示状态标签。

```text
Public source:
  可以在 B 中展示完整内容。

Source-gated:
  B 可以展示标题、source circle、摘要、hash、citation metadata。
  完整展开需要 viewer 满足原 source gate。

Sealed source:
  B 可以展示“存在一个 proof-backed upstream source”。
  默认不展示正文。
```

这样 `B` 仍然有用，但不会变成绕过上游权限的后门。

## 九、AI 和 Draft 约束

AI 和 draft generation 不能绕过 source gate。

`B` 的默认 AI context 可以包含：

- `B` 本地讨论和知识
- public upstream references
- 安全的 origin snapshot summaries
- hash、proof anchor、citation metadata

默认 AI context 不应包含：

- 上游私密讨论原文
- source-gated full text，除非当前用户有 source access 且明确 opt in
- invite-only source content
- fork 之后的上游新内容，除非后续被显式引用

如果某个 draft 或 output 使用了 source-gated upstream material，draft 应带上限制标记，例如：

```text
contains_source_gated_upstream
```

在 crystallization 或 public publishing 前，系统必须验证输出不会把受限上游内容泄露给比原 source 更宽的 audience。

## 十、Invite-Only Rule

invite-only/private source circle 是信任空间，不是公开进阶门槛。

默认规则：

```text
Invite-only/private circles cannot be forked into public paths.
```

允许例外必须来自 source side 的显式批准，例如：

- source circle manager approval
- source governance approval
- policy 中记录的一次性 fork allowance

即使批准，默认导出的也应该是 sealed 或 summarized context，不是 raw content。

## 十一、Crystal-Gated Rule

crystal-gated circle 可以作为 fork source，但原 source gate 必须跟随它的 upstream references。

例子：

```text
A1 是 open。
A2 要求 N 个 A1 crystals。
A3 fork 成 public B。
```

这种情况下：

```text
B 可以显示 A2 贡献了 upstream context。
B 可以显示来自 A2 的安全摘要或 proof metadata。
B 用户只有满足 A2 原来的 gate，才能展开 A2-origin material。
只加入 B 不够。
```

这能保留 progression-based access 的意义，同时让 fork lineage 和 citation 仍然可见。

## 十二、非目标

本文不授权做以下事情：

- 把上游资产复制到 fork target
- 给 fork members 授予上游 membership
- 默认暴露 private 或 invite-only source circles
- 默认把 source-gated text 喂给 AI
- 把 fork source content 迁移到 fork target 的本地 knowledge table
- 把 fork lineage 等同于 hierarchy inheritance
- fork 后自动同步上游新内容到 fork target

## 十三、实现原则

未来实现应优先采用增量结构，不改变层级语义。

可能的实现方向：

```text
CircleForkLineage:
  继续表示 source -> target 的 fork 关系

ForkContextCapsule:
  记录 source path、cutoff、declaration、source refs、gate labels 和 origin snapshot

ForkUpstreamReference:
  如果 JSON metadata 不够查询，再增加规范化表

Access evaluator:
  在 view/expand 时检查 source gates

Draft/AI context builder:
  只读取当前用户和目标 audience 允许使用的 context classes
```

不要通过给 fork target 设置 `parentCircleId` 来实现这套能力，除非产品明确决定 fork target 要变成层级子圈。那会改变 fork 的语义。

## 十四、未来实施计划的验收规则

任何 fork context 实施计划都必须证明：

- `B` 不会因为从 `A3` fork 就能读取 private `A3` 内容。
- public `B` 不会让 crystal-gated `A2` 内容变 public。
- invite-only/private source 默认不可 fork。
- source-gated references 在 viewer 通过原 source gate 前，只能作为 metadata 可见。
- AI context 默认排除 restricted upstream text。
- crystallization 或 publishing 不会把 restricted upstream text 泄露给更宽 audience。
- asset ownership 和 entitlements 仍然绑定在原 knowledge 和原 contributors 上。

## 十五、总结规则

长期产品规则是：

```text
Fork 创建一条独立路径。
上游 gate 继续生效。
Context 可以携带。
资产和权限不继承。
```

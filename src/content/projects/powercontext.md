
| 概念 | 含义 | 一句话理解 |
| --- | --- | --- |
| **Scope** | 隔离边界，每个内容操作都带 `scope_id` | 相当于「哪个项目/工作区」的数据分区 |
| **Source** | 证据（Evidence） | 记录「发生了什么」的原始材料，如 prompt、任务结果 |
| **Artifact** | 可复用输出的一个**不可变修订**，引用格式 `FAMILY/ARTIFACT_ID@REVISION` | 「一个历史快照」，ID 稳定，修订只增不改 |
| **Revision** | Artifact 的历史版本 | 批准替换会生成新 Revision，旧的仍可精确读取 |
| **Lineage** | 血缘 | 记录某 Revision 由哪些 Source/Artifact 精确引用产生 |
| **Memory** | 持久项目知识（决策、约束、事实、状态、下一步） | 可搜索、可修订、可退役，但不丢历史 |
| **Handoff** | 临时交接（目标、已验证进度、阻塞、下一步、证据） | 交接用的「快照」，默认不持久 |
| **Experience** | 经验：情境 + 行动 + 观察结果 + 可复用教训 | 批准后可在 PreparedContext 里被召回 |
| **Skill** | 受管技能：名称、描述、指令、校验、血缘 | 批准后**需显式导出**才能被 Agent 发现，不自动执行 |
| **Candidate** | 待审的提案（pending） | 提案和批准产物是分开的，审批前不生效 |
| **PreparedContext** | 单轮 Agent 的**有界**上下文视图（`ready` 或 `empty`） | 临时值，不产生持久记录 |
| **Review** | 审批关卡 | **生成器永远不能自己批准自己的结果** |


## Scope 是隔离边界

每个内容操作都使用 `scope_id`。Scope 选择相互隔离的 Source journal、Memory 生命周期、Candidate inbox、Handoff
history 和相关 runtime state。Scope ID 是 Server 生成的不透明标识。Integration 解析显式 Scope、持久 binding 或
Server 默认 Scope；代码库、路径、session 和 Agent identity 只是 binding 输入，不是 Scope ID。



## Source 保存证据

Source 描述 PowerContext 可以读取的证据。Captured Source 把内容保存在 PowerContext 中；referenced Source 指向其他
adapter 管理的材料。`SourceRef` 通过类型和 ID 标识一个 Source。

捕获 Source 不会自动创建 Memory、Experience 或 Skill。配置好的 pipeline 可以稍后处理符合条件的 Source。Work
Contract 和 Task Outcome 也会作为精确 Source 证据保存。


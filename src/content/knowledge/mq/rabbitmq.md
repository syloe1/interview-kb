RabbitMQ 是基于 AMQP 协议的消息中间件，核心模型可以概括为：

生产者 → 交换机 Exchange → 绑定 Binding/路由键 Routing Key → 队列 Queue → 消费者 Consumer

RabbitMQ 本身不直接把消息“发给消费者”，而是由生产者把消息发给交换机，交换机再根据规则路由到一个或多个队列，消费者从队列中取消息。

1. 核心组件
   Producer 生产者：发送消息到 Exchange。

Exchange 交换机：接收消息，根据类型和 Routing Key 决定投递到哪些队列。

Binding 绑定：Exchange 和 Queue 之间的绑定关系，通常带 Binding Key。

Queue 队列：实际存储消息的地方，消息最终从这里被消费。

Consumer 消费者：订阅或拉取队列中的消息并处理。

Connection/Channel：TCP 连接和其上的轻量级信道，生产者和消费者通过 Channel 操作 RabbitMQ。

Virtual Host：逻辑隔离单元，类似命名空间。

Broker：RabbitMQ 服务节点。

2. 消息流转过程
   生产者建立到 Broker 的 TCP 连接，并打开 Channel。

声明 Exchange、Queue、Binding。

生产者发送消息到指定 Exchange，并携带 Routing Key。

Exchange 根据类型和 Binding 规则，把消息路由到一个或多个 Queue。

消息在 Queue 中等待消费者。

消费者通过 push 或 pull 方式获取消息。

消费者处理完成后发送 ACK 确认。

RabbitMQ 收到 ACK 后删除消息；如果消费者断开或 NACK，消息可重新入队或进入死信队列。

3. 交换机类型
   RabbitMQ 常见 Exchange 类型：

Direct：Routing Key 与 Binding Key 完全匹配时投递。

Fanout：广播，忽略 Routing Key，投递到所有绑定队列。

Topic：按模式匹配，支持 * 匹配一个单词、# 匹配零个或多个单词。

Headers：根据消息 Header 匹配，不依赖 Routing Key。

如果消息无法路由到任何队列：

设置 mandatory 可退回给生产者；

或配置 Alternate Exchange 备用交换机；

否则消息可能被丢弃。

4. 消费与确认机制
   消费者通常使用 手动 ACK 保证可靠消费：

ack：确认成功，RabbitMQ 删除消息。

nack/reject：拒绝消息，可选择重新入队。

prefetch：限制每个消费者未确认消息数量，防止消费端被压垮。

如果消费者连接断开但未 ACK，消息会重新投递给其他消费者。

5. 可靠性保障
   RabbitMQ 的可靠性通常从三方面做：

生产者可靠发布

使用 Publisher Confirm 确认 Broker 已接收；

使用事务，但性能较差，较少用。

消息持久化

Exchange、Queue 声明为 durable；

消息设置 delivery mode=2，即持久化消息。

消费者可靠消费

手动 ACK；

处理失败进入重试或死信队列。

此外还有：

DLX 死信交换机：处理被拒绝、过期、超过队列长度的消息。

TTL：消息或队列过期时间。

Quorum Queue：基于 Raft 的高可用队列，现代 RabbitMQ 推荐用于关键业务。

6. 集群与高可用
   RabbitMQ 集群中：

Exchange、Binding、用户、权限等元数据会在节点间同步；

队列消息默认不会在所有节点复制，而是分布在某个节点上；

传统镜像队列通过主从复制实现高可用，但新版本更推荐 Quorum Queue；

Quorum Queue 使用 Raft 协议，在多个节点间复制日志，保证 leader 故障时自动选主。

客户端连接集群时可配置多个节点地址，实现故障切换。

7. 一句话总结
   RabbitMQ 的工作流程是：生产者把消息发布到交换机，交换机根据绑定和路由规则把消息投递到队列，消费者从队列消费并 ACK 确认；通过持久化、Confirm、手动 ACK、死信队列和 Quorum Queue 等机制保证可靠性与高可用。

消息不丢要分三段：生产端 Confirm + 失败重试，Broker 端 durable 队列和持久化消息，消费端手动 ACK + 失败重试/死信，最后用本地消息表和补偿兜底。重复消费 RabbitMQ 避免不了，只能消费端幂等，比如业务唯一键、去重表、唯一索引、Redis SETNX、状态机。积压不是简单提高 prefetch，要先定位原因，再扩消费者、优化消费逻辑、合理调 prefetch、分流降级。顺序要靠单队列单消费者串行处理，序列号只能做乱序检测和重排。消费者宕机时，持久化 + 手动 ACK 保证不丢，但未 ACK 消息会重投，所以仍可能重复。

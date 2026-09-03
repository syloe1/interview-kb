消息上两个应用间的数据。数据的类型有很多格式。
消息队列是消息在传输过程中保存消息容器。

## 好处

    解耦：消息放到 MQ，有需要的自己去拉。
    异步：A 数据→MQ，不需要等待 B、C、D 响应。
    削峰：MQ 短堆积，数据是可以的，每次消费拉 2000 条处理，防止大量请求打 Mysql，Mysql 崩

## RabbitMQ 实现 AMQP (高级消息队列协议)消息中间件。

1. 可靠，支持消息确认，使生产者确认、消费者确认，保证 MQ 可靠性。
2. 在消息进入 MQ 前由 exchange 进行路由中转。
   默认端口：5672 端口

Broker：消息队列服务进程

- Exchange：消息队列交换机
- Queue：消息队列

Producer：消息生产者
Consumer：消息消费者

画图标注：
`Producer → 通过Connection，打开 channel`
`channel → Exchange → Binding → Queue`
`Queue ←---- 拉取消息 ---- Consumer`

## 消息确认机制：

Ack 机制：

消息生产者 → connection → 交换机 → channelA ← 接收 消费者

- 自动 Ack：消费者接收到消息后自动发送 Ack 给 RabbitMQ
- 手动 Ack：手动控制消费者接收到并成功消费后发送 Ack 给 RabbitMQ

## 交换机 Exchange 三种类型

1. **direct**：点对点，精确路由（单服务点对点）
2. **topic**：模糊匹配通配订阅发布（多服务订阅）
3. **fanout**：广播，所有队列全收（通知类场景）

RabbitMQ 适合业务消息，即时消息，任务推送，广播通知。
kafka 适合日志采集，行为上报，数据的分析，事件流。

RabbitMQ 类似 MySQL 中的 database
database A virtual host A
database B virtual host B
database C virtual host C

MQ 的 Queue 有最大容量，类似一个缓存缓冲区。

work 模型：
P→Queue
  ├→C₁
  └→C₂
竞争消费模式。

### 订阅：Fanout 类型

P → 交换机
  ├→Queue
  └→Queue
大家都能收到消息，就像听广播。

---

### 订阅：Direct 类型

P →交换机
  ├─routing key→Queue → C₁
  └─routing key→Queue → C₂

拥有不同的 routing key，消费者会收到来自交换机不同信息。

### 订阅：Topic 类型

P →交换机
  ├→Queue → C₁
  └→Queue → C₂

Topic 的 routing key 支持通配符
注：生产者：经过 channel. 发送
消费者：接受消息的同时

RabbitMQ 基于 AMQP 协议，用 erlang开发的消息中间件，异步解耦， 流量削峰

**生产者**：发送消息的应用，消息推送到 Exchange 交换机。

**消息**：消息体 + 消息属性，属性包含消息 id，过期时间、header。

**交换机**：接收生产者消息，由路由规则 转发到对应队列，本身不存储消息。

**绑定**：交换机和队列之间的关联关系。

**队列**：实际存储消息的容器，消费者从队列拉取消息，一个队列可被多个消费者监听。

1° 生产者连接 RabbitMQ，将消息 + routing key 发送给指定 Exchange。2. Exchange 根据类型 + routing key，结合 Binding 规则，把消息路由到目标 Queue。

3° 消息持久化在 Queue 中等消费。
4° 消费者监听对应 Queue，获取消息并执行业务。
5° 消费完成后回复 Ack，MQ 删除对应消息。

MQ 内部每个连接，每个队列，每个消费者是独立erlang轻量线程。基于 Actor 模型通信，进程开销低。

## RabbitMQ 可靠性

**生产者**：生产路由、队列存储，消息。

**生产者确认**：
发送后，MQ 收到消息并成功落盘，再返回给生产者。

**交换机→队列**：
消息无法路由到任何队列时，转发到备份交换机。

**队列可靠性**：

```
1. 队列持久化: durable = true
2. 消息持久化： delivery_mode = 2 消息写入磁盘
```

**消费端**：
Ack 后删除消息
Nack，重新回到队列

**死信队列 dlx**
否定、无法被正常消费的消息。
给普通队列绑定死信交换机和死信队列，消息变成死信后自动转发。

---

**消息堆积**
消费者消费速度 < 生产者生产速度

**使用场景**：

- 流量削峰：秒杀， 利用队列缓冲流量
- 异步：日志、邮件推送
- 消息广播
- 延迟任务：结合死信队列， 实现订单超时关闭定时重试

---

C++ 编译

.c --编译--> .s --汇编--> .o --链接--> .exe

C++ 智能指针自动管理堆内存，防止内存泄漏，重复释放。

## Outbox 事务消息表：入库→发送到 MQ

不能同时成功，二阶段不一致

1. **同库同事务**：更新业务表，插入 outbox 发送数据表
2. 后台定时任务轮询 outbox 未发送数据，把消息发到 MQ
3. 投递成功更新状态；MQ 发送成功回调，outbox 记录为已发送，发送失败重试

生产者确认，MQ 收到消息返回 Ack，收 Ack 再继续发送

死信队列：消息无法被正常消费，转入死信队列

1. `nack requeue=false`
2. 消息过期 TTL
3. 队列达到最大长度，消息溢出

**延迟消息：TTL + 死信**
消息进入普通队列，设置过期时间，到期→死信
死信队列目标消费者队列，实现延迟

## mall 架构

web http 请求进程拆分
分层架构：`Handler → Service → DAO → Model`

## 为什么拆分 web 和 handler？

Golang适合IO密集型，例如web这种，cc适合CPU密集型。
web 专注 HTTP 响应，Worker专注后台异步异步任务， 流量高峰扩容Web, worker 挂了不影响用户请求，web 挂了不影响消息同步。

## 依赖注入怎么做的？ Why not wire

    - 学习成本低
    - 依赖接口而非实现

## 为什么nginx做反向代理

    1. nginx直接返回静态资源
    2. gzip压缩减少带宽
    3. 安全隐藏后端真实端口

## 下单怎么防止超卖？

行锁 + 条件更新
下单在事务内完成
商品 → 扣库存 → 创建订单
→ 请求的数量 ≤ 库存才允许扣减，否则回滚。

事务怎么保证？
`db.Transaction(func(tx *gorm.DB) error {`
所有操作必须在同一个事务的 gorm.DB 上执行，否则不在事务内。
回调返回 error 自动回滚，返回 nil 自动提交。

## 支付怎么保证幂等？

1° db层： 唯一订单号
2° 业务层：创建订单先查已有成功订单，有则直接返回旧结果
3° 按订单分布式锁，防止并发重复支付
4° 加行锁，防止并发扣款

## 为什么用 MQ，什么场景？

- 秒杀订单异步创建：RabbitMQ，消息量不大，需要可靠投递
- 订单超时取消：RabbitMQ，TTL + 死信交换机，超时延迟消消息
- 商品事件同步到 ES：Kafka，可重放，消费者组

**订单超时取消怎么实现？**
发送消息设置`x‑delay:30分钟`
消息在交换机等待，到期后路由到目标队列

**Outbox：商品创建时既要写 Mysql，又要发 Kafka，数据不一致怎么办**
方案：在一个 Mysql 事务，同时写`product`表和`product‑outbox`表
worker 轮询`product‑outbox`表，将待发送消息发布到 Kafka
发送成功 → mark 标记；
失败 → 重试 → 入死信表

Kafka Consumer 如何提交位移？
ES写入成功才提交 offset。

---

## 秒杀系统设计

高并发场景，Redis 预扣
扣减：lua 脚本 + 库存校验
互斥：lua 记录已购买用户
异步 MQ 创建订单

### 为什么秒杀不用 Redis 事务

lua 原子执行可包含条件判断。
发生逻辑：
检查库存 →
再扣减 →
再标记用户

**事务保证命令不能打断，无法实现 “校验库存，判断决定是否扣减”**

## 在线状态怎么实现 ？

    Redis + Lua + TTL

客户端30s必须发心跳， 服务端刷新TTL. 90s无消息， key过期-> 视为离线

## 秒杀回滚

1. MQ 消息发送失败 → 立即回滚
2. Worker 处理记录失败 → 回滚（数据库事务）
3. 超时未支付 → 回滚

## Redis 挂了怎么办？

1. Redis 持久化
2. 设置时间有效，key 设 TTL（锁过期 + 看门狗，定时刷新）
   Redis 不可用，可以走 Mysql兜底

## 双 Token 区别和设计

- Access Token：时分秒，泄露窗口时间短
- Refresh Token：长期，只用来换取 Access Token

金额AES，支付密码 bcrypt 加盐哈希

## 优雅关闭

worker 进程通过`context.Done()`做优雅关闭

---

分布式锁：SETNX 加锁 + lua 脚本保证原子性，防止误删别人锁，redisson 看门狗续锁
锁带TTL 防止死锁
Outbox 模式：每2秒轮询发件箱， 将pending状态投递到RabbitMQ, 投递成功标记`published`

用户不在线，消息不推送到 websocket；但消息已经持久化在数据库，用户上线后，可以通过接口拉取历史消息。

慢客户端断连，不让慢客户端阻塞整个推送类型。

用户发消息 → HTTP 写 DB，Outbox‑worker 投递到 RabbitMQ，给消费者并发推送。

RabbitMQ 宕机不会丢失，websocket/http 正常接收写入 Mysql，消息状态标记`pending`。
RabbitMQ‑outbox 表的 pending 状态，重新投递。

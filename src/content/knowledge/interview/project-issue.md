消息队列保存失败，数据丢失如何解决
redis 宕机，数据有什么影响

项目Mall秒杀做一人一单了吗 ？
CDC同步监听binlog,
mall完用es， mq, db

DI项目websocket断连了，怎么办
Redis缓存命中率多少 ？ 群聊消息怎么推送的

接口p99 p95延迟测试了吗

kafka同步怎么做的ES
kafka断了怎么办 ？mysql表锁，

消费消息qos怎么配的

mysql独占 共享

quic,mqtt,websocket
SSE与websocket对比

## 技术选型

- 不理解技术为什么存在
- why outbox ？ 不是别的 ？
- 秒杀为什么使用lua
- ES为什么最终一致性
- MQ重复消费怎么解决

AI不擅长 线上问题定位， 复杂业务理解。对实习生来说， 深度比广度重要

Redis 分布式锁为什么会失效？
你项目最难解决的地方是什么

websocket 断连、MQ 重复消费
ES 数据不一致
排错过程 → 收包 → solu → why 速率指标监控

## recommand

- 上云，完整跑起来
- 微服务 + Mysql Redis MQ 面对什么
  outbox 为什么存在
  数据库为什么 undo

ES 快照 最终一致性
MQ 重复消费怎么处理

## 提升设计能力，订单超时取消怎么处理？

    方案， 优缺点

自己项目搞坏，然后排错

## 做东西

> 自己设计 → AI 补充 -> 自己实现 → AI review → debug
> 完善 Swagger 文档，docker compose up，开关 swagger 的访问
> 先跑起来 -> 改改问题 → 优化 → 发现问题 → 优化
> 补测试， 做压测， 监控nginx反向代理
> 深挖已有项目

商品列表接口

最开始：

select \* from products

后来数据到了100万条。

怎么办？

你可能会想到：

分页
索引

继续增长到：

1000万条

怎么办？

再增长：

1亿条

怎么办？

这个过程里面涉及：

索引设计
覆盖索引
缓存
ES
分库分表
读写分离

训练1：项目复盘

拿 Mall 项目。

挑一个模块。

比如秒杀。

然后问自己：

为什么用Redis？
为什么用Lua？
为什么不用数据库扣库存？
为什么会超卖？
Redis挂了怎么办？
库存最终以谁为准？

不断往下问。

你会发现自己很多地方其实没想透。

训练2：故意制造问题

比如：

Redis宕机
docker stop redis

看看项目怎么崩。

MQ宕机
docker stop rabbitmq

看看消息怎么丢。

MySQL变慢

模拟慢查询。

看看接口RT变多少。

面经 ？
why go ?

    1. 语法友好， 不想cpp很多黑魔法。
    2. 跨平台友好， 包依赖github安装， 我们只用安装go就行。
    3. 比较好写并发程序。
    4. 语言可以单测，go test 编译速度快
    5. 还有gc, 不用自己管理内存

MYSQL正则 ？
REGEXP '^[aeiuo]' 第一个字符在 aeiuo中
'[aeiuo]$' 最后一个字符在 aeiuo中
	^xxx → 以 xxx 开头
	xxx$ → 以 xxx 结尾
^[aeiou]：第一个字符是元音
._：中间任意长度的任意字符（. 任意字符，_ 0 个或多个）
[aeiou]$：最后一个字符是元音

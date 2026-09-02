## redis分布式锁会失效吗 ？

    - 1.锁过期， 业务没执行完 。 solu: 实现续期机制， 看门狗， 定时给锁续期
    - 2. 锁被其他误删， 判断再删除。 solu: 锁唯一标识， lua脚本释放锁
    - 3. 网坏了，锁无ttl， 死锁  solu: 设置ttl
    - 4. Redis宕机, 锁会丢失 solu: 主从

## Lua被当成单条命令执行， Redis主线程串行处理命令

    - Lua脚本不可中断
    - Lua适合分布式锁， 限流， 原子扣减

## Redis Pipeline一次把多条命令给Redis, 一次返回所有结果

    1. 减少网络往返次数 , 中间命令失败也不停止 (批量导入， 批量查询)
    2. Pipe减少 RTT(网络往返次数), 一次性发给Redis

## Multi开启事务， Exec执行

> Discard放弃事务， Watch监视一个/多个Key
> 先watch， 如果exec前key被修改， 放弃执行

## nginx反向代理， -> nginx再转发到后端， 对内网服务做隔离

> 负载均衡： 把请求分发到多个后端实例， 实现故障转移， 扩容
> 网关能力： 统一跨域， 限流， ssl证书， 动态请求后端， 静态nginx返回
> redis 挂了，消息采用 message 持久点
> JWT 签名 依赖自身过期时间
> 用户缓存在 DB 查询

websocket 特点：依托 TCP 长连接，网络切换会断
既然是基于 TCP 流，一旦丢包，整条链路直接
超时阻塞。TCP + TLS 握手

Quic 基于 UDP，使用 Cid 作为连接标识
udp 头部 简短好处，Quic 存放连接上下文

Quic 特性：1‑RTT 连接，
内置独立 stream 流，一个流丢包只影响当前流，不影响别的。

UDP 也会丢包，为啥 Quic 不受影响？
udp 上层去把数据包送到服务客户端，
建立连接会话，Cid 标识。

集群分片 16 个，16 goroutine 并发处理
`hash(uid) %16`

面向接口做业务，单元测试直接 Mock

什么分库和为什么要分表？

3 个机制，哨兵防止脑裂
哨兵：监控、通知、自动故障转移

主观下线：单个哨兵认为主不通 Master
客观下线：多哨兵判定主故障

## 故障转移

1° 选一个哨兵当 leader
2° 这个哨兵从库筛选新 Master
1° 优先级
执行 `replicaof no one` 升级主
剩余节点 `replicaof` 新主地址，跟随新主

脑裂：主节点卡顿，升级了新主；
一份数据两个主 — 脑裂

---

String：验证码、用户 Token、简单计数器、Json
Hash：平面对象字段存储
Set：用户标签、共同好友、黑名单

- `SISMEMBER` 判断元素是否存在 O (1)
- `SINTER` 求交集
- `SUNION` 求并集

ZSet：排行版，延迟队列

## AOF 重写机制

生成新的子集指令代替冗余表达，`set k3 = {set k 1、set k 2、set k 3}`

手动：`BGREWRITEAOF`

自动：
`auto‑aof‑rewrite‑percentage 100`
`auto‑aof‑rewrite‑min‑size 64mb`

fork 子进程做新 AOF 临时文件，父进程正常接收写请求。
新增指令存入 aof 重写缓冲区。

子进程写完 AOF，父进程正常写 AOF；父进程生成临时文件，失败直接丢弃临时文件。
AOF 重写时，原有 AOF 正常写入 AOF。

## 缓存雪崩：大量 key 同一时间集体过期，DB 被打崩

1° TTL + 随机偏移值
2° 热点数据永不过期
3° 主从 + 集群
4° 限流、熔断

缓存击穿：热点 key 过期，大量请求到 MySQL
互斥锁：`setnx` 上锁，一个请求去查 DB，回填 Redis；其余请求阻塞等待缓存生成。

缓存穿透：根本不存在数据
1° 缓存空值、布隆过滤器
2° 参数校验

`setnx key value` key 不存在才写入，存在返回 0
`set key value NX EX 10` 原子命令
分步执行，会存在死锁风险

Redis 原生事务：
`MULTI` 开启
`EXEC` 串行执行队列
`DISCARD` 放弃队列
`WATCH` 乐观锁

## 原生脚本特性

1° 时间复杂度高
2° 只支持固定返回
3° 不支持判断拆分

原生 Lua 脚本优势：
一个原子指令，redis 单线程串行执行

**加锁 Lua**

```
if(not exists) then
    set key ex 30
    startWatchDog()
end
```

**续期 Lua**

```
if get(key) == id then
    pexpire key 30000
    return 1
else
    return 0
end
```

Lua 只做简短逻辑运算，禁止复杂 IO、循环。
单节点加锁；主从架构，主节点 lock 成功，未同步到从节点，主挂‑新主无锁，锁丢失。

Redlock、Redisson
部署 N 个独立 redis 实例，一半客户端拿到锁才算拿到锁。

Redisson 分布式锁：Lua 加锁、看门狗自动续期锁
看门狗：后台异步定时线程，给锁执行定时任务，自动续期锁。
设置过期时间才触发看门狗。

释放锁：Lua 校验归属再 del，防止误删。

一主多从：Master 负责读写，Slave 只读做数据备份，从节点不接收写请求。

同步：**全量同步 + 增量同步**

- 全量：初次连接主从，没有有效偏移量的时候触发。
  Master 执行 bgsave 生成 RDB，RDB 发给从，从加载 RDB。
  Master 把缓冲区命令补发从节点，同步完成。
  ‑增量：从节点带来 offset + 主节点 id。Master 补发 offset 之后的指令。

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

encoding：

`OBJ_ENCODING_INT`：存数值在 long 范围，直接数字存 ptr

`OBJ_ENCODING_RAW`：字符串 >44 字节，redisObject 和 sds 分开两次内存分配

`OBJ_ENCODING_EMBSTR`：字符串 ≤44 字节，embstr 一次性分配 redisObject + sds 连续内存

sds：简单动态字符串，记录属性，O (1) 获取字符串长度
存二进制数据，可以`\0`截断
预分配冗余空间，减少扩容拷贝

Redis 设置 expire /expireAt 不修改原 key，把 key + 过期时间存入过期字典。
`dict[key] = 时间`，del 删除 key，同时删除数据字典 + 过期字典

惰性删除：
1° 已过期 → 删除 key + 返回 nil
2° 未过期 → 正常返回数据

定期删除：
1° 随机挑选 20 个 key
2° 过期 key 直接删除
3°key 过期比例 >25%，继续再扫一轮

内存淘汰：volatile‑lru 淘汰带过期的 key

RDB：某一瞬间全内存数据二进制快照文件
fork 子进程完成落地，主进程继续处理业务读写

手动触发：`save` 主进程阻塞，主进程直接落地 RDB

BGSAVE：父进程调用 fork 创建子进程，子进程生成 RDB 文件

自动触发：`save 900 1`
900 秒内，1 次修改自动 bgsave 生成 RDB

Linux 写时复制：fork 父子共享一份物理内存，子进程做 RDB 落地；
只有父进程修改的数据页被写入时，才复制对应的内存页

fork：
1° 复制页表，虚拟内存空间
2° 父子进程虚拟地址映射到同一块物理内存
所有内存页设为只读

写时复制：COW
子进程只负责写 RDB，全程只读物理内存，无内存复制开销
父进程：收到指令修改 key 会触发 Copy
1° 复制该页修改内存页到新物理内存
23 次进程页表，映射新页面并修改数据

AOF：
`appendonly yes`
开启 AOF，水涨写内存？
记录时间的写命令，大文件积攒，大文件重写 Cow 复制

AOF 持久化格式记录所有修改数据的命令，Redis 重放时逐条回放 AOF 恢复数据

AOF 刷盘策略：

- `appendfsync always`：每次写都刷盘
- `appendfsync everysec`：每秒刷盘

redis 的 pipeline 批量发送命令，减少往返时间

## Lua脚本格式

```go
# 格式

EVAL "lua脚本内容" key数量 key1 key2 arg1 arg2

 示例：设置一个key
EVAL "redis.call('SET', KEYS[1], ARGV[1])" 1 user:100 name zhangsan

EYS[1]：必须放键名（规范）
ARGV[1]：放参数
redis.call()：执行 Redis 命令
脚本全程原子执行，不会被其他命令打断
```

## 限流原子自增

```go
-- 功能：10秒内最多访问5次
local key = KEYS[1]
local max = tonumber(ARGV[1])
local expire = tonumber(ARGV[2])

local count = redis.call('GET', key)
if count and tonumber(count) >= max then
    return 0  -- 超过限制
end

count = redis.call('INCR', key)
if tonumber(count) == 1 then
    redis.call('EXPIRE', key, expire)
end
return 1
```

## EVALSHA

```go
SCRIPT LOAD "local key=KEYS[1] local max=tonumber(ARGV[1]) local expire=tonumber(ARGV[2]) local count=redis.call('GET',key) if count and tonumber(count)>=max then return 0 end count=redis.call('INCR',key) if tonumber(count)==1 then redis.call('EXPIRE',key,expire) end return 1"
```

用SCRIPT LOAD lua命令

得到SHA1码， 用EVALSHA SHA1码 1 rate:user:100 5 10去做

Redis默认有16个独立数据库，0~15. SELECT 1切换分区

## Hash原子更新用户信息 + 校验存在性

## 安全入队 + 长度限制

```go
local key = KEYS[1]
local msg = ARGV[1]
local max_len = tonumber(ARGV[2])

redis.call('LPUSH', key, msg)
redis.call('LTRIM', key, 0, max_len - 1)
return 1
```

## 原子增加 + 判断是否已存在

```go
local key = KEYS[1]
local member = ARGV[1]
local exists = redis.call('SISMEMBER', key, member)
if exists == 1 then
    return 0
end
redis.call('SADD', key, member)
return 1
```

## redis存储的都是字符串， 使用tonumber转成数字

## 更新排行榜 + 只允许更高分数覆盖

```go
local key = KEYS[1]
local uid = ARGV[1]
local new_score = tonumber(ARGV[2])

local old_score = redis.call('ZSCORE', key, uid)
if old_score and tonumber(old_score) >= new_score then
    return 0
end
redis.call('ZADD', key, new_score, uid)
return 1
```

## Redis事务MULTI/EXEC简单批量

```go
MULTI        -- 开启事务
SET a 100
HSET user:1 name tom
LPUSH list hello
EXEC         -- 执行（原子）
```

- `MULTI`：**开启事务**
- 后面写的命令：**不会马上执行，而是放进队列**，所以返回 `QUEUED`
- `EXEC`：**一次性、原子性执行所有队列命令**
- 执行完才会返回所有结果

# Redis 事务的核心特点（必须懂）

1. **原子性**：要么全部执行，要么全部不执行
2. **中间不会被别的命令插入**
3. **Redis 事务不会回滚**（某条错了，其他继续执行）

## Pipeline管道高性能批量， 非原子， 只是减少网络往返

```go
-- KEYS[1] = 商品库存key  例如：stock:iphone16
-- ARGV[1] = 扣减数量    例如：1（每人买1件）

-- 1. 获取当前库存
local stock = redis.call('GET', KEYS[1])

-- 2. 如果库存不存在 或者 库存 < 要扣的数量
if not stock or tonumber(stock) < tonumber(ARGV[1]) then
    return 0  -- 返回0：库存不足，扣减失败
end

-- 3. 库存足够，执行扣减
redis.call('DECRBY', KEYS[1], ARGV[1])

return 1  -- 返回1：扣减成功
```

- **单机锁**：简单快，怕主从宕机丢锁
- **红锁 Redlock**：多节点过半成功才算锁，高可靠、重、慢
- **普通业务单机锁够用，金融级上红锁，极致稳定用 ZK**

```go

-- KEYS[1] 锁key，ARGV[1] 唯一标识value，ARGV[2] 过期时间
if redis.call('setnx',KEYS[1],ARGV[1]) == 1 then
    redis.call('expire',KEYS[1],ARGV[2])
    return 1
else
    return 0
end
```

等价命令：`SET lock:order uuid NX EX 30`

- `NX`：不存在才设置（互斥）
- `EX`：自动过期（防死锁）

## 解锁

```go

if redis.call('get',KEYS[1]) == ARGV[1] then
return redis.call('del',KEYS[1])
else
return 0
end
```

“**为什么锁不能单独解决幂等，必须配合状态机和唯一索引**”。
分布式锁只防**并发争抢**，挡不住**重复重试请求**；必须搭配**唯一索引**拦重复入库、**状态机**约束业务流转，三者配合才能彻底保证幂等。

锁解决：**同一时刻多请求同时执行业务**，避免并发脏数据

幂等解决：**多次相同请求反复进来**，保证只生效一次

锁管不住超时重试、前端重复点击、mq 重投、接口重试这类重复请求。

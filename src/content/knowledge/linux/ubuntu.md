`df -h` 查看文件系统磁盘使用量
`du -sh <目录>` 统计目录下文件总大小
`lsblk` 列出块设备

## sda：整块物理硬盘

- sda1：空的保留
- sda2：EFI 启动分区（引导开机）
- sda3：系统主分区

loop是Snap 软件挂载

### 磁盘满了怎么排查？

    1. `df -h` 看占用比较高的
    2. `du -sh /* 2>/dev/null`

    3. 查找 `/app/logs` 下最大的 3 个文件
    `du -sh /app/logs/* | sort -rh | head -3`

## `ps aux` 查看 Linux 系统正在运行的进程

`ps aux | grep nginx` 过滤 nginx 进程程序进程

`ps aux` 侧重查看 CPU、内存占用

## `ps -ef` 侧重进程关系

查找子进程、僵尸进程、服务父进程：`ps -ef`

RSS：实际占用物理内存
VSZ：虚拟内存总大小

## 一个程序：二进制代码50MB，数据 20M

- RSS ≈20M，自己独占物理内存

  -VSZ ≈20+do=70M

> 看进程的内存：RSS 实际内存
> VSZ 页面虚拟内存

## `top` 进程监控

`top -p pid` 只看某个进程

`kill -9` 强杀，`kill -15` 优雅停止
推荐 `kill -15`，可以清理善后

`top -b` 监控输出
`top -b -n -1` 只采集一次

pgrep → ps|grep pkill → pgrep + kill

```
pgrep node #显示进程pid
pgrep mysql
pgrep -l node #显示pid+进程名

pgrep -u wk #查看wk用户的进程

pgrep -n node #最后启动的node pid

pkill node #执行关闭
pkill -f node #进程杀死

pkill -u wk node #杀掉指定用户进程
```

`kill -l` 列出所有信号，SIGTERM 安全退出
`kill -9` 杀不掉怎么办，IO 等待，ps aux 看 STAT 列不可解析状态

```
ss -tlnp #过滤8082端口
ss -tlnp | grep 8080
```

查看端口占用：

```
lsof -i :3306
lsof -i tcp/udp #查看所有tcp/udp

ss -tlnp #看哪些服务启动占用端口
lsof -i :port #谁在连这个端口，端口被谁占用

ss -tlhp | grep 8080 #看有没有占用
lsof -i :8080 #看谁在用
```

怎么查看端口被哪个进程占用，处理手段：

```
ss -tlhp | grep :<端口>; kill -15 <pid>
```

```
typedef struct redisObject {
    unsigned type :4;
    unsigned encoding :4;
    unsigned lru:24;
    int refCount;
    void *ptr;
} robj;
```

`refCount`：引用，0 释放内存
A 类型基于 redisObject 封装 key
ptr → 指向底层对象
编码：物理存储实现，Redis 自动切换底层编码，优化空间与性能

这里我的markdown笔记， 帮我修改错误的内容。 然后以 一个美观的markdown源代码格式给我

`tail -n 200` 看多少行
`tail -f` 实时追踪

`journalctl` 是 systemd 自带日志工具
所有 `systemctl start xxx` 托管程序，日志统一被 systemd 收集

`journalctl -u 服务名`
`journalctl -u nginx -f` 实时刷新
`--since ""` 按时间筛选

`ls -l`
权限三位一组：所有者 u、所属组 g、其他人 o
`r=4,w=2,x=1`

`useradd -m myuser` 创建用户
`passwd myuser` 设置密码

`free` 内存相关
`lscpu` cpu 信息
`uname -a` 内核信息

`chmod` 修改文件权限
`chmod +x` 所有者加执行
`chmod g+x` 给属组加执行权限
`chmod -R g+w` 递归改权限

`chown` 修改文件所属用户用户组
`chown 用户:用户组 文件名`

`644`：主人读写，同组读，其他人读

`find` 查找路径，条件动作
`~home` 按文件查找
`‑type d` 目录，`‑type f` 文件

`lsb‑release -a` 看系统版本
`vmstat` 虚拟内存统计

`apt update` 刷新包列表
`apt upgrade` 升级已装包
禁止特定包更新：`apt‑mark hold 包名`

开机自启 / 关掉：`systemctl enable/disable nginx`

```
systemctl status nginx #看服务状态
systemctl mask nginx #锁死服务
#解锁 unmask
systemctl is‑active #判断是否运行
```

- running：运行
- inactive：已经停止
- masked：被 mask 锁定

```
systemctl enable #开机启动
systemctl disable #关闭开机自启
```

```
#放行端口
sudo ufw allow 24/tcp
sudo ufw status numbered #查看已放行规则列表
sudo ufw reset #清空规则

#拒绝某个ip
ufw deny from ip
```

消费者手动 Ack (`autoAck=false`)
手动 Ack，失败 nack 丢死信

---

追踪状态 top/htop
系统全局监控 Umstat
IO 磁盘查看 iostat
网络调用追踪：strace
文件句柄 lsof
网络连接 netstat/ss
cpu 性能 perf

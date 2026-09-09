# Go 笔记

## 目录

- [一、Go 语言基础](#一go-语言基础)
- [二、Slice / Array / Map](#二slice--array--map)
- [三、goroutine 与 GMP 调度](#三goroutine-与-gmp-调度)
- [四、Channel](#四channel)
- [五、sync 同步原语](#五sync-同步原语)
- [六、context 与 time](#六context-与-time)
- [七、GC 与内存管理](#七gc-与内存管理)
- [八、gorm 与 MySQL](#八gorm-与-mysql)
- [九、Redis 与缓存](#九redis-与缓存)
- [十、消息队列 MQ](#十消息队列-mq)
- [十一、架构与业务实战](#十一架构与业务实战)

---

## 一、Go 语言基础

### go 的优势

- 内存占用小
- 并发性能好
- 交叉编译部署简单

### 变量声明

```go
var a int = 10
var b = 20  // 类型推导
c := 30     // 短声明
```

### 函数

```go
// 无参无返回
func Hi() {
    println("no param no return")
}

// 有参有返回
func Add(a, b int) int {
    return a + b
}

// 多返回值
func div(a, b int) (int, error) {
    if b == 0 {
        return 0, errors.New("zero")
    }
    return a / b, nil
}
```

- 函数作为参数：

```go
func callback(y int, f func(int, int))
```

- 匿名函数可以赋值给某个变量：

```go
f = func(x, y int) int {
    return x + y
}
```

- 函数可以是一个返回对象；工厂函数返回值是函数。

### 结构体与方法

```go
type Student struct {
    Name string
    Age int
}
o := Student{
    Name: "wk",
    Age: 18,
}
```

- 结构体方法，类似 C++ 的成员函数：

```go
func (s Student) Study() {
    println(s.Name + " is studying")
}
```

### 接口与多态

> 接口：规定必须做什么，不规定怎么做。接口只写方法名、参数、返回值。

```go
type Animal interface {
    Speak() string
}
```

- 实现接口的函数，就实现接口：

```go
type Dog struct { Name string }
func (d Dog) Speak() string { return "bark" }

type Cat struct { Name string }
func (c Cat) Speak() string { return "meow" }
```

- C++：继承 + 虚函数实现多态；Go：接口实现多态。
- 空接口：`var x interface{}`，所有类型都自动实现空接口。
- 接口习惯 er 结尾。

### iota 生成常量

```go
const (
    a = iota
    b
    c
)
```

### 命名权限

- 命名决定访问权限：大写开头为公开，小写开头为私有。
- 驼峰命名法：userName / UserName。

### 闭包

- 闭包 = 一个函数能记住外部变量。

### defer

> 你走之前，一定要关灯。
> - defer 压栈，后进先出。
> - 函数 return 前执行，执行 panic 了 defer 也会执行。
> - defer 声明时立即对参数求值。

### 创建 go module

```go
go mod init modulename         // 创建模块
go mod tidy                    // 更新依赖
go get github.com/gin-gonic/gin // 添加依赖
```

### make / new

```go
func make([]T, len, cap)  // make(T) 返回类型 T 的初始值
new(T)                    // 为每个 T 分配一片内存，初始化为 0
```

### JSON 序列化

- marshal：把 go → json（二进制）。
- unmarshal：反序列化，把 json → go。

### 表驱动测试

- 建立一张测试表，所有用例在一张表；加测试用例只需往切片里加一行，不用复制粘贴。

### fmt 输出

- `fmt.Printf()` 打印到控制台，只输出不返回。
- `fmt.Errorf` 生成 Error 对象，用来抛异常、返回错误。

### 日志级别

- logger silent：静默。
- Error：只打印错误 sql。
- Warn：只打印错误 + 慢 sql。
- info：全部 sql 打印。

### 字符串操作

```go
HasPrefix(s, prefix string) bool  // 查前缀
HasSuffix(s, suffix string) bool  // 查后缀
Contains(s, substr string) bool   // 包含字符串
Index(s, str string) int          // 找第一个字符的位置
LastIndex(s, str string) int      // 最后位置
Replace(str, old, newstr, n) string // 字符串替换，n = -1 全部替换
Count(s, str string) int          // 统计字符串次数
Repeat(s, count) string           // count 个 s 拼接
ToLower(s), ToUpper(s)            // 字符改大小写
TrimSpace(s)                      // 去除头尾空白符号
Trim(s, "子串"), TrimLeft, TrimRight
Fields()                          // 按空白分隔，返回一个 Slice
Split(s, scp)                     // 按 scp 切割
Join(s []string, scp)             // 拼接字符串
```

### 字符串拼接 Buffer

```go
var buffer bytes.Buffer
buffer.WriteString(s)  // 把 s 追加到后面
buffer.String()        // 转换成 string

x = append(x, y...)    // 追加切片 y 到 x
```

### 浅拷贝 vs 深拷贝

- 浅拷贝和原数据共用；深拷贝和原数据独立。

### 静态库 vs 动态库 / 插件

- 静态库：通过静态链接生成的二进制，包含全部依赖，能独立执行。
- 动态库：可以在多个执行文件之间共享，减少内存占用；提供更多灵活性。
- 主程序可在编译后动态加载共享库，实现热插拔的插件系统。
- Linux 的共享对象使用 ELF 格式，提供一组操作动态链接器的接口。

```go
go build -buildmode=plugin // 编译插件得到一个 .so 文件
// 加载 so 文件：plugin.Open，执行 plugin.Lookup
```

### Future 模式

- 使用某个值前，要先对它进行计算；开发计算密集型任务时用 Futures 设计接口。

---

## 二、Slice / Array / Map

### Array vs Slice

- Array：静态，固定长度，值传递。
- Slice：动态，引用底层数组，引用传递。

### Slice 底层结构

```go
// runtime/slice.go
type slice struct {
    array unsafe.Pointer // 指向底层数组的指针
    len   int            // 切片长度，可访问元素数量
    cap   int            // 切片容量，底层数组总可用元素
}
```

- 数组是一块连续的内存。

### Slice 声明与追加

```go
s := []int{1, 2, 3}
s := make([]int, 3)
s := make([]int, 3, 5) // 容量为 5，长度为 3
s = append(s, 6)        // 追加

s := []int{1, 2, 3, 4, 5, 6}
a := s[2:4] // 左闭右开，=[2, 3]
```

### Slice 扩容

1. 先创建更大底层数组
2. 旧 data 复制过去
3. slice.ptr 指向新数组

- append 时 len > cap 就扩容；原容量 < 256，新容量 = 2 倍。
- 切片截取共用底层数组，扩容后不再共用数组。

### map 底层

```go
type bmap struct {
    topchar  [8]uint8 // 每个 key 哈希高 8 位
    keys     [8]key
    values   [8]val
    overflow *bmap    // 溢出桶链表
}
```

- 底层是哈希表 + 链表 + 桶，底层是 hmap 结构体，数据存在桶里；一个桶有 8 个 kv，用链表串起来。

### map 操作

```go
m := make(map[string]int)
m := map[string]int{ "a": 1, "b": 2, "c": 3 }

v, ok := m["a"]   // 查值
if ok { println(v) } else { println("key not found") }

delete(m, "a")    // 删除

for key, val := range m  // 遍历 key、val
for key := range m       // 只要 key
```

### map 扩容

- 装载因子 > 0.65 触发扩容，正序扩容搬移数据。
- 渐进式迁移：每次访问 map，迁移 2 个旧桶到新桶。

### OJ 读数据

```go
var n, k int
fmt.Scan(&n, &k)

a := make([]int, n)
for i := 0; i < n; i++ {
    fmt.Scan(&a[i])
}
```

---

## 三、goroutine 与 GMP 调度

### goroutine 创建

- go 关键字创建 goroutine。
- 轻量：初始栈 2KB（线程栈大），创建销毁开销大。
- go runtime 管理，自动 M:N 调度，不用手动 epoll/线程池；不是 OS 管理，用户态调度，没有内核切换。
- 线程切换要陷入内核，G 在 P 内部；用户态切换，上下文切换成本低。
- 线程切换 CPU 阻塞，GMP 会剥离阻塞 G，复用 P 跑其他任务。
- 本地队列优先，减少全局竞争。

```go
go func() {
    println("goroutine 1")
}()
```

### goroutine vs thread

- 线程由 OS 管理：重、慢、数量有限。
- 协程由 Go 管理：轻、快、大量并发。
- 协程遇到 IO 自动让出，不卡住线程。
- 内核态线程：由 OS 内核全权管理执行单元，调度、切换、资源分配都在内核完成。
- 用户态协程：运行在用户态，由语言/三方库自行调度的轻量执行单元。

### goroutine 栈

- goroutine 栈可以扩栈，不是 OS 固定栈，是 Go 运行时在堆上申请的、可自由移动的连续内存，可随时扩栈、缩栈。
- 初始栈大小 2KB，栈在堆上，由 Go runtime 管理。
- 扩栈流程：① 申请一块更大内存；② 旧栈数据拷贝过去；③ 更新栈指针 sp；④ 销毁旧栈。
- Go 使用连续栈机制，不链表栈，栈上效率高。
- 缩容：Go 周期性检查，栈使用率低就释放多余内存空间。

### GMP 模型

- G → 挂载到 P → P 绑定 M → M 执行 G。

```
1. 程序启动创建 N 个 P
2. 创建 M 绑定 P
3. P 从本地队列/全局队列拿 G，放 M 上执行
4. G 时间片用完/主动让出，P 切走 G，调度下一个 G
```

- G：协程，go func()，保存当前函数栈、程序计数器 PC、寄存器、退出状态，栈初始化 2KB 自动扩缩。
- M：OS 内核线程，真正干活的，一个 M 对应 OS 线程。
- P：逻辑处理器，持有运行 G 所需资源（运行时上下文、本地队列、缓存），没有 M 不能执行 G。
- P、M = 执行单元，M 绑定 P 才能运行 G。
- M 不去销毁底层 OS 线程，反复复用；G 执行时不直接操作 OS 线程。
- M 绑定 P → P 本地队列取 G 执行 → G 阻塞/时间片耗尽 → 让出 P → M 继续执行可运行 G。

### 工作窃取

- 一个 P 的 G 跑完了，会偷取其他 P 队列的 G（一次偷一半）。
- 调度优先级：① 先查本地 G 队列；② 窃取其他 P 的。
- P 的数量 = GOMAXPROCS。

### 为什么 Go 高并发

1. GMP 调度用户态
2. 协程开销小
3. 线程切换少

### 抢占式调度

- goroutine 抢占式协程，遇到调度机会就会让出点。
- 自主抢占 + 自动调度 + 数据并发模型。

### 系统调用 / sync 锁 / select 调度

- 普通系统调用：
  1. 当前 G 处于 running，发起阻塞系统调用
  2. M 与 P 拆分，M 带着 G 进入内核阻塞
  3. P 寻找空闲 M 或新建 M，继续调度其它就绪 G
  4. syscall 返回，M 尝试继续执行 G，G 回到 runq 队列变为 runnable
- time.Sleep：runtime 加入定时器堆，G 变 blocked，P 调度其他任务；定时器堆到期唤醒 G → runnable。
- sync 锁调用：G 加锁失败进入锁等待队列，G 状态置 blocked，M 释放回 P，P 调度下一个就绪 G；其他 G 释放锁时唤醒等待队列 G → runnable。
- select 底层：随机伪轮询，多路分支生成，阻塞等待；通过 runtime 调度，不依赖内核，阻塞时复用 M 执行其他 G。

### GOMAXPROCS 与让出

- `runtime.GOMAXPROCS(n)`：最多 n 个 M 执行用户 goroutine。
- `GOMAXPROCS`：M:P 的操作系统线程数。
- `runtime.Gosched()`：让出处理器，允许运行其他协程。
- `runtime.Goexit()`：停止协程。

### goroutine 什么时候挂起（面试精简）

- 挂起分两类：
  1. 主动挂起：IO 阻塞、锁等待，goroutine 进入 wait 状态释放 CPU；手动调用 runtime.Gosched() 主动让出。
  2. 被动抢占挂起：goroutine 长时间占用 CPU，运行时抢占调度，强制剥夺 CPU 将 G 挂起。
- 挂起条件：① 阻塞系统调用；② 抢占时间片用完；③ 手动 Gosched()。
- 挂起时：保存当前 goroutine 上下文（寄存器、栈指针）→ goroutine 运行态→等待态 → 让出 M。
- 恢复时：等待条件满足 → 等待态→运行态 → 放回运行队列 → 被 M 调度时恢复上下文继续执行。
- 状态流转：running → 执行完 → terminated（G 被回收）；running → blocked（被挂起）。
- 注意：协程挂起是用户态 runtime 完成，不触发操作系统线程切换。

---

## 四、Channel

### CSP 并发模型

- 用 channel 通信；Go 用通信方式共享内存。

```go
ch := make(chan int)
ch <- 100   // 发送
a := <-ch   // 接收
println(a)
```

- `chan struct{}` 不占用内存空间。

### 无缓冲 vs 有缓冲

- 无缓冲：别人给你饭菜，你不接就掉地上，所以等你——同步阻塞，是各个协程同步的关键点。
- 有缓冲：像快递柜，你放里，别人有空去拿——异步。

```go
a := make(chan int)     // 无缓冲
a := make(chan int, 3)  // 有缓冲
```

### 关闭 channel 的 panic 规则

- 给关闭的 channel 发数据 → panic。
- 关闭后读 channel → 返回 0 + false。
- 关闭已经关闭的 channel → panic。
- 关闭 nil channel → panic。

### select

- select 监听多个 channel，多分支选择，哪个就绪走哪个；每个 case 只能有一个。
- `select{}` 多数阻塞点背后就是一个 select{}。

```go
select {
case <-quit:
default:
    close(p) // 关闭重复的 channel 用 select + default 保护
}
```

### hchan 结构

- 底层基于队列实现，并发安全。
- 底层 hchan 结构体：recvq 接收协程等待队列、sendq 发送协程等待队列。
- 无缓冲 chan 数据不落地存储，只在两个协程之间拷贝。

| 成员 | 含义 |
|---|---|
| 缓冲数组 | 仅有缓冲 channel 存在；无缓冲 channel 该字段为 nil |
| send waitq | 发送协程等待队列，保存阻塞等待发送的 G 链表 |
| recv waitq | 接收协程等待队列，保存阻塞等待接收的 G 链表 |
| waitq | 等待队列，挂载被阻塞的 goroutine |
| uint32 计数 | 引用/元素计数 |
| elemType | channel 里面存放元素的类型 |
| close | 通道关闭标记 |

### 缓冲区环形队列

- 缓冲区是环形队列，容量 N，len 当前元素个数。

### 发送 / 接收

- 发送：
  1. 缓冲区没满，直接写入 buf，发送立即返回，不阻塞。
  2. 缓冲区满了，goroutine send 阻塞，等缓冲区空出来。
- 接收：
  1. 缓冲区有数据，直接取出队首元素返回。
  2. 缓冲区空，当前 goroutine 入 recv 阻塞，等待发送数据。
- buf 的目的：解耦生产者-消费者，生产者可批量发一批数据，不必等消费者实时接收。

### 关闭

- `close(ch)` 关闭：
  1. 标记 closed = true
  2. 唤醒阻塞在 recv 的接收协程，接收返回零值 + ok:false
  3. 唤醒阻塞在 send 的发送协程，发送直接 panic
- 通道关闭代表生产结束，不再有新数据，继续发送直接报错。

### 无缓冲 channel（buf = nil）

- 发送 `ch <- x`：
  1. 没有正在等待的接收 goroutine：当前 G 进入 send 等待队列，阻塞。
  2. 已存在等待的 recv G：直接把数据拷贝给接收 G，收发双方 goroutine 全部唤醒。

---

## 五、sync 同步原语

### atomic

```go
atomic.AddInt32
atomic.LoadInt32
atomic.StoreInt32
atomic.CompareAndSwapInt32
```

- 无锁、线程安全、极高性能。

### CAS

- 先比较再交换，原子操作，靠 CPU 原子指令。
- 只能保证单个变量安全，失败要循环重试（自旋）。

### 互斥锁 / 自旋锁 / 悲观锁 / 乐观锁

- 互斥锁：抢不到锁，线程睡眠，让出 CPU → sync.Mutex。
- 自旋锁：一直循环，CPU 旋转；一种多线程同步机制，当前进程进入自旋一直占用 CPU，互斥锁只有普通模式才能进入自旋。
- 悲观锁：一直有人和我竞争，先加锁后操作。
- 乐观锁：先做后检查，例子 CAS。

### sync.Mutex

- 有正常模式和饥饿模式：正常遵循 FIFO 获取锁，竞争抢不到 → 饥饿模式。
- 饥饿模式：锁给等待队列最前面的 goroutine，新 goroutine 只等待，不自旋。
- 底层：自旋 + 信号量，先自旋自抢，高竞争才休眠。
- `Unlock` 未持有锁去 Unlock：panic；同一个 goroutine 重复 Lock：死锁。
- 互斥锁：同一时间只能一个 goroutine 持有，其他全部阻塞。

```go
type Mutex struct {
    State uint32 // 当前锁状态
    sema  uint32 // 控制锁状态信号量
}
```

- 默认互斥锁状态是 0，int32 不同位数表示不同状态：mutexLocked 锁定状态、mutexWoken 唤醒、starving 进入饥饿状态。

### 加锁 / 解锁流程

- 加锁：CAS 将 locker 置 1，成功获取锁；自旋等待锁释放；自旋失败休眠 waiter+1；G 进入等待队列，调用 runtime.Gosched() 让出 M/P。
- 解锁：CAS 清除 lock 位；若有等待 G，唤醒 woken:=1；不唤醒直到 CAS 抢锁，抢不到继续休眠。

### sync.RWMutex（读写锁）

- 读共享、写互斥；写锁阻塞读锁。
- 写饥饿：大量读协程不断获取读锁，写协程一直无法拿到写锁永久阻塞。
- 解决（写请求插队 + 读锁抢占机制）：
  1. 写协程发起写锁请求，不允许新的读协程获取读锁，等所有读锁释放
  2. 加写锁执行
  3. 写锁释放，放行排队的读协程
- 读锁期间，新写请求会阻塞（防止写饥饿）。

### sync.WaitGroup

```go
Add()  // 计数 +1
Done() // 计数 -1
Wait() // 阻塞，直到计数器为 0
```

```go
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func() {}()
}
wg.Wait()
// 注意：Add 应在 goroutine 外，主循环直接 Wait 会出问题
```

### sync.Once

- once.Do 确保只做一次。

```go
type Once struct {
    done uint32
    m    Mutex
}

func (o *Once) Do(f func()) {
    if atomic.LoadUint32(&o.done) == 1 { return } // 先原子读 done
    o.doSlow(f)
}

func (o *Once) doSlow(f func()) {
    o.m.Lock()
    defer o.m.Unlock()
    if o.done == 0 {                          // 二次检查，防多 goroutine 进入
        defer atomic.StoreUint32(&o.done, 1)  // 执行完 f 后才置 1
        f()
    }
}
```

- 底层：done uint32 原子变量标记已执行；m mutex 互斥锁。
- 每次调用 once.Do(f)：先原子读 done=1 直接返回；后续 Do 原子判断 done==1 直接返回。

### sync.Pool

- 减少 GC 开销，复用短期临时对象。
- 底层：每个 P 私有缓存 + 全局共享链表，GC 时清空池内所有对象。

### sync.Map

- 底层分两套存储：read 只读层，原子操作，读起快；dirty 层（带锁）存放新增/修改数据。
- Load 查询：先查 read 层命中直接返回，未命中加锁查 dirty。
- 读出现过期，主动遍历链表，时间复杂度 O(n)。

### 锁范围尽量小

---

## 六、context 与 time

### context 作用

- 在不同 goroutine 之间同步请求特定数据、取消信号及处理请求的截止日期。
- 从顶层的 goroutine 一层一层传递下去。

### WithCancel / WithValue

- `context.WithCancel` 从 context 衍生新上下文，返回取消该上下文的函数。
- 执行返回的取消函数，当前上下文及子上下文都取消，所有 goroutine 同步收到取消信号。
- `WithValue` 内部单链表，每个节点存 Key-Value + 父 ctx。

### 取消传播

1. 树状结构，父持有所有子 ctx
2. 取消事件自上往下广播
3. Done() 返回只读 channel，channel 关闭后所有阻塞读立即返回零值，用于协程监听
4. Err() 只有 Done 关闭后返回非 nil，区分手动超时还是取消

### Deadline / Done

- `context.Deadline` 返回 context 被取消的时间。
- `Done` 返回一个 channel，当前工作完成/上下文被取消后关闭，多次调用返回同一个 channel。

### time

```go
time.After(d)          // 返回只读通道，指定时间后自动发一个值
time.NewTicker(d)      // 周期性定时器
time.NewTimer(d)       // 一次性定时器
ctx.Done()             // 返回一个 <-chan struct{} 只读通道
```

```go
v, ok := <-ch                    // 判断有没有有效值
time.After(2 * time.Second)      // 等待两秒
t := time.NewTimer(3 * time.Second)
<-t.C                            // 触发
t.Stop()                         // 停止
ticker := time.NewTicker(1 * time.Second) // 循环定时
```

### 函数计时

```go
start := time.Now()
end := time.Now()
delta := end.Sub(start)
time.Since(start) == time.Now().Sub(start)
```

---

## 七、GC 与内存管理

### Go 内存管理

- Go 内存管理 = 自动分配 + 自动回收。
- 栈：存小对象、局部变量，不用 GC，自动释放。
- 堆：存大对象、逃逸变量，要 GC 回收。
- Go 内存管理分三层：用户程序、分配器、收集器。
- 用户申请内存通过内存分配器；申请新内存时分配器做初始化。

### GC 三色标记 + 混合写屏障

- 内存看作房间：有人用 = 存活对象，没人用 = 垃圾，GC = 保洁。
- GC 流程：① 找（标记谁还在用）② 清（回收没人用的）③ 给（干净内存给程序用）。
- 三色对象：
  - 白色：未扫描，潜在对象，可能被 GC 回收。
  - 灰色：正在扫描，存在指向白色对象的指针，GC 会扫描子对象。
  - 黑色：扫描完成、存活，从根对象可达、不包含任何指向外部对象的指针。
- 混合写屏障：让 GC 一边扫描，一边让用户代码改内存。

### 标记清除（跟踪式垃圾收集器）

- 标记：从根对象出发查找并标记堆中存活的对象。
- 清除：遍历堆对象，回收未被标记的垃圾对象，将回收内存加入空闲链表。

### GC 工作流程

```
1. 标记
   暂停用户 G，初始化扫描根对象（全局对象、当前运行 G 栈、寄存器）
   根对象置灰，恢复用户 G，进入并发标记
2. 并发标记
   取出灰色对象标记为黑色；引用子对象白色标记为灰色；循环直到没有灰色对象
3. 并发清除
   遍历堆，所有对象判定为垃圾；并发回收内存归还 runtime 内存池；不阻塞业务协程
```

### STW 与 GC 触发

- STW = stop the world：暂停所有协程让 GC 干活。
- 触发条件：① 达到内存阈值（25%）；② 定时清理；③ 手动 runtime.GC()。
- 并发 GC，STW 极短，不用手动管理内存。

### 频繁 GC 问题

- 频繁 GC → CPU 高，程序变慢。
- 解决：① 减少小对象分配；② sync.Pool 复用对象；③ 减少逃逸，不用逃逸到堆。

### 为什么 G 阻塞 chan 不会浪费 CPU

- P 脱离当前 G，调度其他 G 执行。
- G 遇到 Go 层面阻塞（chan、mutex、sleep），G 切走放到阻塞队列，P 拿新 G 运行，系统线程不阻塞，CPU 不空闲。
- syscall 阻塞（文件 IO、网络 IO），M+G 阻塞在内核，与 P 分离，P 换新 M 继续执行其他 G；syscall 结束阻塞 G 重新找 P 运行。

### 逃逸分析

- Go 编译器自动判断变量在栈还是堆。
- 逃逸：本来在栈上，跑到堆上了。
- 内存逃逸成因：① 变量被返回指针；② 变量被闭包引用；③ 栈空间返回指针。

### 内存分配器 / 多级缓存

- 线程缓存分配器，用于分配内存的机制，比 libc 的 malloc 快得多。
- 按对象大小分为：微对象、小对象、大对象。
- 多级缓存：线程缓存、中心缓存、堆页堆。

```
Thread        Thread        Thread
    ↓             ↓             ↓
Thread cache  Thread cache  Thread cache
    ↘            ↙
      central cache
            ↓
     page   heap
```

| 级别 | 大小 |
|---|---|
| 微对象 | < 16B |
| 小对象 | 16B ~ 32KB |
| 大对象 | > 32KB |

### 内存管理组件

- 内存管理单元 runtime.mspan；线程缓存 runtime.mcache；中心缓存 runtime.mcentral；堆 runtime.mheap。
- 线程缓存负责微对象和小对象快速分配。
- 中心缓存是全局堆结构体，会从 OS 申请内存。
- mcache 每个线程独立结构体，从 OS 申请内存。
- 每个 runtime.mspan 管理多个 pages，每个 8KB 页面。

### 线性分配器 vs 空闲链表分配器

- 线性分配器：维护一个指向内存特定位置的指针，修改指针位置返回指针；无法利用被回收的内存。
- 空闲链表分配器：遍历空闲内存块，找到足够大的内存，切割新内存并修改链表。

### spans / bitmap / arena

| spans | bitmap | arena |
| --- | --- | --- |
| 512MB | 16GB | 512GB |

- spans 存储指向 runtime.mspan 指针，管理该片内存的管理单元 runtime.mspan。
- bitmap 标记 arena 哪些地址保存对象，位图中的每个字节表示对应 64 的 2 个指针占用。
- arena 区域地址，运行时将 8k 看作一页，用 arena 做地址映射；所有页数通过 spans 数组获取。

### 内存泄露 / 协程泄露

- 内存泄露：长生命周期持有短生命周期对象。解决：对象复用 sync.Pool。
- 协程泄露：协程创建了不退出。解决：控制 G 数量，用 Channel 退出。

---

## 八、gorm 与 MySQL

### 安装与连接

```go
// 使用 gorm 安装 gorm.io/gorm, gorm.io/driver/mysql
// 拼接 DSN：用户名:密码@tcp(IP:Port)/数据库名?parseTime=True&loc=Local
db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
// gorm.Open 只构造句柄，不创建 TCP 连接，只有 Ping/sql 才真正连接 DB
```

- gorm 反射 + gorm 标签映射 mysql 数据库；Users → users，UserName → user_name。

### 连接池

- `db.DB().Pool()` 获取原生 *sql.DB。

```go
// SetMaxOpenConns    数据库最大打开连接数
// SetMaxIdleConns    空闲连接最大数量
// SetConnMaxLifetime 连接最大存活时间
// SetConnMaxIdleTime 空闲连接最大闲置时长
```

### 模型定义

```go
type Model struct {
    ID        uint `gorm:"primarykey"` // 自增主键
    CreatedAt time.Time
    UpdatedAt time.Time
    DeletedAt gorm.DeletedAt `gorm:"index"`
}
```

### 自定义表名 / 忽略字段

```go
func (m Model) TableName() string { return "自定义表名" }
// 字段 gorm:"-" 忽略字段
// 字段传入 ""、0 等零值，不会使用数据库 default 值
// TableName 只是值方法，指针方法部分场景会失效
```

### 自动迁移

```go
db.AutoMigrate(&Model{})
// AutoMigrate 不会自动创建数据库，库要手动提前创建
// SkipDefaultTransaction 关闭默认事务
```

### 创建 / 保存

```go
db.Create(&user)   // 底层 Insert into ... Values ...
db.Save(&user)     // 主键 ID = 0 新增；ID > 0 查询后存在则 Update
// Save 多一条 select 查询，单纯新增不推荐 Save
db.Create(&[]User{}) // 批量创建
```

### 查询

```go
db.First(&dest, cond...)     // 查第一条，主键 Asc，找不到 ErrRecordNotFound
db.Take(&dest, cond...)      // 随机取一条，不在乎排序
db.Find(&destSlice, cond...) // 批量列表查询，分页查询一律用 Find
```

### Where / In / Omit / Limit / Offset / Distinct

```go
db.Where("username = ?", "zhangsan")
db.Where("username in ?", []string{"List", "wangou"}) // In 范围查询
db.Omit("Created_at, updated_at")   // 排除某些字段不查询
db.Limit(2)                         // 限制返回行数
db.Limit(每页条数).Offset((页码-1) * 每页) // 分页偏移
db.Distinct("字段1, 字段2").Select("字段1, 字段2") // 去重
```

- 链式调用是构造 sql 语句，只有调用 Find/Take/First 才发送 sql 到 mysql 执行。

### 删除 / 软删

- 物理删除：Delete()。
- 软删：更新 DeletedAt。

```go
// update 表 set deleted_at = 当前时间 where id = ?
// 查询追加条件 where deleted_at is null
// 恢复数据 Update("deleted_at", nil)
db.Order("字段1 desc, 字段2 asc")
```

### 事务 / Raw / Scope / Preload

```go
db.Raw(sqlStr, args...)  // 仅组装 sql
tx := db.Begin()         // 开启事务
tx.Commit(); tx.Rollback()
// MyISAM 引擎不支持事务，开启 Begin 无效，建表必须 InnoDB
db.Transaction(func(tx *gorm.DB) error) // 自动事务：错误自动回滚，panic/return error 自动回滚

db.Scopes(scopeFunc).Where(...).Find(&list) // Scope 封装通用查询逻辑
// Scope 本质 func(db *gorm.DB) *gorm.DB；带参 scope 必须用闭包返回该函数

db.Preload("...") // IN + 多条单表查询，批量查关联表数据，2 次 sql
```

- 简单 CURD 用 ORM 链式写法，复杂统计 + 连表用 Raw 原生 sql。

### N+1 问题

- MySQL 每个查询 N+1 问题：preload 一次性查关联数据，两条 sql 解决。

### 乐观锁 vs 悲观锁

- 乐观锁：无数据库锁，版本号机制，业务控制重试 `update ... where id = ? and version = ?`。
- 悲观锁：行锁锁定数据，事务内独占 `select ... for update`。
- 秒杀 + 抢购：乐观锁 + 有限重试。
- 强一致性：悲观锁 + 短事务。

### 覆盖索引 / 索引失效

- 覆盖索引：查询需要的全部字段都在索引树里，不需要回表读主键行数据，提升查询速度。
- 索引失效：`like '%xxx'` 左边百分号模糊查询，违背最左匹配原则，索引失效走全表扫描。

### mysql binlog

- mysql 未开启 binlog：从库查询不到刚写入的数据，临时走主库查询。

---

## 九、Redis 与缓存

### 为什么用 Redis，不直接用进程内本地缓存

1. 多实例数据不一致：服务多实例部署，本地缓存各自独立；Redis 全局统一。
2. 重启丢失：本地缓存重启数据丢失；Redis 支持 RDB/AOF 持久化。
3. OOM 风险：本地缓存膨胀占用进程内存；Redis 独立部署内存隔离。
4. 额外：Redis 支持过期淘汰、分布式锁、计数器等；本地缓存分布式能力弱。
- 缺点：Redis 要走网络 IO，比本地内存缓存慢。

### 布隆过滤器

- k 次哈希，置多个 bit 位为 1。
- 查询：全部 bit 为 1 才判定存在；有 0 一定不存在；存在误判，不支持删除。
- 位图：底层 bit，初始全 0；插入组件对 val 做 k 次哈希，分别对 k 个下标置 1。
- 查询：检查 k 个位置是否全 1；存在 0 一定不存在，全 1 可能存在（误判）。
- 删除：存在假阳性，不支持删除，无法清空 O(k)。
- 计数布隆：0/1 → bit 计数，额外存 0~k；删除对应下标 -1；某位置计数为 0 全置 0；支持删除，占用更多内存。

---

## 十、消息队列 MQ

### RabbitMQ 交换机类型

- direct：直连，队列绑定交换机时指定 routing-key，消息 routing-key 完全相等才能路由。
- topic：主题模式，通配符路由，`*` 匹配一个单词，`#` 匹配 0 个或多个单词。
- fanout：广播模式。
- headers：头部匹配。

### 至少一次投递

- 消息存储 + 重试机制。
- 客户端订阅记录每个订阅者的消息位点；服务推送消息后等客户端 Ack 应答；超时未收到 Ack 判定消息失败。
- 客户端返回 Ack 后，服务端更新消息位点不再重发。

### 消息持久化

- 消息 ID 作为数据库唯一 id；消息 ID + 消息 ID 作为 key 做分片，构建分片组建索引做消息查询。

### 可靠投递（ACK）

- 消费成功：手动 Ack，MQ 删除这条消息。
- 消费失败：Nack，消息重新入队重试。

### 重复消费如何解决

- 核心：业务实现幂等；数据库唯一索引是简单有效手段，重复请求不产生脏数据。

### outbox 发件箱模式（本地消息表）

1. 业务数据和消息记录同一个事务落库
2. 独立轮询任务扫描消息表，把消息投递到 MQ
3. 投递未确认则不断重试
- 用来解决分布式事务，保证「业务完成消息一定发出」。

### RPC vs MQ

- RPC：同步调用，等待对方返回。
- MQ：异步通信，发送之后不阻塞等待结果。

---

## 十一、架构与业务实战

### RPC vs HTTP

- RPC：二进制协议，protobuf 序列化；底层长连接池复用连接，减少 TCP 握手开销，性能更高。
- HTTP：基于 TCP，JSON 文本序列化，默认短连接。
- RPC 长连接 + 连接池，一次建立连接反复使用；JSON 文本格式；protobuf 紧凑二进制格式。

### JWT 双 Token

- AccessToken：过期时间短，放 header 里，前端每次请求都带上。
- RefreshToken：过期时间长，放 cookie 里，前端不需要每次请求都带。

### AST（抽象语法树）

- 抽象语法树 AST，源代码语法的一种表示。
- 静态单赋值：每个变量只被赋值一次。
- 复杂指令集：增加指令类型减少执行的指令数。
- 精简指令集：更少的指令类型完成目标的计算任务。

### 零拷贝

- sendfile：磁盘 → 内核 → 网卡，跳过用户态。
- mmap：内核缓冲区映射到用户空间，减少拷贝。
- dpdk：绕过内核，用户态直接驱动网卡。
- io_uring：异步 IO，SQ、CQ 完成队列，批量处理。

### 对象存储

- 以对象为最小单位存储数据，每个对象保存数据本体 + 元数据 + 唯一标识键值。
- S3 基于 HTTP/HTTPS 的对象存储，对外提供 http 协议接口；访问 http → 对象存储 bucket → 对象存储 object endpoint。

### 洋葱模型（gin 中间件）

```
先进入 大门 -> 保安 -> 小门
                      |
    大门 <- 保安 <----
```

### 设计模式

- 创建型：单例 + 工厂、建造者。
- 结构型：装饰器、gin 洋葱中间件。
- 行为型：观察者（事件发布订阅，一处修改多处响应）、策略（按热度/时间排序、多种支付方法）。

### 业务实战：支付

```go
type PaymentCreateReq struct {
    OrderID     string
    Channel     string // 支付渠道
    PayPassword string // 支付密码
}
```

- 使用 `shouldBindJSON` 读取序列化填充 req。
- Handler 处理 HTTP 相关事情：解析请求、组装入参、返回响应。
- svc.CreatePayment 先判空 + 加分布式锁，防止重复创建支付单。
- key：`lock:payment:order:订单号`，同一订单串行执行创建支付单逻辑（查询 + 判断 + 写入）。
- 风险：锁超时，锁会失效/过期。
- 控制支付使用 Gorm 本地事务 + select ... for update（悲观锁），保持数据一致性，防止重复创建支付单。
- 状态机：
  1. 已支付 → 直接返回支付单（幂等，重复请求不再次扣余额）
  2. 不是待支付状态 → 不能付款
  3. 创建支付单

### 业务实战：下单 / 秒杀 / ES

- 商品创建是 DB 事务同时插入商品 + outbox 事件记录。
- outbox publisher 就是 kafka 生产者，把 db 事件 → 消息队列；ES Consumer 是 kafka 消费者，收到事件同步数据给 ES。
- 商品创建 → Mysql → Publish → Kafka → Consumer → ES。
- HTTP 接口只做 [Redis 强扣库存 + 发消息] 快速响应；创建订单这种慢 IO 丢给 MQ 消费者异步执行。
- 秒杀分布式锁 key：用户 ID + 活动 ID，锁 3 秒防止重复提交；1 成功 / 0 售完（成功发消息到 MQ 强制建订单）/ -1 已买过。
- 下单：Redis 锁 → DB 事务（扣库存 + 建订单 + 清空购物车 + 写 outbox 表）→ rabbitMQ 延迟消息。
- 秒杀：令牌桶限流 → Redis 锁 → Lua 原子扣库存 → RabbitMQ 异步建单。

### outbox 轮询发布器

```go
func (p *Poller) Start(ctx context.Context) {
    ticker := time.NewTicker(p.Interval)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        default:
            p.publishOnce(ctx) // 一次拉取 limit 条消息
        }
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
        }
    }
}
```

### worker 模式

```go
func worker(in, out chan *Task) {
    for {
        t := <-in
        process(t)
        out <- t
    }
}
```

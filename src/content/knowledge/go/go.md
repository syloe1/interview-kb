## go 新手语法

### go的优势：

> 内存占用小
> 并发性能好
> 交叉编译部署简单

```Go
var a int = 10
var b = 20 //类型推导
c := 30 //短声明
```

- 无参无返回函数

```Go
func Hi() {
    println("no param no return")
}
```

- 有参有返回函数

```Go
func Add(a, b int) int {
    return a + b
}
```

- 多返回值函数

```Go
func div(a, b int) (int, error) {
    if b == 0 {
        return 0, errors.News("zero")
    }
    return a / b, nil
}
```

- 创建结构体

```Go
type Student struct {
    Name string
    Age int
}
o := Student{
    Name: "wk",
    Age: 18,
}
```

- 函数作为参数

```Go
func callback(y int, f func(int, int))
```

- 匿名函数可以赋值给某个变量

```Go
	f = func(x, y int) int {
		return x + y
	}
```

- 结构体方法 类似c++的成员函数

```Go
func (s Student) Study() {
    println(s.Name + " is studying")
}
```

> 接口: 规定必须做什么， 不规定怎么做。 接口只写方法名，参数，返回值。

```Go
type Animal interface {
    Speak() string
}
```

- 实现接口的函数， 就实现接口

```Go
type Dog struct {
    Name string
}
func (d Dog) Speak() string {
    return "bark"
}
type Cat struct {
    Name string
}
func (c Cat) Speak() string {
    return "meow"
}
```

- 函数可以是一个返回对象
- 工厂函数返回值是函数

## C++: 继承 + 虚函数实现多态

## Go: 接口实现多态

```Go
var x interface{}
所有类型都自动实现空接口
```

- iota 生成常量

```Go
const (
    a = iota
    b
    c
)
```

- 浅拷贝和原数据共用， 深拷贝和原数据独立

## goroutine

- go 关键字创建goroutine

```Go
1. 轻量 初始栈2kb， 线程栈大。 创建销毁开销大
2.  go runtime管理， 自动M:N调度，不用手动epoll/线程池 不是os管理。 用户态调度，没有内核切换。
3.  线程切换要陷入内核， G在P内部。用户态切换，上下文切换成本低。
4.  线程切换，CPU阻塞。GMP会剥离阻塞G, 复用P跑其他任务
5.  本地队列优先， 减少全局竞争
go func() {
    println("goroutine 1")
}()
```

## TLB （快表） 缓存

## CSP 并发模型： 用channel通信

go用通信方式共享内存， 用channel通信

```Go
chan struct{} 不占用内存空间
STW， 暂停程序去回收不用的内存


```

> 通信共享内存

```Go
ch := make(chan int)
ch <- 100 //发送
a := <-ch //接收
println(a)
```

## Slice切片， 动态数组， 长度可变

```Go
s := []int{1, 2, 3}
s := make([]int, 3)
s := make([]int, 3, 5) //容量为5， 长度为3

//追加
s = append(s, 6)

s := []int{1, 2, 3, 4, 5, 6}
//左闭右开
a := s[2:4] = [2, 3]
//
```

## OJ读数据

```Go
var n, k int
fmt.Scan(&n, &k)

a := make([]int, n)
for i := 0; i < n; i++ {
	fmt.scan(&a[i])
}
```

## map

```Go
type bmap struct {
	topchar [8] uint8 //每个key哈希高8位
	keys [8]key
	values [8]val
	overflow *bmap //溢出，桶链表
}
m := make(map[string]int)
m := map[string]int{
    "a": 1,
    "b": 2,
    "c": 3,
}
//查值
v, ok := m["a"]
if ok {
    println(v)
}
else {
    println("key not found")
}
//删除
delete(m, "a")
//for-rangge
for key, val := range mp

//只要遍历key
for key := range map
```

## defer验证执行， 函数结束前最后一刻执行

> 你走之前， 一定要关灯
> defer压栈， 后进先出
> 函数return前执行，执行panic了defer也会执行
> defer声明时立即对参数求职

## 闭包 = 1个函数能记住外部变量

## 创建go module

```Go
go mod init modulename
//更新依赖
go mod tidy
//添加依赖
go get github.com/gin-gonic/gin
```

## 命名决定访问权限， 大写开头为公开， 小写开头为私有

> 驼峰命名法：userName / UserName

```Go
type Student struct {
    Name string
    Age int
}
```

### 接口习惯er结尾，

### GMP模型：

- G -> 挂载到P -> P绑定M -> M执行G

```
1. 程序启动创建N个P
2. 创建M绑定P
3. P从本地队列/全局队列拿G, 放M上执行
4，G时间片用完/主动让出， P切走G,调度下一个G
```

> G 协程 M OS的线程 P 逻辑处理器
> G go func() ， G保存当前函数栈， 程序计数器PC, 寄存器， 退出状态
> G 栈初始化2kb， 自动扩容/缩容
> M 真正干活的
>
> - P持有G, M绑定P取G执行

```Go
	1. 创建协程 2. 协程进入P的本地队列 3. M绑定P
	4. M从P拿G运行 5. G阻塞， IO阻塞 M解绑P  P选另一个M执行
```

## 为什么go高并发

> 1. GMP调度 用户态
> 2. 协程开销小
> 3. 线程切换少

## 什么是窃取调度 ?

> 一个P的G跑完了， 会偷取其他P队列的G （一次偷一半）

## GC

Go内存管理 = 自动分配+ 自动回收

栈： 存小对象， 局部变量。 不用GC, 自动释放
堆： 存大对象， 逃逸变量。 要GC回收

内存看作房间， 有人用 = 存活对象， 没人用 = 垃圾， GC = 保洁
GC流程：1. 找： 谁还在使用内存 (标记) 2. 清: 把每人用的内存回收 (清除) 3. 给； 把干净内存给程序用 （分配）
GC对象：
白色未扫描，
灰色： 正在扫描
 黑色： 扫描完成， 存活

标记清除：
跟踪式垃圾收集器
标记： 从跟对象出发查找并标记堆存活的对象
清理： 遍历堆中的对象， 回收未被标记的垃圾对象并将回收的内存加入空闲链表
[白色] 潜在对象，内存可能被GC回收
[黑色] 活跃的对象， 包不存在任何引用外部指针的对象，从根对象可达对象
[灰色] 存在指向白色对象的指针， GC会扫描它们的子对象

### GC工作时

    根对象变灰，对灰色对象集合取出对象开始扫描，灰色集合中无对象， 标记阶段结束

```GC
1.标记
	暂停用户G, 初始化扫描根对象 (全局对象， 当前运行G栈， 寄存器)
	根对象置灰， 恢复用户G, 进入并发标记
2.并发标记
	 取出灰色对象， 标记为黑色
	 引用子对象白色标记为灰色
	 循环灰色对象直到没有
3.并发清除
	遍历堆，所有对象判定为垃圾
	并发回收内存， 归还到runtime内存池
	不阻塞业务协程
```

#### 为什么G阻塞chan不会浪费CPU

    > P脱离当前G, 调度其他G执行
    > G 遇到Go层面阻塞 chan, mutex, sleep， G切走放到阻塞队列 , P拿新G运行， 系统线程不阻塞，CPU不空闲
    > syscall阻塞,文件IO, 网络IO， M + G阻塞在内核， 与 p分离， p换新M ，继续执行其他G, syscall结束阻塞G，重新找P运行

两个阶段， 标记 - 清除

## 内存屏障一种屏障指令，让CPU或编译器在执行内存相关操作时遵循特定约束

### 混合写屏障， 让GC一边扫描， 一遍让用户代码改内存。

    STW = stop the world 暂停所有协程，让GC干活
    触发条件： 1. 达到内存阈值， 25%
     2. 定时清理

### 频繁GC -> Cpu高， 程序变慢

> solu: 1. 减少小对象的分配 2. sync.Pool复用对象 3. 减少逃逸， 不用逃逸到堆

## 什么是逃逸分析？

    go编译器自动判断 变量在栈 还是 堆

### 逃逸： 本来在栈上， 跑到堆上了

## Go map

底层是哈希表 + 链表 + 桶, 底层是hmap结构体， 数据存在桶里。
一个桶有8个kv, 用链表串起来

## 内存逃逸：

    > 1. 变量被返回指针
    > 2. 变量被闭包引用

## 关闭重复的Channel:

```Go
select监听多个channel, 多分支选择
select {
	case <- quit:
	default:
		close(p)
}
```

## time

```Go
time.After(d) 返回只读通道， 指定时间后自动发一个值
time.NewTicker(d)  周期性定时器
context协程链路取消， 超时控制， 函数调用链自上而下传递
ctx.Done() 返回以恶搞 <-chan struct{} 只读通道
```

## 序列化

- marshal 把go->json 二进制
- unmarshal 反序列化 把json-> go

## 表驱动测试

> 建立一张 测试表，所有用例在一张表， 加测试用例，只需要往切片里面加一行，不用复制粘贴

fmt.Printf()打印到控制台， 只输出不返回东西
fmt.Errorf生成一个Error对象， 用来抛异常， 返回错误

## HTTP vs RPC

- HTTP基于TCP, 格式Json
- RPC: 二进制序列化， 性能高
  > Rpc长连接 + 连接池， 一次建立连接反复使用
  > Json 文本格式
  > protobuf 紧凑二进制格式

## GC回收, 三色标记法 + 混合写屏障。

#### STW 停止所有用户协程

GC触发： 堆内存达到GC阈值， 手动调用runtime.GC()

    并发GC， STW极短，不用手动管理内存

先定位在优化， tool : pprof看内存， cpu, 协程， 锁， 阻塞

### 协程泄露， 协程创建了不退出

    > solu: 控制G数量， 用Channel退出

### 内存泄露， 长生命周期持有短生命周期对象

    > solu: 对象复用sync.Pool

### 锁范围尽量小

### Atomic

```Go
atomic.Addint32
	  .LoadInt32
	  .Store32()
	  .CompareAndSwap
无锁， 线程安全， 极高性能
```

## sync.Mutex

有正常解， 正常遵循FIFO获取锁，竞争抢不到->饥饿模式

## 自旋

    一种多线程同步机制，当前进程进入自旋一直占用CPU, 互斥锁只有普通模式才能进入自旋

## context从顶层的goroutine一层一层传递下去

contexte.WithCancel从context衍生一个新上下文， 返回用于取消该上下文的函数

执行返回的取消函数， 当前上下文及子上下文都会取消， 所有goroutine同步顺序取消信号

锁保证多个goroutine访问同一片内存时不会出现竞争条件

```Go
|等待的goroutine|饥饿|awaken唤醒的数量|locked|
默认互斥锁状态是0, int32不同位数
不同状态， mutexlocked锁定状态
		  mutexWoken 唤醒
		  starving 进入解状态


饥饿模式， 锁给等待队列最前面的goroutine, 新的goroutine只等待， 不自旋

type Mutex struct {
	State uint32 //当前锁状态
	sema uint32  //控制锁状态信号量
}
```

## CAS

> 先比较在交换， 原子操作，靠CPU原子指令
> 只能保证单个变量安全， 失效要循环重试 (自旋)

### 互斥锁：

抢不到锁, 线程睡眠， 让出CPU -> sync.Mutex

### 自旋锁： 一直循环， CPU旋转

### 悲观锁： 一直有人和我竞争， 先加锁后操作

### 乐观锁： 先做， 后检查 例子： CAS

## Channel

> 底层基于队列实现， 并发安全。

- 无缓冲 vs 有缓冲
- 无缓冲像 别人给你饭菜， 你不接就会掉在地方，所以要等你。 同步阻塞。
- 有缓冲像 快递柜， 你放里， 别人有空去拿。 异步阻塞。

> 给关闭channel发data -> panic
> 关闭后读channel -> 返回 0 + false
> 关闭 已经关闭的channel -> panic
> 关闭nil -> panic

```Go
a := make(chan int)
a := make(chan int, 3)
```

## sync.WaitGroup()等待协程组

```Go
Add 计数 + 1
Done() 计数 - 1
Wait() 阻塞， 直到计数器为0
for i := 0; i < 5; i++ {
	wg.Add(1)
	go func() {}(i)
	wg.Wait()
}
Add在goroutine内部， 主循环直接wait，
```

## sync.Map

```Go
read只读层， 原子操作， 读起快
dirty层(带锁）新增/修改数据存在这里
Load 查询 ， 先查read层， 命中直接返回，
		未命中加锁查dirty
```

### sync.RWMutex写锁会阻塞读锁吗 ？

> 写操作优先防止读无限抢占导致写饥饿

## 函数

#### 前后缀

```Go
HasPrefix(s, prefix string) bool{}
//查后缀
HasSuffix(s, suffix string) bool{}
//包含字符串
Contains(s, substr string) bool{}
//找第一个字符的位置
Index(s, str string) int
//最后位置
LastIndex(s, str string) int
//字符串替换
Replace(str, old, newstr, n) string
n = -1 全部替换old
//统计字符串次数
count(s, str string) int
//重复字符串中, n次s拼接
Repeat(s, count) string
//字符改大小
ToLower(s) , ToUpper(s)
//修建字符串
TrimSpace(s) 去除头尾空的符号
Trim(s, “子串”）
TrimLeft ， TrimRight
//分隔字符串
Fields() 返回一个Slice
//按照定义 scp去切割
Split（s, scp)
//拼接字符串
Join(s []string, scp)
//获取当前时间
time.Now()
//变长参数 (...type)
//函数计时
start := time.Now()
end := time.Now()
delta = end.Sub(start)

time.Since(start) == time.Now().Sub(start)
```

## 字符串拼接Buffer

```Go
var buffer bytes.Buffer
buffer.WriteString(s) 把S追加到后面
用buffer.String()转换成String

追加切片y到x
x = append(x,y...)
```

## sync.Once

> once.Do确保只做一次

```Go
type Once struct {
	done uint32
	m    Mutex
}

func (o *Once) Do(f func()) {
	// ✅ 先原子读done，如果已经执行过，直接返回
	if atomic.LoadUint32(&o.done) == 1 {
		return
	}
	o.doSlow(f)
}

func (o *Once) doSlow(f func()) {
	o.m.Lock()
	defer o.m.Unlock()
	// 拿到锁之后，再二次检查done（防止多个goroutine进入doSlow）
	if o.done == 0 {
		defer atomic.StoreUint32(&o.done, 1) // ⭐执行完f之后，才把done置1
		f()
	}
}

var once sync.Once
once.Do(func() {})
保证代码只执行一次

```

## 日志级别

> logger:silent静默
> Error只打印错误sql
> Warn 只打印错误 + 慢sql
> info: 全部sql打印

## make

```Go
func make([]T, len, cap)
new(T) 为每个数T分配一片内存， 初始化为0

make(T)返回一个类型为T初始值，
```

## thread vs goroutine

> 线程由OS管理， 重，慢， 数量有限。
> 协程由Go管理， 轻，快， 大量并发。
> 协程遇到IO自动让出， 不卡住线程

### runtime.GoMAXPROCS(n)

> 最多有n个 M执行用户goroutine

## Array vs Slice

> Array 静态， 固定长度， 值传递
> Slice动态， 引用底层数组， 引用传递。

```Go
// runtime/slice.go
type slice struct {
	array unsafe.Pointer // 指向底层数组的指针
	len   int            // 切片长度，可访问元素数量
	cap   int            // 切片容量，底层数组总可用元素
}
//append时len > cap， 就扩容。 原容量 < 256, new = 2倍
```

## Slice扩容

1. 先创建更大底层数组
2. 旧data复制过去
3. slice.ptr指向新数组

   > 切片截取共用 底层数组， 扩容不再共用数组

## gorm

> 使用gorm安装 gorm.io/gorm , gorm.io/driver/mysql

- 拼接DSN, 用户名:密码@tcp(IP:Port)/数据库名？parseTime=True&loc=Local

### gorm的DB.Pool() 获取原生 \*sql.DB

```Go
 //setMaxOpenConns 数据库最大打开连接数
 //setMaxidleConns() 空闲连接最大数量
 //setConnMaxLifetime 连接最大存活时机
 //SetConnMaxIdleTime 空闲连接最大闲置时长
 db, err := gorm.Open(mysql.open(dsn), &gorm.Config{})
 gorm.Open只有构造句柄， 不会创建TCP连接， 只有Ping/sql才会真正连接DB
 gorm 反射 + gorm标签映射mysql数据库
 Users->Users. UserName->user_name

 type Model struct{
    ID uint `gorm:"primarykey"` //自增主键
    createdAt time.Time
    updateAt time.Time
    DeletedAt gorm.DeleteAt 'gorm:"index"'
 }

```

### gorm自定义表名 忽略字段 `gorm:"-"`

```Go
func() TableName() string{
	return ""
}
// 字段传入“”， 0等零值， 不会使用数据库defalt值
TableName只是值方法， 指针方法部分场景会失效

```

## 自动迁移

```Go
func (db *DB) AutoMigrate(dst ...interface{}) error {
	db.AutoMigrate(&model{})
	//AutoMigrate不会自动创建数据库， 库要手动提前创建
	//	SkipDefaultTransaction关闭默认事务
}
```

## 创建

```Go
func(db * DB) Create(dst interface{}) (tx *DB) {
	底层 Insert into __  Values ___
}
```

## Save保存

```Go
func (db *DB) Save(dest interface{}) (tx *DB){
	主键ID = 0, insert新增
	ID > 0 根据ID查询数据
	       存在则Update更新
}
```

多一条select查询， 单纯新增不推荐Save

### 批量创建Create

```Go
db.Create(&[]User{})
```

### 查第一条数据, 主键Asc,找不到ErrRecordNotFound

```Go
db.First(&dest, cond..) *gorm.DB
```

## 随机取一条，不在乎排序

```Go
db.Take(&dest, cond...) *gorm.DB
```

### 批量列表查询， 分页查询一律用Find

```Go
db.Find(&destSlice, cond....) *gorm.DB
```

## Where

```Go
Where("username in ?", "zhangsan")
```

## In范围查询

```Go
Where("username in ?", []string{"List", "wangou"})
```

## Omit排除某些字段不查询 Omit("Created_at, updated_at")

## Limit(2) 限制返回行号

## 链式调用是构造sql语句，只有调用Find/Take/Find才发送sql到mysql执行

## 物理删除

> Delete()
> 软删， 更新DeletedAt

```Go
update 表 set deleted_at = 当前时间 where id = ?
//查询追加条件 where deleted_at is null字段

Delete(value interface{}. cond ... interface{}) *gorm.DB
//恢复数据 Update("deleted_at", nil)

db.Order("字段1 desc， 字段2 asc")
```

## 简单CURD用ORM链式写法， 复杂统计 + 连表 用 Raw原生sql

## 偏移offset

```Go
db.Limit(每页条数).offset((页码-1) * 每页)
```

## Distinct去重

```Go
db.Distinct("字段1 字段2").Select("字段1 字段2")
db.Raw(sqlStr, args...) *gorm.DB 仅组装Sql


tx := db.Begin() //开启事务
tx.Commit() tx.RollBack()


MylSAM引擎不支持事务， 开启Begin无效， 见表必须InnoDB

Scope本质 func(db *gorm.DB) *gorm.DB 封装通用查询逻辑db.Scope()注入
db.Scopes(scopeFunc).Where(__).Find(&list)

带参scope必须用闭包返回func (db *gorm.DB) *gorm.DB

//自动事务
db.transaction(func (tx *gorm.DB) error)


Preload IN + 多条单表查询
IN 批量查关联表数据， 2 次sql

乐观锁： 无数据库锁， 版本号与机制， 业务控制重试 update .... where id = ?
悲观锁： 行锁锁定数据， 事务内独占 select ... for update

秒杀 + 抢购： 乐观锁 + 有限重试
强一致性： 悲观锁 + 短事务



```

## mysql未开启binlog

> 从库查询不到刚写入的数据， 临时走主库查询

支付请求
type PaymentCreateReq struct {
OrderID
Channel //支付渠道
PayPassWord //支付密码
}

使用shoudlBindJSON读取序列化填充req
Handler处理HTTP相关事情， 解析请求， 组装入参， 返回响应
svc.CreatePayment(service.CreatePaymentInput{
UserId,
OrderID,
Channel,
PayPassword
})

先是一些判空， 加分布式锁， 防止重复创建支付单

key: lock:payment:order:订单号
同一订单， 串行执行创建支付单逻辑， 查询 + 判断 + 写入
风险：
锁超时， 锁会失效/过期

控制支付使用Gorm本地事务 + select ... for update //悲观锁
保持数据一致性，防止重复创建支付单

状态机： 1.已支付-> 直接返回支付单， 幂等， 重复请求不会再次扣余额 2. 不是待支付状态-> 不能付款 3. 创建支付单

创建商品是DB事务同时插入商品 + outbox事件记录
go run xx.go 就是一个进程， worker / main.go里面有outbox轮询发布器， 一轮询outbox表， 读到消息就发到Kafka
func(p \*...) Start(ctx context.Context) {
ticker := timer.NewTicker(p.Interval)
defer ticker.Stop()
for {
select {
case <-ctx.Done():
return
default:
p.publish.once(ctx) //一次拉取limit条消息
}
select {
case <-ctx.Done():
return
case <-ticker.C:
//触发第二个select退出
}
}
}

ES消费同一个Kafka topic,更新ES, 前端搜索查询ES

outbox publisher就是kafka生产者， 把db事件->消息队列
ES Consumer是kafka消费者， 收到事件同步数据给es

HTTP接口只做 [redis强扣库存 + 发消息] 快速响应
创建订单这种慢IO, 丢给MQ消费者异步执行

商品创建-> Mysql->Publish->Kafka->Consumer->ES

秒杀分布式锁key: 用户ID + 活动ID
锁3秒， 防止重复提交1. 成功
0 售完 成功了发消息到MQ,强制建订单
-1 已买过

## JWT双Token

AccessToken: 过期时间短，放在header里，前端每次请求都带上A
RefreshToken: 过期时间长，放在cookie里，前端不需要每次请求都带上R

## 抽象语法树AST, 源代码语法的一种表示

静态单赋值： 每个变量只被赋值一次
复杂指令集： 增加指令类型减少执行的指令数
精简指令集： 更少的指令类型完成目标的计算任务

## 数组是一快连续的内存

```Go

type slice struct {
	Data unsafe.Pointer //指向底层数组
	len int
	cap int
}

```

## context.Deadline返回context被取消的事件

Done返回一个channel, 在当前工作完成 / 上下文被取消后关闭， 多次调用返回同一个Channel

## Context的作用是在不同goroutine之间同步请求待定数据， 取消信号及处理请求的截止日期

Go 用 channels 去同步协程，协程阻塞时其他协程会继续在其他 M 上工作。

`runtime.Gosched()` 让出处理器，允许运行其他的协程。
`GOMAXPROCS` M:P 的操作系统线程数。
协程可以通过调用 `runtime.Goexit` 停止。

channel 管道，协程之间的通信。

```
var identifier chan datatype // 通道只能传递一种类型的数据
ch <- int    // 向通道发送
int2 := <-ch // 通道接收
```

无缓冲通道会阻塞等待。
无缓冲通道是各个协程同步的关键点。
`select{}` 多数阻塞点上在背后就是一个 select {}。

```
v, ok := <- ch  // 判断有没有有效阻塞
time.After(2 * time.Second) // 等待两秒
t := time.NewTimer(3 * time.Second)
<-t.C // 触发
t.Stop() // 停止
```

循环定时 ticker

```
ticker := time.NewTicker(1 * time.Second)
```

旧 oop：

```Go
Lock()
// 临界任务
Unlock()
```

for 从 pending通道拿任务，处理后放到 done 通道

```Go
func worker(in, out chan *Task) {
	for {
		t := <-in
		process(t)
		out <- t
	}
}
```

## Future 模式，使用某个值前，要先对它进行计算。

开发一个计算密集型， 用Futures设计接口。
静态库: 通过静态链接生成的二进制
文件包含全部的依赖，所以能够独立执行
动态库可以在多个执行文件之间共享，减少内存的占用。

动态链接的机制可以为我们提供更多的灵活性
主程序可在编译后动态加载共享库， 实现热插拔的插件系统。

Linux 的共享对象使用 ELF 格式并提供一组操作动态链接器的接口

```Go
go build -buildmode=plugin //编译插件得到一个.so文件
```

编译插件得到一个 so 文件
加载 so 文件：`plugin.Open`，执行 `plugin.Lookup`

线程缓存分配器，用于分配内存的机制。比 libc 中的 malloc 还要快得多
本线程对象大小将对象分为小对象、中对象、大对象。

---

Go 内存管理：用户程序，分配器，收集器

用户申请内存时，通过内存分配器
申请新内存，分配器去做初始化。

线性分配器，维护一个指向内存特定位置的指针，修改指针位置，返回指针

无法利用被回收的内存，空闲链表分配器， 遍历空闲的内存块， 找到足够大的内存， 申请新资源并修改链表

空闲链表来分配内存，遍布空闲的内存块，找到足够大的内存，切割新内存并修改链表。

|     |           |
| --- | --------- |
| 微  | 0，16B    |
| 小  | 16，32B   |
| 大  | 32B，+100 |

nginx port:8888
web 端口：3333

下单：Redis锁 -> DB事务(扣库存 + 建订单 + 清空购物车 + 写outbox表) -> rabbitMQ 延迟消息
秒杀： 令牌桶限流 -> Redis锁->Lua原子扣库存 -> RabbitMQ异步建单
ch
Map 的装载因子 >0.65，触发扩容，正序扩容搬移数据
渐进式迁移，每次访问 map，迁移 2 个旧桶到新桶

sync.Map 底层分两套存储，read 天然无锁读缓存
dirty：存放新增修改 key
读出现过期，主动遍历链表，时间复杂度 O (n)

内存逃逸：栈内存分配，在堆上分配，解决闭包上的行为
栈空间返回指针

---

### 洋葱模型：

    先进入大门->保安->小门 ---
                              |
    大门 <---	保安	<----

## Gorm 的自动事务：

Transaction 函数错误自动回滚，panic/return error 自动回滚

MySQL 用户每个查询 N+1问题:
preload一次性查关联数据，两条sql

Map 的装载因子 >0.65，触发扩容，正序扩容搬移数据
渐进式迁移，每次访问 map，迁移 2 个旧桶到新桶

sync.Map 底层分两套存储，read 天然无锁读缓存
dirty：存放新增修改 key

读出现过期，主动遍历链表，时间复杂度→O (n)

内存逃逸：栈内存分配，在堆上分配，解决闭包上的行为
甚至栈返回指针

## 设计模式：

    创建型： 单例 + 工厂， 建造者
    结构型： 装饰器， gin洋葱中间件
    行为型：
    观察者： 事件发布订阅， 一处修改多处响应
    策略： 按热度/时间排序， 多种支付方法

## 多级缓存

线程缓存、中心缓存、堆页堆

流程图：

```
Thread        Thread        Thread
    ↓             ↓             ↓
Thread cache  Thread cache  Thread cache
    ↘️          ↙️
      central cache
            ↓
     page       heap
```

表格

| spans | bitmap | arena |
| ----- | ------ | ----- |
| 512MB | 16GB   | 512GB |

spans 存储指向 `runtime.mspan` 指针
每个内存单元会管理 N 的内存空间，
每页大小为 8KB

bitmap 标记area哪些地址保存第项， 位图中的每个字节表示堆区中的32自己二愉快
位图中的每个字节表示对应 64 的 2 个指针占用

---

arena 区域地址，运行时将 8k 看作一页
对位这一个 地址， 用 arena 做地址映射
所有页数通过 spans 数组获取， 管理该片内存的管理单元runtimespan.

一个 runtime.mspan 结构

内存管理组件：

- 内存管理单元：`runtime.mspan`
- 线程缓存：`runtime.mcache`
- 中心缓存：`runtime.mcentral`
- 堆：`runtime.mheap`

线程缓存负责 微对象和小对象快速分配
中心缓存用于 全局堆结构体， 会从os中申请内存mcache 每个线程独立结构体，
从 OS 申请内存

每个 runtime.mspan 会多个 pages，每个 8KB 页面。

G：协程，保存任务栈、函数、寄存器等，由 Go 运行时管理
M：操作系统内核线程，一个 M 对应 OS 线程
P：逻辑处理器，持有运行 G 所需要的资源（运行时上级，本地队列，缓存），没有 M 不能执行 G

P、M = 执行单元，M 绑定 P 才能运行 G

M 不去销毁底层 OS 线程，反复复用，阻塞，切换。G 执行的时候不直接操作 OS 线程。

M 绑定 P → P 本地队列取 G 执行 → G 阻塞 / 时间片耗尽 → 让出 P → M 继续执行可运行 G

无缓冲 chan 数据不落地存储，只在两个协程之间拷贝。

底层 hchan 结构体
recvq：接收协程等待队列
sendq：发送协程等待队列

互斥锁 mutex：
|wait等待协程计数|协程唤醒|1 加锁 0 未加锁|
`waiter`、`locker`
1 加锁态
1 饥饿态
0 未加锁

**加锁**：CAS 将 locker 置 1，成功获取锁
自旋等待锁释放
自旋失败休眠，waiter +1
G 进入等待队列，调用`runtime.Gosched()`让出 M P

**解锁**：CAS 清除 lock 位
若等待 G，唤醒 `woken:=1`
不唤醒 G，直到 CAS 抢锁，抢不到继续休眠。

## RWMutex 读写锁共享、写锁互斥

写饥饿：大量读协程不断获取读锁，写协程一直无法拿到写锁，永久阻塞

写请求插队 + 读锁抢占机制
1° 写协程发起写锁请求，不允许新的读协程获取读锁；
等所有写锁释放
2° 加写锁执行
3° 写锁释放，放行排队的读协程

## RabbitMQ 交换机类型

- direct：直连
- topic：主题模式
- fanout：广播模式
- headers：头部匹配

direct：队列绑定交换机时指定 routing‑key，消息 routing‑key 完全相等才能路由

topic：通配符路由模式
`*`匹配一个单词
`#`匹配 0 个或多个单词
通过 routing‑key，按通配符进行路由匹配

## 至少‑一次投递

消息存储 + 重试机制
客户端订阅，记录每个订阅者的消息位点
服务推送消息后，等客户端 Ack 应答
超时未收到 Ack，连接断开，判定消息失败

客户端返回 Ack 后，服务端更新消息位点，不再重发

## 消息持久化

消息 ID 做为数据库唯一‑id (子)
消息 ID + 消息 ID 做为 key 做分片，构建分片，组建索引，做消息查询



## 缓冲区是环形队列， 容量N,len当前元素个数

## 发送 ch

1° 缓冲区没满，直接写入 buf，发送立即返回，不阻塞
2° 缓冲区满了，goroutine send 阻塞，等缓冲区空出来

## 接收

1° 缓冲区有数据，直接取出队首元素，返回
2° 缓冲区空，当前 goroutine 入 recv 阻塞，等待发送数据

buf 的目的：**解耦生产者‑消费者，生产者可以批量发一批数据， 不同等消费者实时接收

## 关闭

`close(ch)` 关闭

1° 标记 `closed = true`

2° 唤醒阻塞在 recv 的接收协程，接收返回零值 + `ok: false`

3° 唤醒阻塞在 send 的发送协程，发送会直接 `panic`

通道关闭代表生产结束，不会再有新数据，继续发送直接报错。

`select`同时监听多个 channel 的收发事件，哪个事件就绪就走哪个
**每个 case，只能有一个**

## `sync.Mutex`互斥锁，同一时间只能一个 goroutine 持有该锁，其他全部阻塞。

底层：自旋 + 信号量，先自旋自抢，高竞争才休眠。
`Unlock`未持有锁去`Unlock`：panic。
同一个 goroutine 重复`Lock`：死锁。

## `sync.RWMutex` 读锁 ，读放行， 写阻塞, 写锁： 读写都阻塞。
- 读锁期间，新写请求会阻塞（防止写饥饿）

## `sync.Once` 仅执行一次
底层模型：
`done uint32` 原子变量标记已经执行完毕
`m mutex` 互斥锁

每一次调用`once.Do(f)`：
先做一次原子读 → `done=1` → 直接返回
后续 do 原子判断`done==1`直接返回

```
once.Do(func(){})
```

`sync.Pool`
减少 GC 开销，复用短期临时对象
底层：每个 P 私有，有缓存，全局共享链表，GC 时清空池内所有对象


## `WithValue` 内部单链表， 每个节点存Key-Value + 父ctx

取消传播原理：
1° 树状结构，父持有所有子 ctx
2° 取消事件自上往下广播
3° `Done()` 返回 只读channel，channel 关闭后， 所有阻塞读立即返回零值，用于协程监听
4° Err () 只有 Done 关闭后 返回非 nil，区分手动超时还是取消

# 无缓冲 Channel（buf = nil）

发送：`ch <- x`

1. 没有正在等待的接收 goroutine：当前 G 进入 send 等待队列，**阻塞**
2. 已经存在等待的 recv G：直接把数据拷贝给接收 G，发送、接收双方 goroutine 全部唤醒

# channel 内部核心结构

表格

| 成员 | 含义 |
| --- | --- |
| 缓冲数组 | 仅**有缓冲 channel**存在；无缓冲 channel 该字段为 nil |
| send waitq | 发送协程等待队列，保存阻塞等待发送的 G 链表 |
| recv waitq | 接收协程等待队列，保存阻塞等待接收的 G 链表 |
| waitq | 等待队列，挂载被阻塞的 goroutine |
| uint32 计数 | 引用 / 元素计数 |
| elemType | channel 里面存放元素的类型 |
| close | 通道关闭标记 |


### 为什么用 Redis，不直接用进程内本地缓存

1. **多实例数据不一致**：服务多实例部署，每个实例本地缓存各自独立，数据会出现差异。Redis 是全局统一缓存，所有服务实例共用一套。
2. **重启丢失**：本地进程内存缓存，服务重启之后数据全部丢失；Redis 支持 RDB/AOF 持久化，数据落盘。
3. **OOM 风险**：本地缓存膨胀会占用服务进程内存，容易引发 OOM；Redis 独立部署，内存隔离。
4. 额外补充：Redis 支持过期淘汰、分布式锁、计数器等丰富能力；本地缓存做分布式场景能力弱。

缺点：Redis 要走网络 IO，比本地内存缓存慢。


1. **RPC vs MQ**
RPC：同步调用，等待对方返回；
MQ：异步通信，发送之后不阻塞等待结果。
2. MQ 可靠投递（ACK 机制）

- 消费成功：手动`Ack`，MQ 删除这条消息
- 消费失败：`Nack`，消息重新入队重试

3. **消息重复消费如何解决**
核心：**业务实现幂等**；数据库唯一索引是简单有效的手段，重复请求不会产生脏数据。
4. Outbox 发件箱模式（本地消息表）
1）业务数据和消息记录，**同一个事务落库**；
2）独立轮询任务扫描消息表，把消息投递到 MQ；
3）投递未确认则不断重试；
用来解决分布式事务，保证 “业务完成消息一定发出”。 v



## `RPC vs HTTP`

- RPC：二进制协议，protobuf 序列化；底层长连接池复用连接，减少 TCP 握手开销，性能更高。
- HTTP：JSON 文本序列化，默认短连接。

2. **MySQL 覆盖索引**
查询需要的全部字段都存在索引树里面，不需要回表读取主键对应的行数据，提升查询速度。
3. **索引失效场景**`like '%xxx'` 左边百分号模糊查询，违背**最左匹配原则**，索引失效走全表扫描。


## goroutine 栈可以扩栈，
不是 OS 固定栈，Go 运行时在堆上申请的，可自由移动的连续内存，
所以可以随时扩栈、缩栈。

怎么扩栈？

1. Go 申请一块更大的内存
2. 把旧栈数据拷贝至过大栈
3. 更新栈指针 sp
4. 销毁旧栈

Go 使用**连续栈机制**，不链表栈，栈上效率高。

栈怎么缩容？
Go 周期性检查，栈使用率低，释放多余内存空间


## 零拷贝方案：
`sendfile`：磁盘 → 内核 → 网卡，跳过用户态
`mmap`：内核缓冲区映射到用户空间，减少拷贝
`dpdk`：绕过内核，用户态直接驱动网卡
`io‑uring`：异步 IO，SQ、CQ 完成队列，批量处理

对象存储：
以对象为最小单位存储数据，每个对象保存数据本地
元数据 + 唯一标识键值

S3 基于 HTTP/HTTPS 的对象存储，对外提供 http 协议接口
访问 http → 对象存储 bucket → 对象存储 object endpoint

goroutine 抢占式协程，遇到调度机会就会让出点
自主抢占 + 自动调度 + 数等并发模型

goroutine 初始栈大小：2KB
goroutine 栈在堆上，由 Go runtime 管理


### ° 普通系统调用：

1. 当前 G 处于 running，发起阻塞系统调用
2. M 与 P 拆分，M 带着 G 进入内核阻塞
3. P 寻找空闲 M 或者新建 M，继续调度其它就绪 G

此时老 M，进入内核当中。
4. syscall 返回，M 尝试继续执行 G

> 
> 返回中 G 回到 runq 队列，变为 runnable

time.Sleep：runtime 将其加入定时器堆，将 G 变为 blocked
G 调用 Sleep 后，P 调度其他任务
M 被释放给 P，定时器堆到期唤醒该 G，转变为 runnable，等待调度

### sync 锁调用：

G 加锁失败，进入锁的等待队列
runtime 将 G 状态置为 blocked，
M 将释放回 P，P 调度下一个就绪 G

其他 G 释放锁时，唤醒等待队列，唤醒 G
唤醒后 G → runnable，加入运行队列

右侧状态流转：
running → 执行完 → terminated，G 被回收
running → blocked 被挂起



## 内核态线程：由 OS 内核全权管理它的执行单元，调度、切换,资源分配都在内核这完成

## 用户态协程：运行在用户态，由语言、三方库自行调度的轻量执行单元

## goroutine 什么时候会被挂起？
```Go
挂起的 G 进入等待队列，满足条件后被唤醒

1° 阻塞系统调用的时候
2° 抢占时间片用完后被挂起
3° 手动 Gosched () 后被挂起

挂起时：
1° 保存当前 goroutine 的上下文（寄存器、栈指针）
2° goroutine 从运行态 → 等待态
3° 让出 M，让 M 去执行其他 goroutine

恢复时：
1° 等待条件满足
2° goroutine 从等待状态 → 运行状态
3° 放回运行队列
4° 被 M 调度时，恢复上下文，继续执行
```

## goroutine：让出 CPU，不再执行，等待被唤醒

1. **主动挂起（遇到阻塞操作的，G 运行被剥夺 goroutine 挂起，不占 CPU）**
   1. **主动让出（手动调用 runtime.Gosched ()）** 让出 CPU
   2. **被动挂起**：一个 goroutine 占用 CPU 太久，运行时调度把它挂起


goroutine：让出 CPU，不再执行，等待被唤醒

1. **主动挂起（遇到阻塞操作的，G 运行被剥夺 goroutine 挂起，不占 CPU）**
   1. **主动让出（手动调用 runtime.Gosched ()）** 让出 CPU
   2. **被动挂起**：一个 goroutine 占用 CPU 太久，运行时调度把它挂起

## 面试精简

goroutine 挂起分两类：

1. **主动挂起**

- IO 阻塞、锁等待，goroutine 进入 wait 状态，释放 CPU；
- 手动调用`runtime.Gosched()`主动让出 CPU。

2. **被动抢占挂起**
goroutine 长时间占用 CPU，运行时抢占调度，强制剥夺 CPU，将 G 挂起。

> 
> 注意：协程挂起是**用户态 runtime 完成**，不触发操作系统线程切换。


select 底层实现：
随机伪轮询，多路格式分支生成，阻塞等待
过 runtime 调度，不依赖内核，阻塞时会复用 M 执行其他 G

调度流程：
1° M 绑定 P
2° 执行 runq/local queue 的 G
3° G 执行、挂起、退出
4° M 切换 G
5° P 偷其他 P 中的 G
6° 系统调用时 M 与 P 拆分

P 的数量 = GOMAXPROCS

P 的本地 G 队列，工作窃取
1° 先查本全局 G 队列
2° 窃取其他 P 的

---

位图：底层 bit，初始全部 0
插入组件，对 val 做 k 哈希，分别
对 k 个下标置 1

查询：
检查 k 个位置上是否全 1，
存在 0，一定不存在
全为 1，可能存在（存在误判）

删除：存在假阳性，不支持删除，无法清空 O (k)

计数布隆：
0/1 → bit 计数，额外存 0~k
删除对应之下标 -1
到达某个位置计数为 0，全置 0


### M‑P‑G 调度工作窃取

1. M 绑定 P，优先跑 P 本地 runq 队列 goroutine
2. 本地无 G，从其他 P 偷 goroutine（工作窃取）
3. syscall 系统调用，M 与 P 拆分，P 交给别的 M 继续干活

### 布隆过滤器

- k 次哈希，置多个 bit 位为 1
- 查询：全部 bit 为 1 才判定存在；有 0 一定不存在；**存在误判，不支持删除**
- 计数布隆过滤器：每个位置存计数，支持删除，占用更多内存。
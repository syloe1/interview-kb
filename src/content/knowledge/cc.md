可变参数模板

```cpp
template<typename Middlewares>
模板函数template<uint64_t Tag>
Tag编译期根据URL算出数字， 实现高性能路由
万能引用T&&, 完美转发 std::forward

一个线程安全的class:
    1. 多线程同时访问时，表现正确的行为
    2. 无论os怎么调度线程， 不需要额外的同步
```

野指针： 未初始化的指针
悬空指针： 指向已经销毁的对象或已经回收的地址

## 多线程

```Cpp
thread t1(func, 100)绑定函数 + 传参数
thread t(类::成员函数， 对象地址， 参数)
lock_guard<mutex> lg(mtx)
-----------------
具体类

unique_lock<mutex>
wait()//阻塞
notify_one()// 唤醒一个线程
//让当前线程睡
this_thread::sleep_for(chrono::seconds(1));
//让出CPU
this_thread::yield()
//获取线程ID
this_thread::get_id()
```

## 死锁

1. 互斥条件
2. 请求并保持
3. 不可剥夺
4. 循环等待

## 进程，

独立地址空间， 资源隔离， 线程共享地址空间

## IPC

不同进程之间数据传送， 同步协作

```
1. 管道
2. 信号
3. 消息队列
4. 共享内存
5. 信号量
6. 内存映射

```

## 用户分区

用户区： 代码， 堆，栈， 库文件
内核区： 内核代码， 页表， 缓冲区

## 栈 vs 堆

栈： 堆：
OS管理 手动管理
自动分配 手动分配

shared_ptr强引用， 只要有一个指向x对象的shared_ptr存在，
该x对象就不会被析构
weak_ptr不控制对象的生命周期， 对象在活，lock升级成shared_ptr, 失败nullptr

### CAS抢锁

```cpp
if (!locked_.exchange(true, std::memory_order_acquire))
    this_thread::yield(); //让出CPU, 防自旋占核心
```

锁禁止拷贝，移动。 不然锁会失效。
C++有局部对象自动生命周期规则， 栈上局部变量生命周期严格绑定当前作用域
进入 {} 自动构造， 离开 {} 自动析构

explicit禁止单参数的隐式转换
noexcept告诉编译器， 这个函数绝对不会C++异常. 移动构造不写noexcept, 编译器保险使用拷贝构造
[[nodiscard]] 不能丢弃返回值， 否则编译器给出警告

cas读变量旧值，把变量强写， 返回修改前的旧值

## cpp 内存序列

> 内存序给原子操作加屏障规则， 限制CPU,寄存器不随便打乱读写顺序

- memory_order_relaxed宽松， 只保证原子自身读写有序， 无跨线程同步屏障
- memory_order_acquire 获取锁用
- memory_order_release 释放锁用

```cpp
void unlock() noexcept {
    locked_.store(false, std::memory_order_release)
    locked_.load(memory_order_acquire)
    locked_.exchange(true, std::memory_order_acquire)
}
```

alignas(64) 内存对齐修饰符
CPU读任意变量， 把它所在的连续64字节整数拉进缓存

```cpp
                      //可变参数模板
template <typename T, typename ...Args>
Args&& args既能接收左值， 也能接收右值
forward<Args>(args) 保留参数原本值类别
传左值-> 转发左值， 触发拷贝构造
传右值-> 转发右值， 触发移动构造
forward<Args>(args) 展开=  forward<int>(arg1)forward<string>(arg2)...
```

### 条件变量

```cpp
cond_wait(lck, if(条件)) 释放锁， 同时立即等待
1. 调用`wait(lk, pred)`：**先判断谓词`pred`**
   - 如果`pred()==true`：不等待，直接往下走，**不释放锁**
   - 如果`pred()==false`：
   ① **自动释放 mutex 锁**
   ② 线程陷入阻塞睡眠，等待条件变量通知
2. 收到`notify_one() / notify_all()`唤醒信号，线程从睡眠苏醒1. 收到`notify_one() / notify_all()`唤醒信号，线程从睡眠苏醒
3. **重新去竞争获取 mutex 锁**（不一定立刻拿到锁！）
4. ✨拿到锁之后**再次检查条件**！
   - 条件成立 → wait 返回，继续执行后面代码
   - 条件不成立 → 再次释放锁，继续睡
```

### 生产者-消费者模型

producer 能放数据就生产
consumer 有数据就消费

明确同步条件， 状态机模型

## 写一个基类， 禁止拷贝,允许移动

```cpp
class noncopyable {
public:
  noncopyable() = default;
  ~noncopyable() = default;

  noncopyable(const noncopyable &) = delete;
  noncopyable &operator=(const noncopyable &) = delete;

  noncopyable(noncopyable &&) = default;
  noncopyable &operator=(noncopyable &&) = default;
};
::inet_ntop使用全局c库函数，不是类内函数

socket封装socket相关系统调用，管理fd生命周期，禁止拷贝， 支持移动。 通过继承noncopyable类实现
socket可以设置 地址复用/端口复用/关闭Nagle算法小包直发/TCP保活
关闭写半连接
```

## socket半关闭为什么关闭写半连接 ？

> TCP是全双工， 关闭写半连接， 不再发数据，但可以读数据
> 场景上传数据完成， 等待接收对端返回结果。

## tinywebserver

```cpp
time() 获取时间戳
localtime() 转本地年月日时分秒
fflush() 刷新缓冲区
fclose() 关闭旧文件

sprintf() 安全格式化字符串， 限制长度
Mysql连接池， Mysql连接要先TCP3次握手 + 认证握手， 池化减少开销
链表 + 定时器管理。 有序升序定时器链表
一个连接一个定时器： {    fd ，
                        Port  + IP，
                        定时器
                    }
消费者HTTP工作线程拿连接
生产者： 线程用完归来
RAII自动回收类， 自动归还数据库连接， 防止资源泄露
内核资源禁止拷贝， 否则重复释放， 野指针， 死锁，程序崩溃
cond.wait() 释放锁， 资源-1
信号异步中断， 无法在epoll监听管道转发信号

fcntl(file_fd, 操作数， 参数)
F_GETFL读当前fd的flag(阻塞/非阻塞， 读写模型)
O_NONBLOCK非阻塞标记
F_SETFL把修改后的flag设置回fd
epoll_ctl( //epoll_ctl(epollfd, EPOLL_CTL_ADD, fd, &event)
    epoll_fd,
    操作类型，
    客户端fd,
    事件结构体
)
EPOLL_CTL_DEL 删除fd
EPOLL_CTL_ADD 把fd添加到epoll监听池
消除public的config, 通过只读接口去获取数据

EPOLLIN 有可读事件   EPOLLET 边缘触发ET EPOLLRDHUP TCP对端关闭, 提前收到断开事件， 不用read返回0才会断开
sock_STREM 流式套接字TCP
sock_DGRAM = udp数据报
so_linger延迟关闭行为

pthread_create(tid, 栈属性，入口函数， 参数) 创建工作线程， 第3个参数必须是静态函数 static void* worker(void *arg)
pthread_detach(tid)线程分离， 退出自动释放资源， 不用手动pthread_join()

send(fd, 缓冲区指针， 字节长度， MSG_NOSIGNAL)
TCP客户端已关闭连接， 服务端用send写数据

内核触发sigpipe, 强杀服务器进程
alarm(n) n秒后产生Sigalrm， 只会触发一次信号
sa_flags是信号行为标记为，sa_restart 如果信号打断read/epoll_wait/write 这种阻塞系统调用，调用会重新执行
sigfillset() 把信号加入屏蔽集， 在sig_handler写信号时， 所有新信号阻塞排队
```

## preactor主线程负责全部IO读写

    主线程epoll（完成read/write, 线程池只做纯CPU业务, request->process)

## Reactor 主线程完成IO读写， IO下放给线程池

state = 0 读事件， 线程用read_once() 读请求报文
state = 1 写事件， 线程用write向客户端返回
读写IO不阻塞主线程， 用 pthread_join(子线程id, \_\_) 原线程休眠， 等子线程跑完才往下走

### 一个线程只能被pthread_join调用一次

proactor模式， 主线程前完成IO, 不区分读写事件
void _ 是万能指针， 所有类型都能转换成void _

HTTP服务程序， 依靠epoll监听TCP连接， 线程池分担业务压力，定时器清理闲置死连接， 同时支持同步/异步日志记录，
两种IO并发模型Reactor和 Proactor.
通过m_actor_model区分， 1是Reactor 0是Proactor

```cpp
            threadpool
webserver   timer链表     epoll  |  监听fd新连接
            mysql连接池          |  管道信号
                                 |  客户端fd
                            HTTP_CONN 解析请求 + 响应
```

### 为什么用epoll而不是accept + read循环

> 传统做法是一个连接一个线程。
> IO多路复用，一个连接监听多个fd, 处理就绪的

### 切换线程

> CPU时钟中断强制切线程， 保存现场，恢复另一个线程现场
> 通用寄存器存入TCB中， PC下一条执行代码地址
> TCP在内核内存， 用户态-> 内核态切换
> 恢复： 恢复页表， 栈指针， PC计数器

## epoll监听多个fd

- 只处理就绪的哪些。
  http_conn一个连接一对象， 状态机解析HTTP, 处理完用mmap零拷贝
- Proactor: 主线程read完数据 -> 工作线程： 纯业务处理
- Reactor： 只通知有数据可读 -> 工作线程： 自己read () + 业务处理

如果断网， TCP报文发不过来，服务端fd泄露, 每个连接绑定一个定时器
SIGALRM -> 通知epoll -> timer_handler（） -> tick清理到期节点 -> cb_func()关闭fd

### 智能指针： 一旦某对象不再被引用， 系统立即回收内存

> 自动管理堆内存， 出作用域自动释放，防止内存泄露
> 本质： RAII思想

### 手写UniquePtr智能指针

```cpp
#include <cstddef>

template <typename T> class Unique_ptr {
private:
  T *_ptr = nullptr;

public:
  // 构造，explicit防止隐式转换
  explicit Unique_ptr(T *p = nullptr) noexcept : _ptr(p) {}

  // 禁止拷贝构造、拷贝赋值
  Unique_ptr(const Unique_ptr &) = delete;
  Unique_ptr &operator=(const Unique_ptr &) = delete;

  // 移动构造：接管资源，源置空
  Unique_ptr(Unique_ptr &&other) noexcept {
    _ptr = other._ptr;
    other._ptr = nullptr;
  }

  // 移动赋值
  Unique_ptr &operator=(Unique_ptr &&other) noexcept {
    // 处理自移动：this == &other
    if (this == &other) {
      return *this;
    }
    // 释放当前旧资源
    delete _ptr;
    // 接管对方指针
    _ptr = other._ptr;
    other._ptr = nullptr;
    return *this;
  }

  // 析构：释放资源
  ~Unique_ptr() noexcept {
    delete _ptr; // delete nullptr 是安全合法
  }

  // 解引用
  T &operator*() const noexcept {
    return *_ptr; // 使用者保证不为空，空指针解引用UB，同标准库行为
  }

  // 箭头
  T *operator->() const noexcept { return _ptr; }

  // 辅助接口：release / reset，标准unique_ptr常用接口
  T *release() noexcept {
    T *tmp = _ptr;
    _ptr = nullptr;
    return tmp;
  }

  void reset(T *p = nullptr) noexcept {
    delete _ptr;
    _ptr = p;
  }

  // 获取裸指针
  T *get() const noexcept { return _ptr; }
};

```

### 手写UniquePtr智能指针

```Cpp
#include <iostream>
template <typename T>
class SharedPtr {
private:
    T* _ptr;
    int* _refCount;

public:
    // 构造函数
    explicit SharedPtr(T* ptr = nullptr)
        : _ptr(ptr), _refCount(new int(1)) {}

    // 拷贝构造：共享资源，引用计数+1
    SharedPtr(const SharedPtr<T>& other) {
        _ptr = other._ptr;
        _refCount = other._refCount;
        ++(*_refCount);
    }

    // 拷贝赋值重载
    SharedPtr<T>& operator=(const SharedPtr<T>& other) {
        if (this == &other) return *this; // 自赋值保护

        // 先释放当前对象旧资源
        release();

        // 接管新资源
        _ptr = other._ptr;
        _refCount = other._refCount;
        ++(*_refCount);
        return *this;
    }

    // 析构函数
    ~SharedPtr() {
        release();
    }

    void release() {
        if (_refCount == nullptr) return;

        --(*_refCount);
        if (*_refCount == 0) {
            delete _ptr;
            delete _refCount;
            _ptr = nullptr;
            _refCount = nullptr;
        }
    }

    T& operator*() const { return *_ptr; }
    T* operator->() const { return _ptr; }

    // 获取引用计数，方便调试
    int getRefCount() const {
        return _refCount ? *_refCount : 0;
    }
};

```

## RAII栈对象管理堆资源， 出栈自动释放，

- Join 主线程等待子线程执行完毕，再往下走，资源自动回收
- detach() 后台独立执行， 主线程不等待， 线程资源给系统回收
- 一个线程只能Join / detach一次
  std::async创建异步任务, 强制新建线程执行
  std::launch::defered 延迟调用， get时才运行

## 类名 <模板函数> 变量名 (管理的锁)

- std::mutex mtx;
- std::lock_guard<std::mutex> lg(mtx)

栈区: 局部变量， 函数参数， 自动销毁， 生命周期随函数
堆区： new/malloc开辟， 手动释放， 全局生命周期

普通构造， 定义对象直接调用
拷贝构造， 对象赋值初始化，函数值传参， 函数返回对象
移动构造： 临时对象赋值， move转移资源
析构函数： 对象生命周期结束， 自动调用

## 基类析构与虚析构， 防止派生类内存泄露

多态： 同一接口， 不同实现
静态多态： 编译器确定， 函数重载，模板性能高
动态多态： 运行时根据对象真实类型决定调用

版本： 存在继承关系
基类声明virtual虚函数
通过基类指针调用函数
虚函数表： 基类一张虚表， 子类重写虚函数， 替换成子类函数地址
虚指针： 每个实例对象头部都多一个vptr, 指向当前类的虚表

1. 基类指针找对象地址， 取vptr
2. vptr对应虚表，取函数地址并调用

构造函数不能是virtual ?
构造时对象类初始化， vptr没设置， 不能查虚表

多态: 父类指针/引用指向子对象， 调用子类的重写方法
虚函数： 表vtable, 每个含虚函数的类存一张虚函数表， 存虚函数地址
动态绑定： 运行时查表确定调用函数， 编译不确定

## 继承

- 多继承： 成员名冲突， 冗余数据
- 菱形继承： 二义性，数据冗余
  solu: 虚继承virtual继承，只保留一个父类数据

## 虚表

- 虚表存放所有函数地址， 运行时查表调用

## 静态绑定： 编译时确定

## 动态绑定， 运行确定

## 接口

- 纯虚函数 + 抽象基类， 无法实例化， 用于定义接口
  | 虚函数 | 纯虚函数 |
  |----|----|
  |virtual 函数实现| virtual 函数 == 0实现|
  | 扩展已有功能 | 定义接口规范|

## C++ STL的 stack 是通用模板， 要适合各种场景， 不能只用普通数组

## Const

> const对象: 只能调用const成员函数
> const int a 常量不可改
> const int \*p 指针指向内容不可改
> int \* const p 指向地址不可改

## vector

- 扩容: 1-2-4
- 扩容开辟新内存， 拷贝元素， 释放旧内存
- 动态堆内存

## array

- 固定栈大小， 栈内存

## list双向链表

- 头尾插入O(1)
- 不支持随机访问，遍历慢

## map 红黑树 O(logn)

- 有序 稳定 遍历有序

## unordered_map O(1)

- 拉链法解决哈希冲突， 同一桶下冲突的键值对挂在单链表上。
- 无序，查询极快， 哈希冲突

## set: 红黑树有序去重

## unordered_set 哈希表无序去重

## 静态库 vs 动态库

- 静态库： .lib编译打包进程序, 体积大， 无需依赖
- 动态库： dll运行时加载，体积小可以热更新

## C++线程创建

```cpp
std::thread 直接创建线程， 手动Join / detach (Join阻塞主线程)
std::async异步任务， 自动管理线程
```

## C++线程同步

> 锁， 原子变量， 条件变量， 信号量
> 物理地址： PA, 主板上真实内存条的地址编号，硬件唯一能识别的地址
> 虚拟地址： Va, 每个进程独有的地址空间， 进程代码只认识 虚拟代码
> CPU内存管理单元MMU + 页表完成

## 分页

> 为什么要分页， 进程虚拟地址互不干扰， 一个进程崩溃不影响其他进程
> 虚拟空间块: 虚拟表
> 4KB=2^12 地址低12位是页内偏移， 高位是页号
> 虚拟页号 + 页内偏移 = 任意虚拟地址

## 页表： OS为每个进程维护一个页表， 放在物理内存

页表条目PTE: 虚拟页号 -> 物理页号映射关系

```
1. 进程拿指令， 给出VA(虚拟地址)
2. CPU拆分， 页号 + 页内偏移
3. 虚拟页号查当前进程页表， 得物理页号
4. 偏移 = 物理页号 + 物理地址
```

## 快表TLB:

cpu内部高速缓存， 缓存常用页表加速地址翻译， 减少访问次数

```
CPU查询TLB
        --> 命中 -> 取物理页号->拼位移，访问PA
        --> 缺失 -> 查内存页表->更新TLB ->拼位移，访问PA

线程|进程 切换导致TLB失效， 刷新重建TLB存虚拟页号 -> 物理页号映射

同进程中线程切换： TLB不要整体刷新， 仅需要换栈， 寄存器， PC(程序计数器)

不同进程之间切换： 地址空间编号->TLB强制失效，刷新
互斥锁： 加锁失效，让出CPU进入睡眠
锁释放后， OS唤醒阻塞线程，阻塞 + 上下文切换， 内核参与
自旋锁： 加锁失效， 不放CPU，原地等待，反复轮询, (原地自旋， 占用CPU)
无上下文切换， 纯用户态/原子操作轮询
```

```cpp
1. 互斥锁std::mutex mtx;
void func() {
  mtx.Lock();
  // process
  mtx.Unlock();
}
2. 自动锁 lock_guard出作用域自动解锁 std::lock_guard<std::mutex> lg(mtx);
3. unique_lock支持手动解锁， 延迟上锁，条件变量搭配 std::unique_lock<std::mutex>
    v(mtx);
v.Unlock();
v.Lock();

4. 条件变量 : 线程等待 + 唤醒, 实现生产者消费者， std::mutex _mtx;
std::condition_variable ov;
bool flag = false;

```

## 等待线程

```cpp
void wait_thd() {
  std::unique_lock<std::mutex> vl(mtx);
  // 等待flag为true防止虚假唤醒
  cv.wait(vl, [] { return flag });
}
//唤醒线程
void notify_thd() {
  std::lock_guard<std::mutex> lg(mtx);
  flag = true;
  cv.notify_one();
  cv.notify_all();
  唤醒全部
}
```

## 读写锁 std::shared_mutex

> 读共享， 写独占。 多读同时进， 写独占阻塞所有
> shared_lock<shared_mutex> sh(rw-mtx);
> unique_lock<shared_mutex> ul(rw-mtx);

## lock_guard作用域锁，不可手动解锁， 轻量

## unique_lock函数支持解锁，转移所有权

- 加锁: 互斥，占有且等待，不可剥夺， 循环不等待
  notify_one 一定会唤醒吗 ？> 不是，存在虚假唤醒，wait必须加判断条件
  malloc/free只分配内存， 不调用构造/析构
  new/delete: 分配内存 + 自动调用构造析构函数
  new失败返回 异常， malloc失败返回null

## 指针独立变量， 存内存地址， 占418字节

引用：无独立内存， 依附原变量， 不占用额外空间

## 内存泄露： 不用裸指针， 优先智能指针

## unique_ptr(独占智能指针) 独占所有权， 同一时刻只能一个指针持有

- 一块内存只能被一个unique_ptr持有
- 禁止拷贝， 支持移动 move
- 线程不安全

## shared_ptr(共享智能指针) 共享所有权， 引用计数管理生命周期

`shared_ptr` 引用计数 + 控制块实现共享所有权，指向对象的裸指针
`shared_ptr` 引用计数属于原子操作，
计数增减使用 `memory_order_relaxed`，保证原子性，不做指令重排。
`shared_ptr` 原子撤销基于 CPU 原子指令完成

> 计数为0自动释放内存
> 线程计数安全， 对象访问不安全
> 引用计数本身原子操作， 计数安全
> 指向对象访问不安全， 多线程同时读写对象要加锁

## weak_ptr 弱引用， 不增加引用计数

> 不能直接引用， 必须lock换成shared_ptr
> 专门解决shared_ptr循环引用

## 野指针： 未初始化随机指向非法内存

且空： 指向内存已释放， 指针还保留旧地址

## 指针可空， 可二次赋值， 可多级指针

> 指针直接解引用\*， 引用编译器自动处理

## std::move是强制类型转换， 把任意左值 -> 右值引用T&&, 真正资源移动是移动构造完成的

```cpp
[&] / [this] 存指针
[=] / [*this] 值拷贝
左值: 有名字， 能取地址的变量
     string s = "abc"
右值: 临时变量， 不能取地址
    string("cmp")
    string&& tt = string("xxx") //右值引用只能绑定到右值

拷贝构造： string(const string&) 深拷贝
移动构造： string(T&&) 只转移堆指针， 不拷贝内存
```

## 模板编译期多态， 对每种类型生成一份独立代码。

- 模板不是可编译代码， 只是一套代码生成规则
- 基类构造时， 子类还没构造， 虚表指针指向基类虚表
- 子类析构先执行， 销毁子类，需制作切回基类虚表

## 虚函数： 运行时多态，动态多态， 对象带虚指针，指向其的虚表，运行时查表跳转

## STL容器：

- 序列式容器： 底层线性结构vector， deque , list, array
- 关联式容器： 底层红黑树 map set
- 无序关联式容器：哈希， unordered_map, unordered_set
- 容器适配器： Stack， queue基于deque
  Priority_queue基于Vector

## 互斥锁， 完全互斥， 同时间只允许一个线程进入临界区

`Logger → EventLoop → ThreadPool → Router`
`Acceptor‑>loop.Run()`

event‑loop
回调函数 `typedef EventCallback = function<void(int fd, uint32_t events)>`

注册、析构，禁止拷贝
`AddFd, ModFd, RemoveFd`
绑定回调函数
`setCallback(int fd, EventCallback cb)`

封装 read、write 函数
`Run(), Stop(), IsRun()`
`epoll‑wait` 最多 1024 个待就绪事件

内部派发函数
`void dispatch(int fd, uint32_t events)`
收到就绪轮询后事件统一分发

fd 两个哈希表：`fd → Callback` 哈希表
`epoll‑create1(EPOLL_CLOEXEC)` 创建 epoll

---

`epoll‑ctl(epfd, op, fd, ev)`

`EPOLL_CTL_ADD`：把 fd 加入 epoll 监听

```
epoll_event ev{ };
ev.events = events;
ev.data.fd = fd;
```

`EPOLL_CTL_MOD` 修改 fd 监听事件
`EPOLL_CTL_DEL` 删除 epoll 内的 fd

`close(epoll‑fd)` 释放 epoll 资源

`epoll‑wait(epfd, buffer, maxevents, timeout)`
‑1：永久阻塞；0：非阻塞；>0：定时返回

EPOLLIN 可读，EPOLLOUT 可写，EPOLLERR 错误

epoll 水平 / 边缘模式

Reactor 单线程 IO 模型：一个 EventLoop 一个 epoll
主线程 `epoll‑wait` 将事件分发给处理 fd
耗时业务逻辑丢给线程池，绝不阻塞

`epoll‑wait` 协程分发，TCP 连接，读写事件，系统调用这些 fd，交给回调处理

## tcp‑connection.h

继承 `enable_shared_from_this` 文件内部继承，**自身智能指针**

`enum class State`（连接：建立、读写、关闭）
构造、析构，禁用拷贝

事件回调：`onReadable()`, `onWritable()`

epoll 可读时调用，读取客户端 HTTP 数据；
发送缓冲区满阻塞，`onWritable` 可写时间调用，继续发送响应。

成员：fd、State
连接超时管理：`SetTimeout`

- `Touch`：刷新上次接触时间
- `IsTimeout`：判断是否超时

私有方法：请求、响应、关闭、flush 缓冲区，设置非阻塞函数。

成员 fd，归属 Reactor，业务状态。
读写管理，用于连接收发，缓存。
超时属性，最后一次读写时间点，长连接存活记录。

---

`fcntl(fd, F_GETFL,0)` 获取 fd 状态
`fcntl(fd, F_SETFL, flags | O_NONBLOCK,0)`
设置为非阻塞 IO

close 原子退出 fd 置‑1 有效，防止重复。
原子标记状态`closed`，epoll 移除 fd。
`state_.store(closed, memory_order_release)`

## acceptor.h Tcp 接收器

构造、析构，禁止拷贝，启动监听。
注册回调，获取 socket 端口。

私有：主事件循环、线程池、端口、fd。
监听 socket，绑定端口，调用 listen，epoll 注册监听 fd。
有新连接 accept 生成 fd，创建`TcpConnection`，扔进 epoll。

```
fd = socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
```

`SOCK_CLOEXEC`：执行子进程时自动关闭 fd，防止 fd 泄露。

`SO_REUSEADDR` 端口复用。
`accept4`系统调用直接返回新连接 fd 并且直接设置 O_NONBLOCK，不需要额外 fcntl 设置非阻塞。

## Async_socket.h 底层 Reactor 异步 IO

Socket 读写的时候，阻塞主协程，挂起协程，fd 回调 epoll 事件后再恢复协程继续

`await_ready`：协程立刻执行 true，继续；不挂起，false 挂起协程，进入`await_suspend`

`await_suspend(coroutine_handle<> h)`：协程挂起，保存协程句柄，注册 epoll 事件

`await_resume()`：事件被触发后执行，返回给 co‑await

`function<HttpResponse(const HttpRequest&)>`
接收`const HttpRequest`返回`HttpResponse`

`unordered‑map<string, Handler> routes`
存储路径，处理函数

```
template <typename HttpHandler F>
void register(std::string_view url, F handler)
{
    routes[std::string(url)] = forward<F>(handler);
}
```

建立好路由之后，交给路由处理函数，接收`const HttpRequest`，返回`HttpResponse`

```
template <typename F>
concept TaskCallable = invocable<F> && same‑as<invoke‑result‑t<F>, void>;
```

下层协程任务为 void 类型，提交之后丢给任务

```
template <TaskCallable F>
void submit(F&& task)
{
    std::lock_guard lock(mutex_);
    tasks.push(forward<F>(task));
}
semaphore_.release(); // 唤醒一个工作线程
```

## 跳表

第0层原始有序数据链表
第1层： 每隔若干抽一个做索引
第2层： 在第一层基础上继续抽做索引

- 实现比红黑树简单
- 天然有序，范围遍历友好
- 插入删除修改局部指针

## B+树 多路平衡查找树， 把磁盘随机IO压到最后

- B树所有节点存储索引键 + 完整数据
  查找可能在非叶子节点中， 范围查询需要中序遍历整棵树
  B+树： 非叶子节点， 只有索引键 + 子节点指针
  叶子： 存储全量数据， 用双链表串联所有叶子

有界， 无界阻塞队列。 有界限流， 消息队列

封装线程本地存储 TLS，使用`__thread`缓存 tid、线程名、tid 字符串，避免进程内频繁调用系统调用`gettid()`；每个线程持有独立变量。

inline 函数：消除函数调用开销。
`__builtin_expect`：编译器分支预测优化；TLD 中已经缓存参数。
syscall 会陷入内核，开销大；TLS 做缓存，一次链式引用即可读取该表。

`__thread`：声明每个线程独有的变量。

```
typedef void (*thread_func)(void *)
```

线程启动、调度运行时，从 TLD 中获取线程上下文，用于标识各个线程。
posix 线程 id：在内核同一个进程内有效，跨进程会重复。
`pid_t`轻量级线程 ID，在`pthread_self()->tld`中保存全局唯一标识，访问取值一致。

子线程可以访问父线程 TLS；fork 之后会复制 TLS。
pthread 入口函数仅接收单个`void*`参数，因此需要把所有传递给子线程的数据打包到结构体。

fork 只会复制调用 fork 的当前线程，子线程的 TLS 缓存会失效；需要注册`pthread_atfork`，重置`t-cached Tld`，修复缓存内容。

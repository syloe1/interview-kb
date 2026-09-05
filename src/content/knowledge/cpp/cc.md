## 内存序
```Cpp
多线程就是 acquire /release， 单线程是 relaxed 

acquire是读操作， release是写操作
relaxed是单线程使用， 不需要同步

 //acquire读操作
    //只要本次load读到别的线程release / store写入的指针， 该release store之前的所有写操作， 对当前线程全部可见
 //relaxed对这个atomic变量本身的读写是原子的， CPU可以随意重排这个load前后的指令
```
## c++ 20 requires约束
template <typename F>
requires std::invocable<F>
- `template<typename F>`：模板，F 代表你传进来的可调用对象类型（lambda、函数指针、std::function 都可以）
- `requires std::invocable<F>`：**编译期约束**
`std::invocable<F>` 判断：`F()` 能不能直接调用（无参调用）
如果传进去一个不能直接调用的类型，编译直接报错，而不是等到运行期崩。

auto enqueue(F &&f) -> std::future<std::invoke_result_t<F>>

- `F&& f`：**万能引用**，可以接收左值、右值；配合后面`std::forward`完美转发，保留值类别
- `std::invoke_result_t<F>`：编译期推导：调用`F()`之后的返回值类型
例：`F是 [](){return 42;}` → `invoke_result_t` = `int`
- 返回值：`std::future<ReturnType>`，future 用来等待任务、拿返回值

```
auto task = std::make_shared<std::packaged_task<ReturnType()>>(std::forward<F>(f));
```

- `std::packaged_task<ReturnType()>`：包装一个无参函数，函数执行完之后，**保存返回值到内部共享状态**，供 future 读取。
- `std::forward<F>(f)`：完美转发，把外面传入的任务`f`（lambda / 函数）原封不动传给 packaged_task，保留左 / 右值属性。
- `std::make_shared`：创建**shared_ptr**管理这个 packaged_task。
`task` 的类型是 `std::shared_ptr<std::packaged_task<ReturnType()>>`。

> 
> 一句话：把用户传入的任务打包，放到堆上，用 shared_ptr 管理生命周期。


## 可变参数模板

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

## 1. std::unique_lockstd::mutex lock(mutex_);

- 和 `lock_guard` 类似：构造时上锁。
- **区别：unique_lock 支持 unlock/relock，可以交给 cv.wait 使用，lock_guard 不行。**
条件变量 wait 必须传入`unique_lock`，因为 wait 内部需要临时释放锁。

## 2. cv_.wait (lock, 谓词 lambda)

`cv.wait(lock, pred)` 等价于下面这个循环（库内部帮你写好）：

```Cpp
while (!pred()) {
    cv.wait(lock);
}
1. 持有锁进入 wait
2. **自动调用 lock.unlock ()，释放 mutex，线程阻塞休眠**（别的线程可以 enqueue、操作队列）
3. 收到 notify_one /notify_all 唤醒，线程醒来，**自动 lock.lock () 重新拿到锁**
4. 执行谓词`pred()`
   - pred 返回 false：继续回到 wait 休眠（这就是处理**虚假唤醒**）
   - pred 返回 true：wait 函数返回，继续往下跑代码
```

1. `mutable std::shared_mutex mutex_`

- `std::shared_mutex`：读写锁。两种锁模式
  - **shared 共享锁**：多个读线程可以同时持有（读 - 读并行）
  - **exclusive 独占锁**：写线程持有；持有独占锁时，其他读、写全部阻塞


  - **放在循环里重试 → 优先用 `compare_exchange_weak`**：性能更好，就算假性失败，循环重试即可。无锁栈 / 链表 push 几乎全是 weak。
- **不在循环里，只尝试一次 CAS → 必须用 `compare_exchange_strong`**：不能接受假性失败。


- CAS：无锁，并发高的时候性能好；
- mutex 互斥锁：有锁，并发会串行排队，简单好写。

```Cpp
std::vector<std::thread> threads;
int thread_num = 50;
// 循环1：创建50个子线程
for (int i = 0; i < thread_num; ++i)
//std::thread( 函数名, 参数1, 参数2, ... )
  threads.push_back(std::thread(append_node, i));

// 循环2：等待全部子线程结束
for (auto &th : threads)
  th.join();

```
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

## `template<>` 是空模板参数列表，代表全特化
模板全特化的威力：**对某一个特定类型，重写整个类**。
```Cpp

// 2. 类模板
template <typename T>
class Container
{
private:
  T data;

public:
  Container(T value) : data(value) {}

  T get_data() const { return data; }

  void set_data(T value) { data = value; }
};

// 3. 模板特化 - 为std::string类型提供特殊实现
template <>
class Container<std::string>
{
private:
  std::string data;

public:
  Container(std::string value) : data(value) {}

  std::string get_data() const { return data; }

  void set_data(std::string value) { data = value; }

  // 字符串类型特有的方法
  std::size_t length() const { return data.length(); }
};


- `typename... Args`：**参数包**，可以打包任意数量、同调用推导体系的类型
- `Args... args`：`args` 是一包参数；`args...` 叫**解包**，把包里参数展开传给下一次 sum

**SFINAE：模板参数替换失败 ≠ 编译报错，只是把这个候选函数删掉，继续尝试匹配别的重载。**
`std::enable_if` 是实现 SFINAE 最经典的工具。
```

`inline` 主要意图就是建议编译器：把函数体直接嵌入到调用位置，省去函数调用压栈、跳转、返回的开销

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

epoll：fd 为核心，所有连接与事件要注册进去

io‑uring：异步内核，内核对 fd/accept、recv、send、close 做系统调用，做提交

生命周期：init、destory 析构

SQ 提交队列：SQE 任务提交：
`prep‑accept()`
‑`recv()`
‑`send()`
‑`close`

`io_uring` 构造异步 io 任务

任务提交：`submit/submit‑and‑wait` 把任务发给内核执行

CQE 事件收到：`peek‑cqe`、`cqe‑seen` 拿到执行结果，释放 CQE

静态数据绑定：
`sqe‑set‑data`
`cqe‑get‑data` 绑定连接上下文，回调拿到该值
`cqe‑get‑res`

epoll：监听 fd，注册事件，事件来了调用`accept()`

io‑uring：直接往内核提交`accept`任务，内核有新连接进来自动通知

```
struct io_uring {
    // SQ提交队列
    // CQ完成队列
    // flage 主结构体
    // rg-fd文件描述符
    // feature 位掩码
}
```

任务提交: submit / submit-and-wait把任务发给内核执行
CQE事件收割: peek_cqe, cqe_seen 等IO执行结束， 释放CQ槽

epoll: 监听fd，注册读事件，事件来了同步accept()
io_uring：直接异步提交accept任务， 有私有连接进来 自动完成

用户填充 SQE → SQ 环形队列 → submit 交给内核 →
内核执行完 → 把 user_data，执行结果放 CQE 返回给用户态

SQE 提交队列：一个 SQE 代表一条交给内核执行的异步 IO 任务

CQE 完成队列，内核填充完 SQE 对应异步 IO 的生成，
一手 CQE 放入 CQE 环形队列

io‑uring_queue_init，ret=0 成功，SQ/CQE 初始化成功
ret < 0，失败

`get_sqe` 返回一个 `io_uring_sqe`

prepare 往 `io_uring_get_sqe()` 里面：
`io_uring_prep_accept`
`‑recv`
`‑send`
`‑close`

返回 SQE

调用 wait，等待 `wait‑nr` 个 CQE 完成才解除阻塞
`

## io_uring 底层 Syscall

`io_uring_queue_init()` 创建 SQ/CQ 环形缓冲区

`io_uring_get_sqe()` 从 SQ 队列拿一个空闲 SQE

`io_uring_prep_accept()` 往 SQE 中填充 `IORING_OP_ACCEPT`
‑`recv()`         `IORING_OP_RECV`
‑`send()`         `OP_SEND`
‑`close()`         `OP_CLOSE`

`io_uring_submit()` 把 SQ 队列的 SQE 一次性给内核

`io_uring_submit_and_wait()`，提交 + 阻塞等待 nr CQE 完成

`io_uring_queue_exit()` 释放 io_uring 的所有映射内存

`io_uring_peek_cqe()` 非阻塞拿 CQ 里一个完成的条目

`cqe_seen()` 将该 CQE 标记清楚，释放 CQE 槽位

`sqe_set_data` 在 SQE 上挂一个 void\*，CQE 上能拿到指针（回调）
`cqe_get_data` 取回之前挂的指针

io_uring engine流程
①`get_sqe()`拿到 sqe，`sqe_set_data`挂上上下文指针
②`submit_and_wait()`，提交 SQ + 阻塞等 CQE
③`peek_cqe()` 收到完成的 CQE
④`cqe_get_data()`拿上下文指针；`cqe_get_res()`拿返回码
⑤`cqe_seen`标记已处理完

http_conn.cc 的 process

**epoll 流程**
`epoll‑wait()` 端口可读 → recv 读 http 请求 → 解析 → send 返回响应

epoll
↓
`epoll‑wait`
fd 可读
↓
`recv` 内核拷贝数据
↓
parse http 请求
↓
`epoll‑ctl()`写
↓
继续 `epoll‑wait`
↓
`writev(非阻塞)` 发送
↓
`epoll‑ctl(mod)`
继续等待

**io‑uring 流程**
submit & `[recv]` → 内核异步读
↓
CQE 到达 → 接收请求数据
↓
parse http → 执行业务
↓
CQE 到达 → 发送完成
↓
submit SQ 提交 recv，循环

epoll：`epoll_wait recv + read fd + writev + modfd`
io‑uring → 1/2 B syscall

epoll 内核用户态拷贝一次，io‑uring 零拷贝，更持久
epoll 上下文切换多

`AtomicInteger`封装 GCC 原子汇编，无锁线程安全类型

`disable_copyable` 不可拷贝

`volatile`：告诉编译器不要优化读写，每次都从内存读取

`get()` 获取原值，`getAndAdd` 获取再加，
`addAndGet`，`incrementAndGet`，自增 / 自减
`decrementAndGet` 返回更新后值

`old、increment、decrement` 底层的包装类

```
using AtomicInt32 = detail::AtomicIntegerT<int32_t>;
```

‑`sync` 内存屏障，`memory_order_seq_cst`
硬件原子指令实现，无锁，支持 int32 /int64

```
class capacity("mutex") // 记录锁能力单元
底层 pthread_mutex_t 互斥锁
pthread_t holder tId; // 判断现在是不是有锁
```

`m_check`宏，进一步校验 pthread 线程调用返回值

判断是否占有锁：
`return holder_ == CurrentThread::tid();`

`Acquire()` 编译期静态校验是否已经拿到锁
`GUARDED_BY` 用来标记变量，读之前持有锁

共享变量被多线程访问，要加锁

`std::mutex(x)` `std::unique_lock<Mutex> me(x)`

`std::lock_guard` 内定义构造函数，析构直接执行解锁

`final class X;` 整个 X 类所有成员函数都能访问，
类的私有、保护成员

类的变量不能裸访问，必须搭配一把 mutex

`pthread_cond_wait` 调用前外部必须持有 mutex

1. 原子释放 mutex
2. 线程挂起，进入等待队列
3. 被`signal/broadcast`唤醒，原子获取 mutex

`CountDownLatch` 倒计数门闩
`wait()` 阻塞等待，count→0
`countDown()` 计数器‑1，可以多线程配合
`getCount()` 获取当前剩余计数值

pthread 条件变量存在虚假唤醒

`mutex+cond` 配对；`destory` 反初始化

智能指针 `std::any`，不需要虚基类
`ptr(const T&)` 左值版本
`ptr(T&&)` 右值版本

```
inline void memzero(void *p, size_t n) {
    memset(p, 0, n);
}
```

// 内存清零

```
template<typename To, typename From>
inline To implicit_cast(From const &f) {
    return f;
}
```

// 安全向上隐式转换

C++ 基类指针可以自动隐式转为父类引用
`static_cast` 添加 const 限定，安全，只编译时检查
**禁止反向：int → long**

```
template<typename To, typename From>
inline To down_cast(From* f) {
    if (false)
        implicit_cast<From*, To>(0); // 强制校验为父子类
#if defined(DEBUG)
    assert(f == nullptr || dynamic_cast<To>(f) != nullptr);
#else
    // release版本
    return static_cast<To>(f);
#endif
}
```

// 基类指针 → 子类指针

能注意 C++ 多态里面临的基本问题
`MutexLock` RAII 对象，作用域内自动上锁、临界区结束自动解锁
`mutable`：允许修改类内部标记了`mutable`的成员
不要在构造函数中将`this`传给线程的函数
对象未初始化完成，别的线程访问出现数据竞争结果

构造完成后，另一个函数去执行这个回调

作为数据成员的 mutex 不能保护析构

对象关系：`composition、aggregation、association`

**composition（组合）**：对象生命周期由唯一拥有者控制
内存对象结构，成员是空指针

`shared‑ptr` 共享智能指针
引用计数为 0，对象被销毁

`weak‑ptr`：要升级为 shared_ptr，如果还活着，返回`shared_ptr`

`noncopyable` 基类工具类，禁止拷贝

```
class noncopyable {
public:
    noncopyable(const noncopyable&) = delete;
    void operator=(const noncopyable&) = delete;
protected:
    // 不能实例化这个基类
};
```

ccrpc：`str_view` 构造，指向已有内存，不拷贝，零开销

```
struct str_view {
    const char* ptr;
    size_t len;
};
```

`__VA_ARGS__` 可变参数宏

`json.hpp` 底层，json.hpp 做序列化反序列化

`rpc‑protocol.hpp` 定义消息格式，请求 / 响应的 json 结构体

`request`类，`parse_req`
`build`请求`json`，`build`响应`json`
`parse`响应`json`，`build_err json`

`socket → connect → read/write → shutdown / close`
  `fd:-1` 代表无效文件描述符

`serveCodec` 服务端：读请求，写响应，解析，写应答，监听套接字
`ClientCodec` 客户端：写请求，读响应。`write`向发送缓冲区写入，全部`consume`

`unique_ptr<stream> stream_;`
智能指针，持有文件描述符`stream`，自动管理。
自动销毁，`stream`内存与 fd 生命周期，自动释放。

注册服务：`services_.push_back(std::move(svc));`

继承 `enable_shared_from_this<T>`，`this` 被托管，返回 `shared_ptr<T>`；
`weak_ptr`引用计数不变，不增加引用计数；
返回的`shared_ptr`已经给`this`指针计数；

网络通信把它交给回调使用，防止野指针。
`lock()`升级为`shared_ptr`；`reset()`释放。

# Webbench vs ab vs wrk 对比表

| 特性     | Webbench                         | ab                                       | wrk                                              |
| -------- | -------------------------------- | ---------------------------------------- | ------------------------------------------------ | --------------------------- | --- |
| 并发模型 | 多进程模型                       | 多进程/多线程                            | 多线程 + 事件驱动（epoll）                       |
| 并发实现 | fork创建多个进程，进程切换开销大 | 多线程，同步阻塞IO，并发高时线程开销上涨 | 单进程多线程，每个线程独立事件循环，上下文开销低 |
| 适用场景 | 简单HTTP压测，轻量入门           | Apache自带，快速简单接口压测             | 专业HTTP压测，高并发、复杂业务场景               |
| 资源开销 | 内存、CPU开销高，大量进程占用多  | 中等，并发量大时线程多、系统调用频繁     | 资源利用率最优，同等压力占用更低                 |
| 功能     | 仅基础HTTP GET                   | GET/POST，支持基础header、表单           | 支持Lua脚本，自定义请求、参数、请求逻辑          |
| 统计能力 | 基础QPS、响应统计                | QPS、平均延迟，基础指标                  | 完整延迟分布 p50/p90/p99，详细时延统计           |
| <!--     | 扩展性                           | 弱                                       | 弱                                               | 强，Lua脚本模拟复杂业务逻辑 | --> |

性能 recv，kernel 内核临时页，一份拷贝数据 → copy‑to‑user →再释放临时页

`io_uring_register_buffers`
kernel 把这块内存有效锁定
SQE 设置 `IORING_BUFFER_SELECT + buf_group`
kernel 直接写入注册的 buffer，零拷贝

CQE 的返回里面带 `IORING_BUFFER_SELECT` 返回本机 buffer
`inodes[card]` 已经直接接收，使用，不用调用再返回值

```Cpp
iovec {
void *iov_base 起始地址
size_t iov_len; 内存字节长度
}

```

用来描述用户内存的地址 + 长度

`posix_memalign`：一次性分配整块连续大内存


Const &&  拷贝赋值重载的固定参数
`operator=` 赋值运算符

## RAII 类绝不能浅拷贝
>   两个对象有同一块堆指针，出作用域两个析构都会执行，造成重复释放内存

## 内存对齐：
`__attribute__((aligned))` 控制对齐
`__attribute__((packed))` 取消对齐
`__attribute__((aligned(8)))` **强制 8 字节对齐**。

构造函数不能上 virtual

虚表 vptr 构造阶段才创建

1. 只能子类存内存
2. 调用基类构造函数
3. 基类构造执行完毕，到子类构造点，
把 vptr 切指向子类虚表

`so‑reuse` 多线程 tpl ABI 相同约束
内存虚表重载约束

## 面试提炼

1. **构造函数不能是虚函数**：虚表指针 vptr 是在构造函数执行过程中才被初始化。构造对象的时候虚表还没准备好，所以不能 virtual。
2. 执行顺序：
①先分配子类内存
②调用父类构造函数，此时 vptr 指向**基类虚表**
③父类构造完成，进入子类构造函数，编译器改写 vptr，切换为**子类虚表**

> 经典坑：**基类构造函数里面调用虚函数，执行的是基类版本，不会多态到子类**，因为此时 vptr 还没切到子类。

虚函数：通过父类指针调用子类实现
构造：对象迟诞生，在堆上开辟内存

`new / delete` 是 C++ 语法
`malloc / free` 是 C 库函数

`new`：`malloc`分配内存，**构造函数执行初始化**
`delete`：调用析构，清理并且释放堆内存, free释放内存

软件三层：
需求调研 → 架构设计 → 编码定位 → 测试校验 → 部署上线

`volatile`：每次读写都触发访问真实内存，**不能用寄存器缓存副本**
同一主机同一IP + 端口， 同一时刻只能和一个socket绑定

`so‑reuseaddr` 地址复用，`time‑wait` 新连接
开启 bind 端口复用

##  浅拷贝 vs 深拷贝
- 浅拷贝: 只复制地址， 堆资源共享， 会双重释放崩溃
- 深拷贝: 重新分配堆内存， 数据独立

Linux 查看 CPU、进程：`nproc`
看服务 IP 地址：`ip addr`
看内存大小：`free -h`

根据进程名查 pid
`pprep .服务`（

拥塞窗口，整条网络链路
粘包、拆包数据上报

OOM 内存耗尽，
没有足够内存给新进程，
触发 OOM killer，挑选进程杀死释放内存。

---

### epoll

LT：**水平触发**，缓冲区有数据就持续通知，不读完就会反复通知

ET：**边缘触发**，状态变化才通知一次，一次性读完，搭配非阻塞 IO

> 
> 右侧手写数字是手写 epoll 示例。


创建 `lock_guard` 的调用
```Cpp
std::mutex mtx;
lock_guard<std::mutex> lock(mtx)
`mutex.lock()` 加锁
析构调用 `mutex.unlock();`
```


`select` 底层 `fd‑set` 位图，1024 位

1. 用户态拷贝到内核
2. 内核遍历 1024 个 fd
3 内核将 fd 存在修改到位图，拷贝回用户态

poll 底层：`struct pollfd`数组，**去掉 1024 限制**

epoll 底层：**红黑树**
红黑树保存注册的 fd
就绪链表：只存放当前就绪的 fd

1. `epoll_create` 内核创建 epoll 实例，返回 epollfd
2. `epoll_ctl(ADD/MOD/DEL)`，注册就绪 IO

## 面试提炼

1. `std::lock_guard` RAII 锁：构造自动 lock，析构自动 unlock，异常场景也会释放锁。
2. select：使用位图 fd_set，**最大只能 1024 个 fd**；每次调用都要用户↔内核来回拷贝全部 fd 集合，内核轮询扫描全部 fd。
3. poll：用`struct pollfd`数组，解除 1024 上限，但依然每次全部拷贝、全部遍历。
4. epoll：

- `epoll_create`：内核创建 epoll 对象，返回 epollfd
- `epoll_ctl`：增删改要监听的 fd，fd 存放在**红黑树**
- 内核只把**已经就绪的 fd**放到就绪链表，用户态只拿就绪事件，不需要遍历全部 fd，高并发性能好。

dpdk 高性能网络开发库，让用户态直接收发包，绕过内核协议栈

传统 Linux：应用→内核→网卡（多次拷贝， 系统调用、中断，上下文切换）
dpdk：**应用→网卡（零拷贝、轮询，无中断）**

用户态轮询驱动 PMD，不生成内核驱动，用 UIO/VFIO 把网卡映射到用户空间
CPU 主动轮询网卡，网卡PX/RX 队列，替代中断，消除上下文切换开销
大页内存：
由 2MB/1GB 连续大页，减少 TLB miss，提升地址转换效率
数据包mbuf 从预分配内存池，避免动态分配内存碎片

零拷贝：
网卡 DMA 直接把包写到用户态内存，应用直接访问网卡内存， 无内核拷贝
## 多核亲和
  每个核绑定一个任务， 线程不切换

DMA：直接内存访问
硬件自己读写内存，不用 CPU 插手
普通：网卡收到数据→CPU 一点点拷贝到内存
DMA：网卡自带 DMA 控制器，网卡收到包, 硬件直接把数据丢进内存

## 面试提炼

1. **DPDK 核心：绕过 Linux 内核协议栈，用户态直接操作网卡**，PMD 轮询驱动，摒弃中断，降低上下文切换开销。
2. **大页内存**：2M/1GB 大页，减少 TLB 缺失，提升虚拟地址转换速度。
3. **mbuf**：预先分配内存缓冲区，管理网络数据包，规避动态分配内存碎片。
4. **DMA 直接内存访问**：网卡硬件直接读写内存，不消耗 CPU 做数据拷贝，实现零拷贝。
5. VFIO/UIO：把网卡硬件寄存器映射到用户态，用户程序可以直接操作网卡硬件。

UIO：用户态 IO 框架，内核留一个驱动模块，设备初始化，把网卡寄存器 / 内存映射到用户态

vf‑io：dpdk 自带的
网卡 DMA 可写整个内存，不安全
VF‑IO 虚拟化的 IO，
IOMMU 保护，网卡只能访问分配给它的那部分内存

RDMA：远程直接内存访问
 本地网卡DMA读app内存 -> 网络传输 -> 对端DMA写入APP内存
 无 CPU 拷贝， 无内核协议栈处理，访问内存直接交互

RoCE：以太网承载 RDMA
1. 数据，不经过内核缓冲区， OS不对报文解析转发
2. io‑uring：linux 自带的异步 IO 框架，内核提交 dpdk，不用绑定网卡
3. DPSK: 绕开内存，极致快，复杂
4. io‑uring：存在内核，用环形队列异步 IO。 SQ提交队列， 用户态-> 内核。 CQ: 完成队列，内核态—> 用户态

io‑uring 5 种主要队列
SQ：提交队列
CQ：完成队列
同一个用户，两个队列

## 面试要点

1. **UIO**：旧版 DPDK 方案，内核驱动将网卡寄存器映射到用户空间；没有 IOMMU 防护，网卡 DMA 可以访问全部内存，存在安全风险。
2. **VF‑IO**：DPDK 推荐新方案，依托 IOMMU 硬件隔离，网卡 DMA 只能访问分配给它的内存，安全性高。
3. **RDMA 远程直接内存访问**：网卡之间直接读写内存，**CPU 不参与拷贝**，数据绕过内核协议栈。RoCE 协议：RDMA 跑在以太网上面。
4. **io‑uring**：Linux 原生异步 IO，内核维护环形队列；应用提交任务，内核完成回调；不需要像 DPDK 那样用户态轮询。

> 
> 区分：
> DPDK：**用户态轮询**，绕内核；
> io‑uring：**内核异步 IO**，仍然走内核。


SPDK：用户态 + 轮询 + 零拷贝，高性能存储开发包，
CPU死循环轮询， NVME完成队列。

为什么 dpdk 比 socket 快？
`socket`：应用 → 内核协议栈 → DMA 拷贝，两次拷贝
`socket`收发，频繁系统调用，用户态内核态切换开销
dpdk：线程绑定CPU核心， 全程不切换

`mbuf`：dpdk 数据包结构体，一个 mbuf 对应一个网络报文
内存池申请一大块连续大页内存，切出很多 mbuf
mbuf 内存：**物理连续、大页内存**
mbuf 用完放回池中

内核每次收发：
- `malloc`一块内存
- 拷贝数据
- 处理完`free`释放
- 频繁分配。

rte‑ring：dpdk 的无锁环形队列
- 多核传输不加锁

dpdk rte‑ring：
- 全程无锁，`lock‑free`
- 用 CAS 原子操作完成队列修改

## CAS：CPU 硬件指令，实现无锁原子操作
rte‑ring：环形数组 + 头尾指针
`head`：队头
`tail`：队尾

#### 入队：
-1. 移动指针 2. 放数据
#### 出队：
1. 移动指针 2. 取数据

用户态操作， 无系统调用

DPDK: 单机告诉以太网收发包
RDMA：跨主机内存直接读写

## C++ std::atomic 内存序

1. `memory_order_relaxed`
只保证原子性，**不做内存顺序约束**，允许指令重排
2. `memory_order_acquire` 【lock】
读操作，**后面的指令不能排到这一条前面**
3. `memory_order_release` 【unlock】
写操作，**前面指令不能排到这一条后面**
4. `memory_order_acq_rel`
读‑写都用，**前后都屏障**（acquire + release）
5. `memory_order_seq_cst`
全屏障，读、写都可见，**最强内存序，默认选项**

---

### 面试速记

- `relaxed`：只管原子，随便乱序。
- `acquire`：锁获取，**后面代码不许跑到 acquire 前面**。
- `release`：锁释放，**前面代码不许跑到 release 后面**。
- `acq_rel`：同时拥有 acquire+release 双向屏障。
- `seq_cst`：全局总序，std::atomic**默认内存序**，开销最大。

> 
> 经典配对：
> 读端用 `acquire`，写端用 `release`，实现无锁同步。

C++ 内存模型：多线程下，线程对内存的操作，什么时候能被其他线程看到
乱序的指令会被其他线程看到。
**原子特性：原子性、可见性、有序性**

原子操作：一个 CPU 指令完成的，不可打断。
无锁编程（用原子操作，内存屏障 memory_order）

CAS 很强大，会遇到 ABA 问题（lock‑free 这种）

Linux 把一切皆文件，所有 IO 都套在文件句柄：
用户态 → 系统调用 → 内核 VFS → 具体
文件系统 → 硬件

所有 IO 分两步：

1. 数据拷贝：内核把数据读到内核缓冲区
2. 数据拷贝：内核缓冲区 → 用户缓冲区

## OS 是一组 API
- 取连续指令 boot block
- 不学技能，谈不上品味
- 环境和口闻，会影响人的判断

## VMM 模拟所有特权指令、中断、包括对页表修改

- 链接和加载: execve 的行为
- 加载 ELF 文件
- 设置进程的栈的状态
- 加上库函数的行为

从需求出发的架构验证。
阅读手册，找寻 API
写代码理解 syscall，弄清楚为什么
这样做设计
不要害怕 “不好”，大胆去做，并且持续改进
Just for os，一切伟大都从零开始
syscall 可能会很久

## 共享内存：同一片地址空间

增加一个状态机（thread），有独立的栈，共享全局变量
并发（串行） 并行

`spawn(fn)`：创建进入函数,是fn的线程，并且立即开始执行
`join()`：等待所有运行线程的返回


1. **信号量 sem**

- `sem_init`：初始化信号量初值
- `sem_wait`(P)：`‑1`，资源不足阻塞
- `sem_post`(V)：`+1`，唤醒等待线程
- `sem_destroy`：释放资源

2. **pthread_mutex 互斥锁**

- `pthread_mutex_init`：初始化
- `pthread_mutex_lock`：加锁，拿不到就阻塞
- `pthread_mutex_unlock`：解锁
- `pthread_mutex_destroy`：销毁锁

3. **条件变量 pthread_cond**

- `pthread_cond_init`：初始化条件变量
- `pthread_cond_wait(cond, mutex)`：**释放 mutex，阻塞等待；被唤醒后重新获取 mutex**

> 
> 考点：`cond_wait`必须传入 mutex，内部会先解锁再休眠，唤醒后重新加锁。

```Cpp
int pthread_cond_timedwait(pthread_cond_t *cond, pthread_mutex_t *mutex,
const struct timespec *abstime);
```

带超时等待

`int pthread_cond_signal(pthread_cond_t *cond);` 唤醒**一个**等待线程

`int pthread_cond_broadcast(pthread_cond_t *cond);` 唤醒**所有**等待线程

`int pthread_cond_destroy(pthread_cond_t *cond);` 销毁条件变量资源

> 
> 成功返回 0，失败返回错误码

---

**RAII 自动管理生命周期**
构造函数自动调用`init`函数，析构调用`destroy`函数。

封装：把 C 结构体封装进类中，成员私有，外部不能修改底层类。对外暴露干净的接口，屏蔽系统调用。

同步原语**不能拷贝**，禁用拷贝构造、拷贝赋值。

```
<stdexcept> std::runtime_error(错误信息)
<cerrno> errno 非0做返回判断
```

拷贝构造申请资源，拷贝赋值释放资源
## P操作申请资源， V操作释放资源2
```Cpp
template<typename T>
class NonCopyableResource {
private:
    NonCopyableResource() = delete;
    NonCopyableResource(const NonCopyableResource&) = delete;
    NonCopyableResource& operator=(const NonCopyableResource&) = delete;
};
```

`sem_trywait(sem_t *sem);`

> 
> 资源‑1，返回 true
> 资源为 0，不阻塞，errno=EAGAIN，返回 false
> 其他错误异常

## 高并发轮询，不让线程阻塞休眠

`pthread_mutex_trylock`

> 
> 锁空闲上锁返回 true
> 锁被占用，返回 EAGAIN，函数返回 false
> 其他错误异常

不加`explicit`会**隐式类型转换**
`explicit`禁止单参数构造

`mutex`保护队列共享变量，保证同一时间只有一个线程读写队列

`cond`条件变量等待：上锁→解锁，队列空消费者阻塞；队列满生产者阻塞

---

`block_queue.h`
阻塞队列设计：读写都要先`lock()`
共享数据多线程并发访问必须加锁，防止数据竞争错乱

阻塞队列：生产者、消费者模型
生产者`push`向队列放数据，队列满就插入失败，切换为条件等待线程

消费者`pop`从队列取数据，队列为空时，`cond_wait()`阻塞休眠，有数据再唤醒返回

**必须用 while 判断，不能 if，防止虚假唤醒**，操作系统可能无理由唤醒等待线程

## 队列给异步日志模块使用，后台日志线程循环 pop 落盘，消除 IO 阻塞

懒汉单例：第一次调用`get_instance`才创建日志对象

```Cpp
static Log* get_instance() {
    static Log instance;
    return &instance;
}
```

… 驻留栈，对日志类封装

`##__VA_ARGS__` GCC 扩展可变参数宏支持，不定长参数

`write_log(level, format, ...)` 数据写到文件缓冲区
`flush`方法用`fflush(FILE*)`把缓冲区缓存的日志刷 OS 内核缓冲区

`async_write_log()`后台日志线程的主循环函数，
循环从消息队列取日志写文件
私有类，只有日志类可用

C++ 静态成员函数可以访问类所有私有成员，
## 析构写成虚析构，为后续扩展预留

pthread 线程函数签名要求
`void* (*)(void *)`
static 静态成员函数没有`this`指针，符合线程函数签名

`push_back(对象)`：先构造临时对象，再拷贝 / 移动到容器
`emplace_back`：直接在容器内存原地构造对象，消除临时，性能更好

```Cpp
using namespace muduo
```
不会自动展开命名空间`muduo::net/`,`muduo::base`.



## C++17

`move(x)`不会移动任何数据，仅仅是把 x 转为右值引用，触发移动构造 / 赋值

**完美转发 forward**
模板参数 T 会发生引用折叠，forward 传入左值返回左值引用， 传入右值返回右值引用

```Cpp
template<typename T>
void wrapper(T&& arg) {
    func(std::forward<T>(arg));
}
```

RAII 是资源获取即初始化，资源在构造函数里初始化，出栈时析构函数自动释放

move 不移动数据，强制把变量转换为右值引用 T&&
forward 用于模板万能引用转发

## unique‑ptr 为什么不能拷贝？
- 设计就要独占所有权。如果允许拷贝，两个指针指向同一块内存，double free 崩溃

## shared‑ptr 分为两组，一个 new 对象，一个控制块
>  控制块：
   - 强引用计数
   - 弱引用计数


## 普通 `shared_ptr<T>(new T())` 两次分配
`new T`分配业务对象
内部再`new`分配控制块

`make_shared`一次内存分配
强引用计数为 0，销毁业务对象，控制块不释放
弱引用也为 0，释放控制块

**循环引用：两个对象互相持有 shared_ptr**
强计数无法归 0
解法：一个使用`weak_ptr`

`deque`由多个固定大小的 buffer 地址 +
一张索引映射表
deque 头尾操作 O (1)

## `weak_ptr`只记录控制块地址
指向的对象随时可能被销毁
执行`lock()`，会判定指针是否有效

`vector`一段连续堆内存数组

- `size`：当前存了多少个
- `capacity`：分配的总容量

## 扩容：

1. 分配一块更大的连续新内存
2. 把旧数组拷贝 / 移动过来
3. 释放旧内存
4. 内部指针指向新内存， 更新capacity

### 如何避免扩容？
`vec.reserve(N)`一次性分配足够容量

`unordered_map` 哈希表

1. key → 下标
2. 桶数组 vector（链表）
O (1) 增删查找
key 不需要比较，只需要 hash + 相等判断

## 互斥同步：`mutex + condition_variable`
多线程共享资源互斥， 线程等待唤醒

## 异步：`async + future`， 线程函数获取返回值，异常传递
 线程获取返回值（异常传递）

无锁并发：`atomic` 简单变量不加锁安全读写

1. `std::launch::async`
强制创建**新线程**来运行任务；
任务在独立子线程执行。
2. `std::launch::deferred`
不创建任何线程，任务被**延迟**；
只有当你调用 `future.get()` / `future.wait()` 的那一刻，**调用 get 的这个线程**直接执行任务函数。

`map`红黑树，每个节点存`<k,v>`
按 key 从小到大排序

`unique_lock<mutex> w(mtx, defer_lock)`
支持手动 unlock，延迟加锁

1° 加锁 2°`cv.wait()`释放锁，阻塞休眠
3° 被唤醒了夺回锁，执行业务，再解锁

`cv.notify_one()` 唤醒一个
`cv.notify_all()` 唤醒全部等待线程

`thread`无法直接获取函数返回值
`future/promise/async` 用于线程间传递信息


`future.get()`阻塞，获取返回值，**只能调用一次**
`wait()`仅等待完成，不获取结果
`wait_for()`限时等待，超时返回 `future_status::timeout`

`promise` 子线程写入结果，`future`主线程读取结果

`mutex` 操作系统内核态阻塞，上下文切换

## `atomic`是 CPU 硬件指令 CAS，纯用户态开销小
`store`原子写，`load`原子读取
`fetch_add(1)`原子 + 1，`fetch_sub(1)`原子‑2

## 虚假唤醒：OS 通知，条件变量唤醒的时候条件不满足
```Cpp
cv.wait(lock, pred)
while (!cpred) {
    cv.wait(lock);
}
```   


## 订单锁扣减库存

1° 拦截用户，获取 Redis 分布式锁
2° 数据库扣减：
 构建订单 + 检查库存

```
// 减库存 update set stock = stock -1 where stock > 1;
`rows = 0` 回滚事务
创建订单，锁定的库存
```



## 防超卖：MySQL 行级判断 where stock > 条件更新

### 延迟订单取消
  1. `publish`
  2. 到死信交换机
  3. 消息过期转发到死信队列，订单超时取消，归还库存

### Lua 原子扣库存？

检查用户是否购买，检查库存，扣库存，创建购买

Lua 脚本在 Redis 单线程执行

### 下单请求

```
加锁，检查库存
├─Lua原子扣库存
├─-1 已过期
├─0 空位置
└─1 扣成功
```

发 MQ 消息异步创建订单

## Redis 布隆过滤器接收 id token，避免同一个用户不能重复请求
Lua 脚本有 `purchasekey`，锁失效也能截住已购用户

kafka 等副本成功确认才会成功，同步发送
消息重发，重试 3 次，每次隔 200ms

## 消息确认机制：
- kafka先处理消息，成功后 `CommitMessages`
- RabbitMQ：成功 Ack，失败消息持久化

## 从HTTP 层 Handler 拦截上游 Trace 信息
创建当前 span

MQ 层把 Trace 的文本入 MQ 的消息头

消费者从消息头恢复 Trace 上下文

worker 定时轮转 outbox 表 → 发消息给 kafka
持续监听 kafka → 同时ES索引
监听RabbitMQ秒杀队列->异步创建秒杀记录

监听 binlog MQ 消息队列 → 消息创建最终的业务记录

## 订单 id 唯一索引，一个订单只有一条支付记录

 数据库行锁，防止并发修改


 ## 堆：OS 提供的动态内存区域，malloc/free 直接操作。
自由存储区：通过 new/delete 分配内存和释放内存
new 申请的内存一定属于自由存储区。

普通继承：父类成员放在子类内存前面，不改变内存布局。
类带虚函数，对象头部增加 vptr，指向类虚函数表。

```Cpp
Base* p = new Son(); p->f();
```

取 p 指向对象首地址取 vptr，
去表拿到 Son::f 的真实地址
用 this 调用子类函数，运行时才确定函数。
## 浅拷贝:只拷贝栈上变量，堆内存共用一块内存。
深拷贝：栈拷贝，新开辟堆内存复制内容，两份内存独立。

## 指针 vs 引用
指针：存目标内存地址，拥有内存空间
引用：变量别名，底层是指针
引用一旦绑定，终身不能改。

大端：网络字节序，高字节、有效字节存低地址，低字节存高地址。
/*
0x12345678
大端： 将高有效字节放在内存的低地址处。
12
34
56
78
*/
小端：将高有效字节放在内存的低地址处。

网络接口层，只暴露同步，异步接口，不依赖底层文件。

## 异步回调：

```Cpp
using HttpCallback = std::function<void(const HttpRequest&,HttpResponse&)>;
```

如何支持切换不同网络库？所有底层网络库都实现接口。


回调式：`async_request`
同步等待异步：`std::future`

C++20 协程 `co_await`
`coroutine_handle<HttpRes>`
`co_request(const HttpRequest req);`

Callback：事件驱动，不阻塞
Future：同步阻塞处理结果
## syscall vs 库函数
- 系统调用：用户程序向 OS 内核发起请求的标准接口， 用户态进入内核态的正规通道
- 库函数，用户态封装，不一定触发系统调用。
## lambda
`[this]`捕获对象指针，lambda 内部通过指针访问成员，共享对象。
`[*this]`捕获当前对象副本，把 *this 拷贝一份存 lambda。

普通 lambda 编译期被翻译成一个匿名仿函数类
不加`mutable`编译器生成`operator() const`
去掉 const，允许修改捕获的值拷贝成员



数字证书：服务器公钥 + 域名 +CA + 有效期，实现 net 的身份证
CPU 为了提升性能，会打乱代码执行顺序，编译器重排

CPU 硬件：内部多条单元并行，访存指令乱序读写。

- `relaxed` 宽松序
- `release` 释放
- `acquire` 获取
- `acq‑rel` 获取释放
- `seq‑cst` 顺序一致

```
fetch_add(memory_order_relaxed)
store(memory_order_release)
load(memory_order_acquire)
```

`seq‑cst`顺序一致，CPU 屏障开销最大


`[&] / [this]` 捕获指针
`[=] / [*this]` 值捕获

std::move是强制类型转换， 把任意左值 -> 右值引用T&& 
真正自由转移是移动构造完成的。 

## 左值：有名字，能取地址的变量
- `std::string s = "abc"`

## 右值：临时变量，不能取地址
- `std::string("123")` 纯临时

模板 编译期多态
模板对每种类型，生成一份独立代码

虚函数：运行期多态，动态多态
对象带虚指针，指向共同的虚表，运行查表执行

右值引用绑定到临时对象。

`std::string t1 = std::string("xxx")`
拷贝构造：`string(const std::string&)` 左值引用
移动构造：`string(string&&)` 右值引用
**转移指针，不拷贝内存**

`noexcept` 给编译器，函数，绝不抛出任何异常。
移动构造标记 `noexcept`，编译器使用拷贝构造。
`move`后对象可以安全析构，可被重新赋值。

移动赋值：`T&& noexcept` 转移内部堆指针，O (1)

`unordered‑map` 拉链法哈希表解决哈希冲突，同一桶中冲突的键值对挂在单链表上

## 模板是不可编译代码，只在一套代码生成规则。
基类构造处，子类还未构造，虚表指针指向基类虚表。
基类析构执行，销毁子类，虚指针切回基类虚表。


虚表：编译器编译生成一个静态虚表
一张类对应一个表
所有基类派生类不同表

##  静态绑定 vs 动态绑定

> 静态绑定：编译器直接调用函数地址，运行时无开销，无法运行多态
> 动态绑定：仅虚函数.运行时通过对象 vptr 找到 vtable，虚表
获取真实函数地址，再调用

基类析构为 virtual，动态析构，生效调用
`Son::~Son()` 再 `Base::~Base()`

基类析构非 virtual，直接执行，
反执行 `Base::~Base()`，内存泄漏

```

`nullptr` 关键字

野指针：指针存了一块非法，不受管控虚拟内存地址。

1. 指针未初始化
2. 指向内存已经释放
3. 指针越界

RAII：资源获取即初始化，资源申请写在构造，释放写在析构函数
构造中加锁，析构中解锁。

```Cpp
R(const R&) = delete; // 禁止拷贝
```




## fork：复制当前进程，生成独立子进程
写时复制 COW

## vfork 子进程共享父进程地址空间，父进程阻塞挂起， 直到子进程调用exec + exit

- fork: 子进程复制父虚拟内存，COW
- vfork：父子共用同一份地址空间


## #define NULL 0 // 宏，仅仅做预处理替换0

## STL 容器：
- 序列式容器：底层线性结构 vector、deque、list、array
- 关联式容器：底层红黑树 map、set
- 无序关联容器：哈希，unordered_map、unordered_set
- 容器适配器：stack、queue 基于 deque，priority_queue，基于 vector

## 互斥锁：普通互斥完全互斥，同时只允许一个线程进入临界区。


## struct 和 class：
- struct 默认成员公有
- class 默认成员私有

- struct 继承，默认 public
- class 继承默认 private

数据成员用 struct，对象封装 class

派生 struct，默认 public 继承
派生 class，默认 private 继承


静态全局 / 静态局部内存不变 = 静态存储区
## 静态类变量，整个程序运行期间一直存在，进程结束才回收内存。

函数重载：同名不同参

重写：子类继承父类，重新改写父类的 virtual 虚函数

## 面向对象特征：封装、继承、多态

COW 写时复制：多个对象共享同一份底层数据，只有当某一方要修改数据时，才真正拷贝一份副本。只读全程不拷贝。

## 左值，C++ 的 string
## 浅拷贝

只复制**指针**，不会复制底层数据；多个对象共用同一块内存，一般配合引用计数管理。

> 
> 风险：任意一个对象修改内存，其他对象全部受影响；析构时容易重复释放内存。

## 2. 深拷贝

完整拷贝**内存里的数据**，新对象拥有独立内存空间。
两个对象内存相互隔离，修改其中一个不会影响另一个，内存各自释放。

## Redis 分布式锁会失效吗？

1️⃣ **锁过期，业务没执行完**

- 解决：看门狗，定时给锁续期

2️⃣ **锁被其他进程释放**

- 生成唯一随机值，释放时校验；锁值‑id，Lua 脚本释放锁

3️⃣ **网络坏了，锁丢了，死锁**

4️⃣ **Redis 宕机锁丢失**

Lua 被当成单命令执行，Redis 单线程串行处理命令
Lua 脚本**不可中断**

---

## Redis pipeline

一次把多条命令交给 Redis，一次返回所有结果
1° 减少网络往返次数
中间命令失败，也不会停止
批量导入，批量查询
⚠️注意：**不是分布式锁，不保证原子加减**

pipeline 减少 RTT（网络往返次数），批量给 Redis

### Redis 事务

MULTI 开启、EXEC 执行、DISCARD 放弃事务，watch 监控一个 / 多个 key
先 WATCH，如果 EXEC 前 key 被修改，放弃执行
WATCH 乐观锁。

---

## Nginx 反向代理

nginx 再转发到后端，对内网服务做隔离
负载均衡：把请求分发到多个后端实例，实现集群扩容，扩容
网关、限流、统一鉴权、限流、ssl 证书
动态 / 静态资源，静态 nginx 直接返回



## 覆盖索引：从辅助索引中查询到记录，不需要回表聚簇索引的记录。

MySQL 使用锁为了支持对共享资源进行并发访问，提供数据完整性和一致性。

共享锁：允许事务读一行数据
排他锁：允许事务删除或更新一行数据

## 库 -> 表-> 页 -> 记录
共享锁与排他锁是兼容的。

## MVCC：
一行记录可能不止有一份快照数据。
- Record Lock 行记录锁，锁记录
- Gap Lock 间隙锁，锁一个范围
- Next‑key lock：Gap lock + Record lock，锁记录且锁范围

IS：意向共享锁，事务想要对一张表中某几行加共享锁
IX：意向排他锁，事务想要对一张表中某几行加排他锁



表格

| select | poll | epoll |
| --- | --- | --- |
| 1024 上限 | 无限制 | 无限制 |
| 全量拷贝 | 全量拷贝 | 上拷贝就绪链表 |
| 遍历所有 fd | 遍历 fd | 直接返回就绪 fd |
| O(n) | O(n) | O(1) |

同步：用户自己调用 read，内核→用户拷贝
异步：内核自动拷贝完成，用户收结果

每个进程独有 fd‑table 数组，fd 为数组下标，指向 struct file

epoll：红黑树（存所有 fd）+ 就绪链表

LT 水平触发，数据没读完会一直通知
ET 边缘触发：状态变化通知，必须一次读空

## 阻塞IO 与 IO复用
阻塞 IO：`read()` → 阻塞 → 数据就绪 → 拷贝 → 返回

非阻塞 IO：read → 没数据立刻返回 EAGAIN → 用户轮询，不阻塞，但要一直轮询（CPU 空转浪费）

IO 多路复用：select /poll/epoll
把多个 fd 交给内核监控，调用`epoll‑wait`阻塞
就绪事件 → 返回 → 用户`read()`，一个线程管理多连接


## 信号驱动 IO：
注册 socket 的 fd → 数据就绪 →
内核发信号 → 信号处理函数

异步 IO：io_submit () 发起调用 →
内核完成就绪 + 拷贝 → 通知用户
真正的 product 才返回

块设备：有 IO 调度器
read → VFS → 块层 →
调度器 → 队列 → 磁盘

网络 IO：走网络协议栈
socket → read → 协议栈 →
内核 skb → 网卡


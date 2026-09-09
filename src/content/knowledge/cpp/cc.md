# C++ 笔记

## 目录

- [一、C++ 语言基础](#一c-语言基础)
- [二、模板与元编程](#二模板与元编程)
- [三、面向对象与多态](#三面向对象与多态)
- [四、智能指针与 RAII](#四智能指针与-raii)
- [五、STL 容器与数据结构](#五stl-容器与数据结构)
- [六、并发与多线程](#六并发与多线程)
- [七、操作系统与内存](#七操作系统与内存)
- [八、网络编程基础](#八网络编程基础)
- [九、高性能网络 DPDK/RDMA/io_uring](#九高性能网络-dpdkrdmaio_uring)
- [十、项目笔记](#十项目笔记)
- [十一、数据库 Redis/MySQL](#十一数据库-redismysql)
- [十二、中间件与架构](#十二中间件与架构)

---

## 一、C++ 语言基础

### string_view

> `string_view` 只是一个【指针 + 长度】的轻量级包装，它不存字符串本身，不分配内存，不拷贝字节。

```cpp
// string_view 内部简化模型（伪代码）
class string_view {
private:
  const char* data_ptr; // 指向一块已经存在的内存
  size_t      length;   // 这块内存有效字节数
public:
  string_view(const char* p, size_t n) : data_ptr(p), length(n) {}
};
```

`string::assign(const char* s, size_t count)`：从指针 `s` 开始，拷贝 `count` 个字节，区间是 `[s, s + count)`。

### 指针 vs 引用

- 指针：存目标内存地址，拥有独立内存空间（占 4/8 字节）；可空、可二次赋值、可多级指针；直接解引用 `*`。
- 引用：变量别名，底层是指针，不占用额外空间；一旦绑定终身不能改；编译器自动处理解引用。

### 野指针 vs 悬空指针

- 野指针：指针存了一块非法、不受管控的虚拟内存地址。成因：
  1. 指针未初始化
  2. 指向内存已经释放（即悬空指针）
  3. 指针越界
- 悬空指针：指向已经销毁的对象或已经回收的地址，指针还保留旧地址。

### const

> - const 对象：只能调用 const 成员函数
> - `const int a`：常量不可改
> - `const int *p`：指针指向内容不可改
> - `int * const p`：指向地址不可改

### struct vs class

- struct 默认成员公有、默认 public 继承
- class 默认成员私有、默认 private 继承
- 数据成员用 struct，对象封装用 class

### 浅拷贝 vs 深拷贝

- 浅拷贝：只复制指针/栈上变量，不复制底层数据；多个对象共用同一块内存，一般配合引用计数管理。
  - 风险：任意一个对象修改内存，其他对象全部受影响；析构时容易双重释放崩溃。
- 深拷贝：完整拷贝内存里的数据，新对象拥有独立内存空间；两个对象内存相互隔离，各自释放。

### 左值 vs 右值

- 左值：有名字、能取地址的变量，如 `std::string s = "abc"`。
- 右值：临时变量，不能取地址，如 `std::string("123")`。
- 右值引用只能绑定到右值：`string&& tt = string("xxx")`。

### std::move 与完美转发

- `std::move` 是强制类型转换，把任意左值转为右值引用 `T&&`；真正资源转移由移动构造完成。
- `std::forward` 用于模板万能引用转发，保留参数原本值类别：传左值转发左值（触发拷贝构造），传右值转发右值（触发移动构造）。
- 拷贝构造 `string(const string&)`：深拷贝；移动构造 `string(T&&)`：只转移堆指针，不拷贝内存。

```cpp
template<typename T>
void wrapper(T&& arg) {
    func(std::forward<T>(arg));
}
```

### explicit / noexcept / [[nodiscard]]

- `explicit`：禁止单参数的隐式转换。
- `noexcept`：告诉编译器该函数绝不抛 C++ 异常；移动构造不写 noexcept，编译器会保守地使用拷贝构造。
- `[[nodiscard]]`：返回值不能丢弃，否则编译器给出警告。

### inline

- 建议编译器把函数体直接嵌入到调用位置，省去函数调用压栈、跳转、返回的开销。
- `__builtin_expect`：编译器分支预测优化。

### volatile

- 告诉编译器不要优化读写，每次都从内存读取，不能用寄存器缓存副本。

### 内存对齐 alignas

- `alignas(64)`：CPU 读任意变量时，把它所在的连续 64 字节整数拉进缓存。
- `__attribute__((aligned(n)))` 强制 n 字节对齐；`__attribute__((packed))` 取消对齐。

### malloc/free vs new/delete

- `malloc/free`：只分配内存，不调用构造/析构；malloc 失败返回 null。
- `new/delete`：分配内存 + 自动调用构造/析构；new 失败抛异常。

### 栈 / 堆 / 自由存储区

- 栈：OS 管理、自动分配；局部变量、函数参数，生命周期随函数，自动销毁。
- 堆：手动管理；new/malloc 开辟，手动释放，全局生命周期；OS 提供的动态内存区域，malloc/free 直接操作。
- 自由存储区：通过 new/delete 分配和释放内存；new 申请的内存属于自由存储区。
- C++ 有局部对象自动生命周期规则：栈上局部变量生命周期严格绑定当前作用域，进入 `{}` 自动构造，离开 `{}` 自动析构。

### 定位 new

```cpp
new (地址) 类(构造参数) // 不分配内存，在 addr 直接调用构造函数
```

### 静态存储区

- 静态全局/静态局部内存不变 = 静态存储区；静态类变量整个程序运行期间一直存在，进程结束才回收。

### 大端 vs 小端

```cpp
/*
0x12345678
大端（网络字节序）：高有效字节放在内存低地址
12 34 56 78
小端：低有效字节放在内存低地址
*/
```

- 大端：网络字节序，高字节存低地址，低字节存高地址。

### nullptr / NULL

- `nullptr` 关键字。
- `#define NULL 0`：宏，仅做预处理替换为 0。

### lambda

- `[this]`：捕获对象指针，lambda 内部通过指针访问成员，共享对象。
- `[*this]`：捕获当前对象副本，把 `*this` 拷贝一份存 lambda。
- `[&]` / `[this]` 捕获指针；`[=]` / `[*this]` 值捕获。
- 普通 lambda 编译期被翻译成匿名仿函数类；不加 `mutable` 编译器生成 `operator() const`，去掉 const 才能修改捕获的值拷贝成员。

### 赋值运算符

```cpp
Const&&        // 拷贝赋值重载的固定参数
operator=      // 赋值运算符
```

### 静态库 vs 动态库

- 静态库 `.lib`：编译打包进程序，体积大，无需依赖。
- 动态库 `dll`：运行时加载，体积小，可以热更新。

---

## 二、模板与元编程

### requires 约束（C++20）

```cpp
template <typename F>
requires std::invocable<F>
```

- `template<typename F>`：模板，F 代表可调用对象类型（lambda、函数指针、std::function）。
- `requires std::invocable<F>`：编译期约束，判断 `F()` 能否直接调用（无参调用）。传一个不能直接调用的类型，编译直接报错，而不是运行期崩。

```cpp
auto enqueue(F &&f) -> std::future<std::invoke_result_t<F>>
```

- `F&& f`：万能引用，可接收左值、右值，配合 `std::forward` 完美转发。
- `std::invoke_result_t<F>`：编译期推导 `F()` 的返回值类型，如 `F 是 [](){return 42;}` → `int`。
- 返回值 `std::future<ReturnType>`，future 用来等待任务、拿返回值。

### 可变参数模板

```cpp
template <typename T, typename ...Args>
```

- `typename... Args`：参数包，可打包任意数量、同调用推导体系的类型。
- `Args... args`：`args` 是一包参数；`args...` 叫解包，把包里参数展开传给下一次调用。
- `Args&& args` 既能接收左值，也能接收右值。
- `forward<Args>(args)` 展开 = `forward<int>(arg1) forward<string>(arg2) ...`

### 模板全特化

- `template<>` 是空模板参数列表，代表全特化：对某一个特定类型，重写整个类。

```cpp
// 类模板
template <typename T>
class Container {
private:
  T data;
public:
  Container(T value) : data(value) {}
  T get_data() const { return data; }
  void set_data(T value) { data = value; }
};

// 模板特化 - 为 std::string 提供特殊实现
template <>
class Container<std::string> {
private:
  std::string data;
public:
  Container(std::string value) : data(value) {}
  std::string get_data() const { return data; }
  void set_data(std::string value) { data = value; }
  std::size_t length() const { return data.length(); } // 字符串类型特有的方法
};
```

### SFINAE

- 模板参数替换失败 ≠ 编译报错，只是把这个候选函数删掉，继续尝试匹配别的重载。
- `std::enable_if` 是实现 SFINAE 最经典的工具。

### 模板本质

- 模板不是可编译代码，只是一套代码生成规则。
- 模板是编译期多态，对每种类型生成一份独立代码。

---

## 三、面向对象与多态

### 面向对象三特征

- 封装、继承、多态。

### 继承

- 多继承：成员名冲突、冗余数据。
- 菱形继承：二义性、数据冗余；解法用虚继承 `virtual` 继承，只保留一份父类数据。
- 普通继承：父类成员放在子类内存前面，不改变内存布局；类带虚函数时，对象头部增加 vptr。

### 虚函数与虚表

- 多态：父类指针/引用指向子对象，调用子类重写方法；同一接口，不同实现。
- 静态多态：编译器确定（函数重载、模板），性能高。
- 动态多态：运行时根据对象真实类型决定调用（虚函数）。
- 虚函数表 vtable：每个含虚函数的类存一张虚表，存所有虚函数地址；子类重写虚函数时，替换成子类函数地址。
- 虚指针 vptr：每个实例对象头部多一个 vptr，指向当前类的虚表。
- 调用流程：① 基类指针找对象地址取 vptr；② vptr 对应虚表取函数地址并调用。
- 动态绑定：运行时查表确定调用函数，编译期不确定。

```cpp
Base* p = new Son(); p->f();
// 取 p 指向对象首地址的 vptr，去表拿到 Son::f 真实地址，用 this 调用子类函数，运行时才确定函数
```

### 构造函数为什么不能是 virtual？

- 虚表指针 vptr 是在构造函数执行过程中才被初始化的，构造对象时虚表还没准备好，所以不能 virtual。
- 执行顺序：
  1. 先分配子类内存
  2. 调用父类构造函数，此时 vptr 指向**基类虚表**
  3. 父类构造完成，进入子类构造函数，编译器改写 vptr 切换为**子类虚表**
- 经典坑：基类构造函数里调用虚函数，执行的是基类版本，不会多态到子类（此时 vptr 还没切到子类）。

### 静态绑定 vs 动态绑定

- 静态绑定：编译时确定，编译器直接调用函数地址，运行时无开销，无法运行多态。
- 动态绑定：仅虚函数，运行时通过对象 vptr 找到 vtable 获取真实函数地址再调用。

### 纯虚函数与接口

- 纯虚函数 + 抽象基类，无法实例化，用于定义接口。

| | 虚函数 | 纯虚函数 |
|---|---|---|
| 定义 | virtual 有函数实现 | virtual 函数 = 0 |
| 用途 | 扩展已有功能 | 定义接口规范 |

### 析构与虚析构

- 析构函数：对象生命周期结束，自动调用。
- 基类析构写成 virtual（虚析构），防止派生类内存泄露。
- 基类析构为 virtual：动态析构，先 `Son::~Son()` 再 `Base::~Base()`。
- 基类析构非 virtual：直接执行，只 `Base::~Base()`，内存泄漏。

### 函数重载 vs 重写

- 重载：同名不同参。
- 重写：子类继承父类，重新改写父类的 virtual 虚函数。

### 构造函数 / 拷贝构造 / 移动构造

- 普通构造：定义对象直接调用。
- 拷贝构造：对象赋值初始化、函数值传参、函数返回对象。
- 移动构造：临时对象赋值、move 转移资源。

### 对象关系

- composition（组合）：对象生命周期由唯一拥有者控制。
- aggregation（聚合）、association（关联）。

### 设计注意

- `mutable`：允许修改类内部标记了 `mutable` 的成员。
- 不要在构造函数中将 `this` 传给线程的函数：对象未初始化完成，别的线程访问会出现数据竞争。

---

## 四、智能指针与 RAII

### RAII 思想

- RAII：资源获取即初始化，资源申请写在构造函数，释放写在析构函数；出作用域自动释放，防止内存泄露。
- 本质：自动管理堆内存，出作用域自动释放。
- RAII 类绝不能浅拷贝：两个对象有同一块堆指针，出作用域两个析构都执行，会造成重复释放内存。
- 内存泄露：不用裸指针，优先智能指针。

### unique_ptr（独占智能指针）

- 独占所有权，同一时刻只能一个指针持有；禁止拷贝，支持 move；线程不安全。
- 为什么不能拷贝？设计就要独占所有权，若允许拷贝，两个指针指向同一块内存，double free 崩溃。

### shared_ptr（共享智能指针）

- 引用计数 + 控制块实现共享所有权；计数为 0 自动释放内存。
- 分为两组：一个 new 对象、一个控制块；控制块含强引用计数 + 弱引用计数。
- 引用计数本身是原子操作，使用 `memory_order_relaxed` 保证原子性，不做指令重排；计数安全，但对象访问不安全（多线程同时读写对象要加锁）。
- `make_shared` 一次内存分配（对象 + 控制块）；普通 `shared_ptr<T>(new T())` 两次分配。
- 强引用计数为 0 销毁业务对象，控制块不释放；弱引用也为 0 才释放控制块。

### weak_ptr（弱引用）

- 不增加引用计数，不控制对象生命周期；不能直接解引用，必须 `lock()` 升级成 shared_ptr，失败返回 nullptr。
- 专门解决 shared_ptr 循环引用。
- 只记录控制块地址，指向的对象随时可能被销毁，执行 `lock()` 判定指针是否有效。

### 循环引用

- 两个对象互相持有 shared_ptr，强计数无法归 0。
- 解法：其中一个使用 weak_ptr。

### noncopyable 基类（禁止拷贝、允许移动）

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
```

### 手写 UniquePtr

```cpp
#include <cstddef>

template <typename T> class Unique_ptr {
private:
  T *_ptr = nullptr;

public:
  // 构造，explicit 防止隐式转换
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
    if (this == &other) return *this; // 处理自移动
    delete _ptr;                      // 释放当前旧资源
    _ptr = other._ptr;                // 接管对方指针
    other._ptr = nullptr;
    return *this;
  }

  // 析构：释放资源（delete nullptr 是安全合法）
  ~Unique_ptr() noexcept { delete _ptr; }

  T &operator*() const noexcept { return *_ptr; }
  T *operator->() const noexcept { return _ptr; }

  // 辅助接口：release / reset
  T *release() noexcept { T *tmp = _ptr; _ptr = nullptr; return tmp; }
  void reset(T *p = nullptr) noexcept { delete _ptr; _ptr = p; }
  T *get() const noexcept { return _ptr; }
};
```

### 手写 SharedPtr

```cpp
#include <iostream>
template <typename T>
class SharedPtr {
private:
    T* _ptr;
    int* _refCount;

public:
    explicit SharedPtr(T* ptr = nullptr)
        : _ptr(ptr), _refCount(new int(1)) {}

    // 拷贝构造：共享资源，引用计数 +1
    SharedPtr(const SharedPtr<T>& other) {
        _ptr = other._ptr;
        _refCount = other._refCount;
        ++(*_refCount);
    }

    SharedPtr<T>& operator=(const SharedPtr<T>& other) {
        if (this == &other) return *this; // 自赋值保护
        release();                        // 先释放当前对象旧资源
        _ptr = other._ptr;                // 接管新资源
        _refCount = other._refCount;
        ++(*_refCount);
        return *this;
    }

    ~SharedPtr() { release(); }

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

    int getRefCount() const { return _refCount ? *_refCount : 0; }
};
```

---

## 五、STL 容器与数据结构

### 容器分类

- 序列式容器：底层线性结构 vector、deque、list、array。
- 关联式容器：底层红黑树 map、set。
- 无序关联容器：哈希 unordered_map、unordered_set。
- 容器适配器：stack、queue 基于 deque；priority_queue 基于 vector。
- STL 的 stack 是通用模板，要适合各种场景，不能只用普通数组。

### vector（动态数组）

- 一段连续堆内存；扩容 1→2→4，开辟新内存、拷贝元素、释放旧内存。
- `size`：当前存了多少个；`capacity`：分配的总容量。
- 扩容流程：① 分配一块更大的连续新内存；② 把旧数组拷贝/移动过来；③ 释放旧内存；④ 指针指向新内存，更新 capacity。
- 如何避免扩容：`vec.reserve(N)` 一次性分配足够容量。

### array

- 固定栈大小，栈内存。

### list（双向链表）

- 头尾插入 O(1)；不支持随机访问，遍历慢。

### deque

- 由多个固定大小的 buffer + 一张索引映射表组成；头尾操作 O(1)。

### map（红黑树）

- O(logn)，有序稳定，遍历有序；每个节点存 `<k,v>`，按 key 从小到大排序。

### unordered_map（哈希表）

- O(1)，无序，查询极快；拉链法解决哈希冲突，同一桶下冲突的键值对挂在单链表上；key 只需 hash + 相等判断，不需要比较。

### set / unordered_set

- set：红黑树有序去重。
- unordered_set：哈希表无序去重。

### 跳表

- 第 0 层原始有序数据链表；第 1 层每隔若干抽一个做索引；第 2 层在第一层基础上继续抽做索引。
- 实现比红黑树简单；天然有序，范围遍历友好；插入删除修改局部指针。

### B+ 树（多路平衡查找树）

- 把磁盘随机 IO 压到最后。
- B 树所有节点存储索引键 + 完整数据，查找可能在非叶子节点，范围查询需要中序遍历整棵树。
- B+ 树非叶子节点只有索引键 + 子节点指针；叶子存储全量数据，用双链表串联所有叶子。

---

## 六、并发与多线程

### 进程 vs 线程

- 进程：独立地址空间，资源隔离。
- 线程：共享地址空间。

### 线程创建

```cpp
std::thread t1(func, 100);                 // 绑定函数 + 传参数
std::thread t(类::成员函数, 对象地址, 参数);
```

- `std::thread` 直接创建线程，手动 Join/detach。
- `std::async` 异步任务，自动管理线程。
- Join：主线程等待子线程执行完毕再往下走，资源自动回收。
- detach：后台独立执行，主线程不等待，线程资源交给系统回收。
- 一个线程只能 Join/detach 一次。

```cpp
std::vector<std::thread> threads;
int thread_num = 50;
for (int i = 0; i < thread_num; ++i)          // 循环1：创建 50 个子线程
  threads.push_back(std::thread(append_node, i)); // std::thread(函数名, 参数1, 参数2, ...)
for (auto &th : threads) th.join();           // 循环2：等待全部子线程结束
```

### 线程同步手段

- 锁、原子变量、条件变量、信号量。

### 一个线程安全的 class

1. 多线程同时访问时，表现正确的行为。
2. 无论 OS 怎么调度线程，不需要额外的同步。

### 死锁四条件

1. 互斥条件
2. 请求并保持
3. 不可剥夺
4. 循环等待

### 互斥锁 vs 自旋锁

- 互斥锁 std::mutex：加锁失败让出 CPU 进入睡眠，锁释放后 OS 唤醒阻塞线程；阻塞 + 上下文切换，内核参与。
- 自旋锁：加锁失败不放 CPU，原地等待反复轮询（原地自旋占用 CPU）；无上下文切换，纯用户态/原子操作轮询。

### 锁体系

```cpp
std::mutex mtx;
std::lock_guard<std::mutex> lg(mtx);    // 出作用域自动解锁
std::unique_lock<std::mutex> ul(mtx);   // 支持手动解锁、延迟上锁、条件变量搭配
```

- `lock_guard`：作用域锁，构造上锁、析构解锁，不可手动解锁，轻量；异常场景也会释放锁。
- `unique_lock`：和 lock_guard 类似，但支持 unlock/relock、转移所有权，可以交给 cv.wait 使用。
- `std::shared_mutex`（读写锁）：读共享、写独占，多读同时进，写独占阻塞所有。
  - shared 共享锁：多个读线程可同时持有（读-读并行）。
  - exclusive 独占锁：写线程持有，其他读、写全部阻塞。
  - `shared_lock<shared_mutex>` 读锁；`unique_lock<shared_mutex>` 写锁。
- 锁禁止拷贝、移动，否则锁会失效。

### 条件变量

```cpp
std::mutex mtx;
std::condition_variable cv;
bool flag = false;

// 等待线程
void wait_thd() {
  std::unique_lock<std::mutex> lk(mtx);
  cv.wait(lk, [] { return flag; }); // 等待 flag 为 true，防止虚假唤醒
}
// 唤醒线程
void notify_thd() {
  std::lock_guard<std::mutex> lg(mtx);
  flag = true;
  cv.notify_one();   // 唤醒一个
  cv.notify_all();   // 唤醒全部
}
```

- `cv.wait(lock, pred)` 等价于 `while (!pred()) cv.wait(lock);`：
  1. 先判断谓词 pred，为 true 则不等待直接往下走（不释放锁）。
  2. 为 false：自动释放 mutex 锁 → 线程阻塞休眠。
  3. 收到 notify 唤醒，重新竞争获取 mutex 锁（不一定立刻拿到）。
  4. 拿到锁后再次检查条件：成立则 wait 返回继续执行；不成立则再次释放锁继续睡。
- 条件变量 wait 必须传入 `unique_lock`，因为 wait 内部需要临时释放锁。

### 虚假唤醒

- OS 通知时条件变量唤醒时条件不一定满足；wait 必须用 while 判断，不能 if。

```cpp
cv.wait(lock, pred);   // 等价于
while (!pred) { cv.wait(lock); }
```

### 生产者-消费者模型

- producer 能放数据就生产；consumer 有数据就消费；明确同步条件，状态机模型。

### CAS

- CAS 读变量旧值，把变量强写，返回修改前的旧值；CPU 硬件指令，实现无锁原子操作。
- 无锁，并发高时性能好；mutex 有锁，并发会串行排队，简单好写。
- 循环重试优先用 `compare_exchange_weak`（性能好，假性失败循环重试即可，无锁栈/链表 push 几乎全是 weak）；只尝试一次必须用 `compare_exchange_strong`。

```cpp
if (!locked_.exchange(true, std::memory_order_acquire))
    this_thread::yield(); // 让出 CPU，防自旋占核心
```

### atomic 内存序

| 内存序 | 含义 |
|---|---|
| `memory_order_relaxed` | 只保证原子性，不做内存顺序约束，允许指令重排 |
| `memory_order_acquire` | 【lock】读操作，后面的指令不能排到这一条前面 |
| `memory_order_release` | 【unlock】写操作，前面的指令不能排到这一条后面 |
| `memory_order_acq_rel` | 读写都用，前后都屏障（acquire + release） |
| `memory_order_seq_cst` | 全屏障，最强内存序，std::atomic 默认选项 |

- 速记：relaxed 只管原子随便乱序；acquire 锁获取（后面代码不许跑到前面）；release 锁释放（前面代码不许跑到后面）；seq_cst 全局总序，开销最大。
- 经典配对：读端 acquire、写端 release，实现无锁同步。
- 多线程是 acquire/release，单线程是 relaxed。
- acquire 是读操作，release 是写操作，relaxed 单线程使用不需要同步。
- acquire 读操作：只要本次 load 读到别的线程 release/store 写入的指针，该 release store 之前的所有写操作对当前线程全部可见。
- relaxed 对这个 atomic 变量本身的读写是原子的，CPU 可以随意重排这个 load 前后的指令。

```cpp
locked_.store(false, std::memory_order_release);
locked_.load(std::memory_order_acquire);
locked_.exchange(true, std::memory_order_acquire);
```

- C++ 内存模型：多线程下，线程对内存的操作什么时候能被其他线程看到；乱序的指令会被其他线程看到。
- 原子三特性：原子性、可见性、有序性；原子操作是一个 CPU 指令完成，不可打断。
- 无锁编程：用原子操作 + 内存屏障 memory_order。
- CAS 会遇到 ABA 问题（lock-free 场景）。

### future / promise / async

- `std::thread` 无法直接获取函数返回值；`future/promise/async` 用于线程间传递信息（含异常传递）。
- `future.get()`：阻塞获取返回值，只能调用一次；`wait()` 仅等待完成不取结果；`wait_for()` 限时等待，超时返回 `future_status::timeout`。
- `promise`：子线程写入结果；`future`：主线程读取结果。
- `std::async`：`std::launch::async` 强制创建新线程运行；`std::launch::deferred` 延迟调用，get 时才在当前线程执行。

### 任务打包（packaged_task）

```cpp
auto task = std::make_shared<std::packaged_task<ReturnType()>>(std::forward<F>(f));
```

- `std::packaged_task<ReturnType()>`：包装一个无参函数，执行完保存返回值到内部共享状态供 future 读取。
- `std::forward<F>(f)`：完美转发，保留左/右值属性。
- `std::make_shared`：创建 shared_ptr 管理这个 packaged_task。
- 一句话：把用户传入的任务打包，放到堆上，用 shared_ptr 管理生命周期。

### 信号量 / 互斥锁 / 条件变量（pthread）

- 信号量 sem：`sem_init` 初始化初值、`sem_wait`(P 操作 -1 资源不足阻塞)、`sem_post`(V 操作 +1 唤醒)、`sem_destroy` 释放。
  - `sem_trywait`：资源 -1 返回 true；资源为 0 不阻塞，errno=EAGAIN 返回 false。
- pthread_mutex：`init/lock/unlock/destroy`；`pthread_mutex_trylock` 锁空闲上锁返回 true，锁被占用返回 EAGAIN。
- pthread_cond：`cond_wait(cond, mutex)` 释放 mutex 阻塞等待，唤醒后重新获取 mutex；`cond_signal` 唤醒一个、`cond_broadcast` 唤醒全部、`cond_destroy` 销毁。
- 考点：cond_wait 必须传入 mutex，内部会先解锁再休眠，唤醒后重新加锁。

```cpp
int pthread_cond_timedwait(pthread_cond_t *cond, pthread_mutex_t *mutex,
                           const struct timespec *abstime); // 带超时等待
```

- pthread 线程函数签名要求 `void* (*)(void*)`；static 成员函数没有 this 指针，符合线程函数签名。

### CountDownLatch（倒计数门闩）

- `wait()` 阻塞等待 count→0；`countDown()` 计数器 -1，可多线程配合；`getCount()` 获取当前剩余计数值。

### TLS 线程本地存储

- 用 `__thread` 缓存 tid、线程名等，避免进程内频繁调用系统调用 `gettid()`；每个线程持有独立变量。
- `__thread`：声明每个线程独有的变量。
- 子线程可访问父线程 TLS；fork 之后会复制 TLS（fork 只复制调用 fork 的当前线程，子线程 TLS 缓存失效，需注册 pthread_atfork 重置）。
- posix 线程 id 在内核同一进程内有效，跨进程会重复。
- pthread 入口函数仅接收单个 `void*` 参数，需要把所有传给子线程的数据打包到结构体。

### fork vs vfork

- fork：复制当前进程生成独立子进程，写时复制 COW（子进程复制父虚拟内存）。
- vfork：子进程共享父进程地址空间，父进程阻塞挂起直到子进程调用 exec/exit。

### IPC 进程间通信

- 不同进程之间数据传送、同步协作：
  1. 管道
  2. 信号
  3. 消息队列
  4. 共享内存
  5. 信号量
  6. 内存映射
- 共享内存：同一片地址空间。

### 阻塞队列

- 有界/无界阻塞队列：有界限流、消息队列。
- 阻塞队列设计：读写都要先 lock()；共享数据多线程并发访问必须加锁，防止数据竞争。
- 生产者 push 放数据，队列满切换为条件等待；消费者 pop 取数据，队列空 cond_wait 阻塞休眠，有数据再唤醒返回。

### AtomicInteger（无锁线程安全）

```cpp
using AtomicInt32 = detail::AtomicIntegerT<int32_t>;
```

- 封装 GCC 原子汇编，无锁线程安全类型；`get`/`getAndAdd`/`addAndGet`/`incrementAndGet`/`decrementAndGet`。
- `sync` 内存屏障 `memory_order_seq_cst`；硬件原子指令实现，支持 int32/int64。

### mutex 封装（muduo）

```cpp
class MutexLock { // 记录锁能力单元
  // 底层 pthread_mutex_t 互斥锁
  // pthread_t holder; // 判断现在是不是有锁
};
```

- 判断是否占有锁：`return holder_ == CurrentThread::tid();`
- `Acquire()` 编译期静态校验是否已经拿到锁；`GUARDED_BY` 标记变量，读之前持有锁。
- `MutexLock` 是 RAII 对象，作用域内自动上锁、临界区结束自动解锁。
- 类的变量不能裸访问，必须搭配一把 mutex。

---

## 七、操作系统与内存

### 用户区 vs 内核区

- 用户区：代码、堆、栈、库文件。
- 内核区：内核代码、页表、缓冲区。

### 虚拟内存 vs 物理内存

- 物理地址 PA：主板上真实内存条的地址编号，硬件唯一能识别的地址。
- 虚拟地址 VA：每个进程独有的地址空间，进程代码只认识虚拟地址。
- CPU 内存管理单元 MMU + 页表完成地址翻译。

### 分页

- 为什么分页：进程虚拟地址互不干扰，一个进程崩溃不影响其他进程。
- 4KB = 2^12，地址低 12 位是页内偏移，高位是页号。
- 虚拟页号 + 页内偏移 = 任意虚拟地址。

### 页表

- OS 为每个进程维护一个页表，放在物理内存；页表条目 PTE 记录虚拟页号 → 物理页号映射关系。

```
1. 进程拿指令，给出 VA（虚拟地址）
2. CPU 拆分：页号 + 页内偏移
3. 虚拟页号查当前进程页表，得物理页号
4. 物理地址 = 物理页号 + 页内偏移
```

### 快表 TLB

- CPU 内部高速缓存，缓存常用页表加速地址翻译，减少访问次数。

```
CPU 查询 TLB
  --> 命中：取物理页号 -> 拼位移，访问 PA
  --> 缺失：查内存页表 -> 更新 TLB -> 拼位移，访问 PA
```

- 线程/进程切换导致 TLB 失效，刷新重建 TLB（存虚拟页号 → 物理页号映射）。
- 同进程线程切换：TLB 不要整体刷新，仅需换栈、寄存器、PC（程序计数器）。
- 不同进程切换：地址空间编号变化，TLB 强制失效刷新。

### 切换线程（上下文切换）

- CPU 时钟中断强制切线程，保存现场，恢复另一个线程现场。
- 通用寄存器存入 TCB 中，PC 存下一条执行代码地址。
- TCP 在内核内存，用户态 → 内核态切换。
- 恢复：恢复页表、栈指针、PC 计数器。

### 写时复制 COW

- 多个对象共享同一份底层数据，只有当某一方要修改数据时，才真正拷贝一份副本；只读全程不拷贝。

### OOM

- 内存耗尽，没有足够内存给新进程，触发 OOM killer 挑选进程杀死释放内存。

### VFS（一切皆文件）

- Linux 把所有 IO 都套在文件句柄：用户态 → 系统调用 → 内核 VFS → 具体文件系统 → 硬件。
- 所有 IO 分两步：① 内核把数据读到内核缓冲区；② 内核缓冲区 → 用户缓冲区。

### 块设备 vs 网络 IO

- 块设备：有 IO 调度器，read → VFS → 块层 → 调度器 → 队列 → 磁盘。
- 网络 IO：走网络协议栈，socket → read → 协议栈 → 内核 skb → 网卡。

### VMM / ELF

- VMM 模拟所有特权指令、中断、包括对页表修改。
- 链接和加载（execve 的行为）：加载 ELF 文件、设置进程的栈状态、加上库函数的行为。

### OS 是一组 API

- 取连续指令 boot block。
- 并发（串行）/ 并行；增加一个状态机（thread），有独立的栈，共享全局变量。

```cpp
spawn(fn); // 创建进入函数 fn 的线程，并且立即开始执行
join();    // 等待所有运行线程的返回
```

### 系统调用 vs 库函数

- 系统调用：用户程序向 OS 内核发起请求的标准接口，用户态进入内核态的正规通道；syscall 会陷入内核，开销大。
- 库函数：用户态封装，不一定触发系统调用。

### 常用 Linux 命令

- 查看 CPU/进程数：`nproc`
- 看服务 IP 地址：`ip addr`
- 看内存大小：`free -h`
- 根据进程名查 pid：`pgrep <服务名>`

> 学习心得：从需求出发做架构验证；阅读手册，找寻 API；写代码理解 syscall，弄清楚为什么。不要害怕"不好"，大胆去做并持续改进。Just for OS，一切伟大都从零开始。

---

## 八、网络编程基础

### socket

- socket 封装 socket 相关系统调用，管理 fd 生命周期，禁止拷贝、支持移动（通过继承 noncopyable 实现）。
- 可设置地址复用/端口复用/关闭 Nagle 算法（小包直发）/TCP 保活。
- `SO_REUSEADDR` 端口复用：同一主机同一 IP + 端口，同一时刻只能和一个 socket 绑定；开启 bind 端口复用可复用 time-wait 新连接。
- `::inet_ntop` 使用全局 C 库函数，不是类内函数。

### TCP 全双工与半关闭

- TCP 是全双工，关闭写半连接后不再发数据，但仍可以读数据。
- 场景：上传数据完成，等待接收对端返回结果。

### 阻塞 / 非阻塞 / IO 多路复用

- 阻塞 IO：`read()` → 阻塞 → 数据就绪 → 拷贝 → 返回。
- 非阻塞 IO：read 没数据立刻返回 EAGAIN → 用户轮询（不阻塞，但要一直轮询，CPU 空转浪费）。
- IO 多路复用 select/poll/epoll：把多个 fd 交给内核监控，调用 `epoll_wait` 阻塞，就绪事件返回后用户 `read()`，一个线程管理多连接。
- 同步：用户自己调用 read，内核 → 用户拷贝；异步：内核自动拷贝完成，用户收结果。

### select / poll / epoll 对比

| | select | poll | epoll |
|---|---|---|---|
| fd 上限 | 1024 | 无限制 | 无限制 |
| 拷贝方式 | 全量拷贝 | 全量拷贝 | 只拷贝就绪链表 |
| 扫描方式 | 遍历所有 fd | 遍历 fd | 直接返回就绪 fd |
| 复杂度 | O(n) | O(n) | O(1) |

- select 底层 fd_set 位图，1024 位：① 用户态拷贝到内核；② 内核遍历 1024 个 fd；③ 内核把 fd 状态修改到位图，拷回用户态。
- poll 底层 `struct pollfd` 数组，去掉 1024 限制，但每次仍全量拷贝、全量遍历。
- epoll 底层红黑树保存注册的 fd + 就绪链表只放就绪 fd：
  - `epoll_create` 内核创建 epoll 实例，返回 epollfd。
  - `epoll_ctl(ADD/MOD/DEL)` 增删改要监听的 fd。
  - 内核只把已经就绪的 fd 放到就绪链表，用户态只拿就绪事件，不遍历全部 fd，高并发性能好。
- 为什么用 epoll 而不是 accept + read 循环：传统做法是一个连接一个线程；IO 多路复用一个线程监听多个 fd，只处理就绪的。

### LT vs ET

- LT 水平触发：缓冲区有数据就持续通知，不读完会反复通知。
- ET 边缘触发：状态变化才通知一次，一次性读完，搭配非阻塞 IO。

### 信号驱动 IO / 异步 IO

- 信号驱动 IO：注册 socket 的 fd → 数据就绪 → 内核发信号 → 信号处理函数。
- 异步 IO：`io_submit()` 发起调用 → 内核完成就绪 + 拷贝 → 通知用户，真正完成后才返回。

### Reactor vs Proactor

- Reactor：主线程只通知有数据可读，工作线程自己 read() + 业务处理。
- Proactor：主线程 read 完数据，工作线程纯业务处理。
- 通过 `m_actor_model` 区分（1 = Reactor，0 = Proactor）。

### 网络相关补充

- 拥塞窗口：整条网络链路。
- 粘包、拆包：数据上报时的现象。
- 数字证书：服务器公钥 + 域名 + CA + 有效期，实现 net 的身份证。

---

## 九、高性能网络 DPDK/RDMA/io_uring

### DPDK

- 高性能网络开发库，让用户态直接收发包，绕过内核协议栈。
- 传统 Linux：应用 → 内核 → 网卡（多次拷贝、系统调用、中断、上下文切换）。
- DPDK：应用 → 网卡（零拷贝、轮询、无中断）。
- 用户态轮询驱动 PMD，不生成内核驱动，用 UIO/VFIO 把网卡映射到用户空间。
- CPU 主动轮询网卡 RX/TX 队列，替代中断，消除上下文切换开销。
- 为什么 DPDK 比 socket 快：socket 收发要应用 → 内核协议栈 → DMA 拷贝（两次拷贝），频繁系统调用、用户态内核态切换；DPDK 线程绑定 CPU 核心，全程不切换。

### 大页内存

- 2MB/1GB 连续大页，减少 TLB miss，提升地址转换效率。

### mbuf

- DPDK 数据包结构体，一个 mbuf 对应一个网络报文。
- 从预分配内存池（物理连续、大页内存）切出，避免动态分配内存碎片；用完放回池中。

### rte-ring（无锁环形队列）

- 环形数组 + 头尾指针（head 队头、tail 队尾）；多核传输不加锁，全程 lock-free，用 CAS 原子操作完成队列修改。
- 入队：① 移动指针 ② 放数据；出队：① 移动指针 ② 取数据；用户态操作，无系统调用。

### DMA / 零拷贝

- DMA 直接内存访问：硬件自己读写内存，不用 CPU 插手；网卡自带 DMA 控制器，收到包硬件直接把数据丢进内存。
- 零拷贝：网卡 DMA 直接把包写到用户态内存，应用直接访问网卡内存，无内核拷贝。

### UIO vs VFIO

- UIO：用户态 IO 框架，内核留一个驱动模块，把网卡寄存器/内存映射到用户态；没有 IOMMU 防护，网卡 DMA 可访问全部内存，有安全风险。
- VFIO：DPDK 推荐方案，依托 IOMMU 硬件隔离，网卡 DMA 只能访问分配给它的内存，安全性高。

### 多核亲和

- 每个核绑定一个任务，线程不切换。

### RDMA / RoCE / SPDK

- RDMA 远程直接内存访问：本地网卡 DMA 读 app 内存 → 网络传输 → 对端 DMA 写入 app 内存；无 CPU 拷贝、无内核协议栈处理，访问内存直接交互。
- RoCE：以太网承载 RDMA；数据不经过内核缓冲区，OS 不对报文解析转发。
- SPDK：用户态 + 轮询 + 零拷贝的高性能存储开发包，CPU 死循环轮询 NVME 完成队列。

> 区分：DPDK 用户态轮询，绕内核；io_uring 内核异步 IO，仍然走内核。

### io_uring（Linux 异步 IO 框架）

- 环形队列异步 IO：SQ 提交队列（用户态 → 内核）、CQ 完成队列（内核态 → 用户态）。
- 用户填充 SQE → SQ 环形队列 → submit 交给内核 → 内核执行完把 user_data + 结果放 CQE 返回用户态。
- 一个 SQE 代表一条交给内核执行的异步 IO 任务。

```cpp
struct io_uring {
    // SQ 提交队列
    // CQ 完成队列
    // flags 主结构体
    // ring_fd 文件描述符
    // features 位掩码
};
```

### io_uring 底层 Syscall 流程

- `io_uring_queue_init()` 创建 SQ/CQ 环形缓冲区；ret=0 成功，ret<0 失败。
- `io_uring_get_sqe()` 从 SQ 拿一个空闲 SQE。
- `io_uring_prep_accept/recv/send/close()` 往 SQE 填充对应 IORING_OP。
- `io_uring_submit()` 把 SQ 的 SQE 一次性交给内核；`submit_and_wait()` 提交 + 阻塞等待 nr 个 CQE 完成。
- `io_uring_peek_cqe()` 非阻塞拿 CQ 里完成的条目；`cqe_seen()` 标记已处理、释放 CQE 槽位。
- `sqe_set_data` 在 SQE 挂 void*；CQE 上 `cqe_get_data` 取回指针；`cqe_get_res` 拿返回码。
- engine 流程：① get_sqe + sqe_set_data 挂上下文；② submit_and_wait 提交并等 CQE；③ peek_cqe 收 CQE；④ cqe_get_data/cqe_get_res 拿上下文和返回码；⑤ cqe_seen 标记已处理。

### io_uring 零拷贝

- 传统 recv：kernel 内核临时页，一份拷贝数据 → copy-to-user → 再释放临时页。
- `io_uring_register_buffers`：kernel 把这块内存有效锁定；SQE 设置 `IORING_BUFFER_SELECT + buf_group`，kernel 直接写入注册的 buffer，零拷贝；CQE 返回带 `IORING_BUFFER_SELECT` 的本机 buffer。

```cpp
iovec {
  void *iov_base;   // 起始地址
  size_t iov_len;   // 内存字节长度
}
```

- iovec 用来描述用户内存的地址 + 长度。
- `posix_memalign`：一次性分配整块连续大内存。

### epoll vs io_uring

- epoll：监听 fd 注册事件，事件来了同步 `accept()`；内核用户态拷贝一次；上下文切换多。
- io_uring：直接异步提交 accept 任务，有连接进来自动完成；零拷贝更持久；1/2 次 syscall。

### epoll 流程（http_conn process）

```
epoll-wait（fd 可读）
  ↓
recv 内核拷贝数据
  ↓
parse http 请求
  ↓
epoll-ctl 写
  ↓
继续 epoll-wait
  ↓
writev(非阻塞) 发送
  ↓
epoll-ctl(mod) 继续等待
```

### io_uring 流程

```
submit [recv] → 内核异步读
  ↓
CQE 到达 → 接收请求数据
  ↓
parse http → 执行业务
  ↓
CQE 到达 → 发送完成
  ↓
submit SQ 提交 recv，循环
```

---

## 十、项目笔记

### tinywebserver

- `time()` 获取时间戳；`localtime()` 转本地年月日时分秒；`fflush()` 刷新缓冲区；`fclose()` 关闭旧文件。
- `sprintf()` 安全格式化字符串，限制长度。
- Mysql 连接池：Mysql 连接要先 TCP 3 次握手 + 认证握手，池化减少开销。
- 链表 + 定时器管理（有序升序定时器链表）；一个连接一个定时器 { fd、Port + IP、定时器 }。
- 消费者 HTTP 工作线程拿连接；生产者线程用完归还。
- RAII 自动回收类，自动归还数据库连接，防止资源泄露。
- 内核资源禁止拷贝，否则重复释放、野指针、死锁、程序崩溃。
- 信号异步中断，无法在 epoll 监听，用管道转发信号。
- HTTP 服务程序依靠 epoll 监听 TCP 连接，线程池分担业务压力，定时器清理闲置死连接，支持同步/异步日志记录。
- 如果断网 TCP 报文发不过来，服务端 fd 泄露，每个连接绑定一个定时器：SIGALRM → 通知 epoll → timer_handler → tick 清理到期节点 → cb_func 关闭 fd。

```cpp
// fcntl 设置非阻塞
fcntl(file_fd, F_GETFL, ...)        // 读当前 fd 的 flag（阻塞/非阻塞、读写模型）
O_NONBLOCK                          // 非阻塞标记
fcntl(file_fd, F_SETFL, ...)        // 把修改后的 flag 设置回 fd

epoll_ctl(epoll_fd, EPOLL_CTL_ADD, 客户端fd, 事件结构体);
EPOLL_CTL_ADD // 把 fd 添加到 epoll 监听池
EPOLL_CTL_DEL // 删除 fd

EPOLLIN       // 有可读事件
EPOLLET       // 边缘触发 ET
EPOLLRDHUP    // TCP 对端关闭，提前收到断开事件，不用等 read 返回 0 才断开
SOCK_STREAM   // 流式套接字 TCP
SOCK_DGRAM    // udp 数据报
SO_LINGER     // 延迟关闭行为

pthread_create(tid, 栈属性, 入口函数, 参数); // 入口必须是 static void* worker(void* arg)
pthread_detach(tid);                         // 线程分离，退出自动释放资源

send(fd, 缓冲区指针, 字节长度, MSG_NOSIGNAL);
// TCP 客户端已关闭连接，服务端用 send 写数据 → 内核触发 sigpipe 强杀服务器进程

alarm(n);      // n 秒后产生 SIGALRM，只触发一次
sa_restart     // 若信号打断 read/epoll_wait/write 等阻塞系统调用，调用会重新执行
sigfillset()   // 把信号加入屏蔽集，写信号时所有新信号阻塞排队
```

```cpp
// webserver 结构
            threadpool
webserver   timer 链表     epoll  |  监听 fd 新连接
            mysql 连接池          |  管道信号
                                 |  客户端 fd
                            HTTP_CONN 解析请求 + 响应
```

- 一个线程只能被 pthread_join 调用一次。
- Proactor 模式：主线程提前完成 IO，不区分读写事件。
- 消除 public 的 config，通过只读接口去获取数据。

### muduo（EventLoop）

- 模块链：`Logger → EventLoop → ThreadPool → Router`，`Acceptor->loop.Run()`。
- EventLoop 回调：`typedef EventCallback = function<void(int fd, uint32_t events)>`。
- 注册、析构，禁止拷贝；`AddFd/ModFd/RemoveFd`；绑定回调 `setCallback(int fd, EventCallback cb)`。
- 封装 read、write：`Run()/Stop()/IsRun()`；`epoll_wait` 最多 1024 个待就绪事件。
- 内部派发 `dispatch(int fd, uint32_t events)`，收到就绪轮询后统一分发。
- fd 两个哈希表：fd → Callback；`epoll_create1(EPOLL_CLOEXEC)` 创建 epoll。
- `epoll_ctl(epfd, op, fd, ev)`：EPOLL_CTL_ADD 加入监听、EPOLL_CTL_MOD 修改事件、EPOLL_CTL_DEL 删除。
- `epoll_wait(epfd, buffer, maxevents, timeout)`：-1 永久阻塞，0 非阻塞，>0 定时返回。
- EPOLLIN 可读、EPOLLOUT 可写、EPOLLERR 错误；epoll 水平/边缘模式。
- Reactor 单线程 IO 模型：一个 EventLoop 一个 epoll；主线程 epoll_wait 将事件分发给处理 fd，耗时业务丢给线程池绝不阻塞。

```cpp
epoll_event ev{ };
ev.events = events;
ev.data.fd = fd;
```

### tcp-connection

- 继承 `enable_shared_from_this`，文件内部继承自身智能指针。
- `enum class State`（连接：建立、读写、关闭）；构造、析构禁用拷贝。
- 事件回调 `onReadable()/onWritable()`：epoll 可读时读取客户端 HTTP 数据；发送缓冲区满阻塞，onWritable 可写时继续发送。
- 连接超时管理 `SetTimeout`：`Touch` 刷新上次接触时间、`IsTimeout` 判断是否超时。
- 私有方法：请求、响应、关闭、flush 缓冲区、设置非阻塞。
- `fcntl(fd, F_GETFL, 0)` 获取 fd 状态；`fcntl(fd, F_SETFL, flags | O_NONBLOCK, 0)` 设置为非阻塞 IO。
- close 原子退出 fd 置 -1 防止重复；`state_.store(closed, memory_order_release)` 原子标记状态，epoll 移除 fd。

### acceptor（Tcp 接收器）

- 构造、析构，禁止拷贝，启动监听；注册回调获取 socket 端口。
- 监听 socket 绑定端口，调用 listen，epoll 注册监听 fd；有新连接 accept 生成 fd，创建 TcpConnection 扔进 epoll。

```cpp
fd = socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
```

- `SOCK_CLOEXEC`：执行子进程时自动关闭 fd，防止 fd 泄露；`accept4` 系统调用直接返回新连接 fd 并设置 O_NONBLOCK，不需要额外 fcntl。

### Async_socket（底层 Reactor 异步 IO / 协程）

- Socket 读写时阻塞主协程，挂起协程，fd 回调 epoll 事件后再恢复协程继续。
- `await_ready`：协程立刻执行返回 true 继续不挂起；false 挂起进入 await_suspend。
- `await_suspend(coroutine_handle<> h)`：挂起保存协程句柄，注册 epoll 事件。
- `await_resume`：事件被触发后执行，返回给 co_await。
- `function<HttpResponse(const HttpRequest&)>`：接收 const HttpRequest 返回 HttpResponse。

```cpp
template <typename HttpHandler F>
void register(std::string_view url, F handler) {
    routes[std::string(url)] = forward<F>(handler);
}
```

- `unordered_map<string, Handler> routes`：存储路径和对应处理函数。

```cpp
template <typename F>
concept TaskCallable = invocable<F> && same_as<invoke_result_t<F>, void>;

template <TaskCallable F>
void submit(F&& task) {
    std::lock_guard lock(mutex_);
    tasks.push(forward<F>(task));
}
semaphore_.release(); // 唤醒一个工作线程
```

### ccrpc

- `str_view` 构造指向已有内存，不拷贝，零开销。

```cpp
struct str_view {
    const char* ptr;
    size_t len;
};
```

- `json.hpp` 做序列化反序列化；`rpc-protocol.hpp` 定义消息格式、请求/响应 json 结构体。
- `request` 类：`parse_req`、`build` 请求 json、`build` 响应 json、`parse` 响应 json、`build_err json`。
- `socket → connect → read/write → shutdown/close`；`fd:-1` 代表无效文件描述符。
- `serveCodec` 服务端：读请求、写响应、解析、写应答、监听套接字；`ClientCodec` 客户端：写请求、读响应。
- `unique_ptr<stream> stream_;` 持有文件描述符 stream，自动管理内存与 fd 生命周期。
- 注册服务 `services_.push_back(std::move(svc));`。
- 继承 `enable_shared_from_this<T>`：`this` 被托管，返回 shared_ptr<T>；`lock()` 升级、`reset()` 释放；网络通信交给回调使用，防止野指针。

### 网络库抽象与异步模型

- 网络接口层只暴露同步、异步接口，不依赖底层文件。
- 如何支持切换不同网络库：所有底层网络库都实现统一接口。

```cpp
using HttpCallback = std::function<void(const HttpRequest&, HttpResponse&)>;
```

- 回调式 `async_request`：事件驱动，不阻塞。
- 同步等待异步 `std::future`：同步阻塞处理结果。
- C++20 协程：`co_await`、`coroutine_handle<HttpRes>`、`co_request(const HttpRequest req)`。

### muduo 工具类

- 智能指针 `std::any`：不需要虚基类；`ptr(const T&)` 左值版本、`ptr(T&&)` 右值版本。
- `final class X;`：整个 X 类所有成员函数都能访问类的私有、保护成员。

```cpp
inline void memzero(void *p, size_t n) { memset(p, 0, n); } // 内存清零

template<typename To, typename From>
inline To implicit_cast(From const &f) { return f; }        // 安全向上隐式转换

template<typename To, typename From>
inline To down_cast(From* f) {                              // 基类指针 → 子类指针
    if (false) implicit_cast<From*, To>(0);                 // 强制校验为父子类
#if defined(DEBUG)
    assert(f == nullptr || dynamic_cast<To>(f) != nullptr);
#else
    return static_cast<To>(f);
#endif
}
```

- C++ 基类指针可以自动隐式转为父类引用；`static_cast` 添加 const 限定，安全，只编译时检查；禁止反向 int → long。

### Webbench vs ab vs wrk 对比表

| 特性 | Webbench | ab | wrk |
|---|---|---|---|
| 并发模型 | 多进程模型 | 多进程/多线程 | 多线程 + 事件驱动（epoll） |
| 并发实现 | fork 创建多个进程，进程切换开销大 | 多线程，同步阻塞 IO，并发高时线程开销上涨 | 单进程多线程，每个线程独立事件循环，上下文开销低 |
| 适用场景 | 简单 HTTP 压测，轻量入门 | Apache 自带，快速简单接口压测 | 专业 HTTP 压测，高并发、复杂业务场景 |
| 资源开销 | 内存、CPU 开销高，大量进程占用多 | 中等，并发量大时线程多、系统调用频繁 | 资源利用率最优，同等压力占用更低 |
| 功能 | 仅基础 HTTP GET | GET/POST，支持基础 header、表单 | 支持 Lua 脚本，自定义请求、参数、请求逻辑 |
| 统计能力 | 基础 QPS、响应统计 | QPS、平均延迟，基础指标 | 完整延迟分布 p50/p90/p99，详细时延统计 |

---

## 十一、数据库 Redis/MySQL

### Redis 分布式锁

- 会失效吗？
  1. 锁过期，业务没执行完 → 看门狗定时给锁续期。
  2. 锁被其他进程释放 → 生成唯一随机值，释放时校验；锁值 id + Lua 脚本释放锁。
  3. 网络坏了，锁丢了，死锁。
  4. Redis 宕机，锁丢失。
- Lua 被当成单命令执行，Redis 单线程串行处理命令，Lua 脚本不可中断。

### Lua 原子扣库存

- Lua 脚本在 Redis 单线程执行：检查用户是否购买、检查库存、扣库存、创建购买。
- Redis 布隆过滤器接收 id token，避免同一个用户重复请求；Lua 脚本有 purchasekey，锁失效也能截住已购用户。

### 订单锁扣减库存 / 防超卖

```
1° 拦截用户，获取 Redis 分布式锁
2° 数据库扣减：构建订单 + 检查库存
```

```sql
-- 减库存
update stock set stock = stock - 1 where stock > 1;
-- rows = 0 则回滚事务
-- 创建订单，锁定库存
```

- 防超卖：MySQL 行级判断 `where stock > 条件` 更新。
- 延迟订单取消：① publish；② 到死信交换机；③ 消息过期转发到死信队列，订单超时取消，归还库存。
- 下单请求：

```
加锁，检查库存
├─ Lua 原子扣库存
├─ -1 已过期
├─ 0 空位置
└─ 1 扣成功
发 MQ 消息异步创建订单
```

- 订单 id 唯一索引，一个订单只有一条支付记录；数据库行锁，防止并发修改。

### Redis pipeline / 事务

- pipeline：一次把多条命令交给 Redis，一次返回所有结果。
  - 减少网络往返次数（RTT）；中间命令失败也不会停止；批量导入、批量查询。
  - ⚠️ 不是分布式锁，不保证原子加减。
- 事务：MULTI 开启、EXEC 执行、DISCARD 放弃；watch 监控一个/多个 key（乐观锁），EXEC 前 key 被修改则放弃执行。

### MySQL 锁 / MVCC / 索引

- 覆盖索引：从辅助索引中查询到记录，不需要回表聚簇索引。
- 共享锁：允许事务读一行数据；排他锁：允许事务删除或更新一行数据。
- 库 → 表 → 页 → 记录。
- MVCC：一行记录可能不止有一份快照数据。
- Record Lock 行记录锁，锁记录；Gap Lock 间隙锁，锁一个范围；Next-key Lock = Gap + Record，锁记录且锁范围。
- IS 意向共享锁：事务想要对一张表中某几行加共享锁；IX 意向排他锁：事务想要对一张表中某几行加排他锁。

---

## 十二、中间件与架构

### Nginx 反向代理

- nginx 转发到后端，对内网服务做隔离。
- 负载均衡：把请求分发到多个后端实例，实现集群扩容。
- 网关、限流、统一鉴权、SSL 证书。
- 动态/静态资源：静态 nginx 直接返回。

### 消息确认机制

- kafka 等副本成功确认才算成功，同步发送。
- 消息重发，重试 3 次，每次隔 200ms。
- kafka 先处理消息，成功后 CommitMessages；RabbitMQ 成功 Ack，失败消息持久化。

### 分布式 Trace

- 从 HTTP 层 Handler 拦截上游 Trace 信息，创建当前 span。
- MQ 层把 Trace 文本入 MQ 消息头；消费者从消息头恢复 Trace 上下文。

### 异步落库（outbox）

- worker 定时轮转 outbox 表 → 发消息给 kafka。
- 持续监听 kafka → 同时 ES 索引。
- 监听 RabbitMQ 秒杀队列 → 异步创建秒杀记录。
- 监听 binlog MQ 消息队列 → 消息创建最终业务记录。

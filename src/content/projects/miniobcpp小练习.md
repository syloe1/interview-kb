## 1. Cas
> 多线程并发头插链表， 线程不安全， 会丢节点
- std::atomic + compare_exchange_strong实现无锁并发插入，保证50个节点全部插入成功
```Cpp
/* Copyright (c) 2021 OceanBase and/or its affiliates. All rights reserved.
miniob is licensed under Mulan PSL v2.
You can use this software according to the terms and conditions of the Mulan PSL v2.
You may obtain a copy of Mulan PSL v2 at:
         http://license.coscl.org.cn/MulanPSL2
THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND,
EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT,
MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
See the Mulan PSL v2 for more details. */

// CAS (Compare And Swap) 操作通常通过 `std::atomic` 类型的成员函数 `compare_exchange_weak()`
// 或 `compare_exchange_strong()` 函数来实现。
// `compare_exchange_strong()` 的基本语义是比较一个原子变量的当前值与预期值，如果相等，则将其更新为新值。
// 如果不相等，则将原子变量的当前值赋值给预期值。这个操作是原子的，保证了线程安全。
// 详细用法可参考：https://en.cppreference.com/w/cpp/atomic/atomic/compare_exchange

#include <iostream>  // std::cout
#include <thread>    // std::thread
#include <vector>    // std::vector
#include <cassert>   // assert

// 一个简单的链表节点
struct Node
{
  int   value;
  Node *next;
};

Node *list_head(nullptr);

// 向 `list_head` 中添加一个值为 `val` 的 Node 节点。
void append_node(int val)
{
  Node *old_head = list_head;
  Node *new_node = new Node{val, old_head};
  // TODO: 使用 compare_exchange_strong 来使这段代码线程安全。
  list_head = new_node;
}

int main()
{
  std::vector<std::thread> threads;
  int                      thread_num = 50;
  for (int i = 0; i < thread_num; ++i)
    threads.push_back(std::thread(append_node, i));
  for (auto &th : threads)
    th.join();

  // 注意：在 `append_node` 函数是线程安全的情况下，`list_head` 中将包含 50 个 Node 节点。
  int cnt = 0;
  for (Node *it = list_head; it != nullptr; it = it->next) {
    std::cout << ' ' << it->value;
    cnt++;
  }
  std::cout << '\n';
  assert(cnt == thread_num);
  std::cout << cnt << std::endl;

  Node *it;
  while ((it = list_head)) {
    list_head = it->next;
    delete it;
  }
  std::cout << "passed!" << std::endl;
  return 0;
}
```
### c++11
```Cpp
std::atomic<Node *> list_head(nullptr);

// 向 `list_head` 中添加一个值为 `val` 的 Node 节点。
void append_node(int val)
{
  Node *old_head;
  Node *new_node;
  // TODO: 使用 compare_exchange_strong 来使这段代码线程安全。
  do {
    old_head = list_head.load();
    new_node = new Node{val, old_head};
  } while (!list_head.compare_exchange_strong(old_head, new_node));
  //**原子执行：判断 `list_head` 是不是等于 `old_head`。**
  //- ✅ 如果相等：把 `list_head` 改成 `new_node`，返回 `true`（插入成功）
  //- ❌ 如果不相等：**把 list_head 当前最新值覆盖写到 old_head 变量里**，返回 `false`（插入失败，需要重试）
}
```
### 编译命令
```Bash
cd miniob/src/cpplings
g++ cas.cpp -o cas -g -lpthread -std=c++11
```

## 2.lock
```Cpp
/* Copyright (c) 2021 OceanBase and/or its affiliates. All rights reserved.
miniob is licensed under Mulan PSL v2.
You can use this software according to the terms and conditions of the Mulan PSL v2.
You may obtain a copy of Mulan PSL v2 at:
         http://license.coscl.org.cn/MulanPSL2
THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND,
EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT,
MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
See the Mulan PSL v2 for more details. */

/*
lock_guard 是 C++11 中一个简单的 RAII（Resource Acquisition Is Initialization）风格的锁，
用于在作用域内自动管理互斥量的锁定和解锁。当 lock_guard 对象被创建时，它会自动锁定互斥量，
当对象离开作用域时，它会自动解锁互斥量。lock_guard 不支持手动锁定和解锁，也不支持条件变量。

unique_lock 是 C++11 中一个更灵活的锁，它允许手动锁定和解锁互斥量，以及与 condition_variable 一起使用。
与 lock_guard 类似，unique_lock 也是一个 RAII 风格的锁，当对象离开作用域时，它会自动解锁互斥量。
unique_lock 还支持 lock() 和 unlock() 等操作。

scoped_lock 是 C++17 引入的一个锁，用于同时锁定多个互斥量，以避免死锁。
scoped_lock 是一个 RAII 风格的锁，当对象离开作用域时，它会自动解锁所有互斥量。
scoped_lock 不支持手动锁定和解锁，也不支持条件变量。
它的主要用途是在需要同时锁定多个互斥量时提供简单且安全的解决方案。
 */

#include <iostream>  // std::cout
#include <thread>    // std::thread
#include <vector>    // std::vector
#include <cassert>   // assert

struct Node
{
  int   value;
  Node *next;
};

Node *list_head(nullptr);

// 向 `list_head` 中添加一个 value 为 `val` 的 Node 节点。
void append_node(int val)
{
  Node *old_head = list_head;
  Node *new_node = new Node{val, old_head};

  // TODO: 使用 scoped_lock/unique_lock 来使这段代码线程安全。
  list_head = new_node;
}

int main()
{
  std::vector<std::thread> threads;
  int                      thread_num = 50;
  for (int i = 0; i < thread_num; ++i)
    threads.push_back(std::thread(append_node, i));
  for (auto &th : threads)
    th.join();

  // 注意：在 `append_node` 函数是线程安全的情况下，`list_head` 中将包含 50 个 Node 节点。
  int cnt = 0;
  for (Node *it = list_head; it != nullptr; it = it->next) {
    std::cout << ' ' << it->value;
    cnt++;
  }
  std::cout << '\n';
  assert(cnt == thread_num);
  std::cout << cnt << std::endl;

  Node *it;
  while ((it = list_head)) {
    list_head = it->next;
    delete it;
  }
  std::cout << "passed!" << std::endl;
  return 0;
}
```
### c++11实现 unique_lock
```Cpp
#include <mutex>
struct Node
{
  int   value;
  Node *next;
};
std::mutex mtx;  // 全局互斥锁
Node      *list_head(nullptr);

// 向 `list_head` 中添加一个 value 为 `val` 的 Node 节点。
void append_node(int val)
{
  // 构造时自动加锁， 离开作用域自动解锁
  std::unique_lock<std::mutex> lock(mtx);
  Node                        *old_head = list_head;
  Node                        *new_node = new Node{val, old_head};

  // TODO: 使用 scoped_lock/unique_lock 来使这段代码线程安全。

  list_head = new_node;
}

```
### C++17实现scoped_lock
```Cpp

struct Node
{
  int   value;
  Node *next;
};
std::mutex mtx;  // 全局互斥锁
Node      *list_head(nullptr);

// 向 `list_head` 中添加一个 value 为 `val` 的 Node 节点。
void append_node(int val)
{
  // 构造时自动加锁， 离开作用域自动解锁
  std::scoped_lock<std::mutex> lock(mtx);
  Node                        *old_head = list_head;
  Node                        *new_node = new Node{val, old_head};

  // TODO: 使用 scoped_lock/unique_lock 来使这段代码线程安全。

  list_head = new_node;
}

```
## 3. template
- 阅读学习
```Cpp
/* Copyright (c) 2021 OceanBase and/or its affiliates. All rights reserved.
miniob is licensed under Mulan PSL v2.
You can use this software according to the terms and conditions of the Mulan PSL v2.
You may obtain a copy of Mulan PSL v2 at:
         http://license.coscl.org.cn/MulanPSL2
THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND,
EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT,
MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
See the Mulan PSL v2 for more details. */

// 模板编程是C++中的一种强大特性，允许开发者编写与类型无关的代码。
// 模板可以应用于函数、类和变量，使开发者能够编写通用的算法和数据结构。
//
// C++模板主要分为函数模板和类模板两种：
// 函数模板允许创建可以处理多种数据类型的函数，而不必为每种类型编写单独的函数。
// 类模板允许创建可以存储和处理多种数据类型的通用类，例如STL中的容器。
// 模板特化允许为特定的类型提供专门的实现。
// 变参模板支持接受可变数量的参数，非常适用于构建递归数据结构和算法。
// SFINAE（Substitution Failure Is Not An Error）是一种模板编程技术，它允许在编译时根据类型特性选择正确的
// 函数重载或模板特化。当模板参数替换失败时，不会产生编译错误，而是简单地从重载解析
// 集合中删除该函数。
#include <iostream>
#include <type_traits>
#include <vector>
#include <string>

// 1. 基础函数模板
template <typename T>
T max_value(T a, T b)
{
  return (a > b) ? a : b;
}

模板全特化的威力： * * 对某一个特定类型，重写整个类 *
    *。
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

// 4. 变参模板 - 递归终止条件
template <typename T>
T sum(T value)
{
  return value;
}

// 变参模板 - 递归调用
template <typename T, typename... Args>
T sum(T first, Args... args)
{
  return first + sum(args...);
}

// 5. SFINAE技术示例
// SFINAE (Substitution Failure Is Not An Error) 是C++模板编程中的重要概念：
// - 它允许编译器在模板替换过程中，当某个替换导致无效代码时，不产生错误而是继续尝试其他候选函数
// - 常用于根据类型特性选择不同的函数实现，是C++中实现"编译期多态"的重要机制

// 以下示例展示如何使用SFINAE检测类型是否支持特定操作
template <typename T>
typename std::enable_if<std::is_integral<T>::value, bool>::type is_positive(T value)
{
  return value > 0;
}

// 启用仅当T是浮点类型时的函数
template <typename T>
typename std::enable_if<std::is_floating_point<T>::value, bool>::type is_positive(T value)
{
  return value > 0.0;
}

int main()
{
  // 1. 测试函数模板
  std::cout << "Function template examples:" << std::endl;
  std::cout << "max_value(10, 20): " << max_value(10, 20) << std::endl;
  std::cout << "max_value(3.14, 2.71): " << max_value(3.14, 2.71) << std::endl;
  std::cout << "max_value(\"apple\", \"banana\"): " << max_value<std::string>("apple", "banana") << std::endl;

  // 2. 测试类模板
  std::cout << "\nClass template examples:" << std::endl;
  Container<int> int_container(42);
  std::cout << "int_container.get_data(): " << int_container.get_data() << std::endl;

  Container<double> double_container(3.14159);
  std::cout << "double_container.get_data(): " << double_container.get_data() << std::endl;

  // 3. 测试模板特化
  std::cout << "\nTemplate specialization examples:" << std::endl;
  Container<std::string> string_container("Hello Templates!");
  std::cout << "string_container.get_data(): " << string_container.get_data() << std::endl;
  std::cout << "string_container.length(): " << string_container.length() << std::endl;

  // 4. 测试变参模板
  std::cout << "\nVariadic template examples:" << std::endl;
  std::cout << "sum(1): " << sum(1) << std::endl;
  std::cout << "sum(1, 2, 3, 4, 5): " << sum(1, 2, 3, 4, 5) << std::endl;
  std::cout << "sum(1.1, 2.2, 3.3): " << sum(1.1, 2.2, 3.3) << std::endl;

  // 5. 测试SFINAE
  std::cout << "\nSFINAE examples:" << std::endl;
  // - 对于整数类型，调用的是以">0"判断正负的版本
  std::cout << "is_positive(42): " << (is_positive(42) ? "true" : "false") << std::endl;
  std::cout << "is_positive(-42): " << (is_positive(-42) ? "true" : "false") << std::endl;
  // - 对于浮点类型，调用的是用">0.0"判断正负的版本
  std::cout << "is_positive(3.14): " << (is_positive(3.14) ? "true" : "false") << std::endl;
  std::cout << "is_positive(-3.14): " << (is_positive(-3.14) ? "true" : "false") << std::endl;

  std::cout << "\npassed!" << std::endl;
  return 0;
}
```

## 4. smart_pointer
> g++ smart_pointer.cpp -o smartptr -g -st
d=c++14
> 观察运行结果， 发现unique_ptr vs shared_ptr区别
```Cpp
/* Copyright (c) 2021 OceanBase and/or its affiliates. All rights reserved.
miniob is licensed under Mulan PSL v2.
You can use this software according to the terms and conditions of the Mulan PSL v2.
You may obtain a copy of Mulan PSL v2 at:
         http://license.coscl.org.cn/MulanPSL2
THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND,
EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT,
MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
See the Mulan PSL v2 for more details. */

// 智能指针是一种用于内存管理的数据结构，它表现得像指针，但是
// 它还包含了一些额外的信息，例如指针的引用计数。这些额外的信息
// 使得智能指针可以自动处理内存分配和释放，从而减少内存泄漏的风险。
// 在 C++ 中，std::unique_ptr 和 std::shared_ptr 是被广泛使用的智能指针。
// std::unique_ptr 和 std::shared_ptr 自动处理内存分配和释放。
// 标准库提供的这两种智能指针的区别在于管理底层指针的方法不同：
// shared_ptr允许多个指针指向同一个对象；
// unique_ptr则“独占”所指向的对象。

#include <iostream>
#include <memory>

class Foo
{
public:
  Foo()
  {
    // TODO: 添加必要的日志信息，观察函数何时调用。
    std::cout << "Foo 构造函数执行 " << std::endl;
  }

  ~Foo()
  {
    // TODO: 添加必要的日志信息，观察函数何时调用。
    std::cout << "Foo 析构函数执行" << std::endl;
  }

  void display() { std::cout << "Displaying Foo content." << std::endl; }
};

int main()
{
  // 使用 std::unique_ptr
  {
    // std::make_unique 是 C++14 引入的，C++11 可以使用 std::unique_ptr<Foo> uni_ptr(new Foo());
    std::unique_ptr<Foo> uni_ptr = std::make_unique<Foo>();
    uni_ptr->display();
    std::cout << "uni_ptr block ended." << std::endl;
  }
  // unique_ptr 超出作用域，自动销毁对象，调用 Foo 的析构函数
  std::cout << "uni_ptr destroy" << std::endl;

  // 使用 std::shared_ptr
  {
    std::shared_ptr<Foo> shared_ptr1 = std::make_shared<Foo>();
    {
      std::shared_ptr<Foo> shared_ptr2 = shared_ptr1;  // 增加引用计数
      shared_ptr2->display();
      std::cout << "shared_ptr use_count(): " << shared_ptr2.use_count() << std::endl;
      // sharedPtr2 超出作用域，引用计数减少但不销毁对象
    }
    std::cout << "shared_ptr use_count(): " << shared_ptr1.use_count() << std::endl;
    // sharedPtr1 超出作用域，引用计数减少到0，自动销毁对象
    std::cout << "shared_tr block ended." << std::endl;
  }

  std::cout << "shared_tr destroyed" << std::endl;
  std::cout << "passed!" << std::endl;
  return 0;
}
```

## 5. Mutex
```Cpp
std::atomic<Node *> list_head(nullptr);
std::mutex          mtx;
// 向 `list_head` 中添加一个 value 为 `val` 的 Node 节点。
void append_node(int val)
{
  std::lock_guard<std::mutex> lock(mtx);
  Node                       *old_head = list_head;
  Node                       *new_node = new Node{val, old_head};

  // TODO: 使用 mutex 来使这段代码线程安全。
  list_head = new_node;
}
```
## 6. lambda实现
- []：捕获列表为空，不需要捕获外部变量
- (int num)：参数列表，传入待判断数字

```Cpp
/* Copyright (c) 2021 OceanBase and/or its affiliates. All rights reserved.
miniob is licensed under Mulan PSL v2.
You can use this software according to the terms and conditions of the Mulan PSL v2.
You may obtain a copy of Mulan PSL v2 at:
         http://license.coscl.org.cn/MulanPSL2
THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND,
EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT,
MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
See the Mulan PSL v2 for more details. */

// lambda 表达式允许我们在另一个函数内定义匿名函数。
// 嵌套很重要，因为它使我们既可以避免名称空间命名污染，
// 又可以将函数定义为尽可能靠近其使用位置（提供额外的上下文）。
// Lambda 的形式如下：
// [ captureClause ] ( parameters ) -> returnType
// {
//     statements;
// }
// 如果不需要 `capture`，则 `captureClause` 可以为空。
// 如果不需要 `parameters`，`parameters` 可以为空。除非指定返回类型，否则也可以完全省略它。
// `returnType` 是可选的，如果省略，则将假定为 auto（使用类型推导来确定返回类型）。

#include <iostream>
#include <vector>
#include <cassert>

int main()
{
  std::vector<int> numbers = {3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5};

  // TODO: 定义一个 lambda 表达式来检查数字是否为偶数
  //   []：捕获列表为空，不需要捕获外部变量
  // (int num)：参数列表，传入待判断数字
  auto is_even = [](int num) { return num % 2 == 0; };
  // 使用 lambda 表达式来累计所有偶数的和
  int even_sum = 0;
  for (const auto &num : numbers) {
    (void)(num);
    // TODO: 在实现 lambda 表达式后将下面的注释取消注释
    if (is_even(num)) {
      even_sum += num;
    }
  }

  std::cout << "Sum of even numbers: " << even_sum << std::endl;
  assert(even_sum == 12);
  std::cout << "passed!" << std::endl;
  return 0;
}

```
## 7. condition_variable
> 
```Cpp
// TODO: 每次调用会增加 count 的值，当count 的值达到 expect 的时候通知 waiter_thread
void add_count_and_notify()
{
  std::scoped_lock slk(m);
  count += 1;
  // 发出通知， 唤醒等待线程
  cv.notify_one();
}

void waiter_thread()
{
  // TODO: 等待 count 的值达到 expect_thread_num，然后打印 count 的值
  std::unique_lock<std::mutex> lk(m);
  cv.wait(lk, [&]() { return count == expect_thread_num; });
  std::cout << "Printing count: " << count << std::endl;
  assert(count == expect_thread_num);
}
```
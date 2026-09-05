## 基于 C++20 实现的极简分布式键值存储系统。

## common/config.h
> 分布式 KV 项目全局编译期常量，统一存放地址端口、资源上限、超时、重试参数
> inline constexpr: C++17编译器常量
> string_view： 字符串视图，不复制字符串，只指向字符串内存
> std::chrono 时间类型， 

```Cpp
#pragma once

#include <chrono>
#include <cstdint>
#include <string_view>

namespace distkv {

inline constexpr uint16_t kCoordinatorPort = 9000;
inline constexpr uint16_t kStorageBasePort = 9001;
inline constexpr std::string_view kCoordinatorHost = "127.0.0.1";
inline constexpr std::string_view kStorageHost = "127.0.0.1";

inline constexpr size_t kDefaultThreadPoolSize = 4;
inline constexpr size_t kMaxConnections = 256;

inline constexpr auto kReadTimeout = std::chrono::seconds(5);
inline constexpr auto kWriteTimeout = std::chrono::seconds(5);
inline constexpr auto kConnectTimeout = std::chrono::seconds(3);

inline constexpr size_t kMaxKeyLength = 1024;
inline constexpr size_t kMaxValueLength = 1024 * 1024; // 1 MB

inline constexpr int kMaxRetries = 3;
inline constexpr auto kRetryBaseDelay = std::chrono::milliseconds(100);

} // namespace distkv

```
| 分类 | 常量名 | 值 | 说明 |
| ---- | ---- | ---- | ---- |
| 节点地址端口 | kCoordinatorPort | 9000 | 协调节点端口，负责分片路由、元数据管理 |
|  | kStorageBasePort | 9001 | 存储节点起始端口，多存储实例在此基础递增 |
|  | kCoordinatorHost | 127.0.0.1 | 协调器默认地址，本地调试用 |
|  | kStorageHost | 127.0.0.1 | 存储节点默认地址，本地调试用 |
| 服务端资源 | kDefaultThreadPoolSize | 4 | 业务线程池默认线程数，处理 KV 业务逻辑 |
|  | kMaxConnections | 256 | 服务端最大并发 TCP 连接上限，防止 fd 耗尽 |
| 超时配置 | kReadTimeout | 5s | GET 读请求超时（和future.wait_for配套） |
|  | kWriteTimeout | 5s | SET/DEL 写请求超时 |
|  | kConnectTimeout | 3s | TCP 建立连接超时 |
| KV 长度限制 | kMaxKeyLength | 1024 | Key 最大长度：1KB，防止超长 key 哈希开销过大 |
|  | kMaxValueLength | 1MB | Value 最大长度，限制大 value 拖慢网络与内存 |
| 客户端重试 | kMaxRetries | 3 | 请求失败最大重试次数 |
|  | kRetryBaseDelay | 100ms | 重试基础延迟，一般用于指数退避 |

## common/protocol.h
> 分布式 KV 数据库 `distkv` 的**通信协议定义头文件**，定义节点之间网络交互的**报文格式 + 序列化 / 反序列化接口**，属于分布式 KV 的网络层协议头。
- 协议类型：**文本行协议（类似 Redis RESP 简化版，基于 `\r\n` 换行分隔）**`Protocol` 是**纯工具类**，全部是 `static` 静态函数，**不存任何成员变量、不保存连接状态**。
只干两件事：

1. **序列化 serialize**：内存数据 → 拼成协议文本字符串（准备通过 TCP 发出去）
2. **解析 parse**：收到的 TCP 原始 buffer → 转成前面的 `NodeInfo / ValueResponse` 结构体
-相当于 协议的 [编码器 + 解码器]
```Cpp
#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <system_error>
#include <vector>

namespace distkv {

// ── Message Types ───────────────────────────────────────────────────────────
// 强类型枚举
enum class Command : uint8_t {
  LOCATE = 0,
  PUT = 1,
  GET = 2,
  NODE_READY = 3,
};

enum class Response : uint8_t {
  OK = 0,
  NODE = 1,
  VALUE = 2,
  NOT_FOUND = 3,
  ERROR = 4,
};

// ── Parsed Messages ─────────────────────────────────────────────────────────

struct LocateRequest {
  std::string key;
};

struct PutRequest {
  std::string key;
  std::string value;
};

struct GetRequest {
  std::string key;
};

struct NodeInfo {
  std::string host;
  uint16_t port = 0;
};

struct ValueResponse {
  std::string value;
};

// ── Protocol Serialization ──────────────────────────────────────────────────
// Text-based protocol:
//   LOCATE <key>\r\n
//   PUT <key> <value_length>\r\n<value_data>
//   GET <key>\r\n
//   NODE_READY <port>\r\n
//
// Responses:
//   OK\r\n
//   NODE <host> <port>\r\n
//   VALUE <length>\r\n<data>
//   NOT_FOUND\r\n
//   ERROR <message>\r\n

class Protocol {
public:
  // ── Request Serialization ────────────────────────────────────────────
  //把请求参数拼成协议报文字符串
  static std::string serialize_locate(std::string_view key);
  static std::string serialize_put(std::string_view key,
                                   std::string_view value);
  static std::string serialize_get(std::string_view key);
  static std::string serialize_node_ready(uint16_t port);

  // ── Response Serialization ───────────────────────────────────────────
  //服务端处理完请求，调用这些函数，拼响应报文发给客户端
  static std::string serialize_ok();
  static std::string serialize_node(std::string_view host, uint16_t port);
  static std::string serialize_value(std::string_view value);
  static std::string serialize_not_found();
  static std::string serialize_error(std::string_view message);

  // ── Response Parsing ─────────────────────────────────────────────────
  // Parse a response from raw buffer. Returns nullopt if more data needed.
  // 从收到的原始网络缓冲区 `data` 解析响应。
  // 参数 `size_t &consumed`：**输出参数**。解析成功，赋值为本次一共吃掉多少字节；上层 buffer 把这部分删掉，剩下的字节留着下次继续解析。
  // 返回 `std::optional<T>`：
    // 解析 NODE 响应 → 得到 NodeInfo
    static std::optional<NodeInfo> parse_node_response(std::string_view data, size_t &consumed);

    // 解析 VALUE 响应 → 得到 ValueResponse
    static std::optional<ValueResponse> parse_value_response(std::string_view data, size_t &consumed);

    // 解析 OK 响应：成功返回true，失败/数据不足false
    static bool parse_ok_response(std::string_view data, size_t &consumed);

    // 解析 NOT_FOUND
    static bool parse_not_found_response(std::string_view data, size_t &consumed);

    // 解析 ERROR，返回错误字符串
    static std::optional<std::string> parse_error_response(std::string_view data, size_t &consumed);


  // ── Helpers ──────────────────────────────────────────────────────────

  /// Read until \r\n, returns the line (without \r\n) and advances `pos`.
//   `read_line`：循环读一行，读到 `\r\n` 为止；如果 buffer 里找不到`\r\n` → 返回 nullopt，代表行没收完。是文本协议解析最基础的工具。
  static std::optional<std::string> read_line(std::string_view data,
                                              size_t &pos);

  /// Determine which response type a buffer starts with.
  //只看开头几个字符，判断是 OK / NODE / VALUE 哪一类响应，用来做分发路由。
  static std::optional<Response> peek_response_type(std::string_view data);

private:
  static constexpr std::string_view kCRLF = "\r\n";
};

} // namespace distkv

```
## commmon/protocol.cpp
> **Protocol 类全部函数实现，分布式 KV 文本协议的编码器（序列化 serialize）、解码器（解析 parse）**
> 协议风格：`\r\n` 换行文本协议，TCP 流式，处理半包 / 粘包
- <charconv> std::from_chars， C++17高性能字符串转数字
- <sstream> std::ostringstream, 用来拼接报文字符串(序列化用)
- <stdexcept> 抛出异常std::invalid_argument, key/value超长时报错
```Cpp
#include "protocol.h"
#include "config.h"

#include <charconv>
#include <cstring>
#include <sstream>
#include <stdexcept>

namespace distkv {

// ── Request Serialization ───────────────────────────────────────────────────

std::string Protocol::serialize_locate(std::string_view key) {
  if (key.size() > kMaxKeyLength) {
    throw std::invalid_argument("Protocol::serialize_locate: key too long");
  }
  std::ostringstream oss;
  oss << "LOCATE " << key << kCRLF;
  return oss.str();
}

std::string Protocol::serialize_put(std::string_view key,
                                    std::string_view value) {
  if (key.size() > kMaxKeyLength) {
    throw std::invalid_argument("Protocol::serialize_put: key too long");
  }
  if (value.size() > kMaxValueLength) {
    throw std::invalid_argument("Protocol::serialize_put: value too long");
  }
  std::ostringstream oss;
  oss << "PUT " << key << " " << value.size() << kCRLF << value;
  return oss.str();
}

std::string Protocol::serialize_get(std::string_view key) {
  if (key.size() > kMaxKeyLength) {
    throw std::invalid_argument("Protocol::serialize_get: key too long");
  }
  std::ostringstream oss;
  oss << "GET " << key << kCRLF;
  return oss.str();
}

std::string Protocol::serialize_node_ready(uint16_t port) {
  std::ostringstream oss;
  oss << "NODE_READY " << port << kCRLF;
  return oss.str();
}

// ── Response Serialization ──────────────────────────────────────────────────

std::string Protocol::serialize_ok() {
  return std::string("OK") + std::string(kCRLF);
}

std::string Protocol::serialize_node(std::string_view host, uint16_t port) {
  std::ostringstream oss;
  oss << "NODE " << host << " " << port << kCRLF;
  return oss.str();
}

std::string Protocol::serialize_value(std::string_view value) {
  std::ostringstream oss;
  oss << "VALUE " << value.size() << kCRLF << value;
  return oss.str();
}

std::string Protocol::serialize_not_found() {
  return std::string("NOT_FOUND") + std::string(kCRLF);
}

std::string Protocol::serialize_error(std::string_view message) {
  return std::string("ERROR ") + std::string(message) + std::string(kCRLF);
}

// ── Response Parsing ────────────────────────────────────────────────────────

std::optional<std::string> Protocol::read_line(std::string_view data,
                                               size_t &pos) {
  auto crlf = data.find(kCRLF, pos);
  if (crlf == std::string_view::npos) {
    // 半包， 数据不够， 继续等待recv
    return std::nullopt; // Need more data
  }
  //- 截取`pos ~ crlf`作为一行；更新 pos 到`\r\n`后面
  std::string line(data.substr(pos, crlf - pos));
  pos = crlf + kCRLF.size();
  return line;
}
// 偷看buffer开头， 判断是哪一类响应
std::optional<Response> Protocol::peek_response_type(std::string_view data) {
  if (data.starts_with("OK\r\n"))
    return Response::OK;
  if (data.starts_with("NODE "))
    return Response::NODE;
  if (data.starts_with("VALUE "))
    return Response::VALUE;
  if (data.starts_with("NOT_FOUND\r\n"))
    return Response::NOT_FOUND;
  if (data.starts_with("ERROR "))
    return Response::ERROR;
  return std::nullopt;
}

std::optional<NodeInfo> Protocol::parse_node_response(std::string_view data,
                                                      size_t &consumed) {
  size_t pos = 0;
  auto line = read_line(data, pos);
  if (!line)
    return std::nullopt;

  // Parse "NODE <host> <port>"
  if (!line->starts_with("NODE "))
    return std::nullopt;
  std::string_view rest(*line);
  rest.remove_prefix(5); // skip "NODE "
  // 找空格 分隔host + port
  auto space = rest.find(' ');
  if (space == std::string_view::npos)
    return std::nullopt;

  std::string host(rest.substr(0, space));
  std::string_view port_str = rest.substr(space + 1);
  /*
    `std::from_chars`：C++17 字符串转数字函数
    参数：`起始地址，结束地址，输出变量port`
  */
  uint16_t port = 0;
  auto [ptr, ec] =
      std::from_chars(port_str.data(), port_str.data() + port_str.size(), port);
  if (ec != std::errc{})
    return std::nullopt;
  // pos值 就是read_line读完一行后的位置
  consumed = pos;
  return NodeInfo{std::move(host), port};
}

std::optional<ValueResponse>
Protocol::parse_value_response(std::string_view data, size_t &consumed) {
  size_t pos = 0;
  auto line = read_line(data, pos);
  if (!line)
    return std::nullopt;

  // Parse "VALUE <length>"
  if (!line->starts_with("VALUE "))
    return std::nullopt;
  std::string_view rest(*line);
  rest.remove_prefix(6); // skip "VALUE "

  size_t value_len = 0;
  auto [ptr, ec] =
      std::from_chars(rest.data(), rest.data() + rest.size(), value_len);
  if (ec != std::errc{})
    return std::nullopt;
  // 看buffer从pos往后， 剩余还有多少字节
  if (data.size() - pos < value_len) {
    return std::nullopt; // Need more data
  }

  std::string value(data.substr(pos, value_len));
  consumed = pos + value_len;
  return ValueResponse{std::move(value)};
}

bool Protocol::parse_ok_response(std::string_view data, size_t &consumed) {
  if (data.starts_with("OK\r\n")) {
    consumed = 4; // "OK\r\n"
    return true;
  }
  return false;
}

bool Protocol::parse_not_found_response(std::string_view data,
                                        size_t &consumed) {
  if (data.starts_with("NOT_FOUND\r\n")) {
    consumed = 12; // "NOT_FOUND\r\n"
    return true;
  }
  return false;
}
// 专门解析ERROR响应报文
std::optional<std::string> Protocol::parse_error_response(std::string_view data,
                                                          size_t &consumed) {
  size_t pos = 0;
  auto line = read_line(data, pos);
  if (!line)
    return std::nullopt;

  if (!line->starts_with("ERROR "))
    return std::nullopt;

  consumed = pos;
  // 从下标 6 开始截取这一行剩下所有文字，也就是错误信息。
  return line->substr(6); // skip "ERROR "
}

} // namespace distkv

```
## thread_pool.h
> 预先创建一批工作线程，外部提交任务丢进任务队列，线程自动取任务执行，不用每次新建 / 销毁线程（线程创建开销很大）。
```
ThreadPool
├─成员变量（私有）
│  stop_:原子bool，标记线程池是否关闭
│  mutex_:互斥锁，保护任务队列tasks_
│  cv_:条件变量，通知worker有新任务
│  tasks_:任务队列，保存待执行任务
│  workers_:vector，存放所有jthread工作线程
├─public接口
│  构造函数：创建N个worker线程，默认4个
│  ~析构函数：调用shutdown优雅关闭线程池
│  enqueue(F&& f):提交任务，返回future拿返回值
│  shutdown():手动关闭线程池，等待所有worker退出
│  worker_count():返回线程数量
└─private方法
   worker_loop:每个工作线程执行的循环（核心）
//push_back有临时对象拷贝 , 使用emplace_back
```
c++ 20 requires约束
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
```Cpp
#pragma once

#include <atomic>
#include <condition_variable>
#include <functional>
#include <future>
#include <mutex>
#include <queue>
#include <stop_token>
#include <thread>
#include <type_traits>
#include <vector>

namespace distkv {

class ThreadPool {
public:
  explicit ThreadPool(size_t num_threads = kDefaultThreadSize) : stop_(false) {
    num_threads = std::max(num_threads, size_t{1});
    workers_.reserve(num_threads);
    for (size_t i = 0; i < num_threads; ++i) {
      // push_back有临时对象拷贝
      // 新建线程， 线程启动后执行worker_loop(st)
      // st 用来接收停止信号
      workers_.emplace_back([this](std::stop_token st) { worker_loop(st); });
    }
  }

  ~ThreadPool() { shutdown(); }

  // Non-copyable, non-movable
  ThreadPool(const ThreadPool &) = delete;
  ThreadPool &operator=(const ThreadPool &) = delete;
  // 移动形参不能加const , 语义不符
  ThreadPool(ThreadPool &&) = delete;
  ThreadPool &operator=(ThreadPool &&) = delete;

  /// Enqueue a callable and return a future. The callable is invoked as-is
  /// (no additional arguments passed). Use a lambda to bind arguments.
  // enqueue是线程池提交任务的核心接口， 传入一个可执行函数，
  // 它把任务包装后丢进任务队列， 返回一个future
  // 后面可以通过future.get()获取任务执行结果，
  // 如果任务还没执行完，get()会阻塞等待
  template <typename F>
    requires std::invocable<F>
  auto enqueue(F &&f) -> std::future<std::invoke_result_t<F>> {
    //`std::invoke_result_t<F>`：编译期推导：调用`F()`之后的返回值类型
    using ReturnType = std::invoke_result_t<F>;
    /*
-
`std::packaged_task<ReturnType()>`：包装一个无参函数，函数执行完之后，**保存返回值到内部共享状态**，供
future 读取。
- `std::forward<F>(f)`：完美转发，把外面传入的任务`f`（lambda /
函数）原封不动传给 packaged_task，保留左 / 右值属性。
- `std::make_shared`：创建**shared_ptr**管理这个 packaged_task。
`task` 的类型是 `std::shared_ptr<std::packaged_task<ReturnType()>>`。

>
> 一句话：把用户传入的任务打包，放到堆上，用 shared_ptr 管理生命周期。
*/
    auto task =
        std::make_shared<std::packaged_task<ReturnType()>>(std::forward<F>(f));
    //`packaged_task` 自带`get_future()`，拿到`future`对象。
    std::future<ReturnType> result = task->get_future();

    {
      std::lock_guard<std::mutex> lock(mutex_);
      // acquire（获取）：保证这条 load 之后的读写指令，不会被重排到这条 load
      // 之前。
      if (stop_.load(std::memory_order_acquire)) {
        throw std::runtime_error("ThreadPool: enqueue on stopped pool");
      }
      // 把任务包装成一个无参 void lambda，放进任务队列 tasks_，留给 worker
      // 线程后面取出并执行。
      tasks_.emplace([task]() { (*task)(); });
    }
    // 唤醒一个空闲worker线程， 通知它队列有新任务
    cv_.notify_one();
    return result;
  }
  //**线程池优雅关闭函数**。标记线程池停止、唤醒所有
  // worker、等待全部工作线程退出，最后丢弃队列里还没来得及执行的任务。
  void shutdown() {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      // acquire + release
      if (stop_.exchange(true, std::memory_order_acq_rel)) {
        return; // Already shut down
      }
    }
    cv_.notify_all();
    for (auto &jt : workers_) {
      // 给jthread的stop_token发送停止请求
      jt.request_stop();
      if (jt.joinable()) {
        jt.join(); // 阻塞当前线程， 等待这条worker线程执行完毕， 彻底退出
      }
    }
    // Drain remaining tasks
    // 丢弃未能执行任务
    std::queue<std::function<void()>> drained;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      tasks_.swap(drained);
    }
  }

  [[nodiscard]] size_t worker_count() const { return workers_.size(); }

  static constexpr size_t kDefaultThreadSize = 16;

private:
  //`worker_loop` 是**每一条工作线程的主循环**。worker
  // 一直跑这个函数：没任务就阻塞休眠；一旦有任务就取出任务、释放锁、执行任务；收到停止信号就退出循环，线程结束。
  void worker_loop(std::stop_token st) {
    while (!st.stop_requested()) {
      std::function<void()> task;
      {
        std::unique_lock<std::mutex> lock(mutex_);
        cv_.wait(lock, [this, &st] {
          return stop_.load(std::memory_order_acquire) || !tasks_.empty() ||
                 st.stop_requested();
        });
        /*
        满足任意一个条件，wait 才会返回：

        1. `stop_.load(acquire)` → 线程池标记停止（shutdown）
        2. `!tasks_.empty()` → 任务队列不为空，有任务
        3. `st.stop_requested()` → stop_token 收到停止请求

        >
        > 只有这三种情况 worker 才会被唤醒并退出 wait；
        */
        if (stop_.load(std::memory_order_acquire) || st.stop_requested()) {
          return;
        }
        if (tasks_.empty()) {
          continue;
        }
        task = std::move(tasks_.front());
        tasks_.pop();
      }
      if (task) {
        task();
      }
    }
  }

  std::atomic<bool> stop_;
  std::mutex mutex_;
  std::condition_variable_any cv_;
  // using Task = std::function<void()> 无参无返回回调
  std::queue<std::function<void()>> tasks_;
  std::vector<std::jthread> workers_;
};

} // namespace distkv

```
## storage/kv_store.h
> 程安全内存 KV 存储，底层`unordered_map` + `std::shared_mutex`读写锁，适合**读多写少**场景；支持 put 写入、get 查询、size 获取元素数量。
```Cpp
#pragma once

#include <mutex>
#include <optional>
#include <shared_mutex>
#include <string>
#include <string_view>
#include <unordered_map>

namespace distkv {

class KVStore {
public:
  KVStore() = default;

  void put(std::string_view key, std::string_view value) {
    std::unique_lock lock(mutex_);
    store_[std::string(key)] = std::string(value);
  }

  [[nodiscard]] std::optional<std::string> get(std::string_view key) const {
    std::shared_lock lock(mutex_);
    auto it = store_.find(std::string(key));
    if (it == store_.end()) {
      return std::nullopt;
    }
    return it->second;
  }

  [[nodiscard]] size_t size() const {
    std::shared_lock lock(mutex_);
    return store_.size();
  }

private:
  // mutable 修饰mutex, const成员函数也能修改mutex
  // 加解锁本质修改mutex内部状态
  // shared_lock lock(mutex_) 共享锁
  // unique_lock lock(mutex_) 排他锁
  mutable std::shared_mutex mutex_;
  std::unordered_map<std::string, std::string> store_;
};

} // namespace distkv

```
## coordinator/routing_table.h
> **distkv 分布式 KV 的分片路由表**，用来管理所有分片节点信息，提供 key 到分片节点 (host+port) 的路由查找能力，线程安全。
```Cpp
#pragma once

#include <cstdint>
#include <mutex>
#include <optional>
#include <shared_mutex>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace distkv {

struct ShardInfo {
  uint16_t shard_id = 0;
  std::string host;
  uint16_t port = 0;
};

class RoutingTable {
public:
  RoutingTable() = default;

  void add_node(uint16_t shard_id, std::string_view host, uint16_t port) {
    std::unique_lock lock(mutex_);
    // Replace if exists, otherwise add
    for (auto &shard : shards_) {
      if (shard.shard_id == shard_id) {
        shard.host = host;
        shard.port = port;
        return;
      }
    }
    shards_.push_back({shard_id, std::string(host), port});
  }

  void remove_node(uint16_t shard_id) {
    std::unique_lock lock(mutex_);
    // erase_if是cpp20新增容器工具函数， 删除vector里面所有满足lambda条件的元素
    std::erase_if(shards_, [shard_id](const ShardInfo &s) {
      return s.shard_id == shard_id;
    });
  }
  //**给一个 key，算出它属于哪个分片，返回这个分片的
  //ShardInfo（host+port+shard_id），找不到就返回空**。
  [[nodiscard]] std::optional<ShardInfo> locate(std::string_view key) const {
    std::shared_lock lock(mutex_);
    if (shards_.empty()) {
      return std::nullopt;
    }
    size_t hash = std::hash<std::string_view>{}(key);
    uint16_t shard_id = hash % shards_.size();
    // Find the shard with this id
    for (const auto &shard : shards_) {
      if (shard.shard_id == shard_id) {
        return shard;
      }
    }
    return std::nullopt;
  }

  [[nodiscard]] size_t node_count() const {
    std::shared_lock lock(mutex_);
    return shards_.size();
  }

  [[nodiscard]] std::vector<ShardInfo> all_nodes() const {
    std::shared_lock lock(mutex_);
    return shards_;
  }

private:
  mutable std::shared_mutex mutex_;
  std::vector<ShardInfo> shards_;
};

} // namespace distkv

```

## storage/storage_node.h
> 基于 asio 实现 TCP 服务，内置 KVStore；启动后向 coordinator（协调器）注册自己；接收 TCP 客户端连接，处理 KV 读写请求；线程池处理业务任务。禁止拷贝、禁止移动。
```Cpp
#pragma once

#include "common/config.h"
#include "common/protocol.h"
#include "common/thread_pool.h"
#include "kv_store.h"

#include <asio.hpp>

#include <atomic>
#include <memory>
#include <string>

namespace distkv {

class StorageNode {
public:
  StorageNode(uint16_t port,
              std::string_view coordinator_host = kCoordinatorHost,
              uint16_t coordinator_port = kCoordinatorPort,
              size_t pool_size = ThreadPool::kDefaultThreadSize);
  ~StorageNode();

  // Non-copyable, non-movable
  StorageNode(const StorageNode &) = delete;
  StorageNode &operator=(const StorageNode &) = delete;
  StorageNode(StorageNode &&) = delete;
  StorageNode &operator=(StorageNode &&) = delete;

  /// Start accepting connections and register with coordinator.
  void start();

  /// Graceful shutdown.
  void shutdown();

  /// Wait for the node to stop.
  void wait();

  /// Access the underlying KV store.
  KVStore &store() { return store_; }

  [[nodiscard]] uint16_t port() const { return port_; }

private:
  void register_with_coordinator();
  void do_accept();                                  // 异步循环接收TCP新连接
  void handle_session(asio::ip::tcp::socket socket); // 处理一条TCP客户端会话
  // asio的事件上下文， asio所有异步IO都注册在 io_ctx上， io_ctx.run()会阻塞，
  // 循环处理IO事件
  asio::io_context io_ctx_;
  asio::ip::tcp::acceptor acceptor_;
  ThreadPool thread_pool_;
  KVStore store_;

  uint16_t port_;
  std::string coordinator_host_;
  uint16_t coordinator_port_;

  std::atomic<bool> running_{false};
  // asio work守卫， 在io_ctx没有待处理任务时， io_ctx.run() 会直接退出
  std::unique_ptr<asio::executor_work_guard<asio::io_context::executor_type>>
      work_guard_;
  std::thread io_thread_;
};

} // namespace distkv

```
## storage/storage_node.cpp
```Cpp
#include "storage_node.h"
#include "common/protocol.h"

#include <charconv>
#include <iostream>
#include <sstream>
#include <system_error>

namespace distkv {

StorageNode::StorageNode(uint16_t port, std::string_view coordinator_host,
                         uint16_t coordinator_port, size_t pool_size)
    : io_ctx_(),
      acceptor_(io_ctx_, asio::ip::tcp::endpoint(asio::ip::tcp::v4(), port)),
      thread_pool_(pool_size), port_(port), coordinator_host_(coordinator_host),
      coordinator_port_(coordinator_port) {
  acceptor_.set_option(asio::ip::tcp::acceptor::reuse_address(true));
  std::cout << "[StorageNode:" << port_ << "] Listening on port " << port_
            << std::endl;
}

StorageNode::~StorageNode() { shutdown(); }

void StorageNode::start() {
  // memory_order_acq_rel包装多线程场景下状态同步
  if (running_.exchange(true, std::memory_order_acq_rel)) {
    return;
  }

  work_guard_ = std::make_unique<
      asio::executor_work_guard<asio::io_context::executor_type>>(
      io_ctx_.get_executor());

  // Register with coordinator
  register_with_coordinator();

  do_accept(); // 启动异步TCP接收

  io_thread_ = std::thread([this]() {
    try {
      io_ctx_.run();
    } catch (const std::exception &e) {
      std::cerr << "[StorageNode:" << port_
                << "] IO thread exception: " << e.what() << std::endl;
    }
  });

  std::cout << "[StorageNode:" << port_
            << "] Started, thread pool size=" << thread_pool_.worker_count()
            << std::endl;
}

void StorageNode::shutdown() {
  if (!running_.exchange(false, std::memory_order_acq_rel)) {
    return;
  }

  std::cout << "[StorageNode:" << port_ << "] Shutting down..." << std::endl;

  asio::error_code ec;
  acceptor_.cancel(ec);
  acceptor_.close(ec); // 关闭TCP监听器socket
  // unique_ptr, reset() 销毁 work_guard
  work_guard_.reset();
  io_ctx_.stop();

  if (io_thread_.joinable()) {
    io_thread_.join();
  }

  thread_pool_.shutdown();

  std::cout << "[StorageNode:" << port_ << "] Shutdown complete ("
            << store_.size() << " keys stored)." << std::endl;
}

void StorageNode::wait() {
  if (io_thread_.joinable()) {
    io_thread_.join();
  }
}

void StorageNode::register_with_coordinator() {
  asio::error_code ec;
  asio::ip::tcp::socket socket(io_ctx_);

  asio::ip::tcp::resolver resolver(io_ctx_);
  //`resolver.resolve(主机,端口,ec)`：**域名解析**
  auto endpoints = resolver.resolve(coordinator_host_,
                                    std::to_string(coordinator_port_), ec);

  if (ec) {
    std::cerr << "[StorageNode:" << port_
              << "] Failed to resolve coordinator: " << ec.message()
              << std::endl;
    return;
  }

  asio::connect(socket, endpoints, ec);
  if (ec) {
    std::cerr << "[StorageNode:" << port_
              << "] Failed to connect to coordinator: " << ec.message()
              << std::endl;
    return;
  }

  // Send NODE_READY
  std::string msg = Protocol::serialize_node_ready(port_);
  asio::write(socket, asio::buffer(msg), ec);
  if (ec) {
    std::cerr << "[StorageNode:" << port_
              << "] Failed to send NODE_READY: " << ec.message() << std::endl;
    socket.close(ec);
    return;
  }

  // Read response
  asio::streambuf buf;
  asio::read_until(socket, buf, "\r\n", ec);
  if (ec) {
    std::cerr << "[StorageNode:" << port_
              << "] Failed to read coordinator response: " << ec.message()
              << std::endl;
  } else {
    std::cout << "[StorageNode:" << port_ << "] Registered with coordinator at "
              << coordinator_host_ << ":" << coordinator_port_ << std::endl;
  }

  socket.close(ec);
}

void StorageNode::do_accept() {
  // 1. 判断节点是否还在运行，已经shutdown就直接return，不再注册accept
  if (!running_.load(std::memory_order_acquire))
    return;

  // 2. 注册异步accept：等待新客户端TCP连接，回调函数在连接到来时执行
  acceptor_.async_accept([this](asio::error_code ec,
                                asio::ip::tcp::socket socket) {
    // 3. 没有错误 → 收到新连接
    if (!ec) {
      // 打印对端地址日志
      std::cout << "[StorageNode:" << port_ << "] Accepted connection from "
                << socket.remote_endpoint() << std::endl;
      try {
        // 把socket移动进lambda，投递任务到业务线程池
        thread_pool_.enqueue([this, sock = std::move(socket)]() mutable {
          handle_session(std::move(sock));
        });
      } catch (const std::exception &e) {
        // 线程池队列满，入队失败打印日志
        std::cerr << "[StorageNode:" << port_
                  << "] Failed to enqueue session: " << e.what() << std::endl;
      }
    } else if (ec != asio::error::operation_aborted) {
      // 出错，并且不是【主动取消】的错误，打印accept错误
      std::cerr << "[StorageNode:" << port_
                << "] Accept error: " << ec.message() << std::endl;
    }
    // 4. 如果节点仍然running，递归调用do_accept，继续等待下一条连接！
    if (running_.load(std::memory_order_acquire)) {
      do_accept();
    }
  });
}
// 处理单条TCP客户端连接， 同步读取一行命令头
void StorageNode::handle_session(asio::ip::tcp::socket socket) {
  /*
handle_session(socket)
├─ try{}包裹整个会话，异常兜底
├─ set TCP_NODELAY 关闭Nagle，降低小包延迟
├─ read_until读到"\r\n" → 读取命令行（PUT/GET）
├─ 解析命令
│  ├─ PUT key value_len\r\nvalue：读value → store_.put → 返回OK
│  ├─ GET key：store_.get → 找到返回value / 没找到返回not_found
│  └─ 其他命令：返回错误
├─ 关闭socket
└─ catch捕获会话异常，打印日志、关闭socket

*/
  try {
    asio::error_code ec;
    socket.set_option(asio::ip::tcp::no_delay(true), ec);

    // Read header line
    asio::streambuf buf;
    asio::read_until(socket, buf, "\r\n", ec);

    if (ec) {
      if (ec != asio::error::eof && ec != asio::error::connection_reset) {
        std::cerr << "[StorageNode:" << port_
                  << "] Read error: " << ec.message() << std::endl;
      }
      socket.close(ec);
      return;
    }

    std::string line(asio::buffers_begin(buf.data()),
                     asio::buffers_begin(buf.data()) + buf.size());

    size_t parse_pos = 0;
    auto cmd_line = Protocol::read_line(line, parse_pos);

    if (!cmd_line) {
      std::string error = Protocol::serialize_error("Malformed request");
      asio::write(socket, asio::buffer(error), ec);
      socket.close(ec);
      return;
    }

    std::string_view cmd(*cmd_line);

    if (cmd.starts_with("PUT ")) {
      // Parse: PUT <key> <value_length>\r\n<value>
      std::string_view rest = cmd.substr(4); // skip "PUT "

      auto space = rest.find(' ');
      if (space == std::string_view::npos) {
        std::string error =
            Protocol::serialize_error("PUT: missing value length");
        asio::write(socket, asio::buffer(error), ec);
        socket.close(ec);
        return;
      }

      std::string key(rest.substr(0, space));
      std::string_view len_str = rest.substr(space + 1);

      size_t value_len = 0;
      auto [ptr, errc] = std::from_chars(
          len_str.data(), len_str.data() + len_str.size(), value_len);
      if (errc != std::errc{}) {
        std::string error =
            Protocol::serialize_error("PUT: invalid value length");
        asio::write(socket, asio::buffer(error), ec);
        socket.close(ec);
        return;
      }

      if (value_len > kMaxValueLength) {
        std::string error = Protocol::serialize_error("PUT: value too large");
        asio::write(socket, asio::buffer(error), ec);
        socket.close(ec);
        return;
      }

      // Read the value data
      // The remaining data in buf beyond the header line may contain the value
      size_t header_end = parse_pos;
      size_t already_in_buf = buf.size() - header_end;

      std::string value;
      value.reserve(value_len);

      // Consume the header first
      buf.consume(header_end);

      // Copy any value data already read into the buffer
      if (already_in_buf > 0) {
        size_t to_copy = std::min(already_in_buf, value_len);
        std::string existing(asio::buffers_begin(buf.data()),
                             asio::buffers_begin(buf.data()) + to_copy);
        value += existing;
        buf.consume(to_copy);
      }

      // Read remaining value data
      if (value.size() < value_len) {
        size_t remaining = value_len - value.size();
        asio::read(socket, buf, asio::transfer_exactly(remaining), ec);
        if (ec) {
          std::cerr << "[StorageNode:" << port_
                    << "] Failed to read value: " << ec.message() << std::endl;
          socket.close(ec);
          return;
        }
        std::string rest_data(asio::buffers_begin(buf.data()),
                              asio::buffers_begin(buf.data()) + remaining);
        value += rest_data;
      }

      // Store
      store_.put(key, value);
      std::cout << "[StorageNode:" << port_ << "] PUT key='" << key
                << "' value_len=" << value_len << std::endl;

      std::string response = Protocol::serialize_ok();
      asio::write(socket, asio::buffer(response), ec);

    } else if (cmd.starts_with("GET ")) {
      std::string_view key = cmd.substr(4); // skip "GET "
      if (key.empty()) {
        std::string error = Protocol::serialize_error("GET: missing key");
        asio::write(socket, asio::buffer(error), ec);
        socket.close(ec);
        return;
      }

      auto value = store_.get(key);
      if (value) {
        std::string response = Protocol::serialize_value(*value);
        asio::write(socket, asio::buffer(response), ec);
        std::cout << "[StorageNode:" << port_ << "] GET key='" << key
                  << "' -> found (" << value->size() << " bytes)" << std::endl;
      } else {
        std::string response = Protocol::serialize_not_found();
        asio::write(socket, asio::buffer(response), ec);
        std::cout << "[StorageNode:" << port_ << "] GET key='" << key
                  << "' -> not_found" << std::endl;
      }

    } else {
      std::string error =
          Protocol::serialize_error("Unknown command, expected PUT or GET");
      asio::write(socket, asio::buffer(error), ec);
    }

    socket.close(ec);

  } catch (const std::exception &e) {
    std::cerr << "[StorageNode:" << port_ << "] Session error: " << e.what()
              << std::endl;
    asio::error_code ec;
    socket.close(ec);
  }
}

} // namespace distkv

````

## coordinator/coordinator.h
> 启动 TCP 服务，接收各个 StorageNode 发来的`NODE_READY`注册请求；收到注册消息后，往`routing_table_`添加节点；对外提供路由表。
> 架构：asio 异步 accept + IO 线程 + 业务线程池 + RoutingTable。同样设计：禁止拷贝、禁止移动。
```Cpp
#pragma once
#include "routing_table.h"
#include "common/config.h"
#include "common/protocol.h"
#include "common/thread_pool.h"
#include <asio.hpp>
#include <atomic>
#include <memory>
#include <string>

namespace distkv {
class Coordinator {
public:
    Coordinator(uint16_t port = kCoordinatorPort,
                size_t pool_size = ThreadPool::kDefaultThreadSize);
    ~Coordinator();
    // Non-copyable, non-movable
    Coordinator(const Coordinator&) = delete;
    Coordinator& operator=(const Coordinator&) = delete;
    Coordinator(Coordinator&&) = delete;
    Coordinator& operator=(Coordinator&&) = delete;

    /// Start accepting connections (non-blocking).
    void start();
    /// Graceful shutdown.
    void shutdown();
    /// Wait for the coordinator to stop.
    void wait();
    /// Access routing table (thread-safe).
    RoutingTable& routing_table() { return routing_table_; }
private:
    void do_accept();
    void handle_session(asio::ip::tcp::socket socket);

    asio::io_context io_ctx_;
    asio::ip::tcp::acceptor acceptor_;
    ThreadPool thread_pool_;
    RoutingTable routing_table_;
    std::atomic<bool> running_{false};
    std::unique_ptr<asio::executor_work_guard<asio::io_context::executor_type>> work_guard_;
    std::thread io_thread_;
};
} // namespace distkv

```
## coordinator/coordinator.cpp
>
```Cpp
#include "coordinator.h"

#include <iostream>
#include <sstream>
#include <string_view>

namespace distkv {

Coordinator::Coordinator(uint16_t port, size_t pool_size)
    : io_ctx_()
    , acceptor_(io_ctx_, asio::ip::tcp::endpoint(asio::ip::tcp::v4(), port))
    , thread_pool_(pool_size) {
    acceptor_.set_option(asio::ip::tcp::acceptor::reuse_address(true));
    std::cout << "[Coordinator] Listening on port " << port << std::endl;
}

Coordinator::~Coordinator() {
    shutdown();
}

void Coordinator::start() {
    if (running_.exchange(true, std::memory_order_acq_rel)) {
        return; // Already running
    }

    work_guard_ = std::make_unique<
        asio::executor_work_guard<asio::io_context::executor_type>>(
        io_ctx_.get_executor());

    do_accept();

    io_thread_ = std::thread([this]() {
        try {
            io_ctx_.run();
        } catch (const std::exception& e) {
            std::cerr << "[Coordinator] IO thread exception: " << e.what() << std::endl;
        }
    });

    std::cout << "[Coordinator] Started, thread pool size="
              << thread_pool_.worker_count() << std::endl;
}

void Coordinator::shutdown() {
    if (!running_.exchange(false, std::memory_order_acq_rel)) {
        return; // Already stopped
    }

    std::cout << "[Coordinator] Shutting down..." << std::endl;

    // Cancel acceptor
    asio::error_code ec;
    acceptor_.cancel(ec);
    acceptor_.close(ec);

    // Stop io_context
    work_guard_.reset();
    io_ctx_.stop();

    if (io_thread_.joinable()) {
        io_thread_.join();
    }

    // Shutdown thread pool (waits for all pending tasks)
    thread_pool_.shutdown();

    std::cout << "[Coordinator] Shutdown complete." << std::endl;
}

void Coordinator::wait() {
    if (io_thread_.joinable()) {
        io_thread_.join();
    }
}

void Coordinator::do_accept() {
    if (!running_.load(std::memory_order_acquire)) return;

    acceptor_.async_accept(
        [this](asio::error_code ec, asio::ip::tcp::socket socket) {
            if (!ec) {
                std::cout << "[Coordinator] Accepted connection from "
                          << socket.remote_endpoint() << std::endl;

                // Submit to thread pool
                try {
                    thread_pool_.enqueue(
                        [this, sock = std::move(socket)]() mutable {
                            handle_session(std::move(sock));
                        });
                } catch (const std::exception& e) {
                    std::cerr << "[Coordinator] Failed to enqueue session: "
                              << e.what() << std::endl;
                }
            } else if (ec != asio::error::operation_aborted) {
                std::cerr << "[Coordinator] Accept error: " << ec.message() << std::endl;
            }

            // Continue accepting
            if (running_.load(std::memory_order_acquire)) {
                do_accept();
            }
        });
}

void Coordinator::handle_session(asio::ip::tcp::socket socket) {
    try {
        asio::error_code ec;

        // Set timeouts
        socket.set_option(asio::ip::tcp::no_delay(true), ec);

        // Read until newline
        asio::streambuf buf;
        asio::read_until(socket, buf, "\r\n", ec);

        if (ec) {
            if (ec != asio::error::eof && ec != asio::error::connection_reset) {
                std::cerr << "[Coordinator] Read error: " << ec.message() << std::endl;
            }
            socket.close(ec);
            return;
        }

        std::string line(
            asio::buffers_begin(buf.data()),
            asio::buffers_begin(buf.data()) + buf.size());

        // Also handle NODE_READY from storage nodes
        if (line.starts_with("NODE_READY")) {
            // Parse: NODE_READY <port>\r\n
            size_t pos = 0;
            auto parsed = Protocol::read_line(line, pos);
            if (parsed && parsed->starts_with("NODE_READY ")) {
                std::string_view rest(*parsed);
                rest.remove_prefix(11); // skip "NODE_READY "
                uint16_t port = 0;
                auto [ptr, ec2] = std::from_chars(rest.data(), rest.data() + rest.size(), port);
                if (ec2 == std::errc{}) {
                    uint16_t shard_id = routing_table_.node_count();
                    std::string host = socket.remote_endpoint().address().to_string();
                    routing_table_.add_node(shard_id, host, port);
                    std::cout << "[Coordinator] Storage node registered: shard="
                              << shard_id << " host=" << host << " port=" << port << std::endl;
                    std::string response = Protocol::serialize_node(
                        kCoordinatorHost, kCoordinatorPort);
                    asio::write(socket, asio::buffer(response), ec);
                }
            }
            socket.close(ec);
            return;
        }

        // Parse LOCATE request
        if (!line.starts_with("LOCATE ")) {
            std::string error = Protocol::serialize_error(
                "Unknown command, expected LOCATE");
            asio::write(socket, asio::buffer(error), ec);
            socket.close(ec);
            return;
        }

        size_t pos = 0;
        auto cmd_line = Protocol::read_line(line, pos);
        if (!cmd_line || !cmd_line->starts_with("LOCATE ")) {
            std::string error = Protocol::serialize_error("Malformed LOCATE request");
            asio::write(socket, asio::buffer(error), ec);
            socket.close(ec);
            return;
        }

        std::string_view key(cmd_line->data() + 7, cmd_line->size() - 7); // skip "LOCATE "

        auto shard = routing_table_.locate(key);
        if (!shard) {
            std::string error = Protocol::serialize_error(
                "No storage nodes available");
            asio::write(socket, asio::buffer(error), ec);
        } else {
            std::string response = Protocol::serialize_node(shard->host, shard->port);
            asio::write(socket, asio::buffer(response), ec);
            std::cout << "[Coordinator] LOCATE key='" << key
                      << "' -> shard=" << shard->shard_id
                      << " (" << shard->host << ":" << shard->port << ")" << std::endl;
        }

        socket.close(ec);
    } catch (const std::exception& e) {
        std::cerr << "[Coordinator] Session error: " << e.what() << std::endl;
        asio::error_code ec;
        socket.close(ec);
    }
}

} // namespace distkv

```
## client/client.h
1. `locate(key)`：先去 Coordinator 查询，找到这个 key 对应的存储节点 NodeInfo
2. `put(key,value)`：拿到节点地址，直接 TCP 连接 StorageNode 发送 PUT 命令
3. `get(key)`：拿到节点地址，直接 TCP 连接 StorageNode 发送 GET 命令
```Cpp
#pragma once

#include "common/config.h"
#include "common/protocol.h"

#include <asio.hpp>

#include <chrono>
#include <optional>
#include <string>
#include <string_view>

namespace distkv {

class Client {
public:
    Client(std::string_view coordinator_host = kCoordinatorHost,
           uint16_t coordinator_port = kCoordinatorPort);
    ~Client() = default;

    // Non-copyable, movable
    Client(const Client&) = delete;
    Client& operator=(const Client&) = delete;
    Client(Client&&) = default;
    Client& operator=(Client&&) = default;

    /// Put a key-value pair. Returns true on success.
    [[nodiscard]] bool put(std::string_view key, std::string_view value);

    /// Get a value by key. Returns nullopt if not found or on error.
    [[nodiscard]] std::optional<std::string> get(std::string_view key);

    /// Get last error message.
    [[nodiscard]] const std::string& last_error() const { return last_error_; }

private:
    /// Locate the storage node for a key via the coordinator.
    [[nodiscard]] std::optional<NodeInfo> locate(std::string_view key);

    std::string coordinator_host_;
    uint16_t coordinator_port_;
    asio::io_context io_ctx_;
    std::string last_error_;
};

} // namespace distkv

```
## client/client.cpp
> 实现 `Client` 类的成员函数
```Cpp
#include "client.h"

#include <charconv>
#include <iostream>
#include <thread>

namespace distkv {

Client::Client(std::string_view coordinator_host, uint16_t coordinator_port)
    : coordinator_host_(coordinator_host)
    , coordinator_port_(coordinator_port) {}

std::optional<NodeInfo> Client::locate(std::string_view key) {
    asio::error_code ec;
    asio::ip::tcp::socket socket(io_ctx_);

    // Retry loop
    for (int attempt = 0; attempt < kMaxRetries; ++attempt) {
        if (attempt > 0) {
            auto delay = kRetryBaseDelay * (1 << (attempt - 1));
            std::this_thread::sleep_for(delay);
            std::cerr << "[Client] Retry locate attempt " << (attempt + 1) << std::endl;
        }

        // Resolve
        asio::ip::tcp::resolver resolver(io_ctx_);
        auto endpoints = resolver.resolve(
            coordinator_host_,
            std::to_string(coordinator_port_), ec);
        if (ec) {
            last_error_ = "resolve: " + ec.message();
            continue;
        }

        // Connect
        asio::connect(socket, endpoints, ec);
        if (ec) {
            last_error_ = "connect: " + ec.message();
            continue;
        }

        // Send LOCATE
        std::string request = Protocol::serialize_locate(key);
        asio::write(socket, asio::buffer(request), ec);
        if (ec) {
            last_error_ = "write: " + ec.message();
            socket.close(ec);
            continue;
        }

        // Read response
        asio::streambuf buf;
        asio::read_until(socket, buf, "\r\n", ec);
        if (ec) {
            last_error_ = "read: " + ec.message();
            socket.close(ec);
            continue;
        }

        std::string response(
            asio::buffers_begin(buf.data()),
            asio::buffers_begin(buf.data()) + buf.size());
        socket.close(ec);

        // Parse
        size_t consumed = 0;
        auto node = Protocol::parse_node_response(response, consumed);
        if (node) {
            return node;
        }

        auto err_msg = Protocol::parse_error_response(response, consumed);
        if (err_msg) {
            last_error_ = *err_msg;
        } else {
            last_error_ = "unexpected response: " + response;
        }
        if (attempt < kMaxRetries - 1) {
            socket = asio::ip::tcp::socket(io_ctx_);
        }
    }

    return std::nullopt;
}

bool Client::put(std::string_view key, std::string_view value) {
    // Step 1: Locate storage node
    auto node = locate(key);
    if (!node) {
        // last_error_ already set by locate()
        return false;
    }

    // Step 2: Connect to storage node
    asio::error_code ec;
    asio::ip::tcp::socket socket(io_ctx_);

    for (int attempt = 0; attempt < kMaxRetries; ++attempt) {
        if (attempt > 0) {
            auto delay = kRetryBaseDelay * (1 << (attempt - 1));
            std::this_thread::sleep_for(delay);
        }

        asio::ip::tcp::resolver resolver(io_ctx_);
        auto endpoints = resolver.resolve(
            node->host, std::to_string(node->port), ec);
        if (ec) {
            last_error_ = "resolve storage: " + ec.message();
            continue;
        }

        asio::connect(socket, endpoints, ec);
        if (ec) {
            last_error_ = "connect storage: " + ec.message();
            continue;
        }

        // Send PUT
        std::string request = Protocol::serialize_put(key, value);
        asio::write(socket, asio::buffer(request), ec);
        if (ec) {
            last_error_ = "write storage: " + ec.message();
            socket.close(ec);
            if (attempt < kMaxRetries - 1) socket = asio::ip::tcp::socket(io_ctx_);
            continue;
        }

        // Read response
        asio::streambuf buf;
        asio::read_until(socket, buf, "\r\n", ec);
        if (ec) {
            last_error_ = "read storage: " + ec.message();
            socket.close(ec);
            if (attempt < kMaxRetries - 1) socket = asio::ip::tcp::socket(io_ctx_);
            continue;
        }

        std::string response(
            asio::buffers_begin(buf.data()),
            asio::buffers_begin(buf.data()) + buf.size());
        socket.close(ec);

        size_t consumed = 0;
        if (Protocol::parse_ok_response(response, consumed)) {
            return true;
        }

        auto err_msg = Protocol::parse_error_response(response, consumed);
        if (err_msg) {
            last_error_ = *err_msg;
        } else {
            last_error_ = "unexpected storage response: " + response;
        }
        return false;
    }

    return false;
}

std::optional<std::string> Client::get(std::string_view key) {
    // Step 1: Locate storage node
    auto node = locate(key);
    if (!node) {
        return std::nullopt;
    }

    // Step 2: Connect to storage node
    asio::error_code ec;
    asio::ip::tcp::socket socket(io_ctx_);

    for (int attempt = 0; attempt < kMaxRetries; ++attempt) {
        if (attempt > 0) {
            auto delay = kRetryBaseDelay * (1 << (attempt - 1));
            std::this_thread::sleep_for(delay);
        }

        asio::ip::tcp::resolver resolver(io_ctx_);
        auto endpoints = resolver.resolve(
            node->host, std::to_string(node->port), ec);
        if (ec) {
            last_error_ = "resolve storage: " + ec.message();
            continue;
        }

        asio::connect(socket, endpoints, ec);
        if (ec) {
            last_error_ = "connect storage: " + ec.message();
            continue;
        }

        // Send GET
        std::string request = Protocol::serialize_get(key);
        asio::write(socket, asio::buffer(request), ec);
        if (ec) {
            last_error_ = "write storage: " + ec.message();
            socket.close(ec);
            if (attempt < kMaxRetries - 1) socket = asio::ip::tcp::socket(io_ctx_);
            continue;
        }

        // Read response
        asio::streambuf buf;
        asio::read_until(socket, buf, "\r\n", ec);
        if (ec) {
            last_error_ = "read storage: " + ec.message();
            socket.close(ec);
            if (attempt < kMaxRetries - 1) socket = asio::ip::tcp::socket(io_ctx_);
            continue;
        }

        std::string line(
            asio::buffers_begin(buf.data()),
            asio::buffers_begin(buf.data()) + buf.size());

        size_t consumed = 0;

        // Check for NOT_FOUND
        if (Protocol::parse_not_found_response(line, consumed)) {
            socket.close(ec);
            return std::nullopt;
        }

        // Check for ERROR
        auto err_msg = Protocol::parse_error_response(line, consumed);
        if (err_msg) {
            last_error_ = *err_msg;
            socket.close(ec);
            return std::nullopt;
        }

        // Parse VALUE response
        // We need to read more if value doesn't fit in the initial buffer
        auto value_resp = Protocol::parse_value_response(line, consumed);
        if (value_resp) {
            socket.close(ec);
            return value_resp->value;
        }

        // Maybe we only read the header, need more data for the value
        // Check if line starts with VALUE
        if (line.starts_with("VALUE ")) {
            // Read the rest
            std::string_view header(line);
            size_t line_pos = 0;
            auto header_line = Protocol::read_line(header, line_pos);
            if (header_line) {
                std::string_view rest_str(*header_line);
                rest_str.remove_prefix(6);
                size_t value_len = 0;
                auto [ptr, errc] = std::from_chars(
                    rest_str.data(), rest_str.data() + rest_str.size(), value_len);
                if (errc == std::errc{}) {
                    // Consume what we already read for the header
                    buf.consume(line_pos);
                    // Read remaining value
                    size_t already = buf.size();
                    std::string value;
                    if (already > 0) {
                        value.assign(
                            asio::buffers_begin(buf.data()),
                            asio::buffers_begin(buf.data()) + std::min(already, value_len));
                        buf.consume(std::min(already, value_len));
                    }
                    if (value.size() < value_len) {
                        asio::read(socket, buf,
                                   asio::transfer_exactly(value_len - value.size()), ec);
                        if (!ec) {
                            value.append(
                                asio::buffers_begin(buf.data()),
                                asio::buffers_begin(buf.data()) + (value_len - value.size()));
                        }
                    }
                    socket.close(ec);
                    if (!ec || ec == asio::error::eof) {
                        return value;
                    }
                }
            }
        }

        last_error_ = "unexpected storage response: " + line;
        socket.close(ec);
        return std::nullopt;
    }

    return std::nullopt;
}

} // namespace distkv

```
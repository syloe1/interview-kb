### 基于 Muduo 网络库实现的高性能分布式 KV 存储，使用 C++17 编写。通过一致性哈希做数据分片、分片锁提升并发、异步主从复制保证容错。

## 架构总览

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  KVServer   │     │  KVServer   │     │  KVServer   │
│  (node-1)   │◄───►│  (node-2)   │◄───►│  (node-3)   │
│  :7001      │     │  :7002      │     │  :7003      │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                    ┌──────┴──────┐
                    │   KVClient   │
                    │ (REPL / CLI) │
                    └─────────────┘
```

## src/common.h
> 整个系统共享的类型
```
Node          → 集群中的一个物理节点 (id, host, port)
Command       → 枚举: SET / GET / DEL / PING / UNKNOWN
ParsedCommand → 解析后的命令 {type, key, value}
Protocol      → 协议解析器 (静态方法)
```
```Cpp
#pragma once

#include <muduo/base/Logging.h>
#include <muduo/net/Buffer.h>
#include <muduo/net/Callbacks.h>
#include <muduo/net/TcpConnection.h>

#include <cstdint>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

namespace dvk {

// ============================================================
// Node — 集群中的一个物理节点
// ============================================================
struct Node {
  // name + ip + port
  std::string id;    // e.g. "node-1"
  std::string host;  // e.g. "127.0.0.1"
                     // uint16_t 2个字节
  uint16_t port = 0; // e.g. 7001

  std::string address() const { return host + ":" + std::to_string(port); }
};

inline bool operator==(const Node &a, const Node &b) {
  return a.id == b.id && a.host == b.host && a.port == b.port;
}

// ============================================================
// Command — 解析后的命令
// ============================================================
// 命令枚举
enum class Command { SET, GET, DEL, PING, UNKNOWN };
// 解析结果载体
/*
- SET：key + value
- GET/DEL：仅 key
- PING：无 key/value

*/
struct ParsedCommand {
  Command type = Command::UNKNOWN;
  std::string key;
  std::string value;
};

// ============================================================
// RESP 协议常量 (Redis Serialization Protocol 风格)
// ============================================================
constexpr const char *RESP_OK = "+OK\r\n";
constexpr const char *RESP_NIL = "$-1\r\n";
constexpr const char *RESP_PONG = "+PONG\r\n";
constexpr const char *RESP_TRUE = ":1\r\n";
constexpr const char *RESP_FALSE = ":0\r\n";
inline std::string makeBulkString(const std::string &s) {
  return "$" + std::to_string(s.size()) + "\r\n" + s + "\r\n";
}

inline std::string makeError(const std::string &msg) {
  return "-ERR " + msg + "\r\n";
}

// ============================================================
// Protocol — 行协议解析器
//
// 请求格式:  COMMAND <arg1> <arg2>\r\n
// 支持命令:  SET <key> <value>     GET <key>     DEL <key>     PING
//
// 实现要点:
//   1. 用 muduo Buffer::findCRLF() 找 \r\n
//   2. 不完整行 → 返回 false, Buffer 保留数据等下次回调
//   3. SET 命令中 value 可含空格 (将 tokens[2..] 用空格 join)
// ============================================================
/*
\r\n作为请求分隔符， 处理TCP半包， 缓冲区数据不足一行时不消费， 直接返回

*/
class Protocol {
public:
  // 从 Buffer 中解析一条完整命令。成功返回 true 并消费数据。
  // Buffer 中数据不完整时返回 false,不做任何消费。
  static bool parseCommand(muduo::net::Buffer *buf, ParsedCommand *cmd) {
    // 1. 在缓冲区查找 \\r\\n 分隔符
    const char *crlf = buf->findCRLF();
    if (!crlf) {
      return false; // 半包，等更多数据
    }

    // 取出整行（不含 \r\n）
    std::string line(buf->peek(), crlf - buf->peek());
    // 缓冲区消费：当前行 + \\r\\n 两个字节
    buf->retrieveUntil(crlf + 2); // 消费 line + \r\n
                                  // 空行直接标记未知命令
    if (line.empty()) {
      cmd->type = Command::UNKNOWN;
      return true;
    }

    // 按空格 tokenize
    std::vector<std::string> tokens = split(line, ' ');
    if (tokens.empty()) {
      cmd->type = Command::UNKNOWN;
      return true;
    }

    // 命令名转大写
    std::string cmdName = toUpper(tokens[0]);
    // set k v  至少3个token
    if (cmdName == "SET" && tokens.size() >= 3) {
      cmd->type = Command::SET;
      cmd->key = tokens[1];
      // value = tokens[2..] 用空格 join，支持含空格的值
      cmd->value =
          join(std::vector<std::string>(tokens.begin() + 2, tokens.end()), " ");
    } else if (cmdName == "GET" && tokens.size() >= 2) {
      cmd->type = Command::GET;
      cmd->key = tokens[1];
    } else if (cmdName == "DEL" && tokens.size() >= 2) {
      cmd->type = Command::DEL;
      cmd->key = tokens[1];
    } else if (cmdName == "PING") {
      cmd->type = Command::PING;
    } else {
      cmd->type = Command::UNKNOWN;
    }

    return true;
  }

  // 序列化一条 SET/DEL 命令（用于复制）
  static std::string serializeSET(const std::string &key,
                                  const std::string &value) {
    return "SET " + key + " " + value + "\r\n";
  }
  static std::string serializeDEL(const std::string &key) {
    return "DEL " + key + "\r\n";
  }

private:
  // command -> tokens
  static std::vector<std::string> split(const std::string &s, char delim) {
    // 存储切割后的结果
    std::vector<std::string> result;
    // 把字符串 s 包装成字符串流，方便 getline 读取分段
    std::istringstream iss(s);
    std::string token;

    // 循环按分隔符读取一段，存入 token
    // std::getline(流, 保存读到的字符串, 分隔符)
    while (std::getline(iss, token, delim)) {
      // 关键：空字符串不加入结果，自动忽略连续多个分隔符
      if (!token.empty()) {
        result.emplace_back(std::move(token));
      }
    }
    return result;
  }
  // 把字符串数组（vector）里所有元素，用同一个分隔符 `delim`
  // 拼接成一整条字符串。
  static std::string join(const std::vector<std::string> &parts,
                          const std::string &delim) {
    // 如果数组为空，直接返回空字符串
    if (parts.empty())
      return "";
    // 先把第一个元素拿出来作为初始结果
    std::string result = parts[0];
    // 从第二个元素开始循环，每次：分隔符 + 当前片段 追加到结果末尾
    for (size_t i = 1; i < parts.size(); ++i) {
      result += delim + parts[i];
    }
    return result;
  }
  // 值传递
  // 把传入字符串全部转为大写。在 Protocol
  // 中用来统一命令名，实现**命令大小写不敏感**：
  //::toupper(c)C标准库函数
  static std::string toUpper(std::string s) {
    for (auto &c : s)
      c = static_cast<char>(::toupper(c));
    return s;
  }
};

} // namespace dvk

```
## src/kv_store.h
> 分片锁内存 KV，16 个分片，每个分片独立 mutex；按 key 哈希分到对应分片，不同分片可以并发读写，减小锁竞争，提升并发性能。
> 一个分片 = 一张哈希表 + 一把锁
> `std::optional`：C++17，用来表达「有值 / 不存在」
> `mutable`：重点！const 成员函数里也能修改这个成员
```Cpp
#pragma once
#include <cstddef>
#include <functional>
#include <muduo/base/Mutex.h>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
namespace dvk {
// ============================================================
// KVStore — 分片锁内存 KV 存储
//
// 设计:
//   - 16 个 Shard, 每个有独立的 mutex
//   - key → shardIndex(key) = hash(key) % 16
//   - 不同 shard 可并发读写, 仅同 shard 的 key 才竞争锁
//   - 相比全局锁, 16 路分片让冲突概率降到 1/16
//
// 每个 Shard 内部是 std::unordered_map<string, string>,
// O(1) 查找/插入/删除。
// ============================================================
class KVStore {
public:
  // 16片
  static constexpr size_t NUM_SHARDS = 16;
  // SET: 写入键值对 (覆盖已有值)
  void set(const std::string &key, const std::string &value) {
    Shard &s = getShard(key);
    muduo::MutexLockGuard lock(s.mutex);
    s.data[key] = value;
  }
  // GET: 读取键值, 不存在则返回 nullopt
  std::optional<std::string> get(const std::string &key) const {
    Shard &s = getShard(key);
    // 自动锁
    muduo::MutexLockGuard lock(s.mutex);
    auto it = s.data.find(key);
    if (it != s.data.end()) {
      return it->second;
    }
    return std::nullopt;
  }
  // DEL: 删除键, 返回 true 表示键存在并被删除
  bool del(const std::string &key) {
    Shard &s = getShard(key);
    muduo::MutexLockGuard lock(s.mutex);
    return s.data.erase(key) > 0;
  }
  // 返回存储中的总键数 (遍历所有分片求和)
  size_t size() const {
    size_t total = 0;
    for (size_t i = 0; i < NUM_SHARDS; ++i) {
      muduo::MutexLockGuard lock(shards_[i].mutex);
      // shard[i] 分片 .size() 看有多少条kv对
      total += shards_[i].data.size();
    }
    return total;
  }

private:
  struct Shard {
    std::unordered_map<std::string, std::string> data; // store kv
    mutable muduo::MutexLock mutex;
  };
  Shard &getShard(const std::string &key) const {
    size_t idx = std::hash<std::string>{}(key) % NUM_SHARDS;
    return shards_[idx];
  }
  mutable Shard shards_[NUM_SHARDS];
};
} // namespace dvk

```
## src/hash_ring.h
> 一致性哈希环，用来把 key 分配到分布式集群不同物理节点；引入虚拟节点解决普通一致性哈希数据倾斜问题。这里用 `std::map` 保存有序哈希位置，MD5 生成哈希值。
```Cpp
#pragma once

#include "common.h"

#include <cstdint>
#include <cstring>
#include <map>
#include <openssl/md5.h> //OpenSSL MD5哈希函数
#include <string>
#include <vector>

namespace dvk {

// ============================================================
// HashRing — 一致性哈希环
//
// 算法:
//   1. 每个物理节点生成 VIRTUAL_NODES_PER_PHYSICAL 个虚拟节点
//   2. 虚拟节点名 = "node_id:vn_N", 用 MD5 哈希映射到 uint64_t 位置
//   3. 键查找: hash(key) → ring_.upper_bound(h) → 返回最近的物理节点
//   4. 如果越过环末尾, 回绕到 ring_.begin()
//
// 复杂度:
//   - 构建: O(N * V) (N=节点数, V=虚拟节点数)
//   - 查找: O(log(N * V))
//
// 数据分布:
//   3 节点 × 150 vnode, 标准差约 5%~10%
// ============================================================
class HashRing {
public:
  // 编译器常量
  // 每个真实物理节点生成150个虚拟节点
  static constexpr int VIRTUAL_NODES_PER_PHYSICAL = 150;

  // 用节点列表构建哈希环
  void build(const std::vector<Node> &nodes) {
    ring_.clear();
    for (const auto &node : nodes) {
      for (int i = 0; i < VIRTUAL_NODES_PER_PHYSICAL; ++i) {
        std::string vname = node.id + ":vn_" + std::to_string(i);
        uint64_t pos = md5Hash64(vname);
        ring_[pos] = node;
      }
    }
  }

  // 根据 key 查找所属节点。环为空时返回 nullptr。
  const Node *getNode(const std::string &key) const {
    if (ring_.empty())
      return nullptr;

    uint64_t h = md5Hash64(key);
    auto it = ring_.upper_bound(h);
    if (it == ring_.end()) {
      it = ring_.begin(); // 回绕
    }
    return &it->second;
  }

  bool empty() const { return ring_.empty(); }
  size_t vnodeCount() const { return ring_.size(); }

private:
  // ：**输入字符串，计算 MD5 得到 16 字节摘要，取出前 8 字节拼成一个大端序
  // uint64_t，作为哈希环上的位置 pos**
  //  MD5 哈希 → 取其高 8 字节作为 uint64_t (big-endian)
  static uint64_t md5Hash64(const std::string &input) {
    unsigned char digest[MD5_DIGEST_LENGTH];
    // GCC 警告屏蔽代码块
    // 新版 OpenSSL 已经把老的 `MD5()`
    // 函数标记为废弃(deprecated)，编译会报警告。
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
    MD5(reinterpret_cast<const unsigned char *>(input.data()), input.size(),
        digest);
#pragma GCC diagnostic pop

    uint64_t result = 0;
    for (int i = 0; i < 8; ++i) {
      result = (result << 8) | digest[i];
    }
    return result;
  }

  // 有序映射: hash_position → Node
  // 利用 std::map 的 O(log N) upper_bound 查找
  std::map<uint64_t, Node> ring_;
  /*
    struct Node {
    // name + ip + port
    std::string id;    // e.g. "node-1"
    std::string host;  // e.g. "127.0.0.1"
                    // uint16_t 2个字节
    uint16_t port = 0; // e.g. 7001

    std::string address() const { return host + ":" + std::to_string(port); }
    };

*/
};

} // namespace dvk

```

## kv_server.cc
> 单机 KV 服务节点（主节点），基于 muduo 网络库，RESP 协议，分片锁内存 KV，支持异步主从复制
1. `CommandHandler`：命令处理器，接收解析后的命令，调用 KVStore 读写，触发复制
2. `KVServer`：muduo TcpServer 封装，负责 TCP 连接、消息回调
3. 参数解析：`parseArgs`、`parseReplicas` 解析命令行
4. main 函数：组装所有组件，启动 EventLoop 事件循环
```Cpp
// ============================================================
// kv_server.cpp — 分布式 KV 存储服务节点
//
// 用法:
//   ./kv_server --id node-1 --port 7001 [--threads 4] [--replicas
//   node-2:7002,node-3:7003]
//
// 功能:
//   - 接收 RESP 文本协议命令 (SET/GET/DEL/PING)
//   - 分片锁内存存储
//   - 可选主从异步复制 (需指定 --replicas)
// ============================================================

#include "common.h"
#include "kv_store.h"
#include "replicator.h"

#include <muduo/base/Logging.h>
#include <muduo/net/EventLoop.h>
#include <muduo/net/InetAddress.h>
#include <muduo/net/TcpServer.h>

#include <cstring>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

using namespace muduo;
using namespace muduo::net;

namespace dvk {

// ============================================================
// CommandHandler — 命令分发器
// ============================================================
class CommandHandler {
public:
  CommandHandler(KVStore *store, Replicator *replicator = nullptr)
      : store_(store), replicator_(replicator) {}
  /*
    struct ParsedCommand {
        Command type = Command::UNKNOWN;
        std::string key;
        std::string value;
    };
    */
  std::string handle(const ParsedCommand &cmd) {
    switch (cmd.type) {
    case Command::PING:
      return RESP_PONG;
    case Command::SET:
      return handleSET(cmd);
    case Command::GET:
      return handleGET(cmd);
    case Command::DEL:
      return handleDEL(cmd);
    case Command::UNKNOWN:
      return makeError("unknown command");
    }
    return makeError("internal error");
  }

private:
  std::string handleSET(const ParsedCommand &cmd) {
    // 1. 写本地
    store_->set(cmd.key, cmd.value);

    // 2. 异步复制到从节点
    if (replicator_) {
      replicator_->replicateWrite(cmd.key, cmd.value);
    }
    return RESP_OK;
  }

  std::string handleGET(const ParsedCommand &cmd) {
    auto val = store_->get(cmd.key);
    // 包装成RESP二进制字符串格式返回
    if (val.has_value()) {
      return makeBulkString(val.value());
    }
    return RESP_NIL;
  }

  std::string handleDEL(const ParsedCommand &cmd) {
    bool existed = store_->del(cmd.key);
    // 真正删除了才同步给从节点
    if (existed && replicator_) {
      replicator_->replicateDelete(cmd.key);
    }
    return existed ? RESP_TRUE : RESP_FALSE;
  }

  KVStore *store_;
  Replicator *replicator_;
};

// ============================================================
// KVServer — muduo TcpServer 包装
// ============================================================
class KVServer {
public:
  KVServer(EventLoop *loop, const InetAddress &listenAddr, int numThreads,
           Replicator *replicator = nullptr)
      : server_(loop, listenAddr, "KVServer"), handler_(&store_, replicator) {
    server_.setThreadNum(numThreads);
    server_.setConnectionCallback(std::bind(&KVServer::onConnection, this, _1));
    server_.setMessageCallback(
        std::bind(&KVServer::onMessage, this, _1, _2, _3));
  }

  void start() {
    server_.start();
    LOG_INFO << "KVServer listening on " << server_.ipPort();
  }

  KVStore &store() { return store_; }

private:
  // 连接状态回调
  void onConnection(const TcpConnectionPtr &conn) {
    if (conn->connected()) {
      LOG_INFO << "Connection UP: " << conn->peerAddress().toIpPort();
    } else {
      LOG_INFO << "Connection DOWN: " << conn->peerAddress().toIpPort();
    }
  }
  // 解析回调
  void onMessage(const TcpConnectionPtr &conn, Buffer *buf,
                 Timestamp receiveTime) {
    // 循环解析缓冲区中的所有完整命令
    while (buf->readableBytes() > 0) {
      ParsedCommand cmd;
      if (!Protocol::parseCommand(buf, &cmd)) {
        break; // 半包，等更多数据
      }

      // 分发并发送响应
      std::string response = handler_.handle(cmd);
      conn->send(response);
    }
  }

  TcpServer server_;
  KVStore store_;
  CommandHandler handler_;
};

} // namespace dvk

// ============================================================
// 命令行参数解析 (简易)
// ============================================================
struct ServerArgs {
  std::string id = "node-1"; // 当前节点唯一ID，默认 node-1
  uint16_t port = 7001;      // 监听端口，默认7001，uint16_t 2字节
  int threads = 4;           // muduo IO线程池数量，默认4线程
  std::string replicasStr;   // 从节点字符串，逗号分隔，空=无从节点
};

ServerArgs parseArgs(int argc, char *argv[]) {
  ServerArgs args;
  for (int i = 1; i < argc; ++i) {
    if (strcmp(argv[i], "--id") == 0 && i + 1 < argc) {
      args.id = argv[++i];
    } else if (strcmp(argv[i], "--port") == 0 && i + 1 < argc) {
      args.port = static_cast<uint16_t>(atoi(argv[++i]));
    } else if (strcmp(argv[i], "--threads") == 0 && i + 1 < argc) {
      args.threads = atoi(argv[++i]);
    } else if (strcmp(argv[i], "--replicas") == 0 && i + 1 < argc) {
      args.replicasStr = argv[++i];
    }
  }
  return args;
}
// 拆分从节点字符串
//  解析 "node-2:7002,node-3:7003" → vector<Node>
// 把**逗号分隔的从节点字符串**，解析成`dvk::Node`对象数组。
std::vector<dvk::Node> parseReplicas(const std::string &s) {
  std::vector<dvk::Node> nodes;
  if (s.empty())
    return nodes;

  std::istringstream iss(s);
  std::string pair;
  // std::getline(流, 输出变量, 分隔符)
  while (std::getline(iss, pair, ',')) {
    auto colonPos = pair.find(':');
    if (colonPos != std::string::npos) {
      dvk::Node n;
      n.id = pair.substr(0, colonPos);
      n.host = "127.0.0.1"; // 简化: 默认 localhost
      n.port = static_cast<uint16_t>(std::stoi(pair.substr(colonPos + 1)));
      nodes.push_back(n);
    }
  }
  return nodes;
}

// ============================================================
// main
// ============================================================
int main(int argc, char *argv[]) {
  auto args = parseArgs(argc, argv);
  // 日志配置
  Logger::setLogLevel(Logger::INFO);
  LOG_INFO << "Starting KVServer id=" << args.id << " port=" << args.port
           << " threads=" << args.threads;
  // 创建主事件 + 监听地址
  EventLoop loop;
  InetAddress listenAddr(args.port);

  // 可选: 创建 Replicator
  auto replicaNodes = parseReplicas(args.replicasStr);
  std::unique_ptr<dvk::Replicator> replicator;
  if (!replicaNodes.empty()) {
    replicator = std::make_unique<dvk::Replicator>(&loop, replicaNodes);
    replicator->start();
    LOG_INFO << "Replication enabled to " << replicaNodes.size()
             << " replica(s)";
  }
  // 创建KVServer 服务实例 并 启动监听
  dvk::KVServer server(&loop, listenAddr, args.threads, replicator.get());
  server.start();

  loop.loop();
  return 0;
}

```

## kv_client.cc
> **向指定节点发送 KV 命令，主线程阻塞等待服务端响应，最多等 5 秒；利用 promise/future 把 muduo 异步网络回调包装成同步调用。**

```Cpp
// ============================================================
// kv_client.cpp — 分布式 KV 客户端
//
// 用法:
//   ./kv_client 127.0.0.1:7001 127.0.0.1:7002 127.0.0.1:7003
//
// 功能:
//   - 一致性哈希路由: key → hash → 确定目标节点
//   - 每个节点一个 TcpClient 长连接
//   - 交互式 REPL 界面 (主线程)
//   - I/O 线程处理网络读写
//   - 主线程与 I/O 线程通过 std::promise/future 通信
// ============================================================

#include "common.h"
#include "hash_ring.h"

#include <muduo/base/Logging.h>
#include <muduo/net/EventLoop.h>
#include <muduo/net/EventLoopThread.h>
#include <muduo/net/InetAddress.h>
#include <muduo/net/TcpClient.h>

#include <chrono>
#include <future>
#include <iostream>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

using namespace muduo;
using namespace muduo::net;

namespace dvk {

// ============================================================
// KVClient — 一致性哈希路由客户端
// ============================================================
class KVClient {
public:
  KVClient(EventLoop *loop, const std::vector<Node> &nodes) : loop_(loop) {
    ring_.build(nodes); // 1. 构建一致性哈希环，用于key分片路由

    // 遍历所有集群节点，每个节点独立创建TcpClient
    for (const auto &node : nodes) {
      InetAddress addr(node.host, node.port);
      // 创建独占智能指针TcpClient，绑定事件循环、目标地址、连接名称
      auto client =
          std::make_unique<TcpClient>(loop, addr, "KVClient-" + node.id);
      client->enableRetry(); // 开启断线自动后台重连

      // 绑定连接状态回调（连上/断开更新conn指针）
      client->setConnectionCallback(
          [this, nid = node.id](const TcpConnectionPtr &conn) {
            onNodeConnection(nid, conn);
          });
      // 绑定消息回调：收到服务端返回数据触发
      client->setMessageCallback(
          [this, nid = node.id](const TcpConnectionPtr &conn, Buffer *buf,
                                Timestamp t) {
            onNodeMessage(nid, conn, buf, t);
          });

      // 包装成共享指针存入map
      auto nc = std::make_shared<NodeConnection>();
      nc->node = node;
      nc->client = std::move(client); // move转移unique_ptr所有权
      connections_[node.id] = nc;
    }
  }

  void start() { // 启动连接start()
    for (auto &[id, nc] : connections_) {
      nc->client->connect();
    }
    // 等待连接建立
    CurrentThread::sleepUsec(500 * 1000);
  }

  void stop() { // 停止连接start()
    for (auto &[id, nc] : connections_) {
      nc->client->disconnect();
    }
  }

  // ---- 同步 API (内部用 promise/future 桥接) ----

  std::string syncSET(const std::string &key, const std::string &value) {
    std::string cmd = "SET " + key + " " + value + "\r\n";
    return sendToNodeForKey(key, cmd);
  }

  std::string syncGET(const std::string &key) {
    std::string cmd = "GET " + key + "\r\n";
    return sendToNodeForKey(key, cmd);
  }

  std::string syncDEL(const std::string &key) {
    std::string cmd = "DEL " + key + "\r\n";
    return sendToNodeForKey(key, cmd);
  }

  const HashRing &ring() const { return ring_; }

private:
  struct NodeConnection {
    Node node;                                          // 节点信息 id/host/port
    std::unique_ptr<TcpClient> client;                  // 连接该节点的TCP客户端
    TcpConnectionPtr conn;                              // 当前活跃TCP连接
    std::mutex mtx;                                     // 保护promise多线程竞争
    std::unique_ptr<std::promise<std::string>> promise; // 同步等待器
  };

  // 根据 key 定位节点并发命令
  // 同一个 key 永远路由到同一台机器，分布式分片核心。
  std::string sendToNodeForKey(const std::string &key, const std::string &cmd) {
    const Node *node = ring_.getNode(key);
    if (!node) {
      return "-ERR no available node\r\n";
    }
    return sendToNode(*node, cmd);
  }
  //**把异步 muduo 网络回调封装成同步阻塞接口**，主线程发出命令，阻塞等待 IO
  // 线程拿到服务端返回结果，5 秒超时。
  // 阻塞等待IO线程
  std::string sendToNode(const Node &node, const std::string &cmd) {
    auto it = connections_.find(node.id);
    if (it == connections_.end()) {
      return "-ERR node not found\r\n";
    }

    auto &nc = it->second;

    //     `std::promise` 和 `std::future`
    //     是一对搭档，用来**两个线程之间传递返回值**

    // - `promise`：负责**写入结果**（IO 线程写）
    // - `future`：负责**等待、读取结果**（主线程读）
    // 创建 promise 用于等待响应
    // promise 是信箱，future 是信箱钥匙。IO
    // 线程往信箱放纸条（返回字符串）；主线程拿着钥匙等着读纸条。
    auto prom = std::make_unique<std::promise<std::string>>();
    auto future = prom->get_future();
    {
      std::lock_guard<std::mutex> lock(nc->mtx);
      nc->promise = std::move(prom);
    }

    // 在 I/O 线程发送命令
    loop_->runInLoop([nc, cmd]() {
      if (nc->conn && nc->conn->connected()) {
        nc->conn->send(cmd);
      }
    });

    // 等待响应，超时 5 秒
    auto status = future.wait_for(std::chrono::seconds(5));
    if (status == std::future_status::timeout) {
      std::lock_guard<std::mutex> lock(nc->mtx);
      nc->promise.reset();
      return "-ERR timeout\r\n";
    }
    return future.get();
  }
  // 连接回调函数
  void onNodeConnection(const std::string &nodeId,
                        const TcpConnectionPtr &conn) {
    auto it = connections_.find(nodeId);
    if (it == connections_.end())
      return;

    if (conn->connected()) {
      it->second->conn = conn;
      LOG_INFO << "Connected to " << nodeId;
    } else {
      it->second->conn.reset();
      LOG_INFO << "Disconnected from " << nodeId;
    }
  }

  void onNodeMessage(const std::string &nodeId, const TcpConnectionPtr &,
                     Buffer *buf, Timestamp) {
    auto it = connections_.find(nodeId);
    if (it == connections_.end())
      return;

    std::string response = buf->retrieveAllAsString();
    auto &nc = it->second;

    std::lock_guard<std::mutex> lock(nc->mtx);
    if (nc->promise) {
      nc->promise->set_value(response);
      nc->promise.reset();
    }
  }

  EventLoop *loop_;
  HashRing ring_;
  std::unordered_map<std::string, std::shared_ptr<NodeConnection>> connections_;
};

} // namespace dvk

// ============================================================
// 命令行解析
// ============================================================
std::vector<dvk::Node> parseNodes(int argc, char *argv[]) {
  std::vector<dvk::Node> nodes;
  for (int i = 1; i < argc; ++i) {
    std::string arg(argv[i]);
    auto colonPos = arg.find(':');
    if (colonPos != std::string::npos) {
      dvk::Node n;
      n.host = arg.substr(0, colonPos);
      n.port = static_cast<uint16_t>(std::stoi(arg.substr(colonPos + 1)));
      n.id = "node-" + std::to_string(i); // node-1, node-2, ...
      nodes.push_back(n);
    }
  }
  return nodes;
}

// ============================================================
// REPL
// ============================================================
void printHelp() {
  std::cout << "\n"
            << "===== Distributed KV Client =====\n"
            << "Commands:\n"
            << "  SET <key> <value>   — 写入键值\n"
            << "  GET <key>           — 读取键值\n"
            << "  DEL <key>           — 删除键\n"
            << "  NODES               — 查看集群节点\n"
            << "  QUIT                — 退出\n"
            << "==================================\n\n";
}
// 清理用户输入多余前后空格、换行，避免命令解析出错。
std::string trim(const std::string &s) {
  auto start = s.find_first_not_of(" \t\r\n");
  if (start == std::string::npos)
    return "";
  auto end = s.find_last_not_of(" \t\r\n");
  return s.substr(start, end - start + 1);
}

int main(int argc, char *argv[]) {
  if (argc < 2) {
    std::cerr << "Usage: " << argv[0] << " <host:port> [host:port ...]\n"
              << "Example: " << argv[0]
              << " 127.0.0.1:7001 127.0.0.1:7002 127.0.0.1:7003\n";
    return 1;
  }

  auto nodes = parseNodes(argc, argv);
  if (nodes.empty()) {
    std::cerr << "No valid node addresses provided.\n";
    return 1;
  }

  Logger::setLogLevel(Logger::WARN);

  // 网络 I/O 跑在独立 EventLoop 线程
  EventLoopThread loopThread;
  EventLoop *loop = loopThread.startLoop();

  dvk::KVClient client(loop, nodes);
  client.start();

  std::cout << "Connected to " << nodes.size() << " node(s), "
            << client.ring().vnodeCount()
            << " virtual nodes on the hash ring.\n";
  printHelp();

  // 主线程 REPL
  std::string line;
  while (true) {
    std::cout << "kv> " << std::flush;
    if (!std::getline(std::cin, line))
      break;

    line = trim(line);
    if (line.empty())
      continue;
    if (line == "QUIT" || line == "quit")
      break;

    if (line == "NODES" || line == "nodes") {
      std::cout << "Nodes in cluster (" << nodes.size() << "):\n";
      for (const auto &n : nodes) {
        std::cout << "  " << n.id << " @ " << n.address() << "\n";
      }
      std::cout << "Virtual nodes (ring size): " << client.ring().vnodeCount()
                << "\n";
      continue;
    }

    // 解析命令并执行
    std::istringstream iss(line);
    std::string cmd, key, value;
    iss >> cmd;

    std::string resp;
    if (cmd == "SET" || cmd == "set") {
      iss >> key;
      std::getline(iss, value);
      value = trim(value);
      if (key.empty()) {
        std::cout << "(error) Usage: SET <key> <value>\n";
        continue;
      }
      resp = client.syncSET(key, value);
    } else if (cmd == "GET" || cmd == "get") {
      iss >> key;
      if (key.empty()) {
        std::cout << "(error) Usage: GET <key>\n";
        continue;
      }
      resp = client.syncGET(key);
    } else if (cmd == "DEL" || cmd == "del") {
      iss >> key;
      if (key.empty()) {
        std::cout << "(error) Usage: DEL <key>\n";
        continue;
      }
      resp = client.syncDEL(key);
    } else {
      std::cout << "(error) Unknown command: " << cmd << "\n";
      continue;
    }

    // 显示结果
    std::cout << resp; // RESP 格式自带 \r\n
  }

  std::cout << "Goodbye.\n";
  client.stop();
  CurrentThread::sleepUsec(100 * 1000);
  return 0;
}

```
## replicator.h
> **KVServer 的主节点复制器**，主节点专用。
> 星型复制（1 主 → N 从），fire-and-forget（发完就不管，不等待从节点 ACK）
分布式模型：AP（高可用 + 分区容忍，牺牲强一致性）
```Cpp
#pragma once

#include "common.h"

#include <muduo/base/Logging.h>
#include <muduo/net/EventLoop.h>
#include <muduo/net/InetAddress.h>
#include <muduo/net/TcpClient.h>

#include <memory>
#include <string>
#include <vector>

namespace dvk {

// ============================================================
// Replicator — 异步主从复制 (star 模式)
//
// 主节点收到写请求 (SET/DEL) 后:
//   1. 先写入本地 KVStore
//   2. 调用 replicateWrite / replicateDelete 异步转发到所有从节点
//   3. 对客户端返回 OK (不等从节点确认)
//
// 容错:
//   - 从节点断开 → 静默丢弃本应发给它的复制消息
//   - TcpClient 启用 auto-retry, 从节点恢复后自动重连
//   - 这种设计是 AP (高可用 + 分区容忍), 牺牲 C (强一致性)
//
// 防循环:
//   - 从节点不配置 Replicator, 收到复制命令只写本地
//   - SET 天然幂等, 重复写入不会出错
// ============================================================
class Replicator {
public:
  // 每个从节点单独创建一个Muduo TcpClient， 配置自动重连， 连接状态回调
  Replicator(muduo::net::EventLoop *loop, const std::vector<Node> &replicas)
      : loop_(loop) {
    // 遍历集群里每一台从机， 一台从机对应一条独立TCP连接
    for (const auto &node : replicas) {
      muduo::net::InetAddress addr(node.host, node.port);
      // TcpClient智能指针
      auto client = std::make_unique<muduo::net::TcpClient>(
          loop, addr, "ReplicaTo-" + node.id);
      client->enableRetry(); // 断开后自动重连
      client->setConnectionCallback(
          // lambda捕获node.id副本
          //[this, &node] 引用捕获， 循环迭代node会变
          [this, nodeId = node.id](const muduo::net::TcpConnectionPtr &conn) {
            if (conn->connected()) { // 成功连接撒谎给你从节点
              LOG_INFO << "Replicator: connected to replica " << nodeId;
            } else {
              LOG_WARN << "Replicator: disconnected from replica " << nodeId;
            }
          });
      // unique so move to tranfer owner
      replicas_.emplace_back(node, std::move(client));
    }
  }

  /*
 // 启动所有到从节点的连接
  void start() {
    for (auto &rc : replicas_) {
      rc.client->connect();
    }

*/
  // 启动所有到从节点的连接
  void start() {
    for (auto &rc : replicas_) {
      // 每轮抽一个ReplicaConn对象
      rc.client->connect();
    }
  }

  // 停止所有连接
  void stop() {
    for (auto &rc : replicas_) {
      rc.client->disconnect();
    }
  }

  // 异步复制 SET (fire-and-forget)
  void replicateWrite(const std::string &key, const std::string &value) {
    std::string cmd = Protocol::serializeSET(key, value);
    for (auto &rc : replicas_) {
      auto conn = rc.client->connection();
      if (conn && conn->connected()) {
        conn->send(cmd);
      }
    }
  }

  // 异步复制 DEL (fire-and-forget)
  void replicateDelete(const std::string &key) {
    std::string cmd = Protocol::serializeDEL(key);
    for (auto &rc : replicas_) {
      auto conn = rc.client->connection();
      if (conn && conn->connected()) {
        conn->send(cmd);
      }
    }
  }

private:
  // 从节点元信息 + 对应TCP客户端打包存在一起
  struct ReplicaConn {
    Node node;
    std::unique_ptr<muduo::net::TcpClient> client;

    ReplicaConn() = default;
    ReplicaConn(const Node &n, std::unique_ptr<muduo::net::TcpClient> &&c)
        : node(n), client(std::move(c)) {}
    ReplicaConn(ReplicaConn &&) = default;
  };

  muduo::net::EventLoop *loop_;       // 事件循环
  std::vector<ReplicaConn> replicas_; // 所有从节点连接信息
};

} // namespace dvk

```
# ReactorNet

## Overview

A minimalist C++ network library implementing the Reactor pattern, inspired by muduo.
ReactorNet 是一个 **约 2000 行 C++17** 的网络库，实现了经典的 **Reactor 模式**（事件驱动 + 非阻塞 I/O）。

## Architecture

```
┌───────────────────────────────────────────┐
│  TcpServer (baseLoop)                     │
│  ┌─────────┐                              │
│  │Acceptor │──► newConnection()           │
│  └─────────┘     │                        │
│                  │ round-robin             │
│     ┌────────────┼────────────┐           │
│     ▼            ▼            ▼           │
│  EventLoop   EventLoop   EventLoop  ...   │
│  (worker 0)  (worker 1)  (worker 2)       │
│     │            │            │            │
│  TcpConn     TcpConn     TcpConn          │
└───────────────────────────────────────────┘
```

The architect*ure diagram and the one-loop-per-thread flow will live here.*

## Core Modules

```
第 1 层：基础设施
  noncopyable.h → InetAddress → Socket
              ↓
第 2 层：事件循环核心 ★ 最关键
  Channel → Poller → EPollPoller → EventLoop
              ↓
第 3 层：定时器
  Timer → TimerQueue
              ↓
第 4 层：TCP 网络层
  Buffer → TcpConnection → Acceptor → TcpServer → EventLoopThread
              ↓
第 5 层：应用层
  HttpRequest → HttpResponse → main.cpp（整合示例）
```

## noncopyable.h 禁止拷贝， 允许移动

```cpp
#pragma once
// 工具基类
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

## InetAddress.h

> 基础工具组件，封装IPv4原生结构体，统一管理[IP + Port]
> 适用: bind / connect / accept syscall传参， 日志打印对端地址

```cpp
#pragma once

#include <arpa/inet.h>
#include <netinet/in.h>
#include <string>
// 封装Linux IPV4底层结构体sockaddr_in
class InetAddress {
public:
  explicit InetAddress(uint16_t port = 0, const std::string &ip = "",
                       bool loopbackOnly = false);
  explicit InetAddress(const sockaddr_in &addr);
  // 返回通用只读指针
  const sockaddr *getSockAddr() const {
    return reinterpret_cast<const sockaddr *>(&addr_);
  }
  // 返回IPV4原生可写指针
  sockaddr_in *getSockAddrIn() { return &addr_; }
  const sockaddr_in *getSockAddrIn() const { return &addr_; }
  // bind connect accept需要传入地址长度参数，
  // 返回内部sockaddr_in addr_结构体字节大小
  socklen_t getSockLen() const { return static_cast<socklen_t>(sizeof(addr_)); }
  // 拼接IP:port字符串
  std::string toIpPort() const;
  // 把二进制IPV4->字符串
  std::string toIp() const;
  // 取出可读， 可打印的主机序端口号
  // 网络传输是大端序
  // ntohs network  to host short把网络端口转回本地CPU字节序
  uint16_t toPort() const { return ntohs(addr_.sin_port); }
  // 并不是钩子， 普通的成员赋值接口
  void setSockAddr(const sockaddr_in &addr) { addr_ = addr; }

private:
  sockaddr_in addr_;
};

```

## InetAdress.cc

> explicit 禁止隐式转换

```cpp
#include "InetAddress.h"
#include <cstring>
#include <iostream>
/*
struct sockaddr_in {
  sa_family_t sin_family;  // 协议族， AF_INET IPv4
  in_port_t sin_port;      // 网络大端序， 用htons/ntohs转换
  struct in_addr sin_addr; // 32位Ipv4二进制地址
  char sin_zero[8];        // 填充占位
}
struct in_addr
  {
    in_addr_t s_addr;
  };
*/
InetAddress::InetAddress(uint16_t port, const std::string &ip,
                         bool loopbackOnly) {
  std::memset(&addr_, 0, sizeof(addr_));
  addr_.sin_family = AF_INET; // IPV4
  if (loopbackOnly) {
    // htonl host to network long ,把本地序32->网络大端序， 存s_addr
    addr_.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  } else if (ip.empty() || ip == "INADDR_ANY") {
    addr_.sin_addr.s_addr = htonl(INADDR_ANY);
  } else {
    // inet_pton字符串IP->二进制网络序IP
    if (::inet_pton(AF_INET, ip.c_str(), &addr_.sin_addr) <= 0) {
      std::cerr << "[InetAddress] Invalid IP address: " << ip
                << ", falling back to INADDR_ANY" << std::endl;
      addr_.sin_addr.s_addr = htonl(INADDR_ANY);
    }
  }
  addr_.sin_port = htons(port);
}
//转换构造函数
InetAddress::InetAddress(const sockaddr_in &addr) : addr_(addr) {}
std::string InetAddress::toIpPort() const {
  char buf[64];
  // 先把IP转字符串存入buf
  ::inet_ntop(AF_INET, &addr_.sin_addr, buf, sizeof(buf));
  char result[128];
  // snprintf 拼接 IP:端口，ntohs把网络序端口转回主机序数字
  std::snprintf(result, sizeof(result), "%s:%u", buf, ntohs(addr_.sin_port));
  return result;
}

//:: 代表全局命名空间，
// inet_ntop 二进制网络ip->可读字符串IP
// inet_pton 字符串IP -> 二进制网络IP
/*

struct sockaddr_in {
  sa_family_t sin_family;  // 协议族， AF_INET IPv4
  in_port_t sin_port;      // 网络大端序， 用htons/ntohs转换
  struct in_addr sin_addr; // 32位Ipv4二进制地址
  char sin_zero[8];        // 填充占位
}
*/
std::string InetAddress::toIp() const {
  char buf[64];
  ::inet_ntop(AF_INET, &addr_.sin_addr, buf, sizeof(buf));
  return buf;
}
```

## Socket.h

> 工具组件， 封装Socket相关系统调用， 管理fd生命周期， 禁止拷贝，支持移动
> 依赖： noncopyable, inetAddress

```cpp
#pragma once

#include "InetAddress.h"
#include "noncopyable.h"

// 封装socket系统调用
class Socket : noncopyable {
public:
  explicit Socket(int sockfd) : sockfd_(sockfd) {}

  Socket();
  ~Socket();

  Socket(Socket &&other) noexcept : sockfd_(other.sockfd_) {
    other.sockfd_ = -1;
  }
  Socket &operator=(Socket &&other) noexcept {
    if (this != &other) {
      // 关闭当前对象的fd, 释放旧资源
      close();
      // 接管别人的fd
      sockfd_ = other.sockfd_;
      other.sockfd_ = -1;
    }
    return *this;
  }

  int fd() const { return sockfd_; }
  // 绑定IP + 端口
  void bind(const InetAddress &addr);
  // backlog未完成3次握手的连接队列最大长度
  // bind后accept前使用
  void listen(int bakclog = SOMAXCONN);
  // 封装accept4非阻塞接受客户端连接
  int accept(InetAddress *peerAddr);

  void setReuseAddr(bool on);  // 地址复用
  void setReusePort(bool on);  // 端口复用
  void setTcpNoDelay(bool on); // 关闭Nagle算法， 小包直接发送
  void setKeepAlive(bool on);  // TCP保活
  void setNonBlocking();
  void shutdownWrite(); // 关闭发送端
  void close();

private:
  int sockfd_;
};

```

## Socket.cpp

```cpp
#include "Socket.h"
#include <cstring>
#include <fcntl.h>
#include <iostream>
#include <netinet/tcp.h>
#include <sys/socket.h>
#include <unistd.h>

// SOCK_CLOEXEC执行exec子进程时自动关闭fd, 避免fd泄露
Socket::Socket() {
  sockfd_ = ::socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC,
                     IPPROTO_TCP);
  if (sockfd_ < 0) {
    std::cerr << "[Socket] Failed to create socket: " << strerror(errno)
              << std::endl;
    std::abort();
  }
}

Socket::~Socket() { close(); }

void Socket::bind(const InetAddress &addr) {
  // bind(int fd, const sockadd* addr, socklen_t len)
  int ret = ::bind(sockfd_, addr.getSockAddr(), addr.getSockLen());
  if (ret < 0) {
    std::cerr << "[Socket] bind failed: " << strerror(errno) << std::endl;
    std::abort();
  }
}

void Socket::listen(int backlog) {
  // listen（fd, 队列长度）
  int ret = ::listen(sockfd_, backlog);

  if (ret < 0) {
    std::cerr << "[Socket] listen failed: " << strerror(errno) << std::endl;
    std::abort();
  }
}
// 接受新连接
int Socket::accept(InetAddress *peerAddr) {
  sockaddr_in addr;
  socklen_t addrLen = sizeof(addr);
  std::memset(&addr, 0, sizeof(addr));
  int connfd = ::accept4(sockfd_, reinterpret_cast<sockaddr *>(&addr), &addrLen,
                         SOCK_NONBLOCK | SOCK_CLOEXEC);
  if (connfd >= 0) {
    peerAddr->setSockAddr(addr);
  } else {
    int savedErrno = errno;
    if (savedErrno != EAGAIN && savedErrno != EWOULDBLOCK &&
        savedErrno != EINTR) {
      std::cerr << "[Socket] accept failed: " << strerror(savedErrno)
                << std::endl;
    }
  }
  return connfd;
}

void Socket::setReuseAddr(bool on) {
  // 1 开启 0 关闭
  int optval = on ? 1 : 0;
  // setsockopt(fd, 选项层级， 选项名， 参数指针， 参数长度)
  if (::setsockopt(sockfd_, SOL_SOCKET, SO_REUSEADDR, &optval, sizeof(optval)) <
      0) {
    std::cerr << "[Socket] setsockopt SO_REUSEADDR failed: " << strerror(errno)
              << std::endl;
  }
}

void Socket::setReusePort(bool on) {
  int optval = on ? 1 : 0;
  if (::setsockopt(sockfd_, SOL_SOCKET, SO_REUSEPORT, &optval, sizeof(optval)) <
      0) {
    std::cerr << "[Socket] setsockopt SO_REUSEPORT failed: " << strerror(errno)
              << std::endl;
  }
}

void Socket::setTcpNoDelay(bool on) {
  int optval = on ? 1 : 0;
  if (::setsockopt(sockfd_, IPPROTO_TCP, TCP_NODELAY, &optval, sizeof(optval)) <
      0) {
    std::cerr << "[Socket] setsockopt TCP_NODELAY failed: " << strerror(errno)
              << std::endl;
  }
}

void Socket::setKeepAlive(bool on) {
  int optval = on ? 1 : 0;
  if (::setsockopt(sockfd_, SOL_SOCKET, SO_KEEPALIVE, &optval, sizeof(optval)) <
      0) {
    std::cerr << "[Socket] setsockopt SO_KEEPALIVE failed: " << strerror(errno)
              << std::endl;
  }
}

void Socket::setNonBlocking() {
  int flags = ::fcntl(sockfd_, F_GETFL, 0);
  if (flags < 0) {
    std::cerr << "[Socket] fcntl F_GETFL failed: " << strerror(errno)
              << std::endl;
    return;
  }
  if (::fcntl(sockfd_, F_SETFL, flags | O_NONBLOCK) < 0) {
    std::cerr << "[Socket] fcntl F_SETFL O_NONBLOCK failed: " << strerror(errno)
              << std::endl;
  }
}

void Socket::shutdownWrite() {
  if (::shutdown(sockfd_, SHUT_WR) < 0) {
    std::cerr << "[Socket] shutdownWrite failed: " << strerror(errno)
              << std::endl;
  }
}

void Socket::close() {
  if (sockfd_ >= 0) {
    if (::close(sockfd_) < 0) {
      std::cerr << "[Socket] close failed: " << strerror(errno) << std::endl;
    }
    sockfd_ = -1;
  }
}
```

### 本层对外能力

> 上层组件（Acceptor, TcpConnection）可以构造监听地址 InetAddress
> 创建Socket,设置地址/端口复用，TCP_NODELAY
> bind + listen, accept获取新连接fd

## 事件循环

## Channel.h

> Reactor核心事件分发包装器， 封装fd + 监听事件 + 事件回调
> 一个fd对应一个Channel, Channel只归属单个EventLoop
> Channel不持有fd, fd由Socket / Timerfd / Eventfd持有， 只负责事件注册，回调分发

```cpp
#pragma once
#include "Timer.h"
#include "noncopyable.h"
#include <cstdint>
#include <functional>
#include <memory>
#include <sys/epoll.h>

class EventLoop;

// Channel is the core event dispatcher. It does NOT own the fd;
// it is given an fd by an external owner (Socket, timerfd, eventfd).
//
// Each Channel belongs to exactly one EventLoop thread and tracks:
//   events_  - which events we are interested in (EPOLLIN, EPOLLOUT, etc.)
//   revents_ - which events actually fired (set by EPollPoller::poll).
// channel是fd事件包装器

// epoll检测到fd有事件时， 由channel分发执行对应回调
// 一个fd对应channel,channel只属于一个EventLoop 单线程事件循环
// channel不拥有fd, fd由于Socket/Timer等外部对象持有， Channel仅仅做事件 管理
class Channel : noncopyable {
public:
  // 无参 无返回回调（写， 关闭， 错误事件）
  using EventCallback = std::function<void()>;
  // 读事件回调， 传入事件到达事件戳
  using ReadEventCallback = std::function<void(Timestamp)>;
  Channel(EventLoop *loop, int fd);
  ~Channel();

  // 只读获取接口
  int fd() const { return fd_; }
  int events() const { return events_; }
  int index() const { return index_; }
  EventLoop *ownerLoop() const { return loop_; }
  uint32_t revents() const { return revents_; }

  // Called by EPollPoller to record the fd's position in the epoll interest
  // list.
  // Poller交互标记， 给epoll轮询器使用
  // index_   标记Channel在Epoll数组里的状态 新增/已注册/待删除】
  //-1 未加入 0 曾经加入 1 fd在epoll中
  void setIndex(int idx) { index_ = idx; }

  // Called by EPollPoller when poll() returns events for this fd.
  // epoll轮询后， 把内核返回的触发事件存入revents_, 供后续分发回调
  void setRevents(uint32_t revents) { revents_ = revents; }
  // 事件状态判断
  bool isNoneEvent() const { return events_ == kNoneEvent; }
  bool isReading() const { return events_ & kReadEvent; } // 是否监听读事件
  bool isWriting() const { return events_ & kWriteEvent; }

  // Enable / disable specific event interests.
  // 事件开关接口
  void enableReading();  // 开启读事件 EPOLLIN | EPOLLPRI
  void disableReading(); // 关闭读事件
  void enableWriting();  // 开启写事件 EPOLLOUT
  void disableWriting(); // 关闭写事件
  void disableAll();     // 清空所有监听事件

  // --- Callback setters ---
  // 回调绑定接口
  void setReadCallback(ReadEventCallback cb) { readCallback_ = std::move(cb); }
  void setWriteCallback(EventCallback cb) { writeCallback_ = std::move(cb); }
  void setCloseCallback(EventCallback cb) { closeCallback_ = std::move(cb); }
  void setErrorCallback(EventCallback cb) { errorCallback_ = std::move(cb); }

  // Called by EventLoop when poll returns events for this fd.
  // Dispatches to the appropriate callback based on revents_.
  // 核心事件分发入口
  void handleEvent(Timestamp receiveTime); // 对外入口， 加线程安全保护

  // Remove this channel from its EventLoop.
  // 将当前Channel从所属EventLoop的epoll中移除， 不再监听事件
  void remove();

  // Tie this channel to a shared_ptr owner to prevent premature destruction.
  // 保活机制
  void tie(const std::shared_ptr<void> &obj);

private:
  // EPOLLIN fd有数据可读
  // EPOLLPRI 紧急数据
  // EPOLLOUT fd缓冲区可写
  static const uint32_t kNoneEvent = 0;
  static const uint32_t kReadEvent = EPOLLIN | EPOLLPRI;
  static const uint32_t kWriteEvent = EPOLLOUT;

  void update(); // 同步events_到epoll, 调用EventLoop::updateChannel()
                 //  最终调用epoll_ctl完成内核监听增 / 改 / 删

  // 带安全保护的事件分发， 配合tie_保活， eventHandling_防重入
  void handleEventWithGuard(
      Timestamp receiveTime); // 真正事件分发，根据revents_ 匹配触发对应回调

  EventLoop *const loop_; // 所属事件循环，固定不可修改
  const int fd_;          // 监听的文件描述符，固定
  uint32_t events_;       // 注册监听的事件掩码
  uint32_t revents_;      // epoll 返回的触发事件
  int index_;             // Poller 状态标记

  bool eventHandling_; // 是否正在执行事件回调（防止重入）
  bool addedToLoop_;   // 是否已经加入 epoll

  std::weak_ptr<void> tie_; // 绑定外部对象，保活用
  bool tied_;               // 是否调用过 tie()

  ReadEventCallback readCallback_;
  EventCallback writeCallback_;
  EventCallback closeCallback_;
  EventCallback errorCallback_;
};

```

## Channel.cpp

```cpp
#include "Channel.h"
#include "EventLoop.h"
#include <cassert>
#include <iostream>
#include <sys/epoll.h>

Channel::Channel(EventLoop *loop, int fd)
    : loop_(loop), fd_(fd), events_(0), // 初始不监听任何事件
      revents_(0),                      // 本次触发事件空
      index_(-1),                       // -1：未加入epoll
      eventHandling_(false),            // 当前没有在执行回调
      addedToLoop_(false),              // 还没注册到epoll
      tied_(false) {}                   // 未绑定外部shared_ptr保活

Channel::~Channel() {
  assert(!eventHandling_);
  assert(!addedToLoop_);
}
// 事件开关接口
void Channel::enableReading() {
  events_ |= kReadEvent; // 按位或，叠加读掩码 EPOLLIN | EPOLLPRI
  update();
}

void Channel::disableReading() {
  events_ &= ~kReadEvent; // 按位与取反，清除读掩码
  update();
}

void Channel::enableWriting() {
  events_ |= kWriteEvent; // 叠加 EPOLLOUT
  update();
}

void Channel::disableWriting() {
  events_ &= ~kWriteEvent; // 清除 EPOLLOUT
  update();
}

void Channel::disableAll() {
  events_ = kNoneEvent; // 直接置0，不监听任何事件
  update();
}

void Channel::update() {
  addedToLoop_ = true; // addedToLoop是否已加入epoll
  loop_->updateChannel(this);
}

void Channel::remove() {
  assert(isNoneEvent());
  addedToLoop_ = false;
  loop_->removeChannel(this);
}
void Channel::handleEvent(Timestamp receiveTime) {
  std::shared_ptr<void> guard;
  if (tied_) {
    guard = tie_.lock();
    if (guard) {
      handleEventWithGuard(receiveTime);
    }
  } else {
    handleEventWithGuard(receiveTime);
  }
}

void Channel::handleEventWithGuard(Timestamp receiveTime) {
  eventHandling_ = true; // 标记正在处理事件，禁止析构

  // 1. 处理连接关闭 EPOLLHUP
  if ((revents_ & EPOLLHUP) && !(revents_ & EPOLLIN)) {
    if (closeCallback_)
      closeCallback_();
  }

  // 2. 处理错误 EPOLLERR
  if (revents_ & EPOLLERR) {
    if (errorCallback_)
      errorCallback_();
  }

  // 3. 处理读事件：EPOLLIN / EPOLLPRI / EPOLLRDHUP
  if (revents_ & (EPOLLIN | EPOLLPRI | EPOLLRDHUP)) {
    if (readCallback_)
      readCallback_(receiveTime);
  }

  // 4. 处理写事件 EPOLLOUT
  if (revents_ & EPOLLOUT) {
    if (writeCallback_)
      writeCallback_();
  }

  eventHandling_ = false; // 事件处理完毕，解除标记
}

void Channel::tie(const std::shared_ptr<void> &obj) {
  tie_ = obj;   // weak_ptr 托管 shared_ptr的资源， 但 不增加 引用计数
  tied_ = true; // 标记启用保活
}
```

## Poller.h

> IO多路复用抽象基类， 屏蔽select, poll, epoll
> 职责：
>
> 1. 维护fd -> Channel映射表
> 2. 提供接口：poll, updateChannel, removeChannel
> 3. 工厂方法: newDefaultPoller创建具体多路复用实现(EPollPoller)

```cpp
#pragma once

#include "Timer.h"
#include "noncopyable.h"
#include <unordered_map>
#include <vector>

class Channel;
class EventLoop;

// Abstract base class for I/O multiplexing.
// Concrete implementation: EPollPoller.
// 抽象基类 接口层
// Poller是IO多路复用的统一抽象， 屏蔽底层epoll / poll / select差异
/*
管理所有channel与 fd映射关系
阻塞等待内核IO事件
把触发事件的Channel收集给EventLoop
提供结构增删改  监听channel
*/
class Poller : noncopyable {
protected:
  using ChannelList = std::vector<Channel *>;
  //map红黑树， O(logn) 快速查找， 选择unordered_map
  using ChannelMap = std::unordered_map<int, Channel *>; // O(1)

public:
  // = 0 代表纯虚函数
  virtual void updateChannel(Channel *channel) = 0; // add / update fd 监听事件
  virtual void removeChannel(Channel *channel) = 0;
  // 阻塞轮询， 等待内核IO事件， 把就绪的Channel填入activeChannels
  virtual Timestamp poll(int timeoutMs, ChannelList *activeChannels) = 0;
  // 基类兜底返回false, 子类EpollPoller会重写
  virtual bool hasChannel(Channel *channel) const { return false; }
  // 工厂方法
  static Poller *newDefaultPoller(EventLoop *loop);

  virtual ~Poller() = default;

protected:
  explicit Poller(EventLoop *loop) : ownerLoop_(loop) {}

  // const修饰指针， 指针一旦初始化， 不能再指向别的EventLoop对象
  EventLoop *const ownerLoop_;
};

```

## EpollPoller.h

> Poller抽象基类的Epoll实现， 完成底层epoll API封装
> 创建并持有epollfd, 封装epoll_ctl(ADD/MOD/DEL)
> epoll_wait()阻塞等待事件， 收集就绪fd对应的Channel

```cpp
#pragma once

#include "Poller.h"
#include <sys/epoll.h>
#include <vector>
// 父类Poller的linux专属实现
//  Epoll-based I/O multiplexing implementation.
class EPollPoller : public Poller {
public:
  explicit EPollPoller(EventLoop *loop);
  ~EPollPoller() override;

  void updateChannel(Channel *channel) override;
  void removeChannel(Channel *channel) override;
  bool hasChannel(Channel *channel) const override;
  Timestamp poll(int timeoutMs, ChannelList *activeChannels) override;

private:
  // epoll_event 数组初始容量
  static const int kInitEventListSize = 16;

  // 底层封装 epoll_ctl，统一处理 ADD/MOD/DEL

  void update(int operation, Channel *channel);

  // 遍历 epoll_wait 返回的 events，填充活跃 Channel 列表
  void fillActiveChannels(int numEvents, ChannelList *activeChannels) const;

  // 存储 epoll_wait 返回的 epoll_event 数组
  using EventList = std::vector<epoll_event>;

  int epollfd_;
  // using ChannelMap = std::unordered_map<int, Channel *>; // O(1)
  ChannelMap channels_; // fd -> Channel*
                        //  using EventList = std::vector<epoll_event>;
  EventList events_;    // epoll_wait result buffer
};

```

## EpollPoller.cpp

```cpp
#include "EPollPoller.h"
#include "Channel.h"
#include "EventLoop.h"
#include <cstring>
#include <iostream>
#include <unistd.h>
/*
int epollfd_;
ChannelMap channels_;
EventList events_;

*/
// 先构造父类Poller
EPollPoller::EPollPoller(EventLoop *loop)
    : Poller(loop), epollfd_(::epoll_create1(EPOLL_CLOEXEC)),
      events_(kInitEventListSize) {
  if (epollfd_ < 0) {
    std::cerr << "[EPollPoller] epoll_create1 failed: " << strerror(errno)
              << std::endl;
    std::abort();
  }
}

EPollPoller::~EPollPoller() {
  if (epollfd_ >= 0) {
    ::close(epollfd_);
  }
}
Timestamp EPollPoller::poll(int timeoutMs, ChannelList *activeChannels) {
  // 阻塞等待就绪IO事件
  int numEvents = ::epoll_wait(epollfd_, events_.data(),
                               static_cast<int>(events_.size()), timeoutMs);
  int savedErrno = errno; // 保存错误码，防止被后续调用覆盖
  Timestamp now(Timestamp::now());

  if (numEvents > 0) {
    fillActiveChannels(numEvents, activeChannels);
    // 如果就绪事件填满数组，自动扩容一倍，避免事件截断丢失
    if (static_cast<size_t>(numEvents) == events_.size()) {
      events_.resize(events_.size() * 2);
    }
  } else if (numEvents < 0) {
    // 出错，EINTR 是被信号中断，属于正常场景，不打印日志
    if (savedErrno != EINTR) {
      std::cerr << "[EPollPoller] epoll_wait error: " << strerror(savedErrno)
                << std::endl;
    }
  }
  // numEvents == 0：超时无事件，直接返回时间戳
  return now;
}
void EPollPoller::updateChannel(Channel *channel) {
  const int index = channel->index();
  int fd = channel->fd();

  if (index == -1 || index == 0) {
    // index=-1：全新Channel，从未加入epoll
    // index=0：曾经加入过，后来被DEL删除
    if (index == -1) {
      // 存入哈希表 fd -> Channel*
      channels_[fd] = channel;
    }
    channel->setIndex(1); // 标记：已在epoll监听列表中
    update(EPOLL_CTL_ADD, channel);
  } else {
    // index=1：fd已经在epoll内
    if (channel->isNoneEvent()) {
      // 当前不监听任何事件，直接从epoll删除
      update(EPOLL_CTL_DEL, channel);
      channel->setIndex(0); // 标记：已移除
    } else {
      // 更新监听事件掩码 EPOLLIN/EPOLLOUT
      update(EPOLL_CTL_MOD, channel);
    }
  }
}
void EPollPoller::removeChannel(Channel *channel) {
  int fd = channel->fd();
  channels_.erase(fd); // 哈希表删除fd映射

  if (channel->index() == 1) {
    // 如果当前还在epoll中，执行DEL
    update(EPOLL_CTL_DEL, channel);
  }
  channel->setIndex(-1); // 重置为全新未注册状态
}

void EPollPoller::update(int operation, Channel *channel) {
  epoll_event event;
  std::memset(&event, 0, sizeof(event));
  event.events = channel->events(); // 要监听的事件掩码
  event.data.ptr = channel;         // 绑定Channel指针

  if (::epoll_ctl(epollfd_, operation, channel->fd(), &event) < 0) {
    // DEL失败一般是fd已经被删除，不用打印错误；ADD/MOD失败才告警
    if (operation != EPOLL_CTL_DEL) {
      std::cerr << "[EPollPoller] epoll_ctl op=" << operation
                << " fd=" << channel->fd() << " failed: " << strerror(errno)
                << std::endl;
    }
  }
}
bool EPollPoller::hasChannel(Channel *channel) const {
  auto it = channels_.find(channel->fd());
  return it != channels_.end() && it->second == channel;
}

// Static factory: creates the platform's default Poller.
Poller *Poller::newDefaultPoller(EventLoop *loop) {
  return new EPollPoller(loop);
}

void EPollPoller::fillActiveChannels(int numEvents,
                                     ChannelList *activeChannels) const {
  for (int i = 0; i < numEvents; ++i) {
    // epoll_event.data.ptr 存入的就是Channel*，直接强转
    Channel *channel = static_cast<Channel *>(events_[i].data.ptr);
    // 把本次触发的事件掩码存入channel.revents_
    channel->setRevents(events_[i].events);
    // 加入活跃列表，EventLoop后续统一分发回调
    activeChannels->push_back(channel);
  }
}
```

## EventLoop.h

> One loop per thread
> 一个线程最多绑定一个EventLoop， 所有IO回调，定时任务，投递任务均在本线程串行执行
> 职责：
>
> 1. poll()阻塞等待IO就绪事件
> 2. 遍历Channel, 分发Channel::handleEvent执行IO回调
> 3. 管理TimerQueue， 调度定时任务

```cpp
#pragma once

#include "Timer.h"
#include "noncopyable.h"
#include <atomic>
#include <functional>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

class Channel;
class Poller;
class TimerQueue;

// Core event loop. Each thread can have at most one EventLoop instance.
// Drives I/O multiplexing (via Poller), timer execution (via TimerQueue),
// and cross-thread task dispatch.
/*
EventLoop是单线程事件驱动循环， 驱动Poller阻塞等待IO事件， 分发Channel读写
内置TimerQueue管理定时任务
提供跨线程任务投递机制， 其他线程可以把函数丢进loop线程串行执行
一个线程最多只能有一个EventLoop,
io, 定时器， 任务全部在本线程串行执行
One loop per thread, 一个线程最多一个EventLoop, 所有的IO, 回调
， 定时任务都在这个线程串行跑
*/
class EventLoop : noncopyable {
public:
  using Functor = std::function<void()>;

  EventLoop();
  ~EventLoop();

  // Enter the event loop. Blocks until quit() is called.
  // 服务器主循环
  void loop();
  // 退出循环
  //  Signal the loop to stop after the current iteration.
  void quit();

  // --- Thread-safe task submission ---

  // Run cb immediately if in loop thread; otherwise queue it.
  // 如果当前就在 loop 线程 → 直接执行 cb；否则丢队列 + 唤醒 loop
  // 跨线程任务投递
  // 场景： 本线程直接跑， 跨线程入队
  void runInLoop(Functor cb);

  // Queue cb for execution in the loop thread. Safe to call from an  y thread.
  // 不管你是哪个线程，一律放进 pendingFunctors 任务队列，必要时唤醒 loop
  // 线程安全， 任意线程可调用
  // 无条件加入任务队列， 不会立即执行
  void queueInLoop(Functor cb);

  // --- Poller delegation ---
  // Poller套接字管理接口 转发给EpollPoller
  void updateChannel(Channel *channel);
  void removeChannel(Channel *channel);
  bool hasChannel(Channel *channel);

  // --- Thread affinity checks ---
  // 线程归属校验
  void assertInLoopThread();
  bool isInLoopThread() const; // 不在本线程直接崩溃

  // Wake up the event loop (called from other threads).
  void wakeup();

  // --- Accessors ---

  Poller *poller() const { return poller_; } // 获取底层epoll poller指针
  // 不用传入对象， 直接拿到 当前正在执行代码的线程绑定的EventLoop
  static EventLoop *
  getEventLoopOfCurrentThread(); // 基于线程本地存储，
                                 // 获取当前线程绑定的EventLoop

private:
  void handleWakeup();      // wakeupChannel的可读回调
  void doPendingFunctors(); // 执行跨线程投递过来的任务队列pendingFunctors
  // 打印错误并终止程序
  void abortNotInLoopThread();

  using ChannelList = std::vector<Channel *>;

  std::atomic<bool> looping_;      // 是否正在执行loop循环
  std::atomic<bool> quit_;         // 是否请求退出循环
  bool eventHandling_;             // 当前是否正在执行IO事件回调
  bool callingPendingFunctors_;    // 当前是否正在执行跨线程任务队列
  int64_t iteration_;              // 循环迭代次数，用于日志调试
  const std::thread::id threadId_; // 创建本loop的线程ID，永久不变
  Poller *poller_;                 // epoll封装
  std::unique_ptr<TimerQueue>
      timerQueue_; // 定时器管理 是EventLoop内部子组件， 生命周期归EventLopp独有
  Timestamp pollReturnTime_;   // epoll_wait返回的时间戳
  ChannelList activeChannels_; // 本次poll就绪的Channel列表

  // EventLoop线程大部分时间阻塞在epoll_wait(), 休眠等待IO事件，
  //  wakeupFd_ + wakeupChannel_ + pendingFunctors + mutex_
  // Wakeup mechanism  跨线程唤醒
  /*  多Reactor 主从Reactor
  A thread可以使用B thread的EventLoop,
  EventLoop对象可以被跨线程引用
  主线程（main thread）：mainLoop 负责 listen + accept
  新连接到来 → 主线程拿到 conn fd
  主线程把这个连接分配给 子IO线程 worker thread 的 workerLoop
  主线程调用 workerLoop->runInLoop( ... ) ，让workerLoop注册Channel、管理连接
  主线程（A），调用了 worker 线程（B）所属的 workerLoop。
  */
  int wakeupFd_;
  std::unique_ptr<Channel> wakeupChannel_;

  // Pending functors queue (cross-thread task dispatch)
  std::vector<Functor> pendingFunctors_;
  std::mutex mutex_;
};
```

## EventLoop.cpp

```cpp
#include "EventLoop.h"
#include "Channel.h"
#include "EPollPoller.h"
#include "Poller.h"
#include "TimerQueue.h"
#include <cassert>
#include <csignal>
#include <cstring>
#include <iostream>
#include <sys/eventfd.h>
#include <unistd.h>

// Thread-local pointer to the EventLoop for the current thread.
// nullptr if no EventLoop has been created on this thread.
//__thread 是GCC拓展关键字， 线程局部存储
// 强制一线程一Loop
__thread EventLoop *t_loopInThisThread = nullptr;
// 最长阻塞10s
const int kPollTimeMs = 10000; // Default poll timeout: 10 seconds

// --- Wakeup mechanism ---
// eventfd 轻量级事件fd. 用于线程间唤醒
// EFD_NONBLOCK非阻塞
// EFD_CLOEXEC exec进程自动关闭fd, 放泄露
int createEventfd() {
  int evtfd = ::eventfd(0, EFD_NONBLOCK | EFD_CLOEXEC);
  if (evtfd < 0) {
    std::cerr << "[EventLoop] eventfd creation failed: " << strerror(errno)
              << std::endl;
    std::abort();
  }
  return evtfd;
}
// 全局忽略信号
// SigPipe 终止整个程序， 只是一条连接坏了， 不该把整个服务干掉
//  Ignore SIGPIPE to prevent crashes when writing to closed connections.
class IgnoreSigPipe {
public:
  // 收到 Sigpipe直接忽略， 不要杀进程
  IgnoreSigPipe() { ::signal(SIGPIPE, SIG_IGN); }
};

static IgnoreSigPipe initObj;

EventLoop::EventLoop()
    : looping_(false), quit_(false), eventHandling_(false),
      callingPendingFunctors_(false), iteration_(0),
      threadId_(std::this_thread::get_id()), poller_(new EPollPoller(this)),
      timerQueue_(new TimerQueue(this)), wakeupFd_(createEventfd()),
      wakeupChannel_(new Channel(this, wakeupFd_)) {
  // 校验：当前线程不能已有EventLoop
  if (t_loopInThisThread) {
    std::cerr << "[EventLoop] Another EventLoop " << t_loopInThisThread
              << " exists in this thread " << threadId_ << std::endl;
    std::abort();
  }
  t_loopInThisThread = this;

  // 给唤醒fd绑定读回调，开启读监听
  wakeupChannel_->setReadCallback(std::bind(&EventLoop::handleWakeup, this));
  wakeupChannel_->enableReading();
}

EventLoop::~EventLoop() {
  // 停止监听wakeupfd，从epoll删除
  wakeupChannel_->disableAll();
  wakeupChannel_->remove();
  ::close(wakeupFd_);

  delete poller_;
  poller_ = nullptr;

  // 清空线程本地指针
  t_loopInThisThread = nullptr;
}

void EventLoop::loop() {
  assert(!looping_);
  assertInLoopThread();
  looping_ = true;
  quit_ = false;

  while (!quit_) {
    activeChannels_.clear();
    // 阻塞10m等待IO事件
    pollReturnTime_ = poller_->poll(kPollTimeMs, &activeChannels_);
    ++iteration_;
    // 处理所有就绪IO事件回调
    eventHandling_ = true;
    for (Channel *channel : activeChannels_) {
      // 处理Epoll监测到的fd事件， socket可读， 可写， timerfd定时器到期，
      channel->handleEvent(pollReturnTime_);
    }
    eventHandling_ = false;
    // 执行跨线程投递的任务
    //
    doPendingFunctors();
  }

  looping_ = false;
}

void EventLoop::quit() {
  quit_ = true;
  // Wake up the loop if it's blocked in poll
  if (!isInLoopThread()) {
    wakeup();
  }
}

void EventLoop::runInLoop(Functor cb) {
  if (isInLoopThread()) {
    cb(); // 当前是loop线程，直接执行
  } else {
    queueInLoop(std::move(cb)); // 跨线程，丢入队列
  }
}
// 线程安全投递任务
void EventLoop::queueInLoop(Functor cb) {
  { // 锁持有范围， 最小临界区
    std::lock_guard<std::mutex> lock(mutex_);
    pendingFunctors_.push_back(std::move(cb));
  }
  // Wake up the loop if:
  // - Called from another thread, OR
  // - Called from loop thread while doPendingFunctors is running
  if (!isInLoopThread() || callingPendingFunctors_) {
    wakeup();
  }
}

void EventLoop::updateChannel(Channel *channel) {
  assert(channel->ownerLoop() == this);
  assertInLoopThread();
  poller_->updateChannel(channel);
}

void EventLoop::removeChannel(Channel *channel) {
  assert(channel->ownerLoop() == this);
  assertInLoopThread();
  poller_->removeChannel(channel);
}

bool EventLoop::hasChannel(Channel *channel) {
  assert(channel->ownerLoop() == this);
  assertInLoopThread();
  return poller_->hasChannel(channel);
}

void EventLoop::assertInLoopThread() {
  if (!isInLoopThread()) {
    abortNotInLoopThread();
  }
}

bool EventLoop::isInLoopThread() const {
  return threadId_ == std::this_thread::get_id();
}

EventLoop *EventLoop::getEventLoopOfCurrentThread() {
  return t_loopInThisThread;
}

void EventLoop::abortNotInLoopThread() {
  std::cerr << "[EventLoop] abortNotInLoopThread - EventLoop " << this
            << " was created in threadId_ = " << threadId_
            << ", current thread id = " << std::this_thread::get_id()
            << std::endl;
  std::abort();
}

void EventLoop::wakeup() {
  uint64_t one = 1;
  ssize_t n = ::write(wakeupFd_, &one, sizeof(one));
  if (n != sizeof(one)) {
    std::cerr << "[EventLoop] wakeup write error: wrote " << n
              << " bytes instead of 8" << std::endl;
  }
}

void EventLoop::handleWakeup() {
  uint64_t one;
  ssize_t n = ::read(wakeupFd_, &one, sizeof(one));
  if (n != sizeof(one)) {
    std::cerr << "[EventLoop] handleWakeup read error: read " << n
              << " bytes instead of 8" << std::endl;
  }
}
// 批量执行跨线程任务
void EventLoop::doPendingFunctors() {
  std::vector<Functor> functors;
  callingPendingFunctors_ = true;
  // 交换容器，缩短锁持有时间
  {
    std::lock_guard<std::mutex> lock(mutex_);
    functors.swap(pendingFunctors_);
  }
  for (const Functor &functor : functors) {
    functor();
  }
  callingPendingFunctors_ = false;
}
```

### 本层对外能力

> 构造 Channel，绑定 fd，注册事件回调，
> 通过EventLoop更新/移除Channel, 底层调用epoll_ctl完成监听变更
> 使用 EventLoop::runInLoop /queueInLoop 跨线程投递任务，由 loop 线程串行执行
> EventLoop 内部封装 wakeup 唤醒机制，外部线程投递任务可唤醒阻塞在 epoll_wait 的循环

## Timer.h

> Timestamp封装int64微秒时间， 提供时间运算，
> Timer一个定时器对象，包含回调函数， 过期时间，重复间隔，全局序列号

```cpp
#pragma once

#include <chrono>
#include <functional>

// Represents a timestamp as microseconds since epoch.
// Used for timer expiration comparison.
class Timestamp { // 时间戳类
public:
  // 系统墙上时钟
  using Clock = std::chrono::system_clock;
  using Microseconds = std::chrono::microseconds;

  Timestamp() : microSecondsSinceEpoch_(0) {}

  explicit Timestamp(int64_t microSecondsSinceEpoch)
      : microSecondsSinceEpoch_(microSecondsSinceEpoch) {}

  static Timestamp now() {
    auto now = Clock::now().time_since_epoch();
    return Timestamp(std::chrono::duration_cast<Microseconds>(now).count());
  }

  int64_t microSecondsSinceEpoch() const { return microSecondsSinceEpoch_; }
  // 判断是不是合法时间
  bool valid() const { return microSecondsSinceEpoch_ > 0; }
  // 增加秒数
  Timestamp &operator+=(double seconds) {
    int64_t delta = static_cast<int64_t>(seconds * 1000000);
    microSecondsSinceEpoch_ += delta;
    return *this;
  }
  // 大小比较
  bool operator<(const Timestamp &rhs) const {
    return microSecondsSinceEpoch_ < rhs.microSecondsSinceEpoch_;
  }

  bool operator<=(const Timestamp &rhs) const {
    return microSecondsSinceEpoch_ <= rhs.microSecondsSinceEpoch_;
  }

  bool operator>(const Timestamp &rhs) const {
    return microSecondsSinceEpoch_ > rhs.microSecondsSinceEpoch_;
  }
  // 减法
  //  Returns the difference in seconds.
  double operator-(const Timestamp &rhs) const {
    int64_t diff = microSecondsSinceEpoch_ - rhs.microSecondsSinceEpoch_;
    return static_cast<double>(diff) / 1000000.0;
  }

private:
  int64_t microSecondsSinceEpoch_; // 总微秒
};

// A timer that fires a callback at a given expiration time.
// Supports one-shot (interval == 0) and repeating timers.
class Timer { // 定时器类
public:
  using TimerCallback = std::function<void()>;

  Timer(TimerCallback cb, Timestamp expiration, double interval = 0.0)
      : callback_(std::move(cb)), expiration_(expiration), interval_(interval),
        repeat_(interval > 0.0), sequence_(++s_numCreated_) {}
  // 执行定时器回调
  void run() const {
    if (callback_)
      callback_();
  }
  // 获取下次到期时间
  Timestamp expiration() const { return expiration_; }
  // 是否是重复定时器
  bool repeat() const { return repeat_; }
  // 获取唯一序列号
  int64_t sequence() const { return sequence_; }

  // Restart a repeating timer: advance expiration by interval_.
  // 重置重复定时器到期时间
  void restart(Timestamp now);

  // For ordering in the timer heap (min-heap by expiration).
  // Note: inverted for std::greater / heap ordering.
  bool operator<(const Timer &rhs) const {
    return expiration_ > rhs.expiration_; // Inverted for min-heap convenience
  }
  // 指针比较仿函数
  //  For comparing Timer* in heap operations.
  struct TimerPtrComparator {
    bool operator()(const Timer *a, const Timer *b) const {
      return a->expiration() >
             b->expiration(); // Min-heap: earlier expires first
    }
  };

private:
  const TimerCallback callback_; // 定时任务回调，创建后不可修改
  Timestamp expiration_;         // 下一次到期时间戳
  const double interval_;        // 重复间隔，固定不变
  const bool repeat_;            // 是否循环定时器，固定
  const int64_t sequence_;       // 全局唯一序列号，区分同时到期任务

  static int64_t s_numCreated_; // 全局定时器计数
};
```

## Timer.cpp

```cpp
#include "Timer.h"

int64_t Timer::s_numCreated_ = 0;

void Timer::restart(Timestamp now) {
  // 重复定时器
  if (repeat_) {
    expiration_ = now;
    expiration_ += interval_;
  } else {
    expiration_ = Timestamp();
  }
}

```

## TimerQueue.h

> 基于最小堆的 定时器管理器
> 工作流程：
> ① addTimer() → 插入堆中
> ② 如果新定时器比堆顶更早过期 → timerfd_settime() 重置 timerfd
> ③ epoll_wait 检测到 timerfd 可读 → handleRead()
> ④ handleRead() → 取出所有已过期的定时器 → 执行回调
> ⑤ 如果是重复定时器 → restart() 重新插入堆

```cpp
#pragma once

#include "Channel.h"
#include "Timer.h"
#include "noncopyable.h"
#include <memory>
#include <set>
#include <vector>

class EventLoop;

// Manages a collection of timers using a min-heap.
// Uses timerfd_create for kernel-level timer notification.
//
// All timer operations must happen in the owning EventLoop's thread.
// Timer单个定时任务， timerqueue 定时器管理器
class TimerQueue : noncopyable {
public:
  using TimerCallback = std::function<void()>;
  explicit TimerQueue(EventLoop *loop);
  ~TimerQueue();

  // Add a timer. The callback will be invoked after 'delay' seconds.
  // If interval > 0, the timer repeats every 'interval' seconds.
  // Thread-safe: must be called from the EventLoop thread.
  // 指定绝对到期时间戳
  Timer *addTimer(TimerCallback cb, Timestamp when, double interval);

  // 相对当前now延迟delay秒
  //  Convenience overload: add a timer relative to now.
  Timer *addTimer(TimerCallback cb, double delay, double interval);

  // Cancel a timer. Thread-safe.
  void cancel(Timer *timer);

private:
  using TimerList = std::vector<Timer *>;
  using ActiveTimerSet =
      std::set<Timer *>; // 有序红黑树集合， 保存所有正在堆里的Timer指针，
                         // logn， 用来实现cancel() 取消定时器
  // 回调函数， timerfd到期， epoll从读事件，
  void handleRead(Timestamp receiveTime);

  // Move expired timers from heap to expired list, reset timerfd.
  // clean expired timer
  std::vector<Timer *> getExpired(Timestamp now);

  // For repeating timers: restart or delete.
  void reset(const std::vector<Timer *> &expired, Timestamp now);

  bool insert(Timer *timer);

  EventLoop *const loop_;  // 所属事件循环，永久绑定，禁止跨线程操作
  const int timerfd_;      // Linux内核定时器fd，创建后不变
  Channel timerfdChannel_; // 绑定timerfd，监听到期读事件

  TimerList timers_;            // vector实现最小堆，存储所有定时任务
  ActiveTimerSet activeTimers_; // set红黑树，快速查找Timer，用于cancel取消

  bool callingExpiredTimers_; // 正在执行定时回调，防止cancel重入崩溃
};

```

## TimeQueue.cpp

```cpp
#include "TimerQueue.h"
#include "EventLoop.h"
#include <algorithm>
#include <cstring>
#include <iostream>
#include <sys/timerfd.h>
#include <unistd.h>

//   EventLoop *const loop_;  // 所属事件循环，永久绑定，禁止跨线程操作
//   const int timerfd_;      // Linux内核定时器fd，创建后不变
//   Channel timerfdChannel_; // 绑定timerfd，监听到期读事件

//   TimerList timers_;            // vector实现最小堆，存储所有定时任务
//   ActiveTimerSet activeTimers_; // set红黑树，快速查找Timer，用于cancel取消

//   bool callingExpiredTimers_; // 正在执行定时回调，防止cancel重入崩溃
// 创建定时器fd
int createTimerfd() {
  int timerfd = ::timerfd_create(CLOCK_MONOTONIC, TFD_NONBLOCK | TFD_CLOEXEC);
  if (timerfd < 0) {
    std::cerr << " [TimerQueue] timerfd_create failed: " << strerror(errno)
              << std::endl;
    std::abort();
  }
  return timerfd;
}
// __time_t tv_sec;
struct timespec howMuchTimeFromNow(Timestamp when) {
  int64_t microseconds =
      when.microSecondsSinceEpoch() - Timestamp::now().microSecondsSinceEpoch();
  // prevent < 0
  if (microseconds < 100) {
    microseconds = 100; // Minimum 100us
  }
  struct timespec ts;
  ts.tv_sec = static_cast<time_t>(microseconds / 1000000);
  ts.tv_nsec = static_cast<long>((microseconds % 1000000) * 1000);
  return ts;
}

void resetTimerfd(int timerfd, Timestamp expiration) {
  struct itimerspec newValue;
  struct itimerspec oldValue;
  std::memset(&newValue, 0, sizeof(newValue));
  std::memset(&oldValue, 0, sizeof(oldValue));
  newValue.it_value = howMuchTimeFromNow(expiration);
  // timerfd_settime修改内核timerfd超时时间
  int ret = ::timerfd_settime(timerfd, 0, &newValue, &oldValue);
  if (ret < 0) {
    std::cerr << "[TimerQueue] timerfd_settime failed: " << strerror(errno)
              << std::endl;
  }
}
// clean buf
void readTimerfd(int timerfd, Timestamp /*now*/) {
  uint64_t howmany;
  ssize_t n = ::read(timerfd, &howmany, sizeof(howmany));
  if (n != sizeof(howmany)) {
    std::cerr << "[TimerQueue] read timerfd error: reads " << n
              << " bytes instead of 8" << std::endl;
  }
}

TimerQueue::TimerQueue(EventLoop *loop)
    : loop_(loop), timerfd_(createTimerfd()), timerfdChannel_(loop, timerfd_),
      timers_(), callingExpiredTimers_(false) {
  timerfdChannel_.setReadCallback(
      std::bind(&TimerQueue::handleRead, this, std::placeholders::_1));
  timerfdChannel_.enableReading();
}

TimerQueue::~TimerQueue() {
  timerfdChannel_.disableAll();
  timerfdChannel_.remove();
  ::close(timerfd_);
  // Clean up all timers
  for (Timer *timer : timers_) {
    delete timer;
  }
}

Timer *TimerQueue::addTimer(TimerCallback cb, Timestamp when, double interval) {
  Timer *timer = new Timer(std::move(cb), when, interval);
  loop_->runInLoop([this, timer]() { insert(timer); });
  return timer;
}

Timer *TimerQueue::addTimer(TimerCallback cb, double delay, double interval) {
  Timestamp when = Timestamp::now();
  when += delay;
  return addTimer(std::move(cb), when, interval);
}

void TimerQueue::cancel(Timer *timer) {
  loop_->runInLoop([this, timer]() {
    auto it = activeTimers_.find(timer);
    if (it != activeTimers_.end()) {
      activeTimers_.erase(it);
      // Don't delete here; the timer will be in timers_ and cleaned up
      // when it would have expired, or we leave it and clean up in dtor.
      // Actually, let's delete immediately for simplicity and safety:
      // 从堆中删除该timer rebuild the heap
      auto heapIt = std::find(timers_.begin(), timers_.end(), timer);
      if (heapIt != timers_.end()) {
        timers_.erase(heapIt);
        std::make_heap(timers_.begin(), timers_.end(),
                       Timer::TimerPtrComparator());
      }
      delete timer;
    }
  });
}

void TimerQueue::handleRead(Timestamp /*receiveTime*/) {
  loop_->assertInLoopThread(); // 线程校验
  Timestamp now = Timestamp::now();
  readTimerfd(timerfd_, now);

  std::vector<Timer *> expired = getExpired(now);

  callingExpiredTimers_ = true;
  for (Timer *timer : expired) {
    timer->run();
  }
  callingExpiredTimers_ = false;

  reset(expired, now);
}
// 去除所有到期定时器
std::vector<Timer *> TimerQueue::getExpired(Timestamp now) {
  std::vector<Timer *> expired;

  while (!timers_.empty() && timers_.front()->expiration() <= now) {
    // Remove from active set if present
    activeTimers_.erase(timers_.front());

    std::pop_heap(timers_.begin(), timers_.end(), Timer::TimerPtrComparator());
    expired.push_back(timers_.back());
    timers_.pop_back();
  }

  return expired;
}

void TimerQueue::reset(const std::vector<Timer *> &expired, Timestamp now) {
  for (Timer *timer : expired) {
    if (timer->repeat()) {
      timer->restart(now);
      insert(timer);
    } else {
      delete timer;
    }
  }

  if (!timers_.empty()) {
    Timestamp nextExpire = timers_.front()->expiration();
    if (nextExpire.valid()) {
      resetTimerfd(timerfd_, nextExpire);
    }
  }
}

bool TimerQueue::insert(Timer *timer) {
  bool earliestChanged = false;
  Timestamp when = timer->expiration();

  if (timers_.empty() || when < timers_.front()->expiration()) {
    earliestChanged = true;
  }

  timers_.push_back(timer);
  std::push_heap(timers_.begin(), timers_.end(), Timer::TimerPtrComparator());
  activeTimers_.insert(timer);

  if (earliestChanged) {
    resetTimerfd(timerfd_, timer->expiration());
  }

  return earliestChanged;
}

```

## Buffer.h

> Tcp缓冲区， 解决粘包， 半包， 内存布局（前置预留区 + 可读区 + 可写区）
> `[prependable(前置预留)][readable(可读)][writable(可写)]

```cpp
#pragma once

#include <cstdint>
#include <string>
#include <sys/types.h>
#include <vector>

// Non-contiguous read/write buffer designed for TCP stream processing.
// Uses prependable + readable + writable layout:
//   [prependable (8 bytes)] [readable bytes] [writable bytes]
//
// readIndex_ points to start of readable data.
// writeIndex_ points to end of readable data (start of writable area).
// [可前置区 prependable][可读区 readable][可写区 writable] 0 readIndex_
//     writeIndex_ buffer_.size()
class Buffer {
  // TCP 缓冲区， 解决毡包，半包
public:
  static const size_t kCheapPrepend = 8;   // 前面预留8字节
  static const size_t kInitialSize = 1024; // 初始可写空间1024字节
  explicit Buffer(size_t initialSize = kInitialSize);
  size_t readableBytes() const { return writeIndex_ - readIndex_; }
  size_t writableBytes() const { return buffer_.size() - writeIndex_; }
  size_t prependableBytes() const { return readIndex_; }
  // 获取可读数据起始地址
  // begin是Buffer内存首地址
  const char *peek() const { return begin() + readIndex_; }
  char *peek() { return begin() + readIndex_; }
  // 消费len个可读字节，把readIndex_向后偏移len
  void retrieve(size_t len);
  void retrieveAll(); // 清空全部数据
  std::string retrieveAsString(size_t len);
  std::string retrieveAllAsString();

  // IO接口， 网络核心
  ssize_t readFd(int fd, int *savedErrno);  // 读取内核缓冲区数据，
                                            // 存入当前buffer
  ssize_t writeFd(int fd, int *savedErrno); // 把buffer可读数据写入socket fd

  // write写入接口
  void append(const char *data, size_t len);
  void append(const std::string &str);

  // 确保有空间
  void ensureWritableBytes(size_t len);

  // 在可读区间[peek(), peek() + readableBytes()] 查找换行符\r\n
  const char *findCRLF() const; // 找到返回\r的指针
  // 在Buffer当前未消费的数据， 查找\r\n换行， 切分一行完整报文
  const std::vector<char> &data() const {
    return buffer_; // 返回底层vector的const只读引用
  }

private:
  // 可读写指针
  char *begin() { return buffer_.data(); }
  // 只读指针
  const char *begin() const { return buffer_.data(); }
  void makeSpace(size_t len);
  std::vector<char> buffer_;
  size_t readIndex_;  // 标记可读数据的起始位置
  size_t writeIndex_; // 标记可写数据的起始位置
};

```

## Buffer.cpp

```cpp
#include "Buffer.h"
#include <algorithm>
#include <cerrno>
#include <cstring>
#include <sys/uio.h>
#include <unistd.h>

Buffer::Buffer(size_t initialSize)
    : buffer_(kCheapPrepend + initialSize), readIndex_(kCheapPrepend),
      writeIndex_(kCheapPrepend) {}

void Buffer::retrieve(size_t len) {
  if (len < readableBytes()) {
    readIndex_ += len;
  } else { // 要消费的长度 >= 全部可读， 直接清空所有数据
    retrieveAll();
  }
}

void Buffer::retrieveAll() {
  readIndex_ = kCheapPrepend;
  writeIndex_ = kCheapPrepend;
}

std::string Buffer::retrieveAsString(size_t len) {
  size_t actualLen = std::min(len, readableBytes());
  // 从可读起始指针拷贝actualLen到字符串
  std::string result(peek(), actualLen);
  retrieve(actualLen); // 消费后移动指针
  return result;
}

std::string Buffer::retrieveAllAsString() {
  return retrieveAsString(readableBytes());
}
// append() -> ensureWritableBytes(len) -> makeSpace(len)
void Buffer::append(const char *data, size_t len) {
  ensureWritableBytes(len);
  // 内存拷贝： 外部data复制到buffer可写区
  std::copy(data, data + len, begin() + writeIndex_);
  writeIndex_ += len;
}

void Buffer::append(const std::string &str) {
  append(str.data(), str.size());
}

void Buffer::ensureWritableBytes(size_t len) {
  if (writableBytes() < len) {
    makeSpace(len);
  }
}

// Read from fd using readv: first into writable buffer space,
// then into a stack buffer (64KB) if more data is available.
// This avoids premature buffer growth for large reads.
ssize_t Buffer::readFd(int fd, int *savedErrno) {
  char extrabuf[65536]; // 64KB【‘ “
  const size_t writable = writableBytes();
  // struct iovec
  //   {
  //     void *iov_base;	/* Pointer to data.  */
  //     size_t iov_len;	/* Length of data.  */
  //   };

  iovec vec[2];
  vec[0].iov_base = begin() + writeIndex_;
  vec[0].iov_len = writable;
  vec[1].iov_base = extrabuf;
  vec[1].iov_len = sizeof(extrabuf);

  const int iovcnt = (writable < sizeof(extrabuf)) ? 2 : 1;
  ssize_t n = ::readv(fd, vec, iovcnt);
  if (n < 0) {
    *savedErrno = errno;
  } else if (static_cast<size_t>(n) <= writable) {
    // All data fit in the buffer
    writeIndex_ += n;
  } else {
    // Data overflowed into extrabuf, append to buffer
    writeIndex_ = buffer_.size();
    append(extrabuf, n - writable);
  }
  return n;
}

ssize_t Buffer::writeFd(int fd, int *savedErrno) {
  ssize_t n = ::write(fd, peek(), readableBytes());
  if (n < 0) {
    *savedErrno = errno;
  } else {
    retrieve(n);
  }
  return n;
}

const char *Buffer::findCRLF() const {
  const char *crlf =
      std::search(peek(), peek() + readableBytes(), "\r\n", "\r\n" + 2);
  return crlf == peek() + readableBytes() ? nullptr : crlf;
}

void Buffer::makeSpace(size_t len) {
  // If prependable space + writable space is enough, move data forward
  if (writableBytes() + prependableBytes() < len + kCheapPrepend) {
    // Need to grow the buffer
    buffer_.resize(writeIndex_ + len);
  } else {
    // Move readable data to the beginning of the buffer
    size_t readable = readableBytes();
    std::copy(begin() + readIndex_, begin() + writeIndex_,
              begin() + kCheapPrepend);
    readIndex_ = kCheapPrepend;
    writeIndex_ = readIndex_ + readable;
  }
}

```

## TcpConnection.h

> 封装一条已经accept完成的TCP连接，管理socket fd、Channel、读写Buffer；继承`enable_shared_from_this`，全部操作运行在所属EventLoop IO线程；由TcpServer创建，使用`shared_ptr`管理生命周期。

```cpp
#pragma once

#include "Buffer.h"
#include "Channel.h"
#include "InetAddress.h"
#include "Socket.h"
#include "Timer.h"
#include "noncopyable.h"
#include <functional>
#include <memory>
#include <string>

class EventLoop;

// Represents a single TCP connection. Managed via shared_ptr.
// Uses enable_shared_from_this so callbacks can safely extend the connection's
// lifetime.
// 不写访问权限的基类，**默认 private 继承**
class TcpConnection : noncopyable,
                      public std::enable_shared_from_this<TcpConnection> {
  // TcpConnection封装一条已accept成功的TCP连接， 管理conn的 socket fd, channel,
  // buffer
public:
  using TcpConnectionPtr = std::shared_ptr<TcpConnection>;
  using ConnectionCallback = std::function<void(const TcpConnectionPtr &)>;
  using MessageCallback =
      std::function<void(const TcpConnectionPtr &, Buffer *, Timestamp)>;
  using WriteCompleteCallback = std::function<void(const TcpConnectionPtr &)>;
  using CloseCallback = std::function<void(const TcpConnectionPtr &)>;
  // 未注册 ， 已注册， 正在关闭， 已经关闭
  enum StateE { kConnecting, kConnected, kDisconnecting, kDisconnected };

  //   EventLoop *loop_;        // 连接归属的IO线程循环
  //   const std::string name_; // 连接名称
  //   StateE state_;           // 当前连接状态

  //   Socket socket_;                    // TCP套接字封装（持有fd）
  //   std::unique_ptr<Channel> channel_; // fd对应的epoll事件处理器

  //   const InetAddress localAddr_; // 本机地址端口
  //   const InetAddress peerAddr_;  // 客户端对端地址端口

  //   Buffer inputBuffer_;  // 读缓冲区：客户端发来的数据存在这里
  //   Buffer outputBuffer_; // 写缓冲区：待发送给客户端的数据缓存

  // Construct with an already-accepted socket fd and peer address.
  // 循环 连接名字 fd, 本地地址 客户端地址
  TcpConnection(EventLoop *loop, const std::string &name, int sockfd,
                const InetAddress &localAddr, const InetAddress &peerAddr);
  ~TcpConnection();

  // --- Accessors ---
  // 只读访问接口
  EventLoop *getLoop() const { return loop_; }                   // IO线程
  const std::string &name() const { return name_; }              // 名字
  const InetAddress &localAddress() const { return localAddr_; } // 本地地址
  const InetAddress &peerAddress() const { return peerAddr_; }   // 对端地址
  bool connected() const { return state_ == kConnected; }        // 连接是否存活

  // --- Callback setters ---
  void setConnectionCallback(ConnectionCallback cb) {
    connectionCallback_ = std::move(cb);
  }
  void setMessageCallback(MessageCallback cb) {
    messageCallback_ = std::move(cb);
  }
  void setWriteCompleteCallback(WriteCompleteCallback cb) {
    writeCompleteCallback_ = std::move(cb);
  }
  void setCloseCallback(CloseCallback cb) { closeCallback_ = std::move(cb); }

  // Called by TcpServer when the connection is established.
  // 激活TCP连接， 正式开始收发数据
  void connectEstablished();

  // Called by TcpServer to start the destruction process.
  // 连接收尾， 释放epoll监听资源
  void connectDestroyed();

  // Send data. Thread-safe: if called from another thread, the actual send
  // is queued to the connection's EventLoop.
  // send string, 发底层二进制数据
  void send(const std::string &message);
  void send(const void *data, size_t len);

  // Initiate an orderly shutdown (finishes writing pending data first).
  // 优雅半关闭
  void shutdown();

  // Force close immediately.
  void forceClose();

private:
  void handleRead(Timestamp receiveTime);
  void handleWrite();
  void handleClose();
  void handleError();
  void sendInLoop(const std::string &message);
  void sendInLoop(const void *data, size_t len);
  void shutdownInLoop();   // 优雅关闭
  void forceCloseInLoop(); // 强制关闭

  EventLoop *loop_;        // 连接归属的IO线程循环
  const std::string name_; // 连接名称
  StateE state_;           // 当前连接状态

  Socket socket_;                    // TCP套接字封装（持有fd）
  std::unique_ptr<Channel> channel_; // fd对应的epoll事件处理器

  const InetAddress localAddr_; // 本机地址端口
  const InetAddress peerAddr_;  // 客户端对端地址端口

  Buffer inputBuffer_;  // 读缓冲区：客户端发来的数据存在这里
  Buffer outputBuffer_; // 写缓冲区：待发送给客户端的数据缓存

  ConnectionCallback connectionCallback_;
  MessageCallback messageCallback_;
  WriteCompleteCallback writeCompleteCallback_;
  CloseCallback closeCallback_;
};
```

## TcpConnection.cpp

```cpp
#include "TcpConnection.h"
#include "EventLoop.h"
#include <cassert>
#include <cstring>
#include <iostream>
#include <unistd.h>

TcpConnection::TcpConnection(EventLoop *loop, const std::string &name,
                             int sockfd, const InetAddress &localAddr,
                             const InetAddress &peerAddr)
    : loop_(loop), name_(name), state_(kConnecting),
      socket_(sockfd),                     // TCP套接字封装（持有fd）
      channel_(new Channel(loop, sockfd)), /// fd对应的epoll事件处理器
      localAddr_(localAddr), peerAddr_(peerAddr) {
  channel_->setReadCallback(
      std::bind(&TcpConnection::handleRead, this, std::placeholders::_1));
  channel_->setWriteCallback(std::bind(&TcpConnection::handleWrite, this));
  channel_->setCloseCallback(std::bind(&TcpConnection::handleClose, this));
  channel_->setErrorCallback(std::bind(&TcpConnection::handleError, this));

  socket_.setKeepAlive(true);
  socket_.setTcpNoDelay(true);
}

TcpConnection::~TcpConnection() { assert(state_ == kDisconnected); }

void TcpConnection::connectEstablished() {
  loop_->assertInLoopThread();
  assert(state_ == kConnecting);
  state_ = kConnected;
  // Tie the channel to this shared_ptr so the connection stays alive
  // while the channel is handling events.
  channel_->tie(shared_from_this());
  channel_->enableReading();

  if (connectionCallback_) {
    connectionCallback_(shared_from_this());
  }
}

void TcpConnection::connectDestroyed() {
  loop_->assertInLoopThread();
  if (state_ == kConnected) {
    state_ = kDisconnected;
    channel_->disableAll();
    if (connectionCallback_) {
      connectionCallback_(shared_from_this());
    }
  }
  channel_->remove();
}

void TcpConnection::handleRead(Timestamp receiveTime) {
  loop_->assertInLoopThread();
  int savedErrno = 0;
  ssize_t n = inputBuffer_.readFd(channel_->fd(), &savedErrno);
  if (n > 0) {
    if (messageCallback_) {
      messageCallback_(shared_from_this(), &inputBuffer_, receiveTime);
    }
  } else if (n == 0) {
    // Peer closed write side. If we have pending output, finish writing
    // before closing. Otherwise close immediately.
    if (outputBuffer_.readableBytes() > 0) {
      state_ = kDisconnecting;
    } else {
      handleClose();
    }
  } else {
    std::cerr << "[TcpConnection] handleRead error: " << strerror(savedErrno)
              << std::endl;
  }
}

void TcpConnection::handleWrite() {
  loop_->assertInLoopThread();
  if (channel_->isWriting()) {
    int savedErrno = 0;
    ssize_t n = outputBuffer_.writeFd(channel_->fd(), &savedErrno);
    if (n > 0) {
      if (outputBuffer_.readableBytes() == 0) {
        // All data written
        channel_->disableWriting();
        if (writeCompleteCallback_) {
          writeCompleteCallback_(shared_from_this());
        }
        if (state_ == kDisconnecting) {
          shutdownInLoop();
        }
      }
    } else {
      std::cerr << "[TcpConnection] handleWrite error: " << strerror(savedErrno)
                << std::endl;
    }
  }
}

void TcpConnection::handleClose() {
  loop_->assertInLoopThread();
  assert(state_ == kConnected || state_ == kDisconnecting);
  state_ = kDisconnected;
  channel_->disableAll();

  TcpConnectionPtr guardThis(shared_from_this());
  if (connectionCallback_) {
    connectionCallback_(guardThis);
  }
  if (closeCallback_) {
    closeCallback_(guardThis);
  }
}

void TcpConnection::handleError() {
  int err = 0;
  socklen_t len = sizeof(err);
  if (::getsockopt(channel_->fd(), SOL_SOCKET, SO_ERROR, &err, &len) < 0) {
    std::cerr << "[TcpConnection] handleError getsockopt failed: "
              << strerror(errno) << std::endl;
  }
  if (err != 0) {
    std::cerr << "[TcpConnection] SO_ERROR = " << err << " " << strerror(err)
              << std::endl;
  }
}

void TcpConnection::send(const std::string &message) {
  if (state_ == kConnected) {
    if (loop_->isInLoopThread()) {
      sendInLoop(message);
    } else {
      loop_->queueInLoop([this, message]() { sendInLoop(message); });
    }
  }
}

void TcpConnection::send(const void *data, size_t len) {
  send(std::string(static_cast<const char *>(data), len));
}

void TcpConnection::sendInLoop(const std::string &message) {
  loop_->assertInLoopThread();
  if (state_ == kDisconnected) {
    std::cerr << "[TcpConnection] send on disconnected connection" << std::endl;
    return;
  }

  outputBuffer_.append(message);

  // If not already writing, enable write notification
  if (!channel_->isWriting()) {
    channel_->enableWriting();
  }
}

void TcpConnection::shutdown() {
  if (state_ == kConnected) {
    state_ = kDisconnecting;
    loop_->runInLoop(
        std::bind(&TcpConnection::shutdownInLoop, shared_from_this()));
  }
}

void TcpConnection::shutdownInLoop() {
  loop_->assertInLoopThread();
  // Only shutdown write if all output data has been sent
  if (!channel_->isWriting()) {
    socket_.shutdownWrite();
  }
}

void TcpConnection::forceClose() {
  if (state_ == kConnected || state_ == kDisconnecting) {
    state_ = kDisconnecting;
    loop_->queueInLoop(
        std::bind(&TcpConnection::forceCloseInLoop, shared_from_this()));
  }
}

void TcpConnection::forceCloseInLoop() {
  loop_->assertInLoopThread();
  if (state_ == kConnected || state_ == kDisconnecting) {
    handleClose();
  }
}

```

## Acceptor.h

> 管理listen监听套接字， 负责TCP 3次握手完成后的accept, 运行在 main(base) Reactor 主线程；listenfd 可读时调用 accept 获取新sockfd，回调把新fd交给 TcpServer。

```cpp
#pragma once

#include "Channel.h"
#include "InetAddress.h"
#include "Socket.h"
#include "noncopyable.h"
#include <functional>

class EventLoop;
// 管理listen监听fd, 只处理TCP握手
//  Accepts new TCP connections on a listening socket.
//  Runs exclusively in the main (base) Reactor thread.
class Acceptor : noncopyable {

public:
  using NewConnectionCallback =
      std::function<void(int sockfd, const InetAddress &peerAddr)>;
  Acceptor(EventLoop *loop, const InetAddress &peerAddr);
  ~Acceptor();
  void setNewConnectionCallback(NewConnectionCallback cb) {
    newConnectionCallback_ = std::move(cb);
  }
  // 开启端口监听
  void listen();
  // 查询监听状态s
  bool listening() const { return listening_; }

private:
  // 客户端发起TCP握手， listen fd变为可读， epoll触发EPOLLIN，
  // Channel调用此函数
  void handleRead();

  EventLoop *loop_;       // 绑定的主线程主Reactor
  Socket acceptSocket_;   // 封装listen监听fd
  Channel acceptChannel_; // listen fd对应的epoll事件处理器
  NewConnectionCallback newConnectionCallback_; // 新连接回调
  bool listening_;                              // 是否已经调用listen开启端口
  int idleFd_; // 预留兜底fd，解决EMFILE fd耗尽崩溃问题
};

```

## Acceptor.cpp

```cpp
#include "Acceptor.h"
#include "EventLoop.h"
#include <fcntl.h>
#include <iostream>
#include <unistd.h>
//   EventLoop *loop_;       // 绑定的主线程主Reactor
//   Socket acceptSocket_;   // 封装listen监听fd
//   Channel acceptChannel_; // listen fd对应的epoll事件处理器
//   NewConnectionCallback newConnectionCallback_; // 新连接回调
//   bool listening_;                              // 是否已经调用listen开启端口
//   int idleFd_; // 预留兜底fd，解决EMFILE fd耗尽崩溃问题
Acceptor::Acceptor(EventLoop *loop, const InetAddress &listenAddr)
    : loop_(loop), acceptSocket_(), acceptChannel_(loop, acceptSocket_.fd()),
      listening_(false), idleFd_(::open("/dev/null", O_RDONLY | O_CLOEXEC)) {
  // 端口复用
  acceptSocket_.setReuseAddr(true);
  acceptSocket_.setReusePort(true);
  // 绑定监听地址 0:0:0:0:port
  acceptSocket_.bind(listenAddr);
  // Channel可读事件绑定当前类handleRead
  acceptChannel_.setReadCallback(std::bind(&Acceptor::handleRead, this));
}

Acceptor::~Acceptor() {
  acceptChannel_.disableAll(); // 取消epoll所有事件监听
  acceptChannel_.remove();     // 把fd从epoll红黑树彻底移除
  if (idleFd_ >= 0) {
    ::close(idleFd_);
  }
}

void Acceptor::listen() {
  loop_->assertInLoopThread(); // 强制主线程调用
  listening_ = true;
  acceptSocket_.listen();         // dial 底层syscall, 开启TCp半连接队列
  acceptChannel_.enableReading(); // 注册EPOLLIN, epoll监听新连接事件
}

void Acceptor::handleRead() {
  loop_->assertInLoopThread();
  InetAddress peerAddr; // 存储客户端IP端口

  int connfd = acceptSocket_.accept(&peerAddr);
  // 成功拿到新连接
  if (connfd >= 0) {
    if (newConnectionCallback_) {
      newConnectionCallback_(connfd, peerAddr);
    } else {
      ::close(connfd);
    }
  } else {
    // Handle fd exhaustion: close the idle fd, accept again, then reopen idle
    // fd
    if (errno == EMFILE || errno == ENFILE) {
      std::cerr << "[Acceptor] Too many open files, closing idle fd"
                << std::endl;
      ::close(idleFd_);
      // 再次accept, 现在又空闲fd,可以拿到握手客户端
      idleFd_ = acceptSocket_.accept(&peerAddr);
      if (idleFd_ >= 0) {
        ::close(idleFd_);
      }
      // 重新打开/dev/null, 恢复预留fd, 下次异常继续兜底
      idleFd_ = ::open("/dev/null", O_RDONLY | O_CLOEXEC);
    }
  }
}

```

## TcpServer.h

> 主从Reactor模型， 管理Acceptor, IO线程池， 全部TcpConnection连接， 新连接轮询分发到子IO线程

- baseLoop\_（主线程Reactor）：只运行Acceptor，负责监听端口、accept接收新TCP连接；不处理数据读写。

- subLoops\_（子Reactor线程池）：N个IO工作线程，每个线程持有一个EventLoop；新连接轮询分配到某个子Loop；连接的全部读写、定时器逻辑都在归属子线程执行。

```cpp
#pragma once

#include "InetAddress.h"
#include "TcpConnection.h"
#include "noncopyable.h"
#include <atomic>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>

class EventLoop;
class Acceptor;
class EventLoopThread;

// Manages all TcpConnections and supports multi-threaded (multi-reactor)
// operation.
//
// Architecture:
//   - baseLoop_: The main reactor thread (accepts new connections).
//   - subLoops_: Worker reactor threads (handle I/O for accepted connections).
//   - Connections are distributed via round-robin across subLoops_.
// TCP服务顶层入口， 连接管理器， 多Reactor线程池调度器
// 主从Reactor, baseLoop_主线程，只允许Acceptor， 专门监听端口， 接受新TCP连接
// subLoops_从Reactor线程池， N个工作IO线程，
// 每个新连接通过轮询分配到其中一个子Loop,
// 连接的所有读写事件只在归属子线程处理
class TcpServer : noncopyable {
public:
  // 每个IO子线程启动时执行的回调, 用来在线程初始化资源（数据库连接， 定时器等）
  using ThreadInitCallback = std::function<void(EventLoop *)>;
  // 连接建立 / 断开回调
  using ConnectionCallback = TcpConnection::ConnectionCallback;
  // 收到客户端报文回调
  using MessageCallback = TcpConnection::MessageCallback;
  // 输出缓冲区全部发送完毕回调
  using WriteCompleteCallback = TcpConnection::WriteCompleteCallback;

  // loop 主Reactor, listenAddr监听本机Ip + 端口 name服务名字
  TcpServer(EventLoop *loop, const InetAddress &listenAddr,
            const std::string &name = "TcpServer");
  ~TcpServer();

  // --- User-facing settings ---
  // 回调注册接口
  void setConnectionCallback(ConnectionCallback cb) {
    connectionCallback_ = std::move(cb);
  }
  void setMessageCallback(MessageCallback cb) {
    messageCallback_ = std::move(cb);
  }
  void setWriteCompleteCallback(WriteCompleteCallback cb) {
    writeCompleteCallback_ = std::move(cb);
  }
  void setThreadInitCallback(ThreadInitCallback cb) {
    threadInitCallback_ = std::move(cb);
  }
  // 设置IO工作线程数量
  void setThreadNum(int numThreads);

  // Start the server. numThreads: 0 = single-threaded, N = N worker threads.
  // 启动服务
  void start();

  // --- Accessors ---
  // 只读查询接口
  const std::string &name() const { return name_; }
  EventLoop *getLoop() const { return baseLoop_; }
  std::vector<EventLoop *> getAllLoops();

private:
  // using TcpConnectionPtr = std::shared_ptr<TcpConnection>;

  using TcpConnectionPtr = TcpConnection::TcpConnectionPtr;
  using ConnectionMap = std::map<std::string, TcpConnectionPtr>;
  // 收到新TCP连接， 创建TcpConnection对象， 分配IO线程， 加入全局连接表，
  // 正式启用连接
  void newConnection(int sockfd, const InetAddress &peerAddr);
  // 子线程收到关闭事件， 跨线程投递清理任务到主线程
  void removeConnection(const TcpConnectionPtr &conn);
  // 主线程使用，从map删除连接， 收尾销毁资源
  void removeConnectionInLoop(const TcpConnectionPtr &conn);

  EventLoop *const baseLoop_;          // 主线程主Reactor，永不修改
  const std::string name_;             // 服务名称
  std::unique_ptr<Acceptor> acceptor_; // 端口监听对象，仅主线程使用
  std::atomic<bool>
      started_;    // 原子布尔，标记服务是否已启动，多线程安全防重复start
  int nextConnId_; // 原子布尔，标记服务是否已启动，多线程安全防重复start

  // Thread pool
  int threadNum_;
  std::vector<std::unique_ptr<EventLoopThread>> threadPool_; // IO线程管理容器
  std::vector<EventLoop *>
      subLoops_; // 保存每个线程对应的EventLoop指针，用于轮询分配

  // User callbacks
  ConnectionCallback connectionCallback_;
  MessageCallback messageCallback_;
  WriteCompleteCallback writeCompleteCallback_;
  ThreadInitCallback threadInitCallback_;

  ConnectionMap connections_; // 连接名字 -> TcpConnectionPtr
};

```

## TcpServer.cpp

```cpp
#include "TcpServer.h"
#include "Acceptor.h"
#include "EventLoop.h"
#include "EventLoopThread.h"
#include <cstring>
#include <iostream>
#include <cassert>

TcpServer::TcpServer(EventLoop* loop, const InetAddress& listenAddr,
                     const std::string& name)
    : baseLoop_(loop),
      name_(name),
      acceptor_(new Acceptor(loop, listenAddr)),
      started_(false),
      nextConnId_(1),
      threadNum_(0) {
    acceptor_->setNewConnectionCallback(
        std::bind(&TcpServer::newConnection, this,
                  std::placeholders::_1, std::placeholders::_2));
}

TcpServer::~TcpServer() {
    baseLoop_->assertInLoopThread();
    for (auto& conn : connections_) {
        TcpConnectionPtr connPtr(conn.second);
        conn.second.reset();
        connPtr->getLoop()->runInLoop(
            std::bind(&TcpConnection::connectDestroyed, connPtr));
    }
}

void TcpServer::setThreadNum(int numThreads) {
    assert(!started_);
    threadNum_ = numThreads;
}

void TcpServer::start() {
    if (!started_) {
        started_ = true;

        // Create sub-reactor threads if requested
        if (threadNum_ > 0) {
            threadPool_.reserve(threadNum_);
            for (int i = 0; i < threadNum_; ++i) {
                auto thread = std::make_unique<EventLoopThread>();
                EventLoop* subLoop = thread->startLoop();
                if (threadInitCallback_) {
                    threadInitCallback_(subLoop);
                }
                subLoops_.push_back(subLoop);
                threadPool_.push_back(std::move(thread));
            }
        }
    }

    // Start accepting on the base loop
    if (!acceptor_->listening()) {
        baseLoop_->runInLoop(
            std::bind(&Acceptor::listen, acceptor_.get()));
    }
}

std::vector<EventLoop*> TcpServer::getAllLoops() {
    std::vector<EventLoop*> result;
    result.push_back(baseLoop_);
    result.insert(result.end(), subLoops_.begin(), subLoops_.end());
    return result;
}

void TcpServer::newConnection(int sockfd, const InetAddress& peerAddr) {
    baseLoop_->assertInLoopThread();

    // Round-robin selection of an event loop
    EventLoop* ioLoop = baseLoop_;
    if (!subLoops_.empty()) {
        ioLoop = subLoops_[nextConnId_ % subLoops_.size()];
        ++nextConnId_;
    }

    char buf[64];
    std::snprintf(buf, sizeof(buf), "-%s#%d", peerAddr.toIpPort().c_str(), nextConnId_);
    std::string connName = name_ + buf;

    // Get local address from the socket
    sockaddr_in localAddr;
    socklen_t addrLen = sizeof(localAddr);
    std::memset(&localAddr, 0, sizeof(localAddr));
    if (::getsockname(sockfd, reinterpret_cast<sockaddr*>(&localAddr), &addrLen) < 0) {
        std::cerr << "[TcpServer] getsockname failed: " << strerror(errno) << std::endl;
    }
    InetAddress localInetAddr(localAddr);

    TcpConnectionPtr conn(new TcpConnection(ioLoop, connName, sockfd,
                                            localInetAddr, peerAddr));

    connections_[connName] = conn;

    // Set up callbacks on the connection
    conn->setConnectionCallback(connectionCallback_);
    conn->setMessageCallback(messageCallback_);
    conn->setWriteCompleteCallback(writeCompleteCallback_);
    conn->setCloseCallback(
        std::bind(&TcpServer::removeConnection, this, std::placeholders::_1));

    // Establish the connection in its own IO loop
    ioLoop->runInLoop(
        std::bind(&TcpConnection::connectEstablished, conn));
}

void TcpServer::removeConnection(const TcpConnectionPtr& conn) {
    baseLoop_->runInLoop(
        std::bind(&TcpServer::removeConnectionInLoop, this, conn));
}

void TcpServer::removeConnectionInLoop(const TcpConnectionPtr& conn) {
    baseLoop_->assertInLoopThread();
    size_t n = connections_.erase(conn->name());
    (void)n;
    assert(n == 1);

    EventLoop* ioLoop = conn->getLoop();
    ioLoop->queueInLoop(
        std::bind(&TcpConnection::connectDestroyed, conn));
}

```

## EventLoopThread.h

> 封装一个运行EventLoop的IO线程， 线程内部new出 EventLoop实例
> 主线程通过条件变量等待子线程初始化完成，拿到 loop 指针。

```cpp
#pragma once

#include "noncopyable.h"
#include <condition_variable>
#include <memory>
#include <mutex>
#include <thread>

class EventLoop;

// Encapsulates a thread that runs an EventLoop.
// The EventLoop is created inside the thread and returned via startLoop().
// EventLoopThread封装一条允许EventLoop的IO线程
class EventLoopThread : noncopyable {
public:
  EventLoopThread();
  ~EventLoopThread();

  // 创建底层std::thread, 执行threadFunc()

  EventLoop *startLoop();

private:
  void threadFunc(); // 线程入口函数

  EventLoop *loop_; // 子线程内的EventLoop指针，主线程通过startLoop获取
  bool exiting_;    // 标记是否要退出循环，析构置true
  std::unique_ptr<std::thread> thread_; // 底层操作系统线程封装
  std::mutex mutex_;                    // 保护loop_、exiting_共享变量
  std::condition_variable cond_;        // 同步：主线程等子线程创建loop完成
};

```

## EventLoopThread.h

```cpp
#include "EventLoopThread.h"
#include "EventLoop.h"

EventLoopThread::EventLoopThread() : loop_(nullptr), exiting_(false) {}

EventLoopThread::~EventLoopThread() {
  exiting_ = true;
  if (loop_ != nullptr) {
    loop_->quit();
  }
  if (thread_ && thread_->joinable()) {
    // 等待子线程函数threadFunc() 执行完毕， os线程回收
    thread_->join();
  }
}

EventLoop *EventLoopThread::startLoop() {
  // 创建系统线程，执行threadFunc
  thread_ = std::make_unique<std::thread>(&EventLoopThread::threadFunc, this);

  // Block until the thread has created the EventLoop
  // 加锁等待子线程创建EventLoop
  std::unique_lock<std::mutex> lock(mutex_);
  cond_.wait(lock, [this]() { return loop_ != nullptr; });

  return loop_;
}

void EventLoopThread::threadFunc() {
  // 每个线程独有loop
  EventLoop loop;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    loop_ = &loop;
    cond_.notify_one();
  }
  // 处理当前线程所有IO事件
  loop.loop();

  // When loop exits
  std::lock_guard<std::mutex> lock(mutex_);
  loop_ = nullptr;
}

```

## HttpRequest.h

> 简易HTTP1.0请求解析器，只实现GET方法；从TCP读到的原始字节缓冲区解析HTTP请求。

```cpp
#pragma once

#include <cstdint>
#include <map>
#include <string>

// Simple HTTP 1.0 request parser.
// Only supports GET method.
class HttpRequest {
public:
  enum Method { kInvalid, kGet };

  HttpRequest() : method_(kInvalid), majorVersion_(1), minorVersion_(0) {}

  // Parse the raw HTTP request from the buffer data.
  // 入口总解析函数
  // Returns true if a complete request was parsed.
  bool parseRequest(const char *begin, const char *end);
  // 只读查询接口
  Method method() const { return method_; }
  const std::string &path() const { return path_; }
  const std::map<std::string, std::string> &headers() const { return headers_; }
  const std::string &query() const { return query_; }

  // Get a specific header value. Returns empty string if not found.
  std::string getHeader(const std::string &field) const;

private:
  bool parseRequestLine(const char *begin, const char *end);
  bool parseHeaders(const char *begin, const char *end);
  std::string urlDecode(const std::string &input) const;

  Method method_;                              // 请求方法：kInvalid / kGet
  std::string path_;                           // 解码后的资源路径
  std::string query_;                          // URL查询参数串
  std::map<std::string, std::string> headers_; // 请求头键值对
  int majorVersion_;                           // HTTP主版本，固定1
  int minorVersion_;                           // HTTP次版本，固定0
};

```

## HttpRequest.cpp

```cpp
#include "HttpRequest.h"
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <sstream>

// Simple URL decode: %XX -> character
std::string HttpRequest::urlDecode(const std::string &input) const {
  std::string result;
  result.reserve(input.size());

  for (size_t i = 0; i < input.size(); ++i) {
    if (input[i] == '%' && i + 2 < input.size()) {
      int high = input[i + 1];
      int low = input[i + 2];

      auto hexToInt = [](char c) -> int {
        if (c >= '0' && c <= '9')
          return c - '0';
        if (c >= 'a' && c <= 'f')
          return c - 'a' + 10;
        if (c >= 'A' && c <= 'F')
          return c - 'A' + 10;
        return -1;
      };

      int h = hexToInt(static_cast<char>(high));
      int l = hexToInt(static_cast<char>(low));
      if (h >= 0 && l >= 0) {
        result.push_back(static_cast<char>((h << 4) | l));
        i += 2;
      } else {
        result.push_back('%');
      }
    } else if (input[i] == '+') {
      result.push_back(' ');
    } else {
      result.push_back(input[i]);
    }
  }
  return result;
}

bool HttpRequest::parseRequest(const char *begin, const char *end) {
  // 在 [begin, end) 缓冲区查找 "\r\n"
  const char *crlf = std::search(begin, end, "\r\n", "\r\n" + 2);
  if (crlf == end) {
    return false; // No complete request line yet
  }

  // Parse request line
  if (!parseRequestLine(begin, crlf)) {
    return false;
  }

  // Parse headers
  const char *headersStart = crlf + 2;
  if (!parseHeaders(headersStart, end)) {
    return false;
  }

  return true;
}

bool HttpRequest::parseRequestLine(const char *begin, const char *end) {
  std::string requestLine(begin, end - begin);

  // Expected format: METHOD PATH HTTP/1.X
  std::istringstream iss(requestLine);
  std::string method, path, version;
  if (!(iss >> method >> path >> version)) {
    std::cerr << "[HttpRequest] Malformed request line: " << requestLine
              << std::endl;
    return false;
  }

  // Parse method
  if (method == "GET") {
    method_ = kGet;
  } else {
    std::cerr << "[HttpRequest] Unsupported method: " << method << std::endl;
    method_ = kInvalid;
    return false;
  }

  // Parse path and query string
  size_t queryPos = path.find('?');
  if (queryPos != std::string::npos) {
    query_ = path.substr(queryPos + 1);
    path_ = path.substr(0, queryPos);
  } else {
    path_ = path;
  }

  // URL-decode the path (prevents path traversal via encoded sequences)
  path_ = urlDecode(path_);

  // Security: prevent path traversal (directory climbing)
  if (path_.find("..") != std::string::npos) {
    std::cerr << "[HttpRequest] Path traversal attempt: " << path_ << std::endl;
    return false;
  }

  // Default path to index.html
  if (path_ == "/") {
    path_ = "/index.html";
  }

  // Parse HTTP version
  if (version.size() >= 5 && version.substr(0, 5) == "HTTP/") {
    std::string verStr = version.substr(5);
    size_t dotPos = verStr.find('.');
    if (dotPos != std::string::npos) {
      majorVersion_ = std::stoi(verStr.substr(0, dotPos));
      minorVersion_ = std::stoi(verStr.substr(dotPos + 1));
    }
  }

  return true;
}

bool HttpRequest::parseHeaders(const char *begin, const char *end) {
  const char *current = begin;

  while (current < end) {
    const char *crlf = std::search(current, end, "\r\n", "\r\n" + 2);
    if (crlf == end) {
      return false; // Incomplete header
    }

    // Empty line indicates end of headers
    if (crlf == current) {
      return true; // Headers complete
    }

    // Parse header line: "Key: Value"
    std::string line(current, crlf - current);
    size_t colonPos = line.find(':');
    if (colonPos != std::string::npos) {
      std::string key = line.substr(0, colonPos);
      std::string value = line.substr(colonPos + 1);

      // Trim leading/trailing whitespace
      key.erase(0, key.find_first_not_of(" \t"));
      key.erase(key.find_last_not_of(" \t") + 1);
      value.erase(0, value.find_first_not_of(" \t"));
      value.erase(value.find_last_not_of(" \t") + 1);

      headers_[key] = value;
    }

    current = crlf + 2;
  }

  return false; // Ran out of data before finding end of headers
}

std::string HttpRequest::getHeader(const std::string &field) const {
  auto it = headers_.find(field);
  if (it != headers_.end()) {
    return it->second;
  }
  return "";
}

```

## HttpResponse.h

> 简易 HTTP1.0 响应封装，用来构造 HTTP 回复，最终序列化写入`Buffer`发送给客户端。

```cpp
#pragma once

#include <map>
#include <string>

class Buffer;

// Builds an HTTP 1.0 response.
class HttpResponse {
public:
  enum HttpStatusCode {
    k200Ok = 200,
    k400BadRequest = 400,
    k404NotFound = 404,
    k500InternalServerError = 500
  };

  HttpResponse(bool close = true)
      : statusCode_(k200Ok), closeConnection_(close) {}
  // 状态设置
  void setStatusCode(HttpStatusCode code) { statusCode_ = code; }
  void setStatusMessage(const std::string &message) {
    statusMessage_ = message;
  }
  void setCloseConnection(bool close) { closeConnection_ = close; }
  // 头部操作
  void setContentType(const std::string &contentType) {
    addHeader("Content-Type", contentType);
  }

  void addHeader(const std::string &key, const std::string &value) {
    headers_[key] = value;
  }

  void setBody(const std::string &body) { body_ = body; }

  // Serialize the response to a Buffer for sending.
  // 序列化接口
  void appendToBuffer(Buffer *output) const;

private:
  std::string statusMessageForCode(HttpStatusCode code) const;

  HttpStatusCode statusCode_;                  // 响应状态码
  std::string statusMessage_;                  // 状态描述文字
  std::map<std::string, std::string> headers_; // 全部响应头键值对
  std::string body_;                           // 响应正文
  bool closeConnection_; // 是否短连接（Connection: close）
};

```

## HttpResponse.cpp

```cpp
#include "HttpResponse.h"
#include "Buffer.h"
#include <cstdio>

std::string HttpResponse::statusMessageForCode(HttpStatusCode code) const {
    switch (code) {
        case k200Ok: return "OK";
        case k400BadRequest: return "Bad Request";
        case k404NotFound: return "Not Found";
        case k500InternalServerError: return "Internal Server Error";
        default: return "Unknown";
    }
}

void HttpResponse::appendToBuffer(Buffer* output) const {
    char buf[256];

    // Status line
    std::string msg = statusMessage_.empty()
                      ? statusMessageForCode(statusCode_)
                      : statusMessage_;
    std::snprintf(buf, sizeof(buf), "HTTP/1.0 %d %s\r\n",
                  static_cast<int>(statusCode_), msg.c_str());
    output->append(buf);

    // Connection header
    if (closeConnection_) {
        output->append("Connection: close\r\n");
    }

    // Content-Length
    std::snprintf(buf, sizeof(buf), "Content-Length: %zu\r\n", body_.size());
    output->append(buf);

    // Custom headers
    for (const auto& header : headers_) {
        std::snprintf(buf, sizeof(buf), "%s: %s\r\n",
                      header.first.c_str(), header.second.c_str());
        output->append(buf);
    }

    // Empty line before body
    output->append("\r\n");

    // Body
    output->append(body_);
}

```

## main.cpp

> 基于这个Reactor网络库的两个小demo

- EchoServer回显服务器， 收到什么就发回什么
- HttpServer， 简易HTTP服务器

```cpp
#include "TcpServer.h"
#include "EventLoop.h"
#include "InetAddress.h"
#include "Buffer.h"
#include "HttpRequest.h"
#include "HttpResponse.h"
#include <iostream>
#include <fstream>
#include <sstream>
#include <cstring>
#include <algorithm>

using TcpConnectionPtr = TcpConnection::TcpConnectionPtr;

// --- Echo Server ---
// Usage: ./reactor_demo [numThreads]
// Default: single-threaded echo server on port 8080

class EchoServer {
public:
    EchoServer(EventLoop* loop, const InetAddress& listenAddr)
        : server_(loop, listenAddr, "EchoServer") {
        server_.setConnectionCallback(
            [](const TcpConnectionPtr& conn) {
                std::cout << "[Echo] " << conn->peerAddress().toIpPort()
                          << " -> " << conn->localAddress().toIpPort()
                          << " is " << (conn->connected() ? "UP" : "DOWN")
                          << std::endl;
            });
        server_.setMessageCallback(
            [](const TcpConnectionPtr& conn, Buffer* buf, Timestamp) {
                // Echo back whatever we received
                std::string msg = buf->retrieveAllAsString();
                conn->send(msg);
            });
    }

    void setThreadNum(int numThreads) { server_.setThreadNum(numThreads); }
    void start() { server_.start(); }

private:
    TcpServer server_;
};

// --- HTTP Server ---
// Usage: ./reactor_demo http
// Serves static files from the www/ directory

class HttpServer {
public:
    HttpServer(EventLoop* loop, const InetAddress& listenAddr,
               const std::string& docRoot)
        : server_(loop, listenAddr, "HttpServer"),
          docRoot_(docRoot) {
        server_.setConnectionCallback(
            [](const TcpConnectionPtr& conn) {
                std::cout << "[HTTP] " << conn->peerAddress().toIpPort()
                          << " -> " << conn->localAddress().toIpPort()
                          << " is " << (conn->connected() ? "UP" : "DOWN")
                          << std::endl;
            });
        server_.setMessageCallback(
            [this](const TcpConnectionPtr& conn, Buffer* buf, Timestamp) {
                onMessage(conn, buf);
            });
    }

    void setThreadNum(int numThreads) { server_.setThreadNum(numThreads); }
    void start() { server_.start(); }

private:
    void onMessage(const TcpConnectionPtr& conn, Buffer* buf) {
        // Parse the HTTP request
        HttpRequest req;
        const char* peek = buf->peek();
        if (!req.parseRequest(peek, peek + buf->readableBytes())) {
            // Incomplete request, wait for more data
            return;
        }

        // Consume the parsed data - find \r\n\r\n
        const char* dataStart = buf->peek();
        const char* dataEnd = dataStart + buf->readableBytes();
        const char* headerEnd = std::search(dataStart, dataEnd, "\r\n\r\n", "\r\n\r\n" + 4);
        if (headerEnd != dataEnd) {
            size_t consumed = (headerEnd + 4) - dataStart;
            buf->retrieve(consumed);
        } else {
            buf->retrieveAll();
        }

        HttpResponse response(true);  // HTTP/1.0: close after response

        std::cout << "[HTTP] " << req.path() << std::endl;

        // Secure path: prevent directory traversal
        std::string filePath = docRoot_ + req.path();

        // Read file
        std::ifstream file(filePath, std::ios::binary);
        if (file.is_open()) {
            std::ostringstream oss;
            oss << file.rdbuf();
            std::string content = oss.str();

            response.setStatusCode(HttpResponse::k200Ok);
            response.setContentType(getMimeType(req.path()));
            response.setBody(content);
        } else {
            // 404 Not Found
            std::string notFoundBody = "<html><head><title>404 Not Found</title></head>"
                                       "<body><h1>404 Not Found</h1><p>"
                                       "The requested URL was not found on this server."
                                       "</p></body></html>";
            response.setStatusCode(HttpResponse::k404NotFound);
            response.setContentType("text/html");
            response.setBody(notFoundBody);
        }

        // Serialize response to a Buffer and send
        Buffer responseBuf;
        response.appendToBuffer(&responseBuf);
        conn->send(responseBuf.retrieveAllAsString());

        // HTTP 1.0 non-persistent: close after response
        conn->shutdown();
    }

    static std::string getMimeType(const std::string& path) {
        if (path.size() >= 5 && path.substr(path.size() - 5) == ".html") return "text/html";
        if (path.size() >= 4 && path.substr(path.size() - 4) == ".css")  return "text/css";
        if (path.size() >= 3 && path.substr(path.size() - 3) == ".js")   return "application/javascript";
        if (path.size() >= 4 && path.substr(path.size() - 4) == ".png")  return "image/png";
        if (path.size() >= 4 && path.substr(path.size() - 4) == ".jpg")  return "image/jpeg";
        if (path.size() >= 4 && path.substr(path.size() - 4) == ".svg")  return "image/svg+xml";
        if (path.size() >= 4 && path.substr(path.size() - 4) == ".ico")  return "image/x-icon";
        if (path.size() >= 5 && path.substr(path.size() - 5) == ".json") return "application/json";
        if (path.size() >= 4 && path.substr(path.size() - 4) == ".txt")  return "text/plain";
        return "application/octet-stream";
    }

    TcpServer server_;
    std::string docRoot_;
};

void printUsage(const char* prog) {
    std::cout << "Usage:\n"
              << "  " << prog << " [numThreads]     Echo server (default: single-thread)\n"
              << "  " << prog << " http             HTTP static file server\n"
              << "  " << prog << " http [numThreads] HTTP server with worker threads\n"
              << "\nExamples:\n"
              << "  " << prog << "              Single-threaded echo on port 8080\n"
              << "  " << prog << " 4            Multi-threaded echo (4 workers)\n"
              << "  " << prog << " http         Single-threaded HTTP on port 8080\n"
              << "  " << prog << " http 4       Multi-threaded HTTP (4 workers)\n"
              << std::endl;
}

int main(int argc, char* argv[]) {
    std::cout << "=== ReactorNet - C++ Network Library Demo ===\n" << std::endl;

    bool httpMode = false;
    int numThreads = 0;

    if (argc > 1) {
        if (std::string(argv[1]) == "http") {
            httpMode = true;
            if (argc > 2) {
                numThreads = std::stoi(argv[2]);
            }
        } else if (std::string(argv[1]) == "-h" || std::string(argv[1]) == "--help") {
            printUsage(argv[0]);
            return 0;
        } else {
            numThreads = std::stoi(argv[1]);
        }
    }

    EventLoop loop;
    InetAddress listenAddr(8080);

    if (httpMode) {
        // Try common docRoot locations
        std::string docRoot = "../www/";
        {
            std::ifstream test(docRoot + "index.html");
            if (!test.is_open()) {
                docRoot = "www/";  // Fallback to project root
            }
        }
        std::cout << "Starting HTTP server on port 8080, docRoot=" << docRoot
                  << ", threads=" << numThreads << std::endl;
        HttpServer server(&loop, listenAddr, docRoot);
        server.setThreadNum(numThreads);
        server.start();
        std::cout << "Server listening on " << listenAddr.toIpPort() << std::endl;
        loop.loop();
    } else {
        std::cout << "Starting Echo server on port 8080, threads=" << numThreads << std::endl;
        EchoServer server(&loop, listenAddr);
        server.setThreadNum(numThreads);
        server.start();
        std::cout << "Server listening on " << listenAddr.toIpPort() << std::endl;
        loop.loop();
    }
    return 0;
}

```

### select / poll / epoll是干什么的

> 都属于 IO 多路复用， 一个线程，同时监视一堆文件描述符，知道哪些fd 可读 / 可写， 再去做read / write

```
TCP服务有成千上千个客户端连接，
	方案1： 每个连接一个线程， 线程爆炸
	方案2： IO多路复用， 单个线程监听大量fd， 只处理已就绪的fd

select , poll 跨平台   epoll 仅linux
select的 fd集合有最大上限 1024, 每次调用都要把整个fd集合从用户态 拷贝到 内核态
		返回只告诉有一堆fd有事件， 需要遍历全部fd判断 O(n)
poll vs select， poll没有fd上限，
		每次调用依旧需要把整个数组拷贝进内核， 全部遍历判断 O(n)
epoll :
	epoll_create() 创建epoll实例， 返回epoll fd
	epoll_ctl(epfd, EPOLL_ADD/MOD/DEL, fd, event)
	epoll_wait()阻塞等待事件， 直接返回已经就绪的fd列表
```

> epoll优势

- 1.  fd只拷贝一次到内核， epoll_ctl注册一次， 后续反复epoll_wait不需要重复拷贝全部fd.
- 2.  epoll_wait直接拿到就绪事件数组， 用户只遍历就绪的那几个fd, O(就绪数量)
      > LT 水平触发 ET边缘触发。
- LT 只要缓冲区还有数据没读完， 每次epoll_wait都通知，
- ET 在状态发生变化那一刻， 一次把socket缓冲区数据全部读完

- 在ReactorNet库： EpollPoller封装epoll_xxx 系统调用， EventLoop调用poller->poll() -> epoll_wait() -> 拿到就绪channel， 调用channel->handleEvent() 执行读写回调

### 为什么网络库的Socket, EventLoop这些类要禁止拷贝 ?

>     Socket、EventLoop 封装独占内核资源（fd、事件上下文），默认浅拷贝会导致多个对象持有同一份资源，析构时双重释放，引发未定义行为.

### `inet_pton` / `inet_ntop` 做 IP 地址转换

- p (presentation文本字符串) n (network网络二进制)

- ```
  int inet_pton(int af, const char *src, void *dst); IP->二进制
  ```
- inet_ntop() 二进制->IP

## sockaddr_in` 结构体的字段含义

```c
#include <arpa/inet.h>

struct sockaddr_in {
    sa_family_t    sin_family;   // 地址族
    in_port_t      sin_port;    // 端口号，**网络字节序（大端）**
    struct in_addr sin_addr;    // IPv4地址结构体
    unsigned char  sin_zero[8]; // 占位，填充0，兼容通用sockaddr，不用管
};

// in_addr 内部
struct in_addr {
    uint32_t s_addr; // IPv4地址，uint32_t，**网络字节序（大端）**
};

```

> sin_family IPv4填 AF_INET IPv6填写AF_INET6

### Socket使用`setReuseAddr`、`setReusePort`、`setTcpNoDelay`、`setKeepAlive`

### `SOCK_CLOEXEC` 和 `SOCK_NONBLOCK` 为什么重要？不用它们会有什么问题？

1. **SOCK_NONBLOCK**：创建 fd 时直接设为非阻塞，避免 `fcntl` 并发竞争；是事件驱动网络库（epoll）必需。
2. **SOCK_CLOEXEC**：创建 fd 时带上 FD_CLOEXEC 标志，防止 `fork+exec` 子进程继承 socket fd，造成资源泄漏、端口无法释放。

### tie保活

> TcpConnection通过tie()把自己的shared_ptr绑定到Channel，防止处理事件时连接对象被销毁。

### 为什么要用抽象基类 Poller，而不是直接使用 epoll？这样做的好处是什么？

> 面向接口编程， 方便切换poll版本golang中使用interface实现

### 为什么需要eventfd? 不能只往pendingFunctors加任务，等epoll自然唤醒 ？

> epoll_wait会阻塞， 没有IO时间，线程沉睡

### doPendingFunctors() 为什么swap, 不直接遍历原PendingFunctor

> 1. 锁持有时间太长
> 2. 回调过程中， 内部可能给pendingFunctor加新任务， 迭代器失效
> 3. 有swap,只要加锁保护swap()

### 定时器为什么使用timerfd,而不是轮询

> ReactorNet 内部维护最小堆保存定时器， 同时把timerfd加入epoll监听， 定时器到期， 内核让timerfd可读， epoll_wait返回，处理到期定时器

### TimerQueue 堆里面存裸指针 `Timer*`，为什么不用 `std::shared_ptr<Timer>`，安全吗

> TimerQueue属于某个EventLoop， TimerQueue所有操作都在所属EventLoop线程执行
> timer的生命周期在同一个EventLoop IO线程， 没有多线程竞争。裸指针安全

### idleFd

> **Linux 每个进程能打开的文件描述符 fd 是有上限的，比如 ulimit‑n 默认 1024**。

```
int idleFd_ = ::open("/dev/null", O_RDONLY | O_CLOEXEC);
当 accept 失败且是 EMFILE（进程 fd 耗尽）时：
1. 关闭 idleFd_（腾出一个 fd 位置）
2. accept 新连接
3. 立即关闭新连接（我们不接受这个连接）
4. 重新打开 /dev/null 填充 idleFd_
这样服务器不会崩溃，只是优雅地拒绝新连接。

没有 idleFd 的时候
客户端发起 TCP 连接，三次握手完成。**内核已经把这个新连接放到 listen socket 的全连接队列里面**。
你的程序要调用`accept()`，把这个连接拿出来，拿到之后就分配一个新 fd 给这个客户端
，没有空闲 fd。`accept()`调用失败，返回`‑1`，错误号是 **EMFILE**
epoll 看到 listen fd 可读，立刻唤醒，程序又调用 accept，又 EMFILE 失败。
无限循环： epoll 返回 → accept 失败 → epoll 返回 → accept 失败。
```

### 什么是 Reactor 模式？为什么 one loop per thread？

> Reactor = 事件驱动模型，三要素：**事件源(fd) + 多路复用器(epoll) + 事件分发(Channel+回调)**。程序阻塞在 epoll_wait 等事件，事件到来后按类型分发给对应 handler，把「监听事件」与「业务处理」解耦，由事件驱动而非顺序轮询。

> one loop per thread：一个线程最多一个 EventLoop，线程大部分时间阻塞在 epoll_wait，所有 IO 回调、定时器、跨线程任务都在本线程串行执行。

- 好处：
  1. **免锁**：所有数据只在归属线程访问，无并发竞争，不需要加锁
  2. **生命周期清晰**：一条连接固定归属一个 loop，处理路径不跨线程
  3. **多核并行**：N 个 loop = N 个线程，天然分布多核，水平扩展

- 为什么不是「一个线程管多个 loop」：一个线程同时只能阻塞在一个 epoll_wait 上，多个 loop 意义不大。

- 为什么不是「一个 loop 多个线程共享」：需要加锁保护 loop 内部状态，epoll_wait 也不能被并发调用，违背免锁、串行的初衷。

- 在 ReactorNet 里对应：`EventLoop::loop()` 循环 `poll()` → 遍历 `activeChannels_` → `channel->handleEvent()` 分发回调。

> 易混淆：CPU 亲和(绑核)是另一回事，指用 setaffinity 把线程绑到固定核；本库没实现，别混为一谈。

### runInLoop vs queueInLoop 的区别与场景

> runInLoop：如果当前就在 loop 线程 → 立即同步执行；否则 → 入队（等价 queueInLoop）。保证 cb 一定在 loop 线程执行。

> queueInLoop：无条件入队，即使当前就在 loop 线程也不立即执行，等下一轮 doPendingFunctors 再执行。

- 代码对照：
  - runInLoop：`if (isInLoopThread()) cb(); else queueInLoop(std::move(cb));`
  - queueInLoop：push 进 pendingFunctors_，再 `!isInLoopThread() || callingPendingFunctors_` 时 wakeup。

- 场景：
  - runInLoop：跨线程投递任务用（主 Reactor 把新连接分配给子 Loop、子 Loop 回主 Loop 清理），自动判断在不在 loop 线程。
  - queueInLoop：即使在本线程也强制延迟到本轮事件之后，用于打破重入/递归，或希望先处理完当前所有 IO 回调再执行。

- 易错点：跨线程投递用 runInLoop（代码里 newConnection 的 connectEstablished、removeConnection 都是跨线程 runInLoop 调用）；queueInLoop 不是「跨线程专用」，而是「强制延迟」。

### queueInLoop 为什么 `!isInLoopThread() || callingPendingFunctors_` 才唤醒

> 两个条件回答同一个问题：「新任务会不会被 loop 及时看到并执行」，不会就写 eventfd 唤醒。

- `!isInLoopThread()`（跨线程投递）：loop 线程可能正阻塞在 epoll_wait，不唤醒就没人叫醒它，任务一直躺着。

- `callingPendingFunctors_`（本线程重入）：loop 线程正在执行 doPendingFunctors，它一开始就把 pendingFunctors_ swap 到局部变量 functors 了；此时新任务进的是 pendingFunctors_，而当前 for 循环遍历的是局部 functors，根本看不到它。不唤醒的话，这个新任务要等到下一次 epoll_wait 超时（最多 kPollTimeMs=10s）或下一个 IO 事件才会被处理，延迟严重。

- 两个条件都不满足时（isInLoopThread && !callingPendingFunctors_）为什么不用唤醒：此时 loop 正在处理某个 IO 回调，本轮末尾的 doPendingFunctors 自然会捞起新任务。

- wakeup 机制：往 eventfd 写 8 字节，让 wakeupFd 变可读，下一次 poll 立即返回，从而尽快再次进入 doPendingFunctors 处理新任务。

### 为什么 wakeup 用 eventfd 而不是 pipe / socketpair

> eventfd 是内核专门为「事件通知」设计的轻量机制，一个 fd 就搞定线程间唤醒。

- 只需 1 个 fd：pipe 要读端 + 写端 2 个 fd，socketpair 也要 2 个还带 socket 语义，浪费资源。

- 计数器语义、固定 8 字节：eventfd 写 8 字节计数器累加、读 8 字节清零，没有 pipe 那种「字节流读多少、会不会只读到一半」的边界问题；多次 wakeup 会累加，读一次全清空。

- 创建即到位：`eventfd(0, EFD_NONBLOCK | EFD_CLOEXEC)` 一次设好非阻塞 + close-on-exec；pipe 还要额外 fcntl 设 O_NONBLOCK（读写端各设一次）。

- 语义清晰、开销小：就是为「有事件通知一下」而生，比 pipe/socketpair 更贴合唤醒场景。

- 用法闭环：别的线程写 8 字节 → wakeupFd 变可读 → epoll_wait 返回 → handleWakeup 读走 → loop 继续。

### EventLoop 如何强制 one loop per thread

> 靠两样东西：构造时记录的 threadId_ + 线程局部变量 t_loopInThisThread，配合 assertInLoopThread 在错误线程操作时直接 abort（fail-fast）。

- `t_loopInThisThread`（`__thread` TLS）：记录「当前线程」绑定的 EventLoop 指针。
  - 构造函数里：若 `t_loopInThisThread != nullptr` → 本线程已有 loop → 打印 + abort（防重复创建）；否则 `t_loopInThisThread = this`。
  - 析构时清空为 nullptr。

- `threadId_`：构造时 `std::this_thread::get_id()` 记录创建线程，之后不变，用来判断「调用线程是不是 loop 线程」。

- 分工：
  - `isInLoopThread()`：`threadId_ == std::this_thread::get_id()`，只判断。
  - `assertInLoopThread()`：不在就 `abortNotInLoopThread()`。
  - `abortNotInLoopThread()`：打印「loop 创建于哪个线程 / 当前是哪个线程」+ `std::abort()`。
  - `getEventLoopOfCurrentThread()`：静态方法，读 TLS 返回当前线程的 loop。

- 跨线程直接调 updateChannel 会发生什么：`assert(channel->ownerLoop()==this)` + `assertInLoopThread()` → 不在 loop 线程 → abortNotInLoopThread 打印 → `std::abort()` 崩溃。

- 设计意图：fail-fast。线程模型错误是严重 bug（引发数据竞争、难复现的诡异问题），宁可崩溃在开发期暴露，也不静默带上线。

- 细节：`assertInLoopThread()` 不依赖 assert 宏，Release 版也生效；而 `assert(ownerLoop==this)` 是 assert 宏，NDEBUG 下会被编译掉。

### 介绍一下 ReactorNet 项目 / 为什么自己实现

> 一句话定位：ReactorNet 是一个约 2000 行、零第三方依赖的 C++17 事件驱动网络库，实现了 Reactor 模式（epoll + one-loop-per-thread + 主从多 Reactor），并基于它写了 Echo 和 HTTP 1.0 静态服务器两个 demo。

> 为什么自己写而不是直接用现成库：
- 学习动机（真诚）：看 muduo 源码时发现「看懂」≠「会写」，很多细节（对象生命周期、线程归属、缓冲区、fd 耗尽）只有亲手写才会踩到坑。
- 深入系统调用：想搞清楚 epoll / timerfd / eventfd 这些 Linux 机制的底层，而不是只会调库 API。
- 收获：写完对网络编程的理解从「会用」变成「知道底层在发生什么」，这是用现成库得不到的。

### TCP 粘包 / 半包是什么？Buffer 怎么解决

> 本质：TCP 是字节流，没有消息边界；内核只保证字节有序、不丢不重，不保证按 send 的块边界到达。

- 粘包：发两次（"hello" + "world"），对端一次 read 收到 "helloworld"，两条粘成一条。
- 半包：发一大段，对端要 read 多次才收齐，一条被拆成几半。

- 解决方案：应用层自己定界。Buffer 把每次 read 到的字节先攒进 inputBuffer_，攒够一条完整消息再交给上层，不假设一次 read 就是一条完整消息。
  - 半包时：本次数据不够完整消息，先留在缓冲区，等下次 read 补全再一起处理（不是丢弃）。
  - 粘包时：缓冲区里可能有多条完整消息，用 findCRLF 找 \r\n 一条条切出来循环处理。
  - 定界方式：分隔符（\r\n，HTTP 请求行/头）；echo 透传不关心边界。

### Buffer::readFd 为什么用 readv + 栈上 64KB extrabuf

> 核心目的：避免过早/频繁扩容。一次 readv 先把数据读进「缓冲区可写区 + 栈上 64KB」，读完知道总量再决定要不要扩容。

- 场景：缓冲区可写空间常常不大（刚消费完），但一次到达的数据可能很大。若只用 read 读可写区，大包一次只能读一点，剩下的还在内核里，要么反复 resize、要么等下次事件再读。

- readv 一次系统调用，数据分散读两块：先填满可写区，溢出读进 extrabuf；读完判断：
  - n <= writable：数据都进可写区，只移动 writeIndex_，不扩容。
  - n > writable：溢出到 extrabuf，这时才 append（resize），且按实际总量一次到位。

- extrabuf 放栈上：64KB 栈空间，不 malloc/free，函数结束自动回收。

- 一句话：把「多次读 + 反复扩容」变成「一次 readv + 按需一次扩容」；扩容是用户态拷贝，代价远低于系统调用和频繁 realloc。

### Buffer 为什么预留 8 字节 prependable 前置区

> 设计初衷：预留前置空间，方便在数据前面加少量字段（如长度头）而不拷贝整条数据；8 字节 = 一个 int64 长度字段。

- 通用（muduo 的做法）：要发消息时，可以在前面加 4/8 字节长度头，把 readIndex_ 往前挪写入即可，不用 memmove 后面的数据。

- 本库的实际用途（诚实点）：这个库没有实现 prepend()，prependable 真正的作用在 makeSpace——当「前置 + 可写」空间够时，把可读数据搬回 kCheapPrepend，腾出可写空间，避免 resize（省 realloc + 拷贝）。

- 面试注意：别说「我用它加长度头」结果代码里找不到 prepend，被追问会露馅；按上面「设计初衷 + 本库实际用于空间回收」讲。

### 主从 Reactor：baseLoop 与 subLoops 各自职责，为什么不用单 Reactor

- baseLoop（主线程）：只运行 Acceptor，监听 listen fd、accept 接收新连接，round-robin 分发给 worker 子 loop；不处理业务 socket 读写。

- subLoops（worker 线程）：每个线程一个 EventLoop，处理被分配 TcpConnection 的读写、定时器、业务回调；一条连接生命周期固定在同一个 worker loop，内部串行执行，无需加锁。

- 为什么不用单 Reactor（一个线程既 accept 又读写）：accept 和业务读写挤在同线程，一旦某个业务回调阻塞/慢，新连接也无法 accept，整个服务卡死。多 Reactor 把「快的 accept」和「可能慢的业务读写」拆开，多个 worker 分摊连接、吃满多核。

- 边界：单个 worker 内部仍是单线程，若某业务回调阻塞，该 worker 上所有连接都卡（只是不影响其他 worker）；所以业务逻辑里不能做阻塞 IO / 长耗时操作。

### 为什么用 Reactor 而不是 Proactor

> Reactor = 同步 IO + 就绪通知（epoll 告诉你可读，你自己 read）；Proactor = 异步 IO + 完成通知（内核帮你读完放进 buffer，通知你「好了」）。

- 1. Linux 原生 AIO（libaio）对 socket 支持差；成熟 Proactor 主要是 Windows IOCP，Linux 得靠 io_uring，工程复杂度高。

- 2. Proactor 的 buffer 交给内核后台访问，连接一销毁就可能「内核还在写已释放 buffer」，内存生命周期极难管；Reactor 的 read 同步返回后 buffer 立刻归用户，简单安全。

- 3. 语义：Reactor 的「就绪通知」跟 TCP 流式、Channel/Buffer 组件天然契合；Proactor 的「完成通知」要重写整套组件。

- 4. 性能未必更好：TCP 场景数据拷贝躲不掉，io_uring 也有 syscall 开销，实际差距没想象大；Reactor 赢在简单、好调试、跨平台（epoll/kqueue/poll 统一封装）。

### epoll 相比 select/poll 的优势，以及 LT / ET 你用哪种

- select：fd 集合上限 1024，每次调用把整个集合拷贝进内核，返回后要遍历全部 fd 判断 O(n)。
- poll：去掉 1024 上限，但每次仍要拷贝整个数组 + 全量遍历 O(n)。
- epoll：`epoll_ctl` 注册一次 fd 常驻内核（红黑树 + 就绪链表），`epoll_wait` 只返回就绪的 fd，复杂度 O(就绪数量)，不重复拷贝。

- LT（水平触发，默认）：缓冲区还有数据没读完，每次 epoll_wait 都通知。编程简单、不会漏事件，配合非阻塞 fd 安全。
- ET（边缘触发）：只在状态变化那一刻通知一次，必须一次读空，否则漏事件；编程更复杂，但减少唤醒次数。
- ReactorNet 用 **LT**（没设 EPOLLET），非阻塞 fd + 反复触发也安全，简单可靠优先。

### TcpConnection 为什么继承 enable_shared_from_this

- TcpConnection 由 TcpServer 用 shared_ptr 管理生命周期；但在事件回调里经常需要拿到「自己这个连接的 shared_ptr」（如 messageCallback 要把 conn 传出去、handleClose 里要延长生命周期）。
- 只有 this 裸指针拿不到 shared_ptr；继承 enable_shared_from_this 后可用 `shared_from_this()` 拿到指向自己的 shared_ptr（内部靠 weak_ptr 记录控制块）。
- 关键场景：handleClose 里 `TcpConnectionPtr guardThis(shared_from_this())`，保证回调执行期间对象不被析构。
- 注意：shared_from_this() 必须在对象已被 shared_ptr 持有之后调用，否则抛 bad_weak_ptr。

### TcpConnection 状态机 + shutdown vs forceClose（半关闭）

- 状态流转：kConnecting → kConnected → kDisconnecting → kDisconnected。
- shutdown()（优雅关闭）：先发完输出缓冲区数据，再 shutdownWrite（半关闭，发 FIN），进入 kDisconnecting。
- forceClose()（强制关闭）：不等缓冲区，立即走 handleClose 关闭。
- 半关闭（shutdown(SHUT_WR)）：关闭写端还能继续收对端数据，等对端也关。
- handleRead 里 n==0：对端关闭写端（收到 FIN）；此时若还有待发数据就先发完再关，否则立即关闭。

### 为什么要全局忽略 SIGPIPE

- 默认行为：向已经关闭（对端发 FIN/RST）的 socket 写数据，内核发 SIGPIPE，默认动作是终止进程。
- 服务端一条连接断了，不该让整个进程挂掉。所以全局 `signal(SIGPIPE, SIG_IGN)` 忽略；此后 write 返回 -1 + EPIPE，交给错误处理逻辑接管。

### 定时器为什么「最小堆 + set」双结构

- 最小堆（vector + push_heap/pop_heap）：快速取最早到期的定时器 O(1)。
- activeTimers_（set 红黑树）：用于 O(log n) 查找/取消某个定时器；因为堆里找任意元素是 O(n)。
- 两个结构各自服务一个需求：堆负责「谁最早到期」，set 负责「快速取消」。二者插入/删除时同步维护。
- 裸指针安全的前提：所有定时器操作都在所属 EventLoop 线程串行执行，无并发竞争。

### 如果要支持 10w 并发连接，现在这个库还缺什么

- 系统级：调大 ulimit -n、somaxconn、tcp_max_syn_backlog；TIME_WAIT 优化（reuse）。
- 每连接内存：Buffer 初始 1024+8 字节，10w 连接约 100MB+，应按需分配/内存池。
- 心跳/空闲检测：现在没有，长时间无数据的死连接踢不掉。
- 定时器效率：连接多时最小堆 O(log n) 偏重，可换时间轮。
- 触发模式：LT → ET，减少高并发下的唤醒开销。
- 缺连接数上限、内存池、统计监控。

### 和 muduo 比，你简化 / 缺了什么

- 简化：没实现 TcpClient；Buffer 没实现 prepend 接口（只预留了 prependable）；HTTP 只支持 GET、HTTP 1.0；定时器没有时间轮。
- 缺了：signalfd 信号处理、连接数限制、完整的日志框架、压测与性能调优。

### 如果重做一遍，会改哪些设计

- 更早引入测试（单元测试 + 压测），先验证再堆功能。
- Buffer 真正实现 prepend + 长度头定界，而不是只有 HTTP 的 \r\n 定界。
- 加连接空闲检测 / 心跳。
- 定时器数据结构可插拔，支持时间轮应对海量定时器。

### 压测结果（wrk · HTTP GET / · 本机 12 核，短连接）

**做法**

- 工具：wrk（ab 未装，且 ab 单线程会先成瓶颈，测不出 epoll 服务器真实吞吐）。压 HTTP 服务器 `GET /`，短连接。
- 指标：QPS、平均延迟、P50/P95/P99；对比单线程 vs 4 worker 的扩展性。

**实测数据（HTTP/1.0 + Connection: close，每个请求一条新 TCP 连接；单次 20s 运行）**

| 配置 | 命令 | QPS | 平均 | P95 | P99 |
|------|------|-----|------|-----|-----|
| 单线程 | `wrk -t4 -c100 -d20s` | 4143 req/s | 24.0ms | 32.2ms | 43.9ms |
| 4 worker | `wrk -t4 -c100 -d20s` | 8964 req/s | 10.5ms | 18.4ms | 23.2ms |
| 4 worker 加压 | `wrk -t8 -c256 -d20s` | 9132 req/s | 27.5ms | 44.6ms | 53.6ms |

**怎么读这些数**

- 1→4 worker：QPS 约翻倍、平均延迟和 P99 都砍半，说明 round-robin 多 Reactor 有效扩展。
- 加压到 c256 后 QPS 几乎不再涨（8.9k→9.1k），但 P99 从 23ms 涨到 54ms：说明到 ~9k req/s 就饱和了，瓶颈不在 epoll 网络层。

**瓶颈与优化（面试「瓶颈在哪」的诚实答案）**

- 瓶颈：① HTTP handler 每个请求在 loop 线程里同步 `ifstream` 读盘；② HTTP/1.0 短连接，每个请求一套握手 + 挥手。
- 优化：① 换 HTTP/1.1 keep-alive 复用连接；② 静态文件内存缓存（读一次，命中不读盘）；③ 大文件 sendfile/mmap 零拷贝。

**诚实边界**

- 只测了 `GET /` 一条路径、短连接、本机回环；没测 echo（wrk 压不了裸 TCP）、没查 CPU 打满和内存增长。
- QPS 有 run-to-run 波动（本机回环 + CPU 竞争，多次运行约 ±10%），上表取最近一次 20s 运行，别拿单次数字当精确承诺。
- 简历占位符建议写：`QPS ~9k（4 worker），平均延迟 ~10ms，P99 延迟 ~23ms（4 worker）/ ~54ms（加压 c256）`。

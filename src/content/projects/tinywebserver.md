## include/config/config.h

> 配置全局唯一， 运行期只读，参数统一校验

```cpp
#ifndef CONFIG_H
#define CONFIG_H
// 全局命令行配置解析类
// 作用：统一管理Web服务所有运行参数，解析启动命令行参数，提供只读配置，保证参数运行期间不可篡改
#include "server/webserver.h"
using namespace std;

class Config {
public:
  // 构造函数：初始化所有配置项默认值，不传入启动参数时使用这套默认配置运行服务
  Config();
  // 虚析构，预留后续子类继承扩展的能力，无资源释放需求使用default默认实现
  virtual ~Config() = default;

  // 解析命令行启动参数，使用getopt解析 -p/-t/-s
  // 等短参数，覆盖构造函数的默认配置
  void parse_arg(int argc, char *argv[]);
  // 打印程序启动参数帮助文档，输入非法/未知参数时调用，提示用户正确启动命令
  void print_usage() const;
  // 校验所有配置数值是否合法，端口、线程数、连接池数量、开关参数校验；非法返回false，服务禁止启动
  bool check_valid() const;

  // ========== Getter 只读接口 ==========
  // 获取Web服务监听端口
  int get_port() const;
  // 获取日志写入模式：0同步日志、1异步阻塞队列日志
  int get_log_write() const;
  // epoll触发模式总控制标识：0 LT水平触发、1 ET边缘触发
  int get_trig_mode() const;
  // listenfd监听套接字的epoll触发模式
  int get_listen_trig() const;
  // 客户端连接connfd读写事件的epoll触发模式
  int get_conn_trig() const;
  // TCP优雅关闭开关：0关闭、1开启，开启后等待缓冲区数据传输完成再释放连接
  int get_opt_linger() const;
  // MySQL数据库连接池最大连接数量
  int get_sql_num() const;
  // 业务线程池工作线程数量，控制并发HTTP请求处理能力
  int get_thread_num() const;
  // 全局日志总开关：0开启日志输出、1关闭所有日志，提升线上性能
  int get_close_log() const;
  // 并发IO模型标识：0 Proactor模型、1 Reactor模型
  int get_actor_model() const;

private:
  // 全部配置成员私有，外部无法直接修改，杜绝运行中配置被篡改引发逻辑错乱
  int PORT;           // Web监听端口
  int LOGWrite;       // 同步/异步日志标识
  int TRIGMode;       // epoll LT/ET总开关
  int LISTENTrigmode; // 监听fd触发模式
  int CONNTrigmode;   // 客户端连接fd触发模式
  int OPT_LINGER;     // TCP优雅关闭开关
  int sql_num;        // 数据库连接池连接数
  int thread_num;     // 线程池工作线程数
  int close_log;      // 日志关闭总开关
  int actor_model;    // Proactor/Reactor并发模型

  // 禁止拷贝构造、赋值运算符重载
  // 配置为全局唯一资源，拷贝会生成两份独立配置，参数不一致导致服务逻辑异常，编译期拦截拷贝代码
  Config(const Config &) = delete;
  Config &operator=(const Config &) = delete;
};

#endif

```

## src/config/config.cc

> 给默认值， 解析命令行参数， 参数合法性检查， 提供getter接口

```cpp
#include "config/config.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>

// 构造函数：给所有配置项设置程序默认启动参数
Config::Config() {
  PORT = 9006;        // Web服务监听端口，默认9006
  LOGWrite = 0;       // 日志模式：0同步日志、1异步阻塞队列日志，默认同步
  TRIGMode = 0;       // epoll触发模式组合总开关：0 LT水平触发、1 ET边缘触发
  LISTENTrigmode = 0; // listenfd监听套接字触发方式：0 LT、1 ET
  CONNTrigmode = 0;   // 客户端连接connfd读写触发方式：0 LT、1 ET
  OPT_LINGER =
      0; // TCP优雅关闭开关：0关闭、1开启，开启后等待缓冲区数据传输完成再关闭
  sql_num = 8;     // MySQL数据库连接池最大连接数量，默认8条
  thread_num = 8;  // 业务线程池工作线程数量，默认8个
  close_log = 0;   // 全局日志总开关：0开启日志、1关闭日志
  actor_model = 0; // 并发IO模型：0 Proactor模型、1 Reactor模型，默认Proactor
}

// 打印程序启动参数帮助说明，输入错误参数时调用
void Config::print_usage() const {
  printf("Usage: ./webserver [OPTIONS]\n");
  printf("Options:\n");
  printf("  -p num   Listen port (1-65535, default 9006)\n");
  printf("  -l 0/1   Log mode:0 sync,1 async (default 0)\n");
  printf("  -m 0-3   Epoll trigger combo (default 0 LT+LT)\n");
  printf("  -o 0/1   Enable linger close (default 0 off)\n");
  printf("  -s num   Mysql connection pool size (>=1, default 8)\n");
  printf("  -t num   Thread pool worker count (>=1, default 8)\n");
  printf("  -c 0/1   Close log:1 disable,0 enable (default 0)\n");
  printf("  -a 0/1   Actor model:0 Proactor,1 Reactor (default 0)\n");
}

// 解析命令行启动参数，覆盖默认配置
void Config::parse_arg(int argc, char *argv[]) {
  int opt;
  // 可解析参数列表，带冒号代表该参数后必须附带数值
  const char *opt_str = "p:l:m:o:s:t:c:a:";
  while ((opt = getopt(argc, argv, opt_str)) != -1) {
    switch (opt) {
    case 'p':
      PORT = atoi(optarg); // 覆盖监听端口
      break;
    case 'l':
      LOGWrite = atoi(optarg); // 覆盖日志读写模式
      break;
    case 'm':
      TRIGMode = atoi(optarg); // 覆盖epoll触发模式
      break;
    case 'o':
      OPT_LINGER = atoi(optarg); // 覆盖TCP优雅关闭开关
      break;
    case 's':
      sql_num = atoi(optarg); // 覆盖数据库连接池连接数
      break;
    case 't':
      thread_num = atoi(optarg); // 覆盖线程池工作线程数量
      break;
    case 'c':
      close_log = atoi(optarg); // 覆盖全局日志开关
      break;
    case 'a':
      actor_model = atoi(optarg); // 覆盖并发IO模型
      break;
    default:
      // 未知参数，打印帮助并退出程序
      print_usage();
      exit(EXIT_FAILURE);
    }
  }
}

// 校验所有配置参数合法性，非法参数返回false，程序禁止启动
bool Config::check_valid() const {
  // 端口合法范围 1~65535，0和超过65535均非法
  if (PORT <= 0 || PORT > 65535)
    return false;
  // 日志模式仅允许0同步、1异步
  if (LOGWrite < 0 || LOGWrite > 1)
    return false;
  // epoll触发模式：0 LT+LT, 1 LT+ET, 2 ET+LT, 3 ET+ET
  if (TRIGMode < 0 || TRIGMode > 3)
    return false;
  // TCP优雅关闭仅允许0关闭、1开启
  if (OPT_LINGER < 0 || OPT_LINGER > 1)
    return false;
  // 数据库连接池、线程池数量必须大于0，不能为0或负数
  if (sql_num <= 0 || thread_num <= 0)
    return false;
  // 日志开关仅允许0开启、1关闭
  if (close_log < 0 || close_log > 1)
    return false;
  // 并发模型仅允许0 Proactor、1 Reactor
  if (actor_model < 0 || actor_model > 1)
    return false;
  return true;
}

// ---------------- 只读Getter接口实现，外部只能读取配置，禁止修改
// ---------------- 获取监听端口
int Config::get_port() const { return PORT; }
// 获取日志读写模式
int Config::get_log_write() const { return LOGWrite; }
// 获取epoll触发模式总开关
int Config::get_trig_mode() const { return TRIGMode; }
// 获取listenfd监听fd触发模式
int Config::get_listen_trig() const { return LISTENTrigmode; }
// 获取客户端connfd连接fd触发模式
int Config::get_conn_trig() const { return CONNTrigmode; }
// 获取TCP优雅关闭开关
int Config::get_opt_linger() const { return OPT_LINGER; }
// 获取MySQL连接池最大连接数
int Config::get_sql_num() const { return sql_num; }
// 获取线程池工作线程数量
int Config::get_thread_num() const { return thread_num; }
// 获取全局日志关闭开关
int Config::get_close_log() const { return close_log; }
// 获取并发IO模型标识
int Config::get_actor_model() const { return actor_model; }

```

## include/core/log.h

> **日志模块头文件，单例日志类，支持同步写日志 / 异步阻塞队列写日志，日志按天、按行数分割，提供 LOG_DEBUG/INFO/WARN/ERROR 宏给全项目打印日志**。

```cpp
#ifndef LOG_H
#define LOG_H
#include "core/block_queue.h"
#include <iostream>
#include <pthread.h>
#include <stdarg.h>
#include <stdio.h>
#include <string>
using namespace std;
class Log {
public:
    /*
    **懒汉单例**：整个程序全局只有**一个 Log 实例**，全服务器共用一套日志。C++11 标准保证静态局部变量初始化线程安全。
    */
  static Log *get_instance() {
    static Log instance;
    return &instance;
  }
  // 异步日志的线程函数，pthread入口，静态函数
  //pthread_create 要求线程函数必须是 `void* (*)(void*)`，所以必须是 static 静态函数，不能是普通成员函数。
  //这个后台线程：不断从阻塞队列取出日志字符串，写入磁盘文件。
  static void *flush_log_thread(void *args) {
    (void)args;
    Log::get_instance()->async_write_log();
    return nullptr;
  }
  // 初始化日志系统
  // file_name:日志文件名；close_log：是否关闭日志；log_buf_size内存缓冲区大小
  // split_line：单文件最大行数；max_queue_size>0代表开启异步日志（阻塞队列容量）
  bool init(const char *file_name, int close_log, int log_buf_size = 8192,
            int split_line = 5000000, int max_queue_size = 0);

  // 写日志核心接口：level日志等级，format可变参数格式化
  void write_log(int level, const char *format, ...);

  void flush(void);

  // 宏访问成员，必须公开
  int m_close_log; // 关闭日志

private:
  Log();
  virtual ~Log();
  void *async_write_log();

private:
  char dir_name[128]; // 路径名
  char log_name[128]; // log文件名
  int m_split_lines;  // 日志最大行数
  int m_log_buf_size; // 日志缓冲区大小
  long long m_count;  // 日志行数记录
  int m_today;        // 因为按天分类,记录当前时间是那一天
  FILE *m_fp;         // 打开log的文件指针
  char *m_buf;
  block_queue<string> *m_log_queue; // 阻塞队列
  bool m_is_async;                  // 是否同步标志位
  locker m_mutex;
};

// 原裸if替换为 do{}while(0)，消除悬挂else
//宏是**纯文本替换**，不是函数！

/*

*/
#define LOG_DEBUG(format, ...)                                                 \
  do {                                                                         \
    if (0 == Log::get_instance()->m_close_log) {                               \
      Log::get_instance()->write_log(0, format, ##__VA_ARGS__);                \
    }                                                                          \
  } while (0)

#define LOG_INFO(format, ...)                                                  \
  do {                                                                         \
    if (0 == Log::get_instance()->m_close_log) {                               \
      Log::get_instance()->write_log(1, format, ##__VA_ARGS__);                \
    }                                                                          \
  } while (0)

#define LOG_WARN(format, ...)                                                  \
  do {                                                                         \
    if (0 == Log::get_instance()->m_close_log) {                               \
      Log::get_instance()->write_log(2, format, ##__VA_ARGS__);                \
    }                                                                          \
  } while (0)
//`##` 是 GCC 扩展：**当可变参数为空的时候，自动删掉前面那个逗号**
#define LOG_ERROR(format, ...)                                                 \
  do {                                                                         \
    if (0 == Log::get_instance()->m_close_log) {                               \
      Log::get_instance()->write_log(3, format, ##__VA_ARGS__);                \
    }                                                                          \
  } while (0)

#endif

```

## src/core/log.cc
> 同步 / 异步双模式， 异步模式， worker线程不直接写磁盘， 把日志字符串，丢在block_queue阻塞队列， 单独后台线程消费队列

```cpp
#include "core/log.h"
#include "core/locker.h"
#include <pthread.h>
#include <stdarg.h>
#include <stdexcept>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>
using namespace std;

Log::Log()
    : m_close_log(0), m_split_lines(0), m_log_buf_size(0), m_count(0),
      m_today(0), m_fp(nullptr), m_buf(nullptr), m_log_queue(nullptr),
      m_is_async(false) {}

Log::~Log() {
  // 1. 异步模式：唤醒阻塞的写线程，等待队列消费完毕
  if (m_is_async && m_log_queue != nullptr) {
    // 往队列塞一条空日志唤醒线程，循环pop结束
    string empty_msg;
    //非阻塞入队， 兑现
    m_log_queue->push(empty_msg);
    // 简易等待，实际项目可用pthread_join保存tid等待回收
    usleep(100000);
    delete m_log_queue;
    m_log_queue = nullptr;
  }

  // 2. 释放格式化缓冲区
  if (m_buf != nullptr) {
    delete[] m_buf;
    m_buf = nullptr;
  }

  // 3. 关闭日志文件
  if (m_fp != nullptr) {
    locker_guard guard(m_mutex);
    fflush(m_fp);
    fclose(m_fp);
    m_fp = nullptr;
  }
}

bool Log::init(const char *file_name, int close_log, int log_buf_size,
               int split_lines, int max_queue_size) {
  m_close_log = close_log;
  m_log_buf_size = log_buf_size;
  m_split_lines = split_lines;

  // 分配格式化缓冲区
  if (m_log_buf_size <= 0)
    throw runtime_error("log buf size invalid");
  m_buf = new char[m_log_buf_size];
  memset(m_buf, '\0', m_log_buf_size);

  // 开启异步日志，创建阻塞队列+后台写线程
  if (max_queue_size >= 1) {
    m_is_async = true;
    m_log_queue = new block_queue<string>(max_queue_size);
    pthread_t tid;
    int ret = pthread_create(&tid, nullptr, flush_log_thread, nullptr);
    if (ret != 0)
      throw runtime_error("create log flush thread failed");
  }

  // 拆分路径与文件名
  time_t t = time(NULL);
  struct tm *sys_tm = localtime(&t);
  struct tm my_tm = *sys_tm;
  const char *p = strrchr(file_name, '/');
  char log_full_name[384] = {0};

  if (p == nullptr) {
    snprintf(log_full_name, sizeof(log_full_name), "%d_%02d_%02d_%s",
             my_tm.tm_year + 1900, my_tm.tm_mon + 1, my_tm.tm_mday, file_name);
  } else {
    strncpy(log_name, p + 1, sizeof(log_name) - 1);
    strncpy(dir_name, file_name, p - file_name + 1);
    snprintf(log_full_name, sizeof(log_full_name), "%s%d_%02d_%02d_%s",
             dir_name, my_tm.tm_year + 1900, my_tm.tm_mon + 1, my_tm.tm_mday,
             log_name);
  }

  m_today = my_tm.tm_mday;
  m_fp = fopen(log_full_name, "a");
  if (m_fp == nullptr)
    return false;
  return true;
}

void Log::write_log(int level, const char *format, ...) {
  // 防御: 日志系统未初始化或 m_fp 为空时直接跳过，避免 fclose(NULL) 崩溃
  if (m_fp == nullptr) {
    return;
  }

  struct timeval now = {0, 0};
  gettimeofday(&now, nullptr);
  time_t t = now.tv_sec;
  struct tm *sys_tm = localtime(&t);
  struct tm my_tm = *sys_tm;
  char s[16] = {0};

  switch (level) {
  case 0:
    strcpy(s, "[debug]:");
    break;
  case 1:
    strcpy(s, "[info]:");
    break;
  case 2:
    strcpy(s, "[warn]:");
    break;
  case 3:
    strcpy(s, "[erro]:");
    break;
  default:
    strcpy(s, "[info]:");
    break;
  }

  va_list valst;
  va_start(valst, format);
  string log_str;

  // 合并锁区间：计数更新、切割判断、格式化缓冲区统一一把锁
  locker_guard guard(m_mutex);
  m_count++;

  // 判断是否需要切割日志（m_split_lines 必须 > 0 才做切割，防止除零）
  if (m_split_lines > 0 &&
      (m_today != my_tm.tm_mday || m_count % m_split_lines == 0)) {
    char new_log[384] = {0};
    fflush(m_fp);
    fclose(m_fp);
    char tail[32] = {0};
    snprintf(tail, sizeof(tail), "%d_%02d_%02d_", my_tm.tm_year + 1900,
             my_tm.tm_mon + 1, my_tm.tm_mday);

    if (m_today != my_tm.tm_mday) {
      snprintf(new_log, sizeof(new_log), "%s%s%s", dir_name, tail,
               log_name);
      m_today = my_tm.tm_mday;
      m_count = 0;
    } else {
      snprintf(new_log, sizeof(new_log), "%s%s%s.%lld", dir_name, tail,
               log_name, m_count / m_split_lines);
    }
    m_fp = fopen(new_log, "a");
  }

  // 格式化日志，校验返回值防止缓冲区溢出
  int n = snprintf(m_buf, m_log_buf_size - 2,
                   "%d-%02d-%02d %02d:%02d:%02d.%06ld %s ",
                   my_tm.tm_year + 1900, my_tm.tm_mon + 1, my_tm.tm_mday,
                   my_tm.tm_hour, my_tm.tm_min, my_tm.tm_sec, now.tv_usec, s);
  if (n < 0 || n >= m_log_buf_size - 2)
    n = m_log_buf_size - 3;

  int m = vsnprintf(m_buf + n, m_log_buf_size - n - 2, format, valst);
  if (m < 0)
    m = 0;

  m_buf[n + m] = '\n';
  m_buf[n + m + 1] = '\0';
  log_str = m_buf;

  va_end(valst);

  // 异步队列未满则丢队列，否则同步落盘
  if (m_is_async && !m_log_queue->full()) {
    m_log_queue->push(log_str);
  } else {
    fputs(log_str.c_str(), m_fp);
    fflush(m_fp);  // 立即落盘，否则 libc 缓冲导致日志丢失
  }
}

void Log::flush(void) {
  locker_guard guard(m_mutex);
  if (m_fp != nullptr) {
    fflush(m_fp);
  }
}

// 后台消费线程：阻塞读取日志并写入文件
void *Log::async_write_log() {
  string single_log;
  while (m_log_queue->pop(single_log)) {
    if (single_log.empty())
      break; // 空消息作为退出标记
    locker_guard guard(m_mutex);
    // 把字符串写入FILE对应的文件
    fputs(single_log.c_str(), m_fp);
    fflush(m_fp);
  }
  return nullptr;
}

```

## src/include/block_queue.h

> **是一个线程安全的环形阻塞队列（模板类），用于生产者 - 消费者模型。在你的 WebServer 里，专门给异步日志模块用：**
```
阻塞队列核心特性：
队列满 → 生产者可以阻塞等待；队列空 → 消费者可以阻塞等待。
内部用 **mutex 互斥锁 + condition 条件变量** 做多线程同步，保证多线程并发安全。
模板`template<class T>`，队列里面可以存放任意类型，日志模块实例化：`block_queue<string>`
```
- 生产者：Web 服务业务线程，把日志字符串丢进队列（`push_block`）
- 消费者：单独的后台日志线程，不断从队列取出日志、写磁盘（`pop`）
- C++ 模板的代码不能简单把声明放 h、实现放 cpp，否则链接报错
- 只有你实例化的时候（比如 block_queue<string> q;），编译器才会根据 T 的类型，现场生成一份对应的类代码。
```cpp
#ifndef BLOCK_QUEUE_H
#define BLOCK_QUEUE_H
#include "core/locker.h"
#include <iostream>
#include <pthread.h>
#include <stdexcept>
#include <stdlib.h>
#include <sys/time.h>
using namespace std;

template <class T> class block_queue {
public:
  block_queue(int max_size = 1000) {
    if (max_size <= 0) {
      // 构造函数构造失败，必须抛出异常
      // cerr只是日志输出
      throw runtime_error("block_queue max_size must > 0");
    }
    m_max_size = max_size;
    // m_array是环形数组
    m_array = new T[max_size];
    m_size = 0;
    m_front = -1;
    m_back = -1;
  }
  void clear() {
    locker_guard guard(m_mutex);
    m_size = 0;
    m_front = -1;
    m_back = -1;
  }
  ~block_queue() {
    locker_guard guard(m_mutex);
    if (m_array != nullptr) {
      delete[] m_array;
      m_array = nullptr;
    }
  }
  // 查询状态， 全部加锁
  bool full() {
    locker_guard guard(m_mutex);
    return m_size >= m_max_size;
  }
  bool empty() {
    locker_guard guard(m_mutex);
    return m_size == 0;
  }
  bool front(T &value) {
    locker_guard guard(m_mutex);
    if (m_size == 0)
      return false;
    value = m_array[m_front];
    return true;
  }
  bool back(T &value) {
    locker_guard guard(m_mutex);
    if (m_size == 0)
      return false;
    value = m_array[m_back];
    return true;
  }
  int size() {
    locker_guard guard(m_mutex);
    return m_size;
  }
  int max_size() {
    locker_guard guard(m_mutex);
    return m_max_size;
  }
  // 非阻塞入队， 队列满直接返回false
  bool push(const T &item) {
    locker_guard guard(m_mutex);
    // 限流/背压 资源满了 --> 拒绝新请求
    if (m_size >= m_max_size) {
      return false;
    }
    m_back = (m_back + 1) % m_max_size; // back指针后移，环形取模
    m_array[m_back] = item;             // 放入数组back位置
    m_size++;                           // 队列元素计数+1
    m_cond.signal();                    // 唤醒一个等待的消费者线程
    return true;
  }
  // 阻塞入队， 队列满时生产者阻塞等待
  void push_block(const T &item) {
    locker_guard guard(m_mutex);
    // 队列满就等待，while循环防止虚假唤醒
    while (m_size >= m_max_size) {
      // 调用wait, 释放锁， 休眠
      m_cond.wait(m_mutex.get());
    }
    m_back = (m_back + 1) % m_max_size;
    m_array[m_back] = item;
    m_size++;
    m_cond.signal();
  }
  // 阻塞出队， 无数据永久等待
  bool pop(T &item) {
    locker_guard guard(m_mutex);
    // 先检查条件 → 如果条件成立，就睡觉；被唤醒之后，回到
    // while，再重新检查一遍条件！
    while (m_size <= 0) {
      if (!m_cond.wait(m_mutex.get())) {
        return false;
      }
    }
    m_front = (m_front + 1) % m_max_size;
    item = m_array[m_front];
    m_size--;
    m_cond.signal();
    return true;
  }
  // 带超时阻塞出队，ms_timeout毫秒超时返回false
  bool pop(T &item, int ms_timeout) {
    struct timespec t{};
    struct timeval now{};
    gettimeofday(&now, nullptr);

    locker_guard guard(m_mutex);
    // 队列为空则限时等待
    while (m_size <= 0) {
      t.tv_sec = now.tv_sec + ms_timeout / 1000;
      // 修正纳秒计算：剩余毫秒转纳秒
      t.tv_nsec = (ms_timeout % 1000) * 1000000;
      if (!m_cond.timewait(m_mutex.get(), t)) {
        // 超时直接返回，守卫自动解锁
        return false;
      }
    }
    // 唤醒后再次判断，防止虚假唤醒
    if (m_size <= 0) {
      return false;
    }
    m_front = (m_front + 1) % m_max_size;
    item = m_array[m_front];
    m_size--;
    m_cond.signal();
    return true;
  }

private:
  block_queue(const block_queue &) = delete;
  block_queue &operator=(const block_queue &) = delete;
  locker m_mutex; // 互斥锁，保护队列所有共享变量 m_size/m_front/m_back
  cond m_cond;    // 条件变量，用来线程等待/唤醒
                  //
  T *m_array;     // 环形数组，存放队列元素
  int m_size;     // 当前队列里元素个数
  int m_max_size; // 队列最大容量
  int m_front;    // 队头下标（要出队的元素位置）
  int m_back;     // 队尾下标（最后入队的元素位置）
};
#endif

```
## include/core/buffer_ring.h
> **io_uring Buffer Ring（内核缓冲区环）封装类 `BufferPool`**，Linux io_uring 提供的**内核侧 buffer 池**，专门用于批量接收数据（recv）。
> io_uring buf ring：内核预先拿到一批 buffer，当网络 IO 事件到来时，**内核直接从 ring 里拿一块 buffer 存放收到的数据**，省去用户态和内核态之间反复传递 buffer 地址的开销，是高性能 io_uring 服务常用的优化手段。
```cpp
#ifndef BUFFER_RING_H
#define BUFFER_RING_H

#include <cstddef>
#include <cstdint>
#include <liburing.h>
#include <vector>

constexpr size_t BUF_BLOCK_SIZE = 2048; // 单个buffer大小 2048字节
constexpr uint16_t BUF_GROUP_ID = 0;    // buffer组编号，io_uring多buffer分组用

class BufferPool {
public:
  /// @param ring 已初始化的 io_uring 实例
  /// @param buf_count buffer 数量（≤ 32768）
  BufferPool(struct io_uring *ring, uint32_t buf_count);
  ~BufferPool();

  // 禁止拷贝（资源类，持有内核内存+buf ring，不能拷贝）
  BufferPool(const BufferPool &) = delete;
  BufferPool &operator=(const BufferPool &) = delete;

  /// 归还 buffer 到内核 buffer ring（每次 CQE RECV 完成后必须调用）
  void release(uint32_t buf_id) noexcept;

  /// 按 buf_id 获取 buffer 指针
  void *get_buf_ptr(uint32_t buf_id) const;

  uint32_t total_buf_num() const noexcept { return m_total_buf; }
  size_t single_buf_size() const noexcept { return BUF_BLOCK_SIZE; }
  uint16_t buf_group() const noexcept { return m_group_id; }
  uint32_t get_used_count() const noexcept { return m_used_cnt; }

private:
  struct io_uring *m_ring;    // 外部io_uring句柄（不持有，只是引用）
  const uint32_t m_total_buf; // buffer总数量，构造时固定不变
  const uint16_t m_group_id;  // buffer group id，这里固定0
  std::vector<char *>
      m_buf_ptrs; // 保存每一块buffer的起始地址，方便根据buf_id查找
  struct io_uring_buf_ring *m_buf_ring =
      nullptr;             // io_uring内核buffer ring结构体
  uint32_t m_ring_mask;    // ring掩码 = nr_buf - 1，快速取模（环形数组）
  uint32_t m_used_cnt = 0; // 统计：正在使用的buffer数量(inflight)
};

#endif

```
## src/core/buffer_ring.cc
> 创建io_uring buffer_ring， 分配一批buffer, 注册给内核， 用完buffer调用release放回buffer池。
- buffer ring 是内核维护的环形缓冲区队列，recv 提交 SQE 指定 bgid 后，内核自动从 ring 拿 buffer 存放收到的数据。
```cpp
#include "core/buffer_ring.h"
#include <cstring>
#include <linux/io_uring.h>
#include <stdexcept>
#include <stdlib.h>
#include <sys/mman.h>

BufferPool::BufferPool(struct io_uring *ring, uint32_t buf_count)
    : m_ring(ring), m_total_buf(buf_count), m_group_id(BUF_GROUP_ID) {
  if (!ring || buf_count == 0)
    throw std::invalid_argument("invalid ring or buf_count");

  // 1. 为每个 buffer 分配内存
  m_buf_ptrs.resize(buf_count, nullptr);
  for (uint32_t i = 0; i < buf_count; i++) {
    m_buf_ptrs[i] = (char *)malloc(BUF_BLOCK_SIZE);
    if (!m_buf_ptrs[i]) {
      // 前面`j < i`的位置，`m_buf_ptrs[j]`已经成功 malloc，里面存有效指针
      for (uint32_t j = 0; j < i; j++)
        free(m_buf_ptrs[j]);
      throw std::runtime_error("BufferPool malloc failed");
    }
  }

  // 2. 分配 buffer ring（页对齐）
  size_t ring_sz = buf_count * sizeof(struct io_uring_buf);
  // io_uring, buffer ring 规定这块内存必须页对齐， 普通malloc不保证4k对齐
  if (posix_memalign((void **)&m_buf_ring, 4096, ring_sz) != 0) {
    for (uint32_t i = 0; i < buf_count; i++)
      free(m_buf_ptrs[i]);
    throw std::runtime_error("BufferPool posix_memalign for buf_ring failed");
  }
  memset(m_buf_ring, 0, ring_sz);

  // 3. 填充 buffer ring
  for (uint32_t i = 0; i < buf_count; i++) {
    struct io_uring_buf *entry = &m_buf_ring->bufs[i];
    entry->addr = (__u64)(unsigned long)m_buf_ptrs[i];
    entry->len = BUF_BLOCK_SIZE;
    entry->bid = i; // bid就是buffer id
  }

  // 4. 注册到内核（手动构造 reg struct，绕过 liburing bug）
  struct io_uring_buf_reg reg = {};
  reg.ring_addr = (__u64)(unsigned long)m_buf_ring;
  reg.ring_entries = buf_count;
  reg.bgid = m_group_id;
  reg.flags = 0; // 默认行为

  int ret = io_uring_register_buf_ring(m_ring, &reg, 0);
  if (ret < 0) {
    free(m_buf_ring);
    m_buf_ring = nullptr;
    for (uint32_t i = 0; i < buf_count; i++)
      free(m_buf_ptrs[i]);
    throw std::runtime_error("io_uring_register_buf_ring failed, ret: " +
                             std::to_string(ret));
  }

  // 5. 通知内核所有 buffer 已就绪
  io_uring_buf_ring_advance(m_buf_ring, buf_count);

  m_ring_mask = io_uring_buf_ring_mask(buf_count);
  m_used_cnt = 0;
}

BufferPool::~BufferPool() {
  if (m_ring && m_buf_ring) {
    io_uring_unregister_buf_ring(m_ring, m_group_id);
  }
  free(m_buf_ring);
  m_buf_ring = nullptr;
  for (size_t i = 0; i < m_buf_ptrs.size(); i++)
    free(m_buf_ptrs[i]);
  m_buf_ptrs.clear();
}
// 读完 CQE 里的网络数据之后，把这块 buffer 归还到内核 buffer
// ring，让内核可以再次拿这个 buffer 接收下一次数据包。
void BufferPool::release(uint32_t buf_id) noexcept {
  if (buf_id >= m_total_buf || !m_buf_ring)
    return;
  // 把bffer条目重新添加到buf ring环形队列
  io_uring_buf_ring_add(m_buf_ring, m_buf_ptrs[buf_id], BUF_BLOCK_SIZE, buf_id,
                        m_ring_mask, 0);
  io_uring_buf_ring_advance(m_buf_ring, 1);
  // 告诉内核：ring 生产者指针前进**1**，新增一块空闲 buffer。
  if (m_used_cnt > 0)
    m_used_cnt--;
}

void *BufferPool::get_buf_ptr(uint32_t buf_id) const {
  if (buf_id >= m_total_buf)
    return nullptr;
  return m_buf_ptrs[buf_id];
}

```
## include/core/locker.h
> Linux下C++封装的线程同步工具头文件locker.h, 包装pthread库原生api
- 包含 sem, locker, cond, locker_guard
```cpp
#ifndef LOCKER_H
#define LOCKER_H
#include <cerrno> //EAGAIN非阻塞返回判断
#include <exception>
#include <pthread.h>
#include <semaphore.h>
#include <stdexcept> //runtime_error 带error info

class sem {
public:
  // 无参构造：初始信号量计数=0
  sem() {
    // &m_sem：信号量变量地址
    // 第二个参数0：仅进程内多线程共享（不用进程间）
    // 第三个参数0：初始资源数量为0
    if (sem_init(&m_sem, 0, 0) != 0) {
      // 初始化失败抛异常，上层必须捕获，否则程序崩溃
      throw std::runtime_error("sem init failed");
    }
  }

  // 带参构造：自定义初始资源数量 num
  sem(int num) {
    if (sem_init(&m_sem, 0, num) != 0) {
      throw std::runtime_error("sem init failed");
    }
  }

  // 析构函数：对象销毁时自动释放信号量资源
  ~sem() { sem_destroy(&m_sem); }

  // P操作：申请资源
  bool wait() {
    // sem_wait成功返回0，转成布尔true；失败false
    return sem_wait(&m_sem) == 0;
  }
  // 非阻塞申请资源， 拿不到直接返回false
  bool try_wait() {
    int ret = sem_trywait(&m_sem);
    if (ret == 0)
      return true;
    if (errno == EAGAIN)
      return false;
    throw std::runtime_error("sem_trywait error");
  }
  // V操作：释放资源
  bool post() { return sem_post(&m_sem) == 0; }

  // 重新初始化信号量计数（销毁旧值后重建，用于连接池init）
  void reinit(int num) {
    sem_destroy(&m_sem);
    if (sem_init(&m_sem, 0, num) != 0)
      throw std::runtime_error("sem reinit failed");
  }

  // 限时等待：ms_timeout 毫秒超时返回false
  bool timewait(int ms_timeout) {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    ts.tv_sec += ms_timeout / 1000;
    ts.tv_nsec += (ms_timeout % 1000) * 1000000;
    if (ts.tv_nsec >= 1000000000) {
      ts.tv_sec += 1;
      ts.tv_nsec -= 1000000000;
    }
    return sem_timedwait(&m_sem, &ts) == 0;
  }

private:
  // 底层原生信号量结构体，私有，外部无法直接操作
  sem_t m_sem;
  sem(const sem &) = delete;
  sem &operator=(const sem &) = delete;
};

class locker {
public:
  // 构造函数：初始化互斥锁
  locker() {
    // 第二个参数 nullptr：使用默认锁属性（普通互斥锁）
    if (pthread_mutex_init(&m_mutex, nullptr) != 0) {
      // 初始化失败抛异常，程序终止
      throw std::exception();
    }
  }

  // 析构：销毁锁，释放内核资源
  ~locker() { pthread_mutex_destroy(&m_mutex); }

  // 加锁，阻塞式
  bool lock() {
    // 成功返回true，失败false
    return pthread_mutex_lock(&m_mutex) == 0;
  }
  // 非阻塞加锁,抢不到锁直接false
  bool trylock() {
    int ret = pthread_mutex_trylock(&m_mutex);
    if (ret == 0)
      return true;
    if (ret == EBUSY)
      return false;
    throw std::runtime_error("pthread_mutex_trylock error");
  }
  // 解锁
  bool unlock() { return pthread_mutex_unlock(&m_mutex) == 0; }

  // 获取底层 pthread_mutex_t 指针
  pthread_mutex_t *get() { return &m_mutex; }

private:
  // 底层原生互斥锁，私有隔离
  pthread_mutex_t m_mutex;
  locker(const locker &) = delete;
  locker &operator=(const locker &) = delete;
};
class cond {
public:
  // 构造：初始化条件变量
  cond() {
    if (pthread_cond_init(&m_cond, nullptr) != 0) {
      throw std::exception();
    }
  }

  // 析构：释放内核条件变量资源
  ~cond() { pthread_cond_destroy(&m_cond); }

  // 阻塞等待，必须传入一把已经上锁的mutex
  bool wait(pthread_mutex_t *m_mutex) {
    int ret = 0;
    ret = pthread_cond_wait(&m_cond, m_mutex);
    return ret == 0;
  }

  // 限时等待，超时自动退出阻塞
  bool timewait(pthread_mutex_t *m_mutex, struct timespec t) {
    int ret = 0;
    ret = pthread_cond_timedwait(&m_cond, m_mutex, &t);
    return ret == 0;
  }

  // 唤醒一个正在等待的线程
  bool signal() { return pthread_cond_signal(&m_cond) == 0; }

  // 唤醒所有正在等待的线程
  bool broadcast() { return pthread_cond_broadcast(&m_cond) == 0; }

private:
  // 底层原生条件变量，私有封装隔离
  pthread_cond_t m_cond;
  cond(const cond &) = delete;
  cond &operator=(const cond &) = delete;
};
class locker_guard {
public:
  explicit locker_guard(locker &lk) : m_lk(lk) { m_lk.lock(); }
  ~locker_guard() { m_lk.unlock(); }
  locker_guard(const locker_guard &) = delete;
  locker_guard &operator=(const locker_guard &) = delete;

private:
  locker &m_lk;
};
#endif

```
## include/core/io_uring_engine.h
> 基于liburing封装的io_uring简易异步IO引擎头文件
io_uring 核心就是两个队列：

- **SQ（提交队列 Submission Queue）**：应用塞 IO 任务（SQE，Submission Queue Entry）
- **CQ（完成队列 Completion Queue）**：内核放 IO 完成事件（CQE，Completion Queue Entry）
- 核心思路：先拿到 SQE → 填充 IO 操作 → （可选绑定 user_data）→ submit 提交给内核 → 之后循环收割 CQE 处理完成事件。
```cpp
#ifndef IO_URING_ENGINE_H
#define IO_URING_ENGINE_H

// ============================================================
// io_uring 最小封装 —— 替代 epoll 的异步 I/O 引擎
// 封装 liburing，提供 SQ/CQ 提交与收割的便捷接口
// ============================================================
#include <liburing.h>
#include <sys/socket.h>

class IoUringEngine {
public:
  IoUringEngine() = default;

  // 初始化 io_uring 实例
  // idle_ms: SQPOLL 模式下内核线程空闲多久后休眠（毫秒），0 表示不休眠
  // entries: SQ/CQ 队列大小，一次最多能准备多少个 SQE
  //`flags`：io_uring 创建 flag，常用：`IORING_SETUP_SQPOLL`（SQ 轮询模式，
  bool init(unsigned entries, unsigned flags = 0, unsigned idle_ms = 2000);

  // ---- SQE 准备（入队，不提交） ----

  // 获取一个空闲 SQE 并填充 IORING_OP_ACCEPT
  io_uring_sqe *prepare_accept(int fd, struct sockaddr *addr,
                               socklen_t *addrlen, unsigned flags = 0);

  // 多路 accept：一个 SQE 持久生效，每个新连接产生一个 CQE
  io_uring_sqe *prepare_multishot_accept(int fd, struct sockaddr *addr,
                                         socklen_t *addrlen,
                                         unsigned flags = 0);

  // 获取一个空闲 SQE 并填充 IORING_OP_RECV
  io_uring_sqe *prepare_recv(int fd, void *buf, unsigned len,
                             unsigned flags = 0);

  // 获取一个空闲 SQE 并填充 IORING_OP_SEND
  io_uring_sqe *prepare_send(int fd, const void *buf, unsigned len,
                             unsigned flags = 0);

  // 获取一个空闲 SQE 并填充 IORING_OP_CLOSE
  io_uring_sqe *prepare_close(int fd);

  // 获取一个空闲 SQE 并填充 IORING_OP_WRITEV
  io_uring_sqe *prepare_writev(int fd, const struct iovec *iov,
                               unsigned nr_vecs, off_t offset = 0);

  // 获取一个空闲 SQE（纯裸 SQE，让你自定义 opcode）
  io_uring_sqe *get_sqe();

  // ---- 提交 ----

  // 提交所有已入队的 SQE（不等待 CQE）
  int submit();

  // 提交并等待至少 wait_nr 个 CQE 就绪
  int submit_and_wait(unsigned wait_nr = 1);

  // 提交并超时等待（毫秒），用于 main 线程周期性检查 worker 队列
  int submit_and_wait_timeout(unsigned wait_nr, unsigned timeout_ms);

  // ---- CQE 收割 ----

  // 非阻塞收割 CQE 队列头，没就绪返回 nullptr
  io_uring_cqe *peek_cqe();

  // 标记该 CQE 已处理完毕
  void cqe_seen(io_uring_cqe *cqe);

  // ---- 辅助 ----

  // 从 CQE 取 user_data（你在 SQE 里设置的关联数据）
  static void *cqe_get_data(const io_uring_cqe *cqe);

  // 从 CQE 取返回值（>=0 成功字节数，<0 错误码 errno）
  static int cqe_get_res(const io_uring_cqe *cqe);

  // 对标 io_uring_sqe_set_data
  static void sqe_set_data(io_uring_sqe *sqe, void *data);

  // ---- tagged pointer: 用指针低 bit 区分 RECV/SEND ----
  // 指针 8 字节对齐 → bit0 始终为 0 → 偷来标操作类型
  static constexpr uintptr_t TAG_RECV = 0;
  static constexpr uintptr_t TAG_SEND = 1;

  static void *tag_recv(void *ptr) {
    return reinterpret_cast<void *>(reinterpret_cast<uintptr_t>(ptr) |
                                    TAG_RECV);
  }
  static void *tag_send(void *ptr) {
    return reinterpret_cast<void *>(reinterpret_cast<uintptr_t>(ptr) |
                                    TAG_SEND);
  }
  static void *untag(void *data) {
    return reinterpret_cast<void *>(reinterpret_cast<uintptr_t>(data) & ~1ULL);
  }
  static bool is_send_op(void *data) {
    return reinterpret_cast<uintptr_t>(data) & TAG_SEND;
  }

  // 暴露底层 ring
  io_uring *get_ring() { return &m_ring; }

  // ---- 生命周期 ----

  void destroy();
  ~IoUringEngine();

  // 禁用拷贝
  IoUringEngine(const IoUringEngine &) = delete;
  IoUringEngine &operator=(const IoUringEngine &) = delete;

private:
  io_uring m_ring{};     // liburing底层io_uring实例
  bool m_inited = false; // 是否初始化完成标记
};

#endif

```
## src/core/io_uring_engine.cc
> 薄包装，几乎全部直接透传 liburing 原生 C 函数
```cpp
// ============================================================
// io_uring 最小封装实现 —— 全部透传 liburing C API
// ============================================================
#include "core/io_uring_engine.h"

// ---- 初始化 ----

bool IoUringEngine::init(unsigned entries, unsigned flags, unsigned idle_ms) {
    struct io_uring_params p = {};
    p.flags = flags;
    if (flags & IORING_SETUP_SQPOLL)
        p.sq_thread_idle = idle_ms;  // SQ poll 线程空闲超时（毫秒）

    int ret = io_uring_queue_init_params(entries, &m_ring, &p);
    if (ret < 0)
        return false;
    m_inited = true;
    return true;
}

// ---- 获取裸 SQE ----

io_uring_sqe *IoUringEngine::get_sqe() {
    // 从 SQ 拿一个空闲槽位。队列满时返回 nullptr，调用方需检查
    return io_uring_get_sqe(&m_ring);
}

// ---- SQE 准备 ----

io_uring_sqe *IoUringEngine::prepare_accept(int fd, struct sockaddr *addr,
                                             socklen_t *addrlen,
                                             unsigned flags) {
    io_uring_sqe *sqe = io_uring_get_sqe(&m_ring);
    if (!sqe)
        return nullptr;
    io_uring_prep_accept(sqe, fd, addr, addrlen, flags);
    return sqe;
}

io_uring_sqe *IoUringEngine::prepare_multishot_accept(int fd,
                                                       struct sockaddr *addr,
                                                       socklen_t *addrlen,
                                                       unsigned flags) {
    io_uring_sqe *sqe = io_uring_get_sqe(&m_ring);
    if (!sqe)
        return nullptr;
    io_uring_prep_multishot_accept(sqe, fd, addr, addrlen, flags);
    return sqe;
}

io_uring_sqe *IoUringEngine::prepare_recv(int fd, void *buf, unsigned len,
                                           unsigned flags) {
    io_uring_sqe *sqe = io_uring_get_sqe(&m_ring);
    if (!sqe)
        return nullptr;
    io_uring_prep_recv(sqe, fd, buf, len, flags);
    return sqe;
}

io_uring_sqe *IoUringEngine::prepare_send(int fd, const void *buf,
                                           unsigned len, unsigned flags) {
    io_uring_sqe *sqe = io_uring_get_sqe(&m_ring);
    if (!sqe)
        return nullptr;
    io_uring_prep_send(sqe, fd, buf, len, flags);
    return sqe;
}

io_uring_sqe *IoUringEngine::prepare_close(int fd) {
    io_uring_sqe *sqe = io_uring_get_sqe(&m_ring);
    if (!sqe)
        return nullptr;
    io_uring_prep_close(sqe, fd);
    return sqe;
}

io_uring_sqe *IoUringEngine::prepare_writev(int fd, const struct iovec *iov,
                                             unsigned nr_vecs, off_t offset) {
    io_uring_sqe *sqe = io_uring_get_sqe(&m_ring);
    if (!sqe)
        return nullptr;
    io_uring_prep_writev(sqe, fd, iov, nr_vecs, offset);
    return sqe;
}

// ---- 提交 ----

int IoUringEngine::submit() {
    return io_uring_submit(&m_ring);
}

int IoUringEngine::submit_and_wait(unsigned wait_nr) {
    return io_uring_submit_and_wait(&m_ring, wait_nr);
}

int IoUringEngine::submit_and_wait_timeout(unsigned wait_nr,
                                            unsigned timeout_ms) {
    struct __kernel_timespec ts;
    ts.tv_sec  = timeout_ms / 1000;
    ts.tv_nsec = (timeout_ms % 1000) * 1000000UL;
    struct io_uring_cqe *cqe = nullptr;
    int ret = io_uring_submit_and_wait_timeout(&m_ring, &cqe,
                                                wait_nr, &ts, nullptr);
    return ret;
}

// ---- CQE 收割 ----

io_uring_cqe *IoUringEngine::peek_cqe() {
    io_uring_cqe *cqe = nullptr;
    int ret = io_uring_peek_cqe(&m_ring, &cqe);
    if (ret == 0)
        return cqe;
    return nullptr;
}

void IoUringEngine::cqe_seen(io_uring_cqe *cqe) {
    io_uring_cqe_seen(&m_ring, cqe);
}

// ---- 辅助 ----

void *IoUringEngine::cqe_get_data(const io_uring_cqe *cqe) {
    return io_uring_cqe_get_data(cqe);
}

int IoUringEngine::cqe_get_res(const io_uring_cqe *cqe) {
    return cqe->res; // >=0: 成功读/写的字节数; <0: -errno
}

void IoUringEngine::sqe_set_data(io_uring_sqe *sqe, void *data) {
    io_uring_sqe_set_data(sqe, data);
}

// ---- 生命周期 ----

void IoUringEngine::destroy() {
    if (m_inited) {
        io_uring_queue_exit(&m_ring);
        m_inited = false;
    }
}

IoUringEngine::~IoUringEngine() {
    destroy();
}
```
## include/core/lst_tiimer.h
> 基于双向有序链表实现的定时器模块
- 链表始终保持**按到期时间升序**。`tick()`扫描链表头部，逐个执行已经到期的定时器回调，然后删除节点
```cpp
#ifndef LST_TIMER
#define LST_TIMER

#include <arpa/inet.h>
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>

#include "core/locker.h"
#include <time.h>

class util_timer;

// 客户端连接上下文：socket、地址、绑定定时器
struct client_data {
  sockaddr_in address; // 客户端IP+端口
  int sockfd;          // 客户端连接fd
  util_timer *timer;   // 关联的定时器节点
};

// 定时器双向链表节点
class util_timer {
public:
  time_t expire;                  // 到期绝对时间戳
  void (*cb_func)(client_data *); // 超时回调函数指针
  client_data *user_data;         // 绑定客户端上下文
  util_timer *prev, *next;        // 双向链表前后指针

  util_timer()
      : expire(0), cb_func(nullptr), user_data(nullptr), prev(nullptr),
        next(nullptr) {}
};

// 有序升序双向定时器链表
class sort_timer_lst {
public:
  sort_timer_lst();
  ~sort_timer_lst();

  // 添加定时器节点
  void add_timer(util_timer *timer);
  // 刷新定时器超时时间，调整节点位置
  void adjust_timer(util_timer *timer);
  // 删除指定定时器节点
  void del_timer(util_timer *timer);
  // 定时触发，清理所有已到期定时器
  void tick();

private:
  // 递归插入节点内部重载
  void add_timer(util_timer *timer, util_timer *lst_head);

  util_timer *head;
  util_timer *tail;
  locker lst_lock; // 新增：互斥锁保护链表，多线程增删安全

  // 禁止拷贝、赋值（持有链表资源，不可复制）
  sort_timer_lst(const sort_timer_lst &) = delete;
  sort_timer_lst &operator=(const sort_timer_lst &) = delete;
};

// 全局工具类：信号、定时器、fd工具统一封装
class Utils {
public:
  Utils();
  ~Utils();

  void init(int timeslot);
  int setnonblocking(int fd);
  static void sig_handler(int sig);
  void addsig(int sig, void(handler)(int), bool restart = true);
  void timer_handler();
  void show_error(int connfd, const char *info);
  static int get_pipefd(int idx);

public:
  static int u_pipefd[2]; // 管道，信号处理线程通知IO主线程

public:
  sort_timer_lst m_timer_lst;
  int m_TIMESLOT; // 定时器心跳

  Utils(const Utils &) = delete;
  Utils &operator=(const Utils &) = delete;
};

// 全局默认超时回调：关闭闲置超时连接
void cb_func(client_data *user_data);

#endif

```
## src/core/lst_timer.cc
```cpp
#include "core/lst_timer.h"
#include "net/http_conn.h"
#include <cstddef>
#include <cstdio>
#include <cstring>
#include <signal.h>
#include <unistd.h>

// 静态私有全局资源定义
int Utils::u_pipefd[2] = {0, 0};

// ===================== sort_timer_lst 实现 =====================
sort_timer_lst::sort_timer_lst() : head(nullptr), tail(nullptr) {}

sort_timer_lst::~sort_timer_lst() {
  locker_guard guard(lst_lock);
  util_timer *tmp = head;
  while (tmp) {
    util_timer *del = tmp;
    tmp = tmp->next;
    // user_data 指向 WebServer::users_timer 数组元素，
    // 生命周期由数组delete[]统一管理，不可单独delete
    del->user_data = nullptr;
    delete del;
  }
  head = nullptr;
  tail = nullptr;
}

void sort_timer_lst::add_timer(util_timer *timer) {
  if (!timer)
    return;
  locker_guard guard(lst_lock);
  // 链表为空，直接head=tail=timer
  if (!head) {
    head = tail = timer;
    return;
  }
  // 新定时器比头节点更早到期 → 插头部
  // 链表头先过期， 头插发 O(1)
  if (timer->expire < head->expire) {
    timer->next = head;
    head->prev = timer;
    head = timer;
    return;
  }
  // 否则递归重载函数，从head往后找位置插入
  add_timer(timer, head);
}

void sort_timer_lst::adjust_timer(util_timer *timer) {
  if (!timer)
    return;
  locker_guard guard(lst_lock);
  util_timer *tmp = timer->next;
  // 下一个节点为空 或 当前超时小于后继，无需调整
  if (!tmp || timer->expire < tmp->expire)
    return;

  // 摘下当前节点
  if (timer == head) {
    head = head->next;
    head->prev = nullptr;
  } else {
    timer->prev->next = timer->next;
    timer->next->prev = timer->prev;
  }
  timer->prev = nullptr;
  timer->next = nullptr;
  add_timer(timer, head);
}

void sort_timer_lst::del_timer(util_timer *timer) {
  if (!timer)
    return;
  locker_guard guard(lst_lock);
  // 链表仅一个节点
  if (timer == head && timer == tail) {
    delete timer;
    head = nullptr;
    tail = nullptr;
    return;
  }
  // 头节点
  if (timer == head) {
    head = head->next;
    head->prev = nullptr;
    delete timer;
    return;
  }
  // 尾节点
  if (timer == tail) {
    tail = tail->prev;
    tail->next = nullptr;
    delete timer;
    return;
  }
  // 中间节点
  timer->prev->next = timer->next;
  timer->next->prev = timer->prev;
  delete timer;
}

void sort_timer_lst::tick() {
  if (!head)
    return;
  locker_guard guard(lst_lock);
  time_t cur = time(nullptr);
  util_timer *tmp = head;
  while (tmp) {
    // 链表升序：遇到未到期节点直接break，后面全部更晚到期，不用遍历
    if (cur < tmp->expire)
      break;
    // 执行超时回调
    tmp->cb_func(tmp->user_data);
    if (tmp->user_data)
      tmp->user_data->timer = nullptr;
    head = tmp->next;
    if (head)
      head->prev = nullptr;
    // 释放内存
    util_timer *del = tmp; // ✅ del 和 tmp 指向**同一个定时器对象**
    tmp = head;            // ✅ 更新tmp，指向下一轮要处理的节点
    delete del;            // ✅ delete del 就是释放这个定时器内存
  }
}
// 从 lst_head 往后遍历链表，找到合适位置插入 timer，维持链表按 expire 升序
void sort_timer_lst::add_timer(util_timer *timer, util_timer *lst_head) {
  util_timer *prev = lst_head;
  util_timer *tmp = prev->next;
  while (tmp) {
    if (timer->expire < tmp->expire) {
      prev->next = timer;
      timer->next = tmp;
      tmp->prev = timer;
      timer->prev = prev;
      break;
    }
    prev = tmp;
    tmp = tmp->next;
  }
  // 插到尾部
  if (!tmp) {
    prev->next = timer;
    timer->prev = prev;
    timer->next = nullptr;
    tail = timer;
  }
}

// ===================== Utils 实现 =====================
Utils::Utils() : m_TIMESLOT(0) {}

Utils::~Utils() {
  // 关闭管道
  if (u_pipefd[0] > 0)
    close(u_pipefd[0]);
  if (u_pipefd[1] > 0)
    close(u_pipefd[1]);
  u_pipefd[0] = u_pipefd[1] = 0;
}

void Utils::init(int timeslot) {
  m_TIMESLOT = timeslot;
  // io_uring 下管道由 WebServer::eventListen 创建和管理，这里仅保存定时节拍
}

int Utils::setnonblocking(int fd) {
  int old_option = fcntl(fd, F_GETFL);
  int new_option = old_option | O_NONBLOCK;
  fcntl(fd, F_SETFL, new_option);
  return old_option;
}
// 信号处理函数
void Utils::sig_handler(int sig) {
  int save_errno = errno;
  int msg = sig;
  // 信号是异步的，会打断 epoll_wait/io_uring_wait。用管道把“信号”转成“IO
  // 事件”，就能统一在主循环里处理，避免在信号处理函数里做危险操作。
  send(u_pipefd[1], (char *)&msg, 1, MSG_NOSIGNAL);
  errno = save_errno;
}
// 注册信号
void Utils::addsig(int sig, void(handler)(int), bool restart) {
  (void)sig;
  struct sigaction sa;
  memset(&sa, '\0', sizeof(sa));
  sa.sa_handler = handler;
  if (restart)
    sa.sa_flags |= SA_RESTART;
  // 阻塞所有信号，保证处理期间不被打断
  sigfillset(&sa.sa_mask);
  assert(sigaction(sig, &sa, nullptr) != -1);
}

void Utils::timer_handler() {
  m_timer_lst.tick();
  // 重新设置 SIGALRM，m_TIMESLOT 秒后再触发一次
  alarm(m_TIMESLOT);
}

// 向客户端返回错误提示，然后直接断开连接
void Utils::show_error(int connfd, const char *info) {
  // 1. 把错误字符串发送给客户端浏览器
  send(connfd, info, strlen(info), MSG_NOSIGNAL);
  // 2. 关闭客户端socket，断开TCP连接
  close(connfd);
}

int Utils::get_pipefd(int idx) {
  if (idx < 0 || idx > 1)
    return -1;
  return u_pipefd[idx];
}
void cb_func(client_data *user_data) {
  // 1. 判空防护：如果传入的连接上下文是空，直接退出，防止野指针崩溃
  if (!user_data)
    return;

  // 2. 关闭 socket fd（io_uring 下无需 epoll_ctl DEL）
  close(user_data->sockfd);

  // 3. 全局在线连接计数-1，统计当前服务活跃客户端数量
  http_conn::m_user_count--;
}

```
## include/core/threadpool.h
> **任务队列 + N 个工作线程 + 互斥锁保护队列 + 信号量通知有任务**。
```cpp
#ifndef THREADPOOL_H
#define THREADPOOL_H

#include "core/locker.h"
#include "db/sql_connection_pool.h"
#include <cstdio>
#include <exception>
#include <list>
#include <pthread.h>

template <typename T> class threadpool {
public:
  /*thread_number是线程池中线程的数量，max_requests是请求队列中最多允许的、等待处理的请求的数量*/
  threadpool(int actor_model, connection_pool *connPool, int thread_number = 8,
             int max_request = 10000);
  ~threadpool();
  bool append(T *request, int state);
  bool append_p(T *request);

private:
  /*工作线程运行的函数，它不断从工作队列中取出任务并执行之*/
  static void *worker(void *arg);
  void run();

private:
  int m_thread_number;         // 线程池中的线程数
  int m_max_requests;          // 请求队列中允许的最大请求数
  pthread_t *m_threads;        // 描述线程池的数组，其大小为m_thread_number
  std::list<T *> m_workqueue;  // 请求队列
  locker m_queuelocker;        // 保护请求队列的互斥锁
  sem m_queuestat;             // 是否有任务需要处理
  connection_pool *m_connPool; // 数据库
  int m_actor_model;           // 模型切换
  bool m_stop = false;         // 析构标记
};
template <typename T>
threadpool<T>::threadpool(int actor_model, connection_pool *connPool,
                          int thread_number, int max_requests)
    : m_thread_number(thread_number), m_max_requests(max_requests),
      m_threads(NULL), m_connPool(connPool), m_actor_model(actor_model) {
  if (thread_number <= 0 || max_requests <= 0)
    throw std::exception();
  m_threads = new pthread_t[m_thread_number];
  if (!m_threads)
    throw std::exception();
  for (int i = 0; i < thread_number; ++i) {
    // 创建线程，入口worker，参数this（把线程池对象传给静态worker）
    if (pthread_create(m_threads + i, NULL, worker, this) != 0) {
      delete[] m_threads;
      throw std::exception();
    }
    // pthread_detach：分离线程。线程退出后自动回收资源，不用pthread_join
    if (pthread_detach(m_threads[i])) {
      delete[] m_threads;
      throw std::exception();
    }
  }
}

template <typename T> threadpool<T>::~threadpool() {
  m_stop = true;
  // 唤醒所有阻塞在 sem_wait 的 worker
  for (int i = 0; i < m_thread_number; i++)
    m_queuestat.post();
  delete[] m_threads;
}
template <typename T> bool threadpool<T>::append(T *request, int state) {
  m_queuelocker.lock();
  // 判断队列是否满
  if (m_workqueue.size() >= static_cast<size_t>(m_max_requests)) {
    m_queuelocker.unlock();
    return false;
  }
  request->m_state = state;
  m_workqueue.push_back(request);
  m_queuelocker.unlock();
  m_queuestat.post(); // 信号量+1，唤醒一个工作线程
  return true;
}

template <typename T> bool threadpool<T>::append_p(T *request) {
  m_queuelocker.lock();
  if (m_workqueue.size() >= static_cast<size_t>(m_max_requests)) {
    m_queuelocker.unlock();
    return false;
  }
  m_workqueue.push_back(request);
  m_queuelocker.unlock();
  m_queuestat.post();
  return true;
}
//`worker` 是**pthread 线程入口函数，必须是类的 static 静态成员**；pthread
// 启动线程时调用 worker，worker
// 拿到线程池对象，调用成员方法`run()`，真正的业务循环写在 run 里面。
template <typename T> void *threadpool<T>::worker(void *arg) {
  threadpool *pool = (threadpool *)arg;
  pool->run();
  return pool;
}
template <typename T> void threadpool<T>::run() {
  while (!m_stop) {     // m_stop=false：线程池正常运行；m_stop=true 准备退出
    m_queuestat.wait(); // 信号量等待：没任务就阻塞在这里休眠
    if (m_stop)
      break;

    m_queuelocker.lock();      // 上锁，保护任务队列（共享资源）
    if (m_workqueue.empty()) { // 拿到信号，但队列空（惊群/伪唤醒）
      m_queuelocker.unlock();
      continue; // 回到循环开头，继续wait
    }
    T *request = m_workqueue.front(); // 取队首任务指针
    m_workqueue.pop_front();          // 队列弹出任务
    m_queuelocker.unlock();           // ✅ 尽早解锁！任务处理不需要锁

    if (!request)
      continue;

    if (1 == m_actor_model) { // 分支1：io_uring Reactor模型
      if (0 == request->m_state) {
        request->improv = 1;
        connectionRAII mysqlcon(&request->mysql, m_connPool);
        request->process(); // 执行http业务逻辑，访问mysql
      } else {
        request->improv = 1; // 仅标记，不跑process、不拿数据库连接
      }
    } else { // 分支2：原版epoll Reactor
      connectionRAII mysqlcon(&request->mysql, m_connPool);
      request->process(); // 拿到任务就执行业务
    }
  }
}

#endif

```
## include/db/user_cache.h
> 这是**单例模式的内存用户缓存**，把数据库里用户名密码读到内存 map，登录校验直接查内存，减少 MySQL 查询压力；所有接口线程安全。
```cpp
#ifndef USER_CACHE_H
#define USER_CACHE_H

#include <map>
#include <string>

class connection_pool;
class locker;

// ============================================================
// 全局数据库用户缓存（单例）
// 封装原 http_conn.cpp 中全局 users map + m_lock
// 提供线程安全的用户查询/插入接口
// ============================================================
class UserCache {
public:
  // 获取单例实例
  static UserCache *getInstance();

  // 从数据库 user 表预加载全部用户名/密码到内存缓存
  void load_all_users(connection_pool *connPool);

  // 检查用户名是否已存在（线程安全）
  bool user_exists(const std::string &name);

  // 校验用户名密码是否匹配（线程安全）
  bool validate_user(const std::string &name, const std::string &password);

  // 插入新用户到缓存（线程安全）
  void insert_user(const std::string &name, const std::string &password);

private:
  UserCache(); // 构造私有， 只能通过getInstance() 拿到唯一全局对象
  ~UserCache() = default;

  // 禁止拷贝、赋值
  UserCache(const UserCache &) = delete;
  UserCache &operator=(const UserCache &) = delete;
  std::map<std::string, std::string> users_;
  locker *lock_;
};

#endif

```


## src/db/user_cache.cc
```cpp
#include "db/user_cache.h"
#include "core/locker.h"
#include "core/log.h"
#include "db/sql_connection_pool.h"
#include <mysql/mysql.h>
#include <string>

// ===================== 单例实现 =====================
UserCache *UserCache::getInstance() {
  static UserCache instance;
  return &instance;
}

UserCache::UserCache() : lock_(new locker()) {}

// ===================== load_all_users =====================
// 预加载数据库中全部用户到内存缓存
void UserCache::load_all_users(connection_pool *connPool) {
  // 先从连接池中取一个连接
  MYSQL *mysql = NULL;
  connectionRAII mysqlcon(&mysql, connPool);

  // 在user表中检索username，passwd数据
  if (mysql_query(mysql, "SELECT username,passwd FROM user")) {
    LOG_ERROR("SELECT error:%s\n", mysql_error(mysql));
  }

  // 从表中检索完整的结果集
  MYSQL_RES *result = mysql_store_result(mysql);

  // 从结果集中获取下一行，将对应的用户名和密码，存入map中
  lock_->lock();
  while (MYSQL_ROW row = mysql_fetch_row(result)) {
    std::string temp1(row[0]);
    std::string temp2(row[1]);
    users_[temp1] = temp2;
  }
  lock_->unlock();
}

// ===================== user_exists =====================
bool UserCache::user_exists(const std::string &name) {
  lock_->lock();
  bool exists = (users_.find(name) != users_.end());
  lock_->unlock();
  return exists;
}

// ===================== validate_user =====================
bool UserCache::validate_user(const std::string &name,
                              const std::string &password) {
  lock_->lock();
  bool valid = false;
  auto it = users_.find(name);
  if (it != users_.end() && it->second == password)
    valid = true;
  lock_->unlock();
  return valid;
}

// ===================== insert_user =====================
void UserCache::insert_user(const std::string &name,
                            const std::string &password) {
  lock_->lock();
  users_.insert(std::pair<std::string, std::string>(name, password));
  lock_->unlock();
}

```

## include/db/sql_connection_pool.h
> **MySQL 数据库连接池**。预先创建一批 MySQL 连接放到队列复用，避免每次业务请求都mysql_init
```cpp
#ifndef _CONNECTION_POOL_
#define _CONNECTION_POOL_

#include "core/locker.h"
#include "core/log.h"
#include <error.h>
#include <iostream>
#include <mysql/mysql.h>
#include <queue>
#include <stdio.h>
#include <string.h>
#include <string>

using namespace std;
class connection_pool {
public:
  MYSQL *GetConnection();
  // 超时获取连接，ms_timeout毫秒无空闲返回nullptr，防止线程卡死
  MYSQL *GetConnection(int ms_timeout);
  bool ReleaseConnection(MYSQL *conn);
  int GetFreeConn();
  void DestroyPool();

  // 单例模式
  static connection_pool *GetInstance();

  void init(string url, string User, string PassWord, string dbname, int port,
            int maxconn, int close_log);

private:
  // 创建单个mysql连接，内部工具函数
  MYSQL *CreateMysqlConn();
  // 校验连接是否有效，失效则重建
  MYSQL *CheckAndReBuildConn(MYSQL *old_conn);

private:
  string m_url;
  string m_port;
  string m_user;
  string m_passwd;
  string m_dbname;
  int m_close_log;

private:
  connection_pool();
  ~connection_pool();

  int m_MaxConn;           // 连接池最大连接数量
  int m_CurConn;           // 当前已经创建的连接总数
  int m_FreeConn;          // 当前空闲可用连接数量
  locker lock;             // 互斥锁，保护队列connPool
  queue<MYSQL *> connPool; // 空闲连接队列，存放MYSQL*
  sem reserve;             // 信号量：空闲连接数量信号量
  // 禁止拷贝， 赋值
  connection_pool(const connection_pool &) = delete;
  connection_pool &operator=(const connection_pool &) = delete;
};
class connectionRAII {
public:
  connectionRAII(MYSQL **conn, connection_pool *connPool);
  ~connectionRAII();

private:
  MYSQL *connRAII;
  connection_pool *pollRAII;

  connectionRAII(const connectionRAII &) = delete;
  connectionRAII &operator=(const connectionRAII &) = delete;
};
#endif

```
## src/db/sql_connection_pool.cc
```cpp
#include "db/sql_connection_pool.h"
#include <mysql/mysql.h>
#include <queue>
#include <stdexcept>
#include <stdio.h>
#include <string>

using namespace std;

connection_pool::connection_pool() {
  m_CurConn = 0;
  m_FreeConn = 0;
  m_MaxConn = 0;
  m_close_log = 0;
}

connection_pool *connection_pool::GetInstance() {
  static connection_pool connPool;
  return &connPool;
}
// 创建单个 MySQL 连接（工具函数）
MYSQL *connection_pool::CreateMysqlConn() {
  MYSQL *con = mysql_init(nullptr);
  if (!con) {
    LOG_ERROR("mysql_init failed!");
    return nullptr;
  }

  // 端口是 int，不是 string！！！这里必须修正
  int port = stoi(m_port);

  con = mysql_real_connect(con, m_url.c_str(), m_user.c_str(), m_passwd.c_str(),
                           m_dbname.c_str(), port, nullptr, 0);
  if (!con) {
    LOG_ERROR("mysql_connect failed: %s", mysql_error(con));
    mysql_close(con);
    return nullptr;
  }
  return con;
}

// 校验连接是否有效，失效则重建
MYSQL *connection_pool::CheckAndReBuildConn(MYSQL *old_conn) {
  if (!old_conn)
    return nullptr;

  if (mysql_ping(old_conn) == 0) {
    return old_conn;
  }
  LOG_WARN("mysql connection lost, reconnecting... errno={}, msg={}",
           mysql_errno(old_conn), mysql_error(old_conn));
  mysql_close(old_conn);
  return CreateMysqlConn();
}
// 初始化连接池
void connection_pool::init(string url, string User, string PassWord,
                           string dbname, int port, int maxconn,
                           int close_log) {
  // 1. 把配置参数保存到成员变量
  m_url = url;
  m_user = User;
  m_passwd = PassWord;
  m_dbname = dbname;
  m_port = to_string(port); // int端口转字符串，刚好给CreateMysqlConn里面stoi用
  m_close_log = close_log;

  // 2. 循环创建 maxconn 个mysql连接
  for (int i = 0; i < maxconn; i++) {
    MYSQL *con = CreateMysqlConn();
    if (!con) {
      LOG_ERROR("create mysql connection failed");
      throw runtime_error("init connection pool failed");
    }
    connPool.push(con); // 创建成功，放进空闲连接队列
    m_FreeConn++;       // 空闲连接计数+1
  }

  reserve.reinit(m_FreeConn); // 信号量初始化，值=空闲连接数量
  m_MaxConn = m_FreeConn;     // 最大连接数 = 实际成功创建的连接数
}

// 阻塞获取连接
MYSQL *connection_pool::GetConnection() {
  reserve.wait();

  locker_guard guard(lock);
  if (connPool.empty())
    return nullptr;

  MYSQL *con = connPool.front();
  connPool.pop();

  m_FreeConn--;
  m_CurConn++;

  return CheckAndReBuildConn(con);
}

// 超时获取连接
MYSQL *connection_pool::GetConnection(int ms_timeout) {
  if (!reserve.timewait(ms_timeout)) {
    LOG_ERROR("get connection timeout");
    return nullptr;
  }

  locker_guard guard(lock);
  if (connPool.empty())
    return nullptr;

  MYSQL *con = connPool.front();
  connPool.pop();

  m_FreeConn--;
  m_CurConn++;

  return CheckAndReBuildConn(con);
}

// 归还连接
bool connection_pool::ReleaseConnection(MYSQL *conn) {
  if (!conn)
    return false;

  locker_guard guard(lock);
  connPool.push(conn);

  m_FreeConn++;
  m_CurConn--;

  reserve.post();
  return true;
}

// 销毁连接池
void connection_pool::DestroyPool() {
  // 不等待归还：直接关闭池中现有的连接
  // worker 线程持有的连接由 connectionRAII 析构自己归还/关闭
  locker_guard guard(lock);
  while (!connPool.empty()) {
    MYSQL *con = connPool.front();
    connPool.pop();
    mysql_close(con);
  }
  m_CurConn = 0;
  m_FreeConn = 0;
}

// 获取空闲连接数
int connection_pool::GetFreeConn() {
  locker_guard guard(lock);
  return m_FreeConn;
}

connection_pool::~connection_pool() { DestroyPool(); }

// ------------------- RAII -------------------
connectionRAII::connectionRAII(MYSQL **conn, connection_pool *connPool) {
  // 1. 从连接池获取一条连接，赋值给外部传入的 MYSQL* 变量
  *conn = connPool->GetConnection();
  // 2. 保存拿到的连接句柄，析构时用来归还
  connRAII = *conn;
  // 3. 保存连接池指针，析构时调用 ReleaseConnection
  pollRAII = connPool;
}

connectionRAII::~connectionRAII() {
  // 判空：如果获取连接失败，不用归还
  if (connRAII)
    pollRAII->ReleaseConnection(connRAII);
}

```
## include/net/http_const.h
> **HTTP 服务器的常量配置头文件**，专门存放 HTTP 响应需要用到的**状态描述文本 + 简易错误页面内容**。Web 服务器解析完 HTTP 请求后，如果出错，就拿这里定义的字符串拼装 HTTP 响应报文发给浏览器。
```cpp
#ifndef HTTP_CONST_H
#define HTTP_CONST_H

// ============================================================
// HTTP响应状态码描述 & 错误页面模板 —— 仅头文件，无cpp
// ============================================================

// 200 OK
const char *const ok_200_title = "OK";

// 400 Bad Request
const char *const error_400_title = "Bad Request";
const char *const error_400_form =
    "Your request has bad syntax or is inherently impossible to staisfy.\n";

// 403 Forbidden
const char *const error_403_title = "Forbidden";
const char *const error_403_form =
    "You do not have permission to get file form this server.\n";

// 404 Not Found
const char *const error_404_title = "Not Found";
const char *const error_404_form =
    "The requested file was not found on this server.\n";

// 500 Internal Server Error
const char *const error_500_title = "Internal Error";
const char *const error_500_form =
    "There was an unusual problem serving the request file.\n";

#endif

```

## include/net/socket_tool.h
> 
```cpp
#ifndef SOCKET_TOOL_H
#define SOCKET_TOOL_H

// ============================================================
// 底层socket工具函数 —— 全项目通用，与单HTTP连接无关
// ============================================================

// 对文件描述符设置非阻塞，返回旧的文件状态标志
int setnonblocking(int fd);

#endif

```
## src/net/socket_tool.h
```cpp
#include "net/socket_tool.h"
#include <fcntl.h>

// 对文件描述符设置非阻塞
int setnonblocking(int fd) {
  int old_option = fcntl(fd, F_GETFL);
  int new_option = old_option | O_NONBLOCK;
  fcntl(fd, F_SETFL, new_option);
  return old_option;
}

```
## include/net/http_conn.h
> 这是**HTTP 连接类头文件**，是整个 Web 服务器最核心的业务类。
对比原版 TinyWebServer：**改造升级成 io_uring 异步 IO 版本**，不再用 epoll + 非阻塞 read；还保留了经典 HTTP 状态机解析逻辑、静态文件 mmap、POST CGI、MySQL 登录校验、定时器。
一个 `http_conn` 对象代表**一条客户端 TCP 连接**。客户端连上服务器，就创建一个实例；连接关闭，销毁实例。
```cpp
#ifndef HTTPCONNECTION_H
#define HTTPCONNECTION_H

#include <arpa/inet.h>
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <unistd.h>

#include "core/buffer_ring.h"
#include "core/io_uring_engine.h"
#include "core/locker.h"
#include "core/log.h"
#include "core/lst_timer.h"
#include "db/sql_connection_pool.h"
#include <list>

class http_conn {
public:
  // 静态常量
  static const int FILENAME_LEN = 200;
  static const int READ_BUFFER_SIZE = 2048;
  static const int WRITE_BUFFER_SIZE = 1024;

  // HTTP请求方法
  enum METHOD {
    GET = 0,
    POST,
    HEAD,
    PUT,
    DELETE,
    TRACE,
    OPTIONS,
    CONNECT,
    PATH
  };
  // HTTP报文解析阶段状态机（最重要！）
  enum CHECK_STATE {
    CHECK_STATE_REQUESTLINE = 0, // 阶段1：解析请求行（Request-Line）
    CHECK_STATE_HEADER,          // 阶段2：解析请求头（Request Header）
    CHECK_STATE_CONTENT          // 阶段3：解析请求体（Content，POST才会用到）
  };
  // HTTP处理结果码：解析完请求后，服务器返回的处理结果
  enum HTTP_CODE {
    NO_REQUEST,        // 请求不完整，还需要继续读socket数据
    GET_REQUEST,       // 成功拿到一个完整的HTTP请求（GET类）
    BAD_REQUEST,       // 请求报文格式错误 400
    NO_RESOURCE,       // 资源不存在 404
    FORBIDDEN_REQUEST, // 权限不足 403
    FILE_REQUEST,      // 静态文件请求成功，准备返回文件
    INTERNAL_ERROR,    // 服务器内部错误 500
    REDIRECT,          // 重定向 3xx
    CLOSED_CONNECTION  // 关闭连接
  };
  // 单行解析状态
  enum LINE_STATUS { LINE_OK = 0, LINE_BAD, LINE_OPEN };

public:
  http_conn();
  ~http_conn();

  // 禁止拷贝，持有fd、数据库、mmap资源不可复制
  http_conn(const http_conn &) = delete;
  http_conn &operator=(const http_conn &) = delete;

  // 对外初始化接口，全部使用std::string
  void init(int sockfd, const sockaddr_in &addr, std::string root,
            int trig_mode, int close_log, std::string sql_user,
            std::string sql_passwd, std::string sql_db);

  // 关闭连接，释放mmap、归还数据库连接
  void close_conn(bool real_close = true);

  // 业务主逻辑：解析请求 + 组装响应
  void process();

  // 非阻塞读取TCP数据（首次 accept 后仍可用）
  bool read_once();

  // 获取客户端地址
  sockaddr_in *get_address() { return &m_address; }

  // 预加载数据库用户表
  void initmysql_result(connection_pool *connPool);

  // ==== io_uring 异步 I/O 接口 ====
  void submit_recv();                            // 主线程直接提交 RECV
  void on_recv_done(int bytes_read, int buf_id); // RECV CQE 回调
  void on_send_done();                           // SEND CQE 回调（主线程）
  bool
  on_send_cqe(int bytes_sent); // 处理 SEND CQE，返回 true=完成 false=需重传

  // 定时器标记、线程同步标记
  int timer_flag;
  int improv; // 线程 / 事件标记

  // ========== 只读Getter，调试可读，外部不可修改 ==========
  int get_sockfd() const;
  int get_state() const;
  std::string get_url() const;
  std::string get_doc_root() const;
  long get_content_length() const;
  bool is_linger() const;
  METHOD get_method() const;

public:
  // 全局 io_uring 引擎 + BufferPool + 单线程统一提交队列
  static IoUringEngine *m_ring;
  static BufferPool *s_buf_pool;
  static int m_user_count;
  static locker m_count_lock;

  // worker → main 线程的待提交队列（锁 + list）
  static locker s_sq_lock;
  static std::list<http_conn *> s_sq_queue;
  static int s_wakeup_fd; // pipe 写端 fd，worker 入队后写 1 字节唤醒主线程
  static void enqueue_to_main(http_conn *conn);
  static void flush_main_queue(); // 主线程 eventLoop 调用

  MYSQL *mysql;
  int m_state;

  // worker 线程设标记，主线程读并清空
  bool m_need_send = false;
  bool m_need_recv = false;

private:
  void init();

  // 完整解析HTTP请求报文
  HTTP_CODE process_read();

  // 根据解析结果组装响应报文
  bool process_write(HTTP_CODE ret);

  // 分段解析HTTP
  HTTP_CODE parse_request_line(const char *text);
  HTTP_CODE parse_headers(const char *text);
  HTTP_CODE parse_content(const char *text);

  // 路由业务：读取静态文件 / CGI数据库登录校验
  HTTP_CODE do_request();

  // 获取当前解析行起始指针
  char *get_line() { return &m_read_buf[m_start_line]; };

  // 按\r\n截取单行，返回行状态
  LINE_STATUS parse_line();

  // 释放mmap文件映射内存
  void unmap();

  // 响应拼接工具函数
  bool add_response(const char *format, ...);
  bool add_content(const char *content);
  bool add_status_line(int status, const char *title);
  bool add_headers(int content_length);
  bool add_content_type();
  bool add_content_length(int content_length);
  bool add_linger();
  bool add_blank_line();

private:
  // TCP套接字
  int m_sockfd;
  sockaddr_in m_address;

  // 原固定数组保留基础缓冲区，业务存储改用string，兼顾ET分段读取
  char m_read_buf[READ_BUFFER_SIZE];
  long m_read_idx;
  long m_checked_idx;
  int m_start_line;

  // 响应缓冲区
  char m_write_buf[WRITE_BUFFER_SIZE];
  int m_write_idx;

  // HTTP解析状态
  CHECK_STATE m_check_state;
  METHOD m_method;

  // 文件路径，替换定长数组为string
  std::string m_real_file;
  std::string m_url;
  std::string m_version;
  std::string m_host;
  long m_content_length;
  bool m_linger;

  // 文件mmap映射
  char *m_file_address;
  struct stat m_file_stat;
  // 分散写iovec：响应头 + 文件内容
  struct iovec m_iv[2];
  int m_iv_count;

  // POST CGI标记，请求体缓存改用string
  int cgi;
  std::string m_post_data;

  // 发送进度标记
  int bytes_to_send;
  int bytes_have_send;

  // 网站静态资源根目录
  std::string doc_root;

  // 运行配置
  int m_TRIGMode;
  int m_close_log;

  // 数据库账号库名，替换定长char数组
  std::string sql_user;
  std::string sql_passwd;
  std::string sql_name;
};

#endif

```
## src/net/http_conn_init.cc
> **http_conn 的生命周期相关代码：构造、析构、两套 init、close_conn、getter、mysql 预加载**。
```cpp
// ============================================================
// http_conn 生命周期管理：构造、析构、初始化、关闭
// ============================================================
#include "net/http_conn.h"
#include "net/socket_tool.h"
#include "db/user_cache.h"
#include <cstring>
#include <unistd.h>

// ===================== 构造 =====================
http_conn::http_conn()
    : timer_flag(0), improv(0), mysql(nullptr), m_state(0), m_sockfd(-1),
      m_read_idx(0), m_checked_idx(0), m_start_line(0), m_write_idx(0),
      m_check_state(CHECK_STATE_REQUESTLINE), m_method(GET),
      m_content_length(0), m_linger(false), m_file_address(nullptr),
      m_iv_count(0), cgi(0), bytes_to_send(0), bytes_have_send(0),
      m_TRIGMode(0), m_close_log(0) {
  memset(m_read_buf, '\0', READ_BUFFER_SIZE);
  memset(m_write_buf, '\0', WRITE_BUFFER_SIZE);
}

// ===================== 析构 =====================
http_conn::~http_conn() {
  // 仅关闭socket，不修改全局计数器（析构由delete[]触发）
  if (m_sockfd != -1) {
    close(m_sockfd);
    m_sockfd = -1;
  }
}

// ===================== close_conn =====================
void http_conn::close_conn(bool real_close) {
  if (real_close && (m_sockfd != -1)) {
    printf("close %d\n", m_sockfd);
    close(m_sockfd);
    m_sockfd = -1;
    m_user_count--;
  }
}

// ===================== init(sockfd, ...) 外部初始化 =====================
void http_conn::init(int sockfd, const sockaddr_in &addr, std::string root,
                     int trig_mode, int close_log, std::string sql_user,
                     std::string sql_passwd, std::string sql_db) {
  m_sockfd = sockfd;
  m_address = addr;

  setnonblocking(m_sockfd);
  m_user_count++;

  doc_root = root;
  m_TRIGMode = trig_mode;
  m_close_log = close_log;

  this->sql_user = sql_user;
  this->sql_passwd = sql_passwd;
  this->sql_name = sql_db;

  init();
}

// ===================== init() 内部状态重置 =====================
void http_conn::init() {
  mysql = NULL;
  bytes_to_send = 0;
  bytes_have_send = 0;
  m_check_state = CHECK_STATE_REQUESTLINE;
  m_linger = false;
  m_method = GET;
  m_url.clear();
  m_version.clear();
  m_content_length = 0;
  m_host.clear();
  m_start_line = 0;
  m_checked_idx = 0;
  m_read_idx = 0;
  m_write_idx = 0;
  cgi = 0;
  m_state = 0;
  timer_flag = 0;
  improv = 0;

  memset(m_read_buf, '\0', READ_BUFFER_SIZE);
  memset(m_write_buf, '\0', WRITE_BUFFER_SIZE);
  m_real_file.clear();
}

// ===================== initmysql_result 委托给 UserCache =====================
void http_conn::initmysql_result(connection_pool *connPool) {
  UserCache::getInstance()->load_all_users(connPool);
}

// ===================== 只读Getter实现 =====================
int http_conn::get_sockfd() const { return m_sockfd; }
int http_conn::get_state() const { return m_state; }
std::string http_conn::get_url() const { return m_url; }
std::string http_conn::get_doc_root() const { return doc_root; }
long http_conn::get_content_length() const { return m_content_length; }
bool http_conn::is_linger() const { return m_linger; }
http_conn::METHOD http_conn::get_method() const { return m_method; }

```

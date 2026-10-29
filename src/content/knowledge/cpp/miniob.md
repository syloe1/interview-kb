### LRU Cache 类模板

```cpp
#pragma once
#include <stdint.h>
#include <cstddef>
#include <list>
#include <unordered_map>
#include <mutex>
/*
普通类：类的类型是固定死的；
**类模板：类是一个 “模板图纸”，编译时传入不同类型，编译器帮你生成不同的真实类。**
*/
namespace oceanbase {

template <typename KeyType, typename ValueType>
class ObLRUCache
{
public:
  ObLRUCache(size_t capacity) : capacity_(capacity) {}

  bool get(const KeyType &key, ValueType &value)
  {
    std::lock_guard<std::mutex> lock(mutex_);
    auto                        it = map_.find(key);
    if (it == map_.end()) {
      return false;
    }
    /*
    > **把 `it->second` 指向的那个链表节点，剪下来，移动到 `list_.begin()` 这个位置。全程不拷贝对象，只修改链表指针。**

`std::list` 的 splice 是它的独门函数，**只转移节点，不构造、不析构、不拷贝 pair**，LRU 性能靠它。
// void splice( 目标位置, 源链表, 要移动的节点迭代器 )
void splice(iterator pos, list& other, iterator elem);

    */
    list_.splice(list_.begin(), list_, it->second);
    /*
    it                // map 的迭代器，指向 map里的一个 <key, list迭代器>
it->second        // 拿到【list的迭代器】，指向list里面的 pair<Key,Value>节点
it->second->first // list节点里面pair的first：缓存key
it->second->second// list节点里面pair的second：缓存value！！

    */
    value = it->second->second;
    return true;
  }

  void put(const KeyType &key, const ValueType &value)
  {
    std::lock_guard<std::mutex> lock(mutex_);
    auto                        it = map_.find(key);
    if (it != map_.end()) {
      it->second->second = value;
      list_.splice(list_.begin(), list_, it->second);
      return;
    }
    /*
    1. 在链表头部新建节点（标记为最近使用）
    2. 在哈希表 map 里记录：key → 这个新节点的 list 迭代器
    3. 如果现在总数量超容量了，淘汰链表最尾部那个最久没使用的节点
    */
    // emplace眼底构造， push是先构造临时对象，在拷贝
    list_.emplace_front(key, value);
    map_[key] = list_.begin();
    if (map_.size() > capacity_) {
      auto last = list_.back();
      map_.erase(last.first);
      list_.pop_back();
    }
  }

  bool contains(const KeyType &key) const
  {
    std::lock_guard<std::mutex> lock(mutex_);
    return map_.find(key) != map_.end();
  }

private:
  size_t                                                                                   capacity_;
  mutable std::mutex                                                                       mutex_;
  std::list<std::pair<KeyType, ValueType>>                                                 list_;
  std::unordered_map<KeyType, typename std::list<std::pair<KeyType, ValueType>>::iterator> map_;
};

template <typename Key, typename Value>
ObLRUCache<Key, Value> *new_lru_cache(uint32_t capacity)
{
  return new ObLRUCache<Key, Value>(capacity);
}
}
```

### ObFileWriter 文件写入工具类

> 封装 ofstream，统一返回 RC 错误码，支持覆盖 / 追加写文件，静态工厂创建对象

```cpp
#pragma once
#include "common/lang/fstream.h"
#include "common/lang/string.h"
#include "common/lang/string_view.h"
#include "common/lang/memory.h"
#include "common/sys/rc.h"
namespace oceanbase {

class ObFileWriter
{
public:
  ObFileWriter(const string &filename, bool append = false) : filename_(filename), append_(append) {}
  ~ObFileWriter();
  RC open_file();
  void close_file();
  RC write(const string_view &data);
  RC flush();
  bool is_open() const { return file_.is_open(); }
  string file_name() const { return filename_; }
  static unique_ptr<ObFileWriter> create_file_writer(const string &filename, bool append);
private:
  string filename_;
  bool append_;
  ofstream file_;
};
}
namespace oceanbase {

// 析构函数：对象销毁的时候自动调用close_file，防止句柄泄漏
ObFileWriter::~ObFileWriter() { close_file(); }

// 把 data 写入文件
RC ObFileWriter::write(const string_view &data)
{
  RC rc = RC::SUCCESS;
  // << 是ofstream输出运算符，把data里的字符写入文件流缓冲区
  file_ << data;
  // good()：流状态正常返回true；发生写失败、磁盘满、IO错误就变成false
  if (!file_.good()) {
    rc = RC::IOERR_WRITE;
  }
  return rc;
}

// 把缓冲区数据强制刷到操作系统
RC ObFileWriter::flush()
{
  RC rc = RC::SUCCESS;
  // 刷新C++流的内部缓冲区，把缓冲区数据交给OS页缓存
  // 注意：不等于磁盘持久化！只是刷C++ std::ofstream自己的buffer
  file_.flush();
  if (!file_.good()) {
    rc = RC::IOERR_SYNC;
  }
  return rc;
}

// 打开文件，根据append_选择打开模式
RC ObFileWriter::open_file()
{
  RC rc = RC::SUCCESS;
  // 如果已经打开了，直接返回成功，避免重复打开同一个流
  if (file_.is_open()) {
    return rc;
  }
  if (append_) {
    // std::ios::app 追加模式：每次写都写到文件末尾，不会覆盖原有内容
    // std::ios::binary 二进制模式，Windows下很关键：不会自动把 \n <-> \r\n 换行转换
    file_.open(filename_, std::ios::app | std::ios::binary);
  } else {
    // std::ios::out     打开用于输出（写文件）
    // std::ios::trunc   打开时截断文件：如果文件已存在，直接清空里面全部内容
    // std::ios::binary  二进制模式
    // | 是按位或，多个打开标志叠加在一起
    file_.open(filename_, std::ios::out | std::ios::trunc | std::ios::binary);
  }
  // 打开之后检查流状态，打不开（权限、路径不存在）就标记打开错误
  if (!file_.good()) {
    rc = RC::IOERR_OPEN;
  }
  return rc;
}

// 关闭文件
void ObFileWriter::close_file()
{
  // 只有文件当前是打开状态才执行
  if (file_.is_open()) {
    // 关闭前先flush，保证流缓冲区数据全部推给OS，避免丢数据
    file_.flush();
    // 关闭文件流，释放操作系统的文件句柄
    file_.close();
  }
}

// 静态工厂函数：创建ObFileWriter对象 + 直接打开文件
unique_ptr<ObFileWriter> ObFileWriter::create_file_writer(const string &filename, bool append)
{
  // 构造对象，unique_ptr自动管理内存，不用手动delete
  unique_ptr<ObFileWriter> writer(new ObFileWriter(filename, append));
  // 工厂里面直接调用open_file，打开失败直接返回空指针
  // 调用方拿到 nullptr 就知道打开文件失败了
  if (writer->open_file() != RC::SUCCESS) {
    return nullptr;
  }
  return writer;
}

}  // namespace oceanbase

```

### ObFileReader 文件读工具类

>

```cpp
#pragma once
#include "common/lang/fstream.h"
#include "common/lang/memory.h"
#include "common/lang/sstream.h"
#include "common/lang/string.h"
#include "common/sys/rc.h"
#include "common/lang/mutex.h"
namespace oceanbase {

class ObFileReader
{
public:
  ObFileReader(const string &filename) : filename_(filename) {}
  ~ObFileReader();
  RC open_file();
  void close_file();
  string read_pos(uint32_t pos, uint32_t size);
  uint32_t file_size();
  static unique_ptr<ObFileReader> create_file_reader(const string &filename);
private:
  string filename_;
  int fd_ = -1;
};
}
namespace oceanbase {

// 析构：对象销毁自动关闭文件，防止文件描述符泄漏
ObFileReader::~ObFileReader() { close_file(); }

/**
 * @brief 从文件指定偏移pos处读取size个字节
 * @param pos 文件起始偏移位置
 * @param size 需要读取的字节数
 * @return 读到的数据字符串；读取失败返回空串
 */
string ObFileReader::read_pos(uint32_t pos, uint32_t size)
{
  string buf;
  // 预先分配好内存空间，存放读取出来的数据
  buf.resize(size);
  /*
  pread：linux posix系统调用
  参数：fd 文件描述符，buf缓冲区，读取长度，文件偏移
  特点：读取的时候不会改变文件当前读写指针，多线程并发读很友好
  :: 代表调用全局的系统pread，不是类内函数
  */
  ssize_t read_size = ::pread(fd_, buf.data(), size, static_cast<off_t>(pos));
  // 读到的字节数和预期不一致（读到末尾、出错），打警告日志返回空
  if (read_size != size) {
    LOG_WARN("Failed to read file %s, read_size=%ld, size=%ld", filename_.c_str(), read_size, size);
    return "";
  }
  return buf;
}

// 获取文件总大小（字节）
uint32_t ObFileReader::file_size()
{
  return filesystem::file_size(filename_);
}

// 静态工厂方法：创建ObFileReader，并且自动打开文件
unique_ptr<ObFileReader> ObFileReader::create_file_reader(const string &filename)
{
  // unique_ptr 自动管理对象，出作用域自动释放，避免内存泄漏
  unique_ptr<ObFileReader> reader(new ObFileReader(filename));
  // 尝试打开文件，打开失败打日志返回nullptr
  if (OB_FAIL(reader->open_file())) {
    LOG_WARN("Failed to open file %s", filename.c_str());
    return nullptr;
  }
  return reader;
}

// 打开文件，只读模式
RC ObFileReader::open_file()
{
  RC rc = RC::SUCCESS;
  /*
  ::open posix系统调用
  O_RDONLY：只读打开
  返回值fd：>=0 合法文件描述符；-1代表打开失败（路径不存在、权限不足）
  */
  fd_ = ::open(filename_.c_str(), O_RDONLY);
  if (fd_ < 0) {
    LOG_WARN("Failed to open file %s", filename_.c_str());
    rc = RC::INTERNAL;
  }
  return rc;
}

// 关闭文件，释放操作系统的文件描述符fd
void ObFileReader::close_file()
{
  ::close(fd_);
}

}

```

### ObComparator LSM的key排序组件

> `compare(x,y)` 返回负数：**x 排在 y 的前面**
> user key相同时， seq大的放前面

```cpp
#pragma once
#include "common/lang/string_view.h"
namespace oceanbase {

/**
 * @brief 比较器抽象基类，所有key比较器的统一接口
 * 采用三路比较约定：返回负数、0、正数区分大小关系
 */
class ObComparator
{
public:
  // 虚析构，保证派生类析构时能正确释放
  virtual ~ObComparator() = default;
  /**
   * @brief 三路比较函数，纯虚函数，子类必须实现
   * @param a 待比较key1
   * @param b 待比较key2
   * @return <0  a < b
   *         =0  a == b
   *         >0  a > b
   */
  virtual int compare(const string_view &a, const string_view &b) const = 0;
};

/**
 * @brief 默认比较器：字典序（lex）比较器，直接按字节逐字节对比
 */
class ObDefaultComparator : public ObComparator
{
public:
  explicit ObDefaultComparator() = default;
  // 实现基类的compare接口，字节字典序比较
  int compare(const string_view &a, const string_view &b) const override;
};

/**
 * @brief LSM内部key比较器，用于比较InternalKey
 * InternalKey结构： | key_size(8B) | user_key | sequence_number(8B) |
 * 比较规则：先比较user_key；user_key相同，序列号大的排在前面
 */
class ObInternalKeyComparator : public ObComparator
{
public:
  explicit ObInternalKeyComparator() = default;
  // 实现InternalKey的比较逻辑
  int compare(const string_view &a, const string_view &b) const override;
  // 获取底层用户key的比较器
  // 子类对象的地址，可以隐式转成父类（ObComparator）的指针。
  const ObComparator *user_comparator() const { return &default_comparator_; }
private:
  // 底层依赖默认字典序比较器比较用户key
  ObDefaultComparator default_comparator_;
};

}
namespace oceanbase {

// 默认比较器：直接调用string_view内置compare，按字节字典序比较
int ObDefaultComparator::compare(const string_view &a, const string_view &b) const
{
  return a.compare(b);
}

/**
 * @brief InternalKey 比较逻辑（LSM内部key）
 * InternalKey 结构： user_key + sequence_number(8字节)
 * 比较规则：
 * 1. 先比较用户key；
 * 2. 用户key相同，序列号大的排在前面（新版本优先）
 */
int ObInternalKeyComparator::compare(const string_view &a, const string_view &b) const
{
  // 从完整internal key里剥离出user_key
  const string_view akey = extract_user_key(a);
  const string_view bkey = extract_user_key(b);

  // 使用用户比较器对比user key
  int r = default_comparator_.compare(akey, bkey);

  // user_key相等，再比较序列号sequence
  if (r == 0) {
    // 从internal key末尾取出8字节的序列号SEQ_SIZE=8
    /*
    - `a.data()`：`string_view` 底层字节数组的起始指针 `const char*`
    - `a.size() - SEQ_SIZE`：往前偏移，定位到**最后 8 字节的起始位置**，这 8 个字节存的就是 sequence
    */
    uint64_t aseq = get_numeric<uint64_t>(akey.data() + a.size() - SEQ_SIZE);
    uint64_t bseq = get_numeric<uint64_t>(bkey.data() + b.size() - SEQ_SIZE);

    // 序列号更大（更新的数据）优先级更高，排在前面
    // 返回 -1 代表 a < b，所以aseq更大时，a要排在前面
    if (aseq > bseq) {
      r = -1;
    } else if (aseq < bseq) {
      r = +1;
    }
    // aseq == bseq 的情况，r保持0
  }
  return r;
}

}

```

### ObCoding

> 专门做**二进制编解码的工具头文件**，整套都是模板 + inline 小函数，无内存分配、高性能。
> 内存只是一块连续的字节数组 char []，我们约定好布局，靠指针偏移 + memcpy 读写，不转文本。

```cpp
#pragma once
#include "common/lang/string.h"
namespace oceanbase {

static const uint8_t SEQ_SIZE            = 8; // sequence number 固定8字节 uint64_t
static const uint8_t LOOKUP_KEY_PREFIX_SIZE = 8; // lookup_key头部固定8字节

//【编码：数字 → 二进制字节，写入 buffer】 marshal
/*
&v：拿到数字变量 v 在内存里的起始地址
reinterpret_cast<char *>：转成字节指针，按单个字节去看这块内存
sizeof(T)：T 占多少字节，比如 uint64_t 就是 8 字节
dst->append(指针, n)：把这 n 个原始字节追加到 string 尾部
*/
template <typename T>
void put_numeric(string *dst, T v)
{
  dst->append(reinterpret_cast<char *>(&v), sizeof(T));
}
// 【解码：二进制字节 → 还原数字】 unmarshal
/*
- src 指向一块二进制内存
- 从 src 拷贝 `sizeof(T)` 字节到 value 的内存
- 返回还原出来的数字
*/
template <typename T>
T get_numeric(const char *src)
{
  T value;
  memcpy(&value, src, sizeof(T));
  return value;
}

inline string_view extract_user_key(const string_view &internal_key)
{
  /*
┌───────────────┬──────────────┐
│   user_key    │  seq(8字节)  │
└───────────────┴──────────────┘
        ↑               ↑
     我们想要的        末尾8B序列号
[ user_key ] [ seq(8B, uint64_t) ]
 - `internal_key.data()`：整块 internal key 的起始指针
- `internal_key.size() - SEQ_SIZE`：总长度减掉末尾 8 字节，剩下就是 user_key 长度
- `string_view(指针, len)`：**零拷贝！** 不复制内存，只是记录起始地址 + 长度
*/
  return string_view(internal_key.data(), internal_key.size() - SEQ_SIZE);
}

inline uint64_t extract_sequence(const string_view &internal_key)
{
  // get_numeric 从 地址 拷贝 64byte字节 8B
  /*
- `internal_key.data()` 起始地址
- `+ internal_key.size() - SEQ_SIZE`：指针向后偏移，跳到末尾 8 字节 seq 的开头
- 调用 get_numeric 读出这 8 字节，还原成 uint64 序列号
  */
  return get_numeric<uint64_t>(internal_key.data() + internal_key.size() - SEQ_SIZE);
}

inline size_t user_key_size_from_lookup_key(const string_view &lookup_key)
{
  /*
┌────────────────────┬────────────┬────────────┐
│ LOOKUP_PREFIX(8B)  │ user_key   │ seq(8B)    │
└────────────────────┴────────────┴────────────┘
LOOKUP_KEY_PREFIX_SIZE=8        SEQ_SIZE=8
*/
  return lookup_key.size() - SEQ_SIZE - LOOKUP_KEY_PREFIX_SIZE;
}

inline string_view extract_user_key_from_lookup_key(const string_view &lookup_key)
{
  return string_view(lookup_key.data() + LOOKUP_KEY_PREFIX_SIZE, user_key_size_from_lookup_key(lookup_key));
}

inline string_view extract_internal_key(const string_view &lookup_key)
{
  // string_view(地址， 长度)
  return string_view(lookup_key.data() + LOOKUP_KEY_PREFIX_SIZE, lookup_key.size() - LOOKUP_KEY_PREFIX_SIZE);
}
//先存字符串的长度，再存字符串内容
inline string_view get_length_prefixed_string(const char *data)
{
  /*
┌──────────────────┬──────────────────────┐
│ size_t len(8B)   │ 字符串原始bytes       │
└──────────────────┴──────────────────────┘
↑data指针指向这里     ↑p指针指向这里
*/
  size_t      len = get_numeric<size_t>(data);
  const char *p   = data + sizeof(size_t);
  return string_view(p, len);
}

}
```

### ObBloomfilter

> 布隆过滤器

```cpp
#pragma once
#include <algorithm>
#include <cstdint>
#include <mutex>
#include <shared_mutex>
#include <vector>
#include "common/lang/string.h"

namespace oceanbase {

/**
 * @brief 布隆过滤器，支持并发读写
 * 特性：存在误判（false positive），不存在漏判（false negative）
 * 判断逻辑：返回true -> 元素可能存在；返回false -> 元素一定不存在
 * 哈希方案：Kirsch-Mitzenmacher 双哈希优化，只用2个基础hash推导出k个哈希位置
 * 同步策略：shared_mutex，读共享锁、写独占锁，提升读多写少场景并发性能
 */
class ObBloomfilter
{
public:
  /**
   * @brief 构造布隆过滤器
   * @param hash_func_count 哈希函数个数k，影响误判率，一般取4~10
   * @param total_bits 位图总bit数量，bit越多，相同元素数量下误判率越低
   */
  ObBloomfilter(size_t hash_func_count = 4, size_t total_bits = 65536);

  /**
   * @brief 向布隆过滤器插入元素
   * @param object 待插入字符串
   * @threadsafe 写操作，独占锁保护
   */
  void insert(const string &object);

  /**
   * @brief 清空布隆过滤器所有标记位，重置计数
   * @threadsafe 写操作，独占锁保护
   */
  void clear();

  /**
   * @brief 查询元素是否【可能】存在
   * @param object 待查询字符串
   * @return true 可能存在；false 一定不存在
   * @threadsafe 读操作，共享锁，可并发读
   */
  bool contains(const string &object) const;

  /**
   * @brief 获取insert调用次数（重复插入会重复计数）
   * @note 不能代表去重元素个数：布隆过滤器无法判断元素是否已经插入过
   */
  size_t object_count() const;

  /// @brief 判断过滤器是否从未插入过元素
  bool empty() const { return 0 == object_count(); }

private:
  /**
   * @brief 计算第i个哈希对应的bit下标
   * 公式：h_i = (hash1 + i * hash2) % total_bits_
   * Kirsch-Mitzenmacher：只算两次基础hash，避免多次调用hash函数的开销
   */
  size_t hash(const string &object, size_t i) const;

  size_t                     hash_func_count_;  ///< 哈希函数数量 k
  size_t                     total_bits_;       ///< 位图总bit数
  size_t                     object_count_;     ///< insert调用计数，重复插入累加
  std::vector<unsigned char> bits_;             ///< 底层bit数组，1字节存8个bit
  mutable std::shared_mutex  mutex_;            ///< 读写锁：mutable允许const函数加锁
};

/**
 * @brief 构造函数
 * 向上取整分配字节：(总bit +7)/8 ，保证容纳全部bit
 * inline：头文件内实现，避免多文件include造成链接重复定义
 */
inline ObBloomfilter::ObBloomfilter(size_t hash_func_count, size_t total_bits)
    : hash_func_count_(hash_func_count), total_bits_(total_bits), object_count_(0)
{
  if (total_bits_ > 0) {
    /*
  - `reserve`：**只预分配容量，不创建元素，vector 的 size 不变**
  - `resize`：**修改 vector 的 size，真正创建 / 初始化元素**
  */
    bits_.resize((total_bits_ + 7) / 8, 0);
  }
}

/**
 * @brief 插入元素流程：
 * 1. 加独占锁，互斥写
 * 2. 算出hash1/hash2，循环k次得到bit位置
 * 3. 对应bit置1
 * 4. 插入计数+1（重复插入也+1）
 */
inline void ObBloomfilter::insert(const string &object)
{
  std::unique_lock<std::shared_mutex> lock(mutex_);
  // 边界：无bit位或者无哈希函数，直接返回
  if (total_bits_ == 0 || hash_func_count_ == 0) {
    return;
  }
  // 双哈希优化
  uint64_t hash_val = std::hash<string>{}(object);
  uint32_t hash1    = static_cast<uint32_t>(hash_val & 0xFFFFFFFF);  // 低32位
  uint32_t hash2    = static_cast<uint32_t>(hash_val >> 32);         // 高32位

  for (size_t i = 0; i < hash_func_count_; i++) {
    // hi = (h1 + i * h2 ) % m
    size_t pos = (hash1 + i * hash2) % total_bits_;
    // pos /8 → 找到数组下标；pos%8 → 在当前字节内的bit偏移
    // `pos / 8`：算出这个 bit 落在第几个字节（数组下标）
    //`pos % 8`：这个 bit 在当前字节内部是第几位（0~7）
    bits_[pos / 8] |= static_cast<unsigned char>(1u << (pos % 8));
  }
  object_count_++;
}

/**
 * @brief 清空：所有bit置0，计数清零
 */
inline void ObBloomfilter::clear()
{
  std::unique_lock<std::shared_mutex> lock(mutex_);
  std::fill(bits_.begin(), bits_.end(), 0);
  object_count_ = 0;
}

/**
 * @brief 查询流程：
 * 1. 加共享锁，支持并发读
 * 2. 依次检查k个bit位，全部为1才返回true
 * 3. 任意一个bit是0 → 元素一定不存在，直接return false
 */
inline bool ObBloomfilter::contains(const string &object) const
{
  std::shared_lock<std::shared_mutex> lock(mutex_);
  if (total_bits_ == 0 || hash_func_count_ == 0) {
    return false;
  }
  uint64_t hash_val = std::hash<string>{}(object);
  uint32_t hash1    = static_cast<uint32_t>(hash_val & 0xFFFFFFFF);
  uint32_t hash2    = static_cast<uint32_t>(hash_val >> 32);

  for (size_t i = 0; i < hash_func_count_; i++) {
    size_t pos = (hash1 + i * hash2) % total_bits_;
    // 该bit没有被置1 → 肯定不在集合里
    if (!(bits_[pos / 8] & (1u << (pos % 8)))) {
      return false;
    }
  }
  return true;
}

/**
 * @brief 获取插入次数，共享锁读取，保证内存可见性
 */
inline size_t ObBloomfilter::object_count() const
{
  std::shared_lock<std::shared_mutex> lock(mutex_);
  return object_count_;
}

}  // namespace oceanbase

```

### 单测unittest/oblsm/ob_bloomfilter_test.cpp

```cpp
/* Copyright (c) 2021 OceanBase and/or its affiliates. All rights reserved.
miniob is licensed under Mulan PSL v2.
You can use this software according to the terms and conditions of the Mulan PSL v2.
You may obtain a copy of Mulan PSL v2 at:
         http://license.coscl.org.cn/MulanPSL2
THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND,
EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT,
MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
See the Mulan PSL v2 for more details. */

#include "gtest/gtest.h"

#include <thread>
#include "oblsm/util/ob_bloomfilter.h"

using namespace oceanbase;

TEST(BloomfilterTest, ConstructorTest) {
    ObBloomfilter bf(4);
    EXPECT_TRUE(bf.empty());
    EXPECT_EQ(bf.object_count(), 0);
}

TEST(BloomfilterTest, InsertAndContainsTest) {
    ObBloomfilter bf(4);

    bf.insert("database");
    bf.insert("db");

    EXPECT_TRUE(bf.contains("database"));
    EXPECT_TRUE(bf.contains("db"));
    EXPECT_FALSE(bf.contains("oceanbase"));

    EXPECT_EQ(bf.object_count(), 2);
}

TEST(BloomfilterTest, ClearTest) {
    ObBloomfilter bf(4);

    bf.insert("bloom");
    bf.insert("filter");
    bf.clear();

    EXPECT_FALSE(bf.contains("bloom"));
    EXPECT_FALSE(bf.contains("filter"));
    EXPECT_TRUE(bf.empty());
    EXPECT_EQ(bf.object_count(), 0);
}

TEST(BloomfilterTest, EmptyTest) {
    ObBloomfilter bf(4);

    EXPECT_TRUE(bf.empty());

    bf.insert("ob");
    EXPECT_FALSE(bf.empty());

    bf.clear();
    EXPECT_TRUE(bf.empty());
}

TEST(BloomFilterTest, MultiThreadInsertTest) {
    ObBloomfilter bloom_filter;
    const size_t thread_count = 10;
    const size_t insertions_per_thread = 1000;

    auto insert_function = [&bloom_filter](size_t id) {
        for (size_t i = 0; i < insertions_per_thread; ++i) {
            bloom_filter.insert("item_" + std::to_string(id) + "_" + std::to_string(i));
        }
    };

    std::vector<std::thread> threads;
    for (size_t i = 0; i < thread_count; ++i) {
        threads.emplace_back(insert_function, i);
    }

    for (auto& thread : threads) {
        thread.join();
    }

    EXPECT_EQ(bloom_filter.object_count(), thread_count * insertions_per_thread);

    EXPECT_TRUE(bloom_filter.contains("item_1_500"));
    EXPECT_FALSE(bloom_filter.contains("non_existent_item"));
}

int main(int argc, char **argv)
{
  ::testing::InitGoogleTest(&argc, argv);
  return RUN_ALL_TESTS();
}
```

### defs.h

> X 宏，用来**消除重复样板代码**。C 预处理器（preprocessor）的文本替换把戏
> **是预编译阶段文本展开**， `#define`、`#include`、`#ifdef` 全是预处理器干的活；
> 预处理器跑完之后，宏就全部消失了，剩下纯 C++ 代码交给编译器。

```cpp
/* Copyright (c) 2021 OceanBase and/or its affiliates. All rights reserved.
miniob is licensed under Mulan PSL v2.
You can use this software according to the terms and conditions of the Mulan PSL v2.
You may obtain a copy of Mulan PSL v2 at:
        http://license.coscl.org.cn/MulanPSL2
THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND,
EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT,
MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
See the Mulan PSL v2 for more details. */
//
// Created by Ping Xu(haibarapink@gmail.com)
//
#include "common/lang/string_view.h"
namespace oceanbase {
/**
 * @brief add a new command format: DEFINE_OBLSM_CLI_CMD(command's code, command's name, command's usage)
 */
#define DEFINE_OBLSM_CLI_CMDS                                                                                          \
  DEFINE_OBLSM_CLI_CMD(                                                                                                \
      OPEN, "open", "Usage: open \"DATABASE_NAME\"\nOpens a database. If the database does not exist, it is created.") \
  DEFINE_OBLSM_CLI_CMD(CLOSE, "close", "Usage: close\nCloses the currently opened database.")                          \
  DEFINE_OBLSM_CLI_CMD(SET, "set", "Usage: set \"KEY\" \"VALUE\"\nSets the value for the given key.")                  \
  DEFINE_OBLSM_CLI_CMD(GET, "get", "Usage: get \"KEY\"\nGets the value associated with the given key.")                \
  DEFINE_OBLSM_CLI_CMD(DELETE, "delete", "Usage: delete \"KEY\"\nDeletes the given key.")                              \
  DEFINE_OBLSM_CLI_CMD(SCAN,                                                                                           \
      "scan",                                                                                                          \
      "Usage: scan \"KEY1\" \"KEY2\"\n"                                                                                \
      "Scans the database for keys within the specified range.\n"                                                      \
      "The first and second keys can be specified in the following ways:\n"                                            \
      "- 'scan - \"KEY\"' scans from the first key in the database up to the specified key \"KEY\".\n"                 \
      "- 'scan \"KEY\" -' scans from the specified key \"KEY\" to the last key in the database.\n"                     \
      "- 'scan - -' scans the entire database from the first key to the last key.\n"                                   \
      "- 'scan \"KEY1\" \"KEY2\"' scans from the key \"KEY1\" to the key \"KEY2\".\n")                                 \
  DEFINE_OBLSM_CLI_CMD(HELP, "help", "")                                                                               \
  DEFINE_OBLSM_CLI_CMD(EXIT, "exit", "Usage: exit\nExits the application.")
// 生成 enum class ObLsmCliCmdType
enum class ObLsmCliCmdType
{
// `#define DEFINE_OBLSM_CLI_CMD(cmd, str, help) cmd,`现在把 X 宏模板定义成：输出 `cmd,`
#define DEFINE_OBLSM_CLI_CMD(cmd, str, help) cmd,
  DEFINE_OBLSM_CLI_CMDS
#undef DEFINE_OBLSM_CLI_CMD
};
struct ObLsmCliUtil
{
  // strcmd 函数，枚举 → 命令名字符串
  inline static const string_view strcmd(ObLsmCliCmdType command)
  {
#define DEFINE_OBLSM_CLI_CMD(cmd, name, help) \
  case ObLsmCliCmdType::cmd: {                \
    return name;                              \
  } break;
    switch (command) {
      DEFINE_OBLSM_CLI_CMDS;
      default: {
        return "unknown";
      }
    }
#undef DEFINE_OBLSM_CLI_CMD
  }
  // cmd_usage 函数，枚举 → 帮助文本
  inline static const string_view cmd_usage(ObLsmCliCmdType command)
  {
#define DEFINE_OBLSM_CLI_CMD(cmd, name, help) \
  case ObLsmCliCmdType::cmd: {                \
    return help;                              \
  } break;
    switch (command) {
      DEFINE_OBLSM_CLI_CMDS;
      default: {
        return "Unknown command usage.";
      }
    }
#undef DEFINE_OBLSM_CLI_CMD
  }
};
}  // namespace oceanbase

```

### parse.h

> 词法， 语法解析器

```cpp
/* Copyright (c) 2021 OceanBase and/or its affiliates. All rights reserved.
miniob is licensed under Mulan PSL v2.
You can use this software according to the terms and conditions of the Mulan PSL v2.
You may obtain a copy of Mulan PSL v2 at:
        http://license.coscl.org.cn/MulanPSL2
THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND,
EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT,
MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
See the Mulan PSL v2 for more details. */
//
// Created by Ping Xu(haibarapink@gmail.com)
//
#pragma once
#include <cstdlib>
#include <iostream>
#include <fstream>
#include <map>
#include <ctime>
#include "common/sys/rc.h"
#include "common/lang/string.h"
#include "common/lang/string_view.h"
#include "oblsm/client/cliutil/defs.h"
#define MAX_MEM_BUFFER_SIZE 8192  // 内存缓冲区最大大小
namespace oceanbase {
inline const string LINE_HISTORY_FILE = "./.oblsm_cli.history";  // 命令行历史记录保存文件路径

/**
 * @brief Token令牌类型，词法分析切分出来的最小单元
 */
enum class TokenType
{
  COMMAND,  // 顶层命令：open / set / get / delete / scan / help / exit
  STRING,   // 字符串参数，双引号包裹的key、value
  BOUND,    // scan专用边界标记 '-'，代表负无穷/正无穷
  INVALID   // 非法令牌，解析出错
};

/**
 * @brief 词法分词器（Tokenizer）
 * 职责：接收一行输入字符串，逐个切割出Token（命令、字符串、边界符）
 */
class ObLsmCliCmdTokenizer
{
public:
  TokenType       token_type;  // 当前读到的token类型
  ObLsmCliCmdType cmd;         // 如果token是COMMAND，存放对应的命令枚举
  string          str;         // 当前token的文本内容（参数、边界符号文本）

  /**
   * @brief 构造函数：构建【命令字符串 → 命令枚举】映射表
   * 例如 "open" -> ObLsmCliCmdType::OPEN
   */
  ObLsmCliCmdTokenizer()
  {
    /*
1. `ObLsmCliUtil::strcmd(ObLsmCliCmdType::OPEN)`
就是之前学的工具函数，输入枚举 `OPEN`，返回字符串 `"open"`
2. `string{...}` 把拿到的 string_view 转成 string，作为 map 的 key
3. `token_map_["open"] = ObLsmCliCmdType::OPEN;`
  */
    //**小 X 宏，用来批量往 map 里面塞键值对**，
    // 构造函数里面，程序运行时
#define MAP_COMMAND(cmd) token_map_[string{ObLsmCliUtil::strcmd(ObLsmCliCmdType::cmd)}] = ObLsmCliCmdType::cmd
    MAP_COMMAND(OPEN);
    MAP_COMMAND(CLOSE);
    MAP_COMMAND(SET);
    MAP_COMMAND(DELETE);
    MAP_COMMAND(SCAN);
    MAP_COMMAND(HELP);
    MAP_COMMAND(EXIT);
    MAP_COMMAND(GET);
#undef MAP_COMMAND
  }

  /**
   * @brief 初始化分词器，绑定待解析的一行命令，重置游标
   * @param command 一行原始输入，如 set "k1" "v1"
   */
  void init(string_view command)
  {
    command_ = command;
    p_       = 0;
  }

  /**
   * @brief 读取下一个Token，核心分词函数
   * 每次调用向前走一个token，填充 token_type / cmd / str
   * @return RC 成功或者错误码
   */
  RC next();

private:
  /**
   * @brief 判断游标是否已经走到输入末尾，全部解析完成
   */
  bool out_of_range() { return p_ >= command_.size(); }

  /**
   * @brief 跳过空白字符：空格、tab，分词前必备
   */
  void skip_blank_space();

  /**
   * @brief 解析双引号包裹的字符串，提取key/value
   * @param res 输出解析出来的字符串
   */
  RC parse_string(string &res);

  std::map<string, ObLsmCliCmdType> token_map_;  // 命令名字符串 -> 命令枚举 的哈希映射
  string_view                       command_;    // 原始待解析的一行命令文本
  size_t                            p_;          // 当前解析游标（下标指针）
};

/**
 * @brief 语法解析器 Parser
 * 依赖Tokenizer拿到一串token，做语法校验、参数规整，输出结构化结果给上层REPL主循环
 */
class ObLsmCliCmdParser
{
public:
  /**
   * @brief 解析结果结构体，REPL主循环直接读取这个结构执行命令
   */
  struct Result
  {
    ObLsmCliCmdType cmd;                         // 识别到的命令枚举
    string          error;                       // 错误信息，非空代表语法解析失败
    string          args[2];                     // 最多两个字符串参数，适配所有命令
    bool            bounds[2] = {false, false};  // 标记两个参数位置是否是边界符'-'（scan专用）
  };
  Result result;

  /**
   * @brief 对外解析入口
   * @param command 用户输入的一行完整命令
   * @return RC 解析成功/失败
   */
  RC parse(string_view command);

private:
  ObLsmCliCmdTokenizer tokenizer_;  // 内部持有的分词器实例
};
}  // namespace oceanbase
/* Copyright (c) 2021 OceanBase and/or its affiliates. All rights reserved.
miniob is licensed under Mulan PSL v2.
You can use this software according to the terms and conditions of the Mulan PSL v2.
You may obtain a copy of Mulan PSL v2 at:
        http://license.coscl.org.cn/MulanPSL2
THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND,
EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT,
MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
See the Mulan PSL v2 for more details. */

/**
 * @file parser.cpp
 * @brief ObLsm 交互式CLI命令词法Tokenizer + 语法Parser实现
 * @details 负责把用户输入的一行命令字符串，拆成Token，并按照固定命令语法解析成命令结果结构
 * 支持命令：OPEN / SET / GET / DELETE / SCAN / HELP / EXIT / CLOSE
 * Token类型：COMMAND(命令字)、STRING(带双引号字符串)、BOUND(-边界标记)、INVALID(非法token)
 */
#include "oblsm/client/cliutil/parser.h"
#include "common/lang/string.h"
#include "common/log/log.h"
#include "common/sys/rc.h"

namespace oceanbase {

/**
 * @brief 跳过空白字符（空格、tab、换行等），移动游标p_
 */
void ObLsmCliCmdTokenizer::skip_blank_space()
{
  while (!out_of_range() && std::isspace(command_[p_])) {
    p_++;
  }
}

/**
 * @brief 解析双引号包裹的字符串，支持转义 \"
 * @param res 输出解析后的字符串
 * @return RC::SUCCESS 成功；RC::UNEXPECTED_END_OF_STRING 字符串未闭合，提前到末尾
 * @note 调用前p_已经指向开头的"，函数内部读到闭合"为止
 */
RC ObLsmCliCmdTokenizer::parse_string(string &res)
{
  while (!out_of_range() && command_[p_] != '"') {
    char ch = command_[p_++];
    // 处理转义：\" 解析成一个双引号
    if (ch == '\\' && !out_of_range() && command_[p_] == '"') {
      res.push_back('"');
      p_++;
    } else {
      res.push_back(ch);
    }
  }
  // 循环退出但没找到闭合引号，输入提前结束
  if (out_of_range()) {
    return RC::UNEXPECTED_END_OF_STRING;
  }
  p_++;  // 跳过闭合的 "
  return RC::SUCCESS;
}

/**
 * @brief 获取下一个Token，主词法扫描函数
 * @return RC 错误码：INPUT_EOF到达末尾，INVALID_TOKEN非法命令字
 * @details 优先级：空白跳过 -> -识别为BOUND标记 -> "识别为STRING -> 其余连续字符识别为COMMAND命令字
 */
RC ObLsmCliCmdTokenizer::next()
{
  RC     rc = RC::SUCCESS;
  string current;
  skip_blank_space();

  // 游标已经到输入末尾
  if (out_of_range()) {
    return RC::INPUT_EOF;
  }

  // 识别边界标记 '-'，用于SCAN命令（表示无边界）
  if (command_.at(p_) == '-') {
    token_type = TokenType::BOUND;
    p_++;
    return rc;
  }

  // 识别双引号字符串
  bool is_str = command_.at(p_) == '\"';
  if (is_str) {
    token_type = TokenType::STRING;
    p_++;  // 跳过开头 "
    rc  = parse_string(current);
    str = std::move(current);
    // 解析字符串失败，标记token非法
    if (rc != RC::SUCCESS) {
      token_type = TokenType::INVALID;
    }
    return rc;
  }

  // 识别命令字（连续非空白、非"字符）
  token_type = TokenType::COMMAND;
  while (!out_of_range()) {
    char ch = command_.at(p_++);
    // 遇到空白或者引号，命令字截断
    if (std::isspace(ch) || ch == '\"') {
      break;
    }
    current.push_back(ch);
  }
  // 在token映射表查找命令字，不存在则非法
  auto iter = token_map_.find(current);
  if (iter == token_map_.end()) {
    token_type = TokenType::INVALID;
    return RC::INVALID_TOKEN;
  }
  cmd = iter->second;
  return rc;
}

/**
 * @brief 语法解析入口，一行完整命令解析
 * @param command 用户输入的单行命令字符串
 * @return RC 语法错误/成功
 * @details 流程：初始化tokenizer -> 读取第一个token必须是COMMAND -> 根据命令类型读取后续参数
 */
RC ObLsmCliCmdParser::parse(string_view command)
{
  tokenizer_.init(command);
  RC rc = tokenizer_.next();
  if (OB_FAIL(rc)) {
    return rc;
  }
  // 第一条token必须是命令字，否则语法错误
  if (tokenizer_.token_type != TokenType::COMMAND) {
    return RC::SYNTAX_ERROR;
  }
  result.cmd = tokenizer_.cmd;

  // 按不同命令的语法规约读取参数
  switch (tokenizer_.cmd) {
    // OPEN "dbname" 打开lsm实例，1个字符串参数
    case ObLsmCliCmdType::OPEN:
      rc = tokenizer_.next();
      if (OB_FAIL(rc) || tokenizer_.token_type != TokenType::STRING) {
        result.error = ObLsmCliUtil::cmd_usage(ObLsmCliCmdType::OPEN);
        return RC::SYNTAX_ERROR;
      }
      result.args[0] = tokenizer_.str;
      break;

    // SET "key" "value" 写入kv，2个字符串参数
    case ObLsmCliCmdType::SET:
      for (size_t i = 0; i < 2; ++i) {
        rc = tokenizer_.next();
        if (OB_FAIL(rc) || tokenizer_.token_type != TokenType::STRING) {
          result.error = ObLsmCliUtil::cmd_usage(ObLsmCliCmdType::SET);
          return RC::SYNTAX_ERROR;
        }
        result.args[i] = std::move(tokenizer_.str);
      }
      break;

    // GET "key" 查询key，1个字符串参数
    case ObLsmCliCmdType::GET:
      rc = tokenizer_.next();
      if (OB_FAIL(rc) || tokenizer_.token_type != TokenType::STRING) {
        result.error = ObLsmCliUtil::cmd_usage(ObLsmCliCmdType::GET);
        return RC::SYNTAX_ERROR;
      }
      result.args[0] = tokenizer_.str;
      break;

    // DELETE "key" 删除key，1个字符串参数
    case ObLsmCliCmdType::DELETE:
      rc = tokenizer_.next();
      if (OB_FAIL(rc) || tokenizer_.token_type != TokenType::STRING) {
        result.error = ObLsmCliUtil::cmd_usage(ObLsmCliCmdType::DELETE);
        return RC::SYNTAX_ERROR;
      }
      result.args[0] = tokenizer_.str;
      break;

    // SCAN [ - | "start" ] [ - | "end" ] 范围扫描，左右边界可以是'-'代表无边界
    case ObLsmCliCmdType::SCAN:
      for (size_t i = 0; i < 2; ++i) {
        rc = tokenizer_.next();
        if (OB_FAIL(rc)) {
          result.error = ObLsmCliUtil::cmd_usage(ObLsmCliCmdType::SCAN);
          return RC::SYNTAX_ERROR;
        }
        if (tokenizer_.token_type == TokenType::BOUND) {
          result.bounds[i] = true;
        } else if (tokenizer_.token_type == TokenType::STRING) {
          result.args[i] = std::move(tokenizer_.str);
        } else {
          result.error = ObLsmCliUtil::cmd_usage(ObLsmCliCmdType::SCAN);
          return RC::SYNTAX_ERROR;
        }
      }
      break;

    // 无参命令 HELP / EXIT / CLOSE，不需要读取参数
    case ObLsmCliCmdType::HELP:
    case ObLsmCliCmdType::EXIT:
    case ObLsmCliCmdType::CLOSE: break;

    default: ASSERT(false, "unimplement!"); break;
  }
  return rc;
}

}  // namespace oceanbase

```

### ObUserIterator

```cpp
/* Copyright (c) 2021 OceanBase and/or its affiliates. All rights reserved.
miniob is licensed under Mulan PSL v2.
You can use this software according to the terms and conditions of the Mulan PSL v2.
You may obtain a copy of Mulan PSL v2 at:
        http://license.coscl.org.cn/MulanPSL2
THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND,
EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT,
MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
See the Mulan PSL v2 for more details. */
#pragma once
namespace oceanbase {
class ObComparator;
class ObLsmIterator;
//**包装底层 LSM 迭代器，生成一个带指定快照序列号 (seq) 的用户态迭代器，用来实现 MVCC 多版本快照读**。
ObLsmIterator *new_user_iterator(ObLsmIterator *iterator, uint64_t seq);
}
namespace oceanbase {

/**
 * @class ObUserIterator
 * @brief 用户态迭代器，装饰器包装底层内部迭代器，实现MVCC快照过滤
 * @details 底层iter拿到的是【内部key(user_key + seq)】，包含全部版本、删除墓碑；
 *          ObUserIterator 根据快照seq_过滤，对外只暴露该快照可见的最新有效KV，屏蔽旧版本、墓碑
 */
class ObUserIterator : public ObLsmIterator
{
public:
  /**
   * @param iter 底层原始内部迭代器，存放内部key
   * @param seq  快照序列号，只展示 curr_seq <= seq 的记录
   */
  ObUserIterator(ObLsmIterator *iter, uint64_t seq) : iter_(iter), seq_(seq), valid_(false) {}
  ~ObUserIterator() override = default;

  /// @brief 当前迭代器是否指向一条合法、对用户可见的KV
  bool valid() const override { return valid_; }

  /**
   * @brief 定位到快照里第一条可见用户记录
   * @note 先让底层iter跳到第一条内部key，再调用find_next_user_entry跳过不可见版本/墓碑
   */
  void seek_to_first() override
  {
    iter_->seek_to_first();
    if (iter_->valid()) {
      // 内部key对当前快照可能不可见
      find_next_user_entry(false, &saved_key_);
    } else {
      valid_ = false;
    }
  }

  /**
   * @brief 定位到快照里最后一条可见用户记录
   * @warning 底层迭代器只支持向前遍历（无prev），所以实现是O(n)扫描全量再seek回去，仅给SCAN场景使用
   */
  void seek_to_last() override
  {
    // 第一步：先跳到快照的第一条可见记录
    seek_to_first();
    // 如果seek_to_first之后直接无效：快照里一条数据都没有，直接返回
    if (!valid_) {
      return;
    }
    // 把当前第一条的user key保存进 last_key
    string last_key(key().data(), key().size());
    while (true) {
      next();
      if (!valid_) {
        break;
      }
      //`std::string::assign`：**清空原来字符串内容，然后把新内容拷贝进来**
      last_key.assign(key().data(), key().size());
    }
    seek(last_key);
  }

  /**
   * @brief 根据用户key定位，构造内部key交给底层迭代器seek，再做MVCC快照过滤
   * @param target 上层传入的纯用户key（不带seq版本后缀）
   * @note 本实现内部key编码格式：【总长度(8B)】【user_key(N B)】【快照seq(8B)】
   * @note 底层迭代器只认内部key，本身不感知快照、墓碑、多版本；过滤逻辑在find_next_user_entry
   */
  void seek(const string_view &target) override
  {
    lookup_key_.clear();  // 清空临时buffer，复用lookup_key_避免反复分配内存
    put_numeric<uint64_t>(
        &lookup_key_, target.size() + SEQ_SIZE);       // 写入：user_key + seq 的总字节长度（自定义长度前缀）
    lookup_key_.append(target.data(), target.size());  // 追加用户原始key
    put_numeric<uint64_t>(&lookup_key_, seq_);         // 追加【快照版本seq】，用来控制底层seek的版本下界
    iter_->seek(string_view(lookup_key_.data(), lookup_key_.size()));  // 底层迭代器按内部key字节序定位

    if (iter_->valid()) {
      // 底层定位成功不代表对快照可见，进入过滤流水线；skipping=false：全新查找，暂无需要跳过的墓碑key
      find_next_user_entry(false, &saved_key_);
    } else {
      valid_ = false;  // 底层迭代器已经没有数据，用户迭代器直接置为无效
    }
  }

  /**
   * @brief 移动到下一条用户可见记录
   * @note 先记录当前user_key，底层iter向前走一格，再过滤版本和墓碑
   */
  void next() override
  {
    // 提取当前底层内部key里的用户key，保存下来，用于后续跳过该key的旧版本
    saved_key_ = extract_user_key(iter_->key());
    // 底层裸迭代器向前移动一步（底层只按内部key顺序走，不做MVCC过滤）
    iter_->next();

    // 底层迭代器已经遍历完毕，没有更多内部key
    if (!iter_->valid()) {
      valid_ = false;
      saved_key_.clear();
      return;
    }
    // skipping=true：开启跳过模式，跳过刚才已经读取过的这个user_key的剩余旧版本
    find_next_user_entry(true, &saved_key_);
  }

  /**
   * @brief 核心过滤函数：循环向前找下一条快照可见、未被删除的用户KV
   * @param skipping true=需要跳过同一个user_key的旧版本
   * @param skip      要跳过的user_key（遇到墓碑时记录）
   * @rule 1. curr_seq > seq_：新版本，快照不可见，直接跳过
   * @rule 2. value为空 = 墓碑删除标记：标记该key需要跳过，后续同key全部跳过
   * @rule 3. 同一个user_key只保留seq最大的一条（最新版本）
   */
  void find_next_user_entry(bool skipping, std::string *skip)
  {
    do {
      // 从底层内部key解析：版本号、用户key、value
      size_t      curr_seq = extract_sequence(iter_->key());
      string_view user_key = extract_user_key(iter_->key());
      string_view value    = iter_->value();

      // 判断：这条记录的版本号 ≤ 快照seq，才有机会对当前快照可见
      if (curr_seq <= seq_) {
        if (value.empty()) {
          // value为空 = 墓碑tombstone，代表这个key被删除
          // 记录下这个被删除的key，开启跳过模式，后面同key全部跳过
          *skip    = user_key;
          skipping = true;
        } else {
          // 正常写入记录，不是墓碑
          if (skipping && user_comparator_.compare(user_key, *skip) <= 0) {
            // 处于跳过模式，当前key <= 要跳过的key，继续跳过这条记录
          } else {
            // 退出跳过模式，找到了一条合法、快照可见的用户记录
            valid_ = true;
            saved_key_.clear();
            return;
          }
        }
      }
      // 走到这里：不可见（新版本 / 需要跳过的key），底层迭代器继续往前走
      iter_->next();
    } while (iter_->valid());

    // 底层迭代器全部遍历完，找不到更多合法记录
    saved_key_.clear();
    valid_ = false;
  }

  /// @brief 返回对外暴露的用户key（剥离内部seq后缀）
  string_view key() const override { return extract_user_key(iter_->key()); }
  /// @brief 返回用户可见value，墓碑不会暴露给上层
  string_view value() const override { return iter_->value(); }

private:
  unique_ptr<ObLsmIterator> iter_;        ///< 底层内部迭代器，持有内部key(user_key+seq)
  uint64_t                  seq_;         ///< 快照序列号，MVCC版本隔离
  string                    lookup_key_;  ///< seek时拼接内部key的临时buffer
  string                    saved_key_;   ///< 保存上一个user_key，用于版本去重
  bool                      valid_;       ///< 对外可见的迭代器有效标记
  // 字典序比较
  ObDefaultComparator user_comparator_;  ///< 用户key比较器
};

/**
 * @brief 工厂函数，创建包装后的用户快照迭代器
 * @param iter 底层原始迭代器
 * @param seq  快照版本号
 * @return 堆上分配ObUserIterator*，调用方负责delete释放
 */
ObLsmIterator *new_user_iterator(ObLsmIterator *iter, uint64_t seq) { return new ObUserIterator(iter, seq); }

}  // namespace oceanbase

```

### ObLsmImpl

```cpp
namespace oceanbase {

// 后台Compaction上下文：冻结memtable时携带新memtable id，交给后台线程
struct ObLsmBgCompactCtx
{
  ObLsmBgCompactCtx() = default;
  ObLsmBgCompactCtx(uint64_t id) : new_memtable_id(id) {}
  uint64_t new_memtable_id;
};

// LSM树核心实现类，实现ObLsm对外接口
class ObLsmImpl : public ObLsm
{
public:
  // 构造：接收配置项 + 数据根目录
  ObLsmImpl(const ObLsmOptions &options, const string &path);

  // 析构：刷WAL(按需)、关闭线程池，等待后台compaction任务全部结束
  ~ObLsmImpl() override
  {
    if (!options_.force_sync_new_log) {
      wal_->sync();
    }
    executor_.shutdown();
    executor_.await_termination();
  }

  // 写入K-V，写入当前活跃memtable + WAL
  RC put(const string_view &key, const string_view &value) override;
  // 读：依次查memtable -> 不可变memtable -> sstable
  RC get(const string_view &key, string *value) override;
  // 删除：写入墓碑标记(tombstone)，LSM不原地删
  RC remove(const string_view &key) override;
  // 开启事务，返回事务对象
  ObLsmTransaction *begin_transaction() override;
  // 创建迭代器，支持范围遍历（合并memtable、immem、sstable）
  ObLsmIterator *new_iterator(ObLsmReadOptions options) override;
  // 获取当前所有SSTable集合，debug/观测用
  SSTablesPtr get_sstables() { return sstables_; }
  // 故障恢复：从manifest、WAL恢复memtable和sstable元信息
  RC recover();
  // 批量写入K-V，优化刷WAL/锁开销
  RC batch_put(const std::vector<pair<string, string>> &kvs) override;
  // 调试：打印所有sstable信息
  void dump_sstables() override;

private:
  // 从WAL回放，恢复对应memtable数据（恢复流程子步骤）
  RC recover_from_wal(const std::unique_ptr<ObManifestNewMemtable> &new_memtable_record);
  // 回放manifest里的compaction记录，重建sstable层级
  RC recover_from_manifest_records(const std::vector<ObManifestCompaction> &records);
  // 加载manifest快照，恢复元数据视图
  RC load_manifest_snapshot(const ObManifestSnapshot &snapshot);
  // 根据sstable id列表，加载sstable对象到内存
  RC load_manifest_sstable(const std::vector<std::vector<uint64_t>> &sstables);
  // 将当前sstable视图写入manifest快照，持久化元信息
  RC write_manifest_snapshot();

private:
  // 尝试冻结活跃memtable：达到阈值后memtable变成immutable，新建活跃memtable，触发后台compaction
  RC try_freeze_memtable();
  // 执行compaction：合并选中的多层sstable，输出一批新sstable
  vector<shared_ptr<ObSSTable>> do_compaction(ObCompaction *compaction);
  // 尝试触发全量major compaction（合并所有层，清理墓碑、重复key）
  void try_major_compaction();
  // 后台线程入口：把immutable memtable转成sstable，后续执行sstable compaction
  void background_compaction(std::shared_ptr<ObLsmBgCompactCtx> ctx);
  // 将不可变memtable落地为sstable文件
  void build_sstable(shared_ptr<ObMemTable> imem);
  // 根据sstable_id拼接磁盘上sstable文件完整路径
  string get_sstable_path(uint64_t sstable_id);
  // 根据memtable_id拼接对应WAL文件路径
  string get_wal_path(uint64_t memtable_id);

  ObLsmOptions                      options_;                  // LSM配置：块大小、每层阈值、compaction策略等
  string                            path_;                     // 数据根目录，存放wal、sstable、manifest
  mutex                             mu_;                       // 全局互斥锁，保护memtable切换、immem列表、sstable视图
  std::shared_ptr<WAL>              wal_;                      // 当前活跃memtable对应的WAL
  std::vector<std::shared_ptr<WAL>> frozen_wals_;              // 已经冻结的memtable对应的WAL列表，compaction完成后删除
  shared_ptr<ObMemTable>            mem_table_;                // 当前活跃memtable，新写请求先走这里
  vector<shared_ptr<ObMemTable>>    imem_tables_;              // 冻结后的不可变memtable，等待转sstable
  SSTablesPtr                       sstables_;                 // 多层SSTable集合，LSM的磁盘层数据
  common::ThreadPoolExecutor        executor_;                 // 后台线程池：跑memtable落盘、compaction任务
  ObManifest                        manifest_;                 // 元数据管理器，持久化sstable层级、compaction记录、快照
  atomic<uint64_t>                  seq_{0};                   // 全局递增序列号，用于版本/事务、key排序
  atomic<uint64_t>                  sstable_id_{0};            // 自增sstable唯一id
  atomic<uint64_t>                  memtable_id_{0};           // 自增memtable唯一id，关联wal
  condition_variable                cv_;                       // 条件变量，用于后台任务等待/唤醒
  const ObDefaultComparator         default_comparator_;       // 用户原始key比较器
  const ObInternalKeyComparator     internal_key_comparator_;  // 内部key比较器（key+seq+type，区分更新/删除）
  atomic<bool>                      compacting_ = false;       // 标记是否正在执行compaction，防止并发重复触发
  std::unique_ptr<ObLRUCache<uint64_t, shared_ptr<ObBlock>>> block_cache_;  // Block缓存，缓存sstable的数据块，加速读
};
}  // namespace oceanbase

```

### ObSkipList

```cpp
namespace oceanbase {
// Key：存储的键类型；
// ObComparator：自定义比较器，实现 Key 大小对比
// 模板类实现有序跳表，用于内存有序存储，支持单线程插入、并发无锁插入、范围迭代；MemTable 底层就是这个结构。
template <typename Key, class ObComparator>
class ObSkipList
{
private:
  // 私有前向声明
  struct Node;

public:
  /**
   * @brief Create a new ObSkipList object that will use "cmp" for comparing keys.
   */
  // explicit避免隐式转换
  explicit ObSkipList(ObComparator cmp);
  // 调表自己管理堆内存， 禁止拷贝构造
  ObSkipList(const ObSkipList &)            = delete;
  ObSkipList &operator=(const ObSkipList &) = delete;
  ~ObSkipList();

  /**
   * @brief Insert key into the list.
   * REQUIRES: nothing that compares equal to key is currently in the list
   */
  void insert(const Key &key);

  void insert_concurrently(const Key &key);

  /**
   * @brief Returns true if an entry that compares equal to key is in the list.
   *  @param [in] key
   *  @return true if found, false otherwise
   */
  bool contains(const Key &key) const;

  /**
   * @brief Iteration over the contents of a skip list
   */
  class Iterator
  {
  public:
    /**
     * @brief Initialize an iterator over the specified list.
     * @return The returned iterator is not valid.
     */
    // 初始化 迭代器是无效的
    explicit Iterator(const ObSkipList *list);

    /**
     * @brief Returns true iff the iterator is positioned at a valid node.
     */
    bool valid() const;

    /**
     * @brief Returns the key at the current position.
     * REQUIRES: valid()
     */
    const Key &key() const;

    /**
     * @brief Advance to the next entry in the list.
     * REQUIRES: valid()
     */
    void next();

    /**
     * @brief Advances to the previous position.
     * REQUIRES: valid()
     */
    void prev();

    /**
     * @brief Advance to the first entry with a key >= target
     */
    // 定位第一个键 >= target的节点
    void seek(const Key &target);

    /**
     * @brief Position at the first entry in list.
     * @note Final state of iterator is valid() iff list is not empty.
     */
    // 迭代器指向跳表中最小的键所在的节点
    void seek_to_first();

    /**
     * @brief Position at the last entry in list.
     * @note Final state of iterator is valid() iff list is not empty.
     */
    void seek_to_last();

  private:
    const ObSkipList *list_;
    Node             *node_;
  };

private:
  enum
  {
    kMaxHeight = 12
  };

  inline int get_max_height() const
  {
    // 宽松内存序，只保证原子本身读写，不做跨线程内存屏障。
    return max_height_.load(std::memory_order_relaxed);
  }
  // 新建跳表节点
  Node *new_node(const Key &key, int height);
  // 生成随机节点高度
  int  random_height();
  bool equal(const Key &a, const Key &b) const { return (compare_(a, b) == 0); }

  // Return the earliest node that comes at or after key.
  // Return nullptr if there is no such node.
  //
  // If prev is non-null, fills prev[level] with pointer to previous
  // node at "level" for every level in [0..max_height_-1].
  // 返回第一个 key ≥ 目标 key 的节点；无则返回 nullptr
  Node *find_greater_or_equal(const Key &key, Node **prev) const;

  // Return the latest node with a key < key.
  // Return head_ if there is no such node.
  // 返回最大的、key < 目标 key 的节点
  Node *find_less_than(const Key &key) const;

  // Return the last node in the list.
  // Return head_ if list is empty.
  Node *find_last() const;

  // Immutable after construction
  ObComparator const compare_;

  Node *const head_;

  // Modified only by insert().  Read racily by readers, but stale
  // values are ok.
  atomic<int> max_height_;  // Height of the entire list
};

```

### ObBlock

```go
namespace oceanbase {
// TODO: block align to 4KB
//      ┌─────────────────┐
//      │    entry 1      │◄───┐
//      ├─────────────────┤    │
//      │    entry 2      │    │
//      ├─────────────────┤    │
//      │      ..         │    │
//      ├─────────────────┤    │
//      │    entry n      │◄─┐ │
//      ├─────────────────┤  │ │
// ┌───►│  offset size(n) │  │ │
// │    ├─────────────────┤  │ │
// │    │    offset 1     ├──┼─┘
// │    ├─────────────────┤  │
// │    │      ..         │  │
// │    ├─────────────────┤  │
// │    │    offset n     ├──┘
// │    ├─────────────────┤
// └────┤  offset start   │
//      └─────────────────┘
/*
1. `entry 1 ~ entry n`
前面一大段：一条一条有序 KV。
单条 entry 内部格式：`[4B key_len][key][4B val_len][value]`
entry 是紧挨着连续存放，没有分隔符。
   - `entry 1`：第 0 条 KV
   - `entry n`：最后一条 KV
2. `offset size(n)` 【固定 4 字节 uint32】
n = entry 的总条数！
读到这里，你就知道后面一共有多少个 offset。

>
> 这是解析的入口标记：decode 的时候，**先从 Block 的最后 4 字节读出 n**，知道要读多少个偏移量。
3. `offset 1 ... offset n` 【每个都是 4 字节 uint32】
offsetₖ = 第 k 条 entry 在这个 Block 内部的起始字节偏移。
   - offset 1 → entry1 的起始位置
   - offset n → entry n 的起始位置
   👉 图里箭头：`offset 1` 的箭头回指 `entry1`；`offset n` 箭头回指 `entry n`。
   这就是图上 `◄───┐` 那条线的含义：**offset 记录对应 entry 的位置**。
4. `offset start`
这是一个标记位置：**整个 offset 索引区的起始地址**
offset 索引区 = `[offset_size(n)] + [offset1, offset2 ... offsetn]``offset start` 就是 `offset_size(n)` 这 4
字节的起始地址。 图最左边的箭头 `┌───►` 指向这里：告诉我们，索引区从这个位置开始。
*/
class ObBlock
{
  //**单个 Block 内部布局**：多个 entry + Block 尾部 offset 索引（就是你刚才看的 `ObBlock` ASCII 图）
  //- **KV 在前，索引在后**，这是设计选择：写的时候方便；先把所有 entry 刷 buffer，写完所有 entry 之后，再把 offsets
  // 数组追加到尾部。
public:
  ObBlock(const ObComparator *comparator) : comparator_(comparator) {}
  void           add_offset(uint32_t offset) { offsets_.push_back(offset); }
  uint32_t       get_offset(int index) const { return offsets_[index]; }
  string_view    get_entry(uint32_t offset) const;
  int            size() const { return offsets_.size(); }
  RC             decode(const string &data);
  ObLsmIterator *new_iterator() const;

private:
  string           data_;
  vector<uint32_t> offsets_;  // entry在单个Block内部的偏移
  // TODO: remove
  const ObComparator *comparator_;
};
class BlockIterator : public ObLsmIterator
{
public:
  BlockIterator(const ObComparator *comparator, const ObBlock *data, uint32_t count)
      : comparator_(comparator), data_(data), count_(count)
  {}
  // 删除拷贝
  BlockIterator(const BlockIterator &)            = delete;
  BlockIterator &operator=(const BlockIterator &) = delete;
  ~BlockIterator() override                       = default;
  void seek(const string_view &lookup_key) override;
  void seek_to_first() override
  {
    index_ = 0;
    parse_entry();
  }
  void seek_to_last() override
  {
    index_ = count_ - 1;
    parse_entry();
  }
  bool valid() const override { return index_ < count_; }
  void next() override
  {
    index_++;
    if (valid()) {
      parse_entry();
    }
  }
  string_view key() const override { return key_; };
  string_view value() const override { return value_; }

private:
  void parse_entry();

private:
  const ObComparator  *comparator_;
  const ObBlock *const data_;
  // entry 是 [ulen][ukey][seq][vlen][vkey]
  // key 称为 user_key，将 key + seq 称为 internal_key，将key_size + key + seq 称为 lookup_key。
  string_view curr_entry_;  // 当前下标的整个entry
  string_view key_;
  string_view value_;
  uint32_t    count_ = 0;  // BLock里entry总条数
  uint32_t    index_ = 0;
};
class BlockMeta
{
  //**不用读 Block 本身，就能知道这个 Block 覆盖的 key 范围、在 SST 文件的位置、Block 的字节大小**。
  // 一个 `ObBlock` 对应一个 `BlockMeta`；所有 BlockMeta 打包放在**整个 SST 文件的末尾**。s
public:
  BlockMeta() {}
  BlockMeta(const string &first_key, const string &last_key, uint32_t offset, uint32_t size)
      : first_key_(first_key), last_key_(last_key), offset_(offset), size_(size)
  {}
  string   encode() const;
  RC       decode(const string &data);
  string   first_key_;  // 最小的internal_key  {key + seq}
  string   last_key_;
  uint32_t offset_;  // BLock在SST整个文件内的字节偏移
  uint32_t size_;    // Block二进制字节总长度
};
}  // namespace oceanbase

```

### ObSSTable

```cpp
/* Copyright (c) 2021 OceanBase and/or its affiliates. All rights reserved.
miniob is licensed under Mulan PSL v2.
You can use this software according to the terms and conditions of the Mulan PSL v2.
You may obtain a copy of Mulan PSL v2 at:
        http://license.coscl.org.cn/MulanPSL2
THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND,
EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT,
MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
See the Mulan PSL v2 for more details. */
#pragma once
#include "oblsm/util/ob_file_reader.h"
#include "common/lang/memory.h"
#include "common/sys/rc.h"
#include "oblsm/table/ob_block.h"
#include "oblsm/util/ob_comparator.h"
#include "oblsm/util/ob_lru_cache.h"
namespace oceanbase {
// TODO: add a dumptool to dump sst files(example for usage: ./dumptool sst_file)
//    ┌─────────────────┐
//    │    block 1      │◄──┐
//    ├─────────────────┤   │
//    │    block 2      │   │
//    ├─────────────────┤   │
//    │      ..         │   │
//    ├─────────────────┤   │
//    │    block n      │◄┐ │
//    ├─────────────────┤ │ │
// ┌─►│  meta size(n)   │ │ │
// │  ├─────────────────┤ │ │
// │  │block meta 1 size│ │ │
// │  ├─────────────────┤ │ │
// │  │  block meta 1   ┼─┼─┘
// │  ├─────────────────┤ │
// │  │      ..         │ │
// │  ├─────────────────┤ │
// │  │block meta n size│ │
// │  ├─────────────────┤ │
// │  │  block meta n   ┼─┘
// │  ├─────────────────┤
// └──┼                 │
//    └─────────────────┘
/**
 * @class ObSSTable
 * @brief Represents an SSTable (Sorted String Table) in the LSM-Tree.
 *
 * The `ObSSTable` class is responsible for managing on-disk sorted string tables (SSTables).
 * It provides methods for initialization, key-value lookups, block reading (with caching support),
 * and creating iterators for traversal. Each SSTable is uniquely identified by an `sst_id_` and
 * interacts with the LRU cache for efficient block access.
 */
/// ObSSTable 是单个磁盘 SST 文件的内存句柄，它本身不存 KV，只管理文件句柄、常驻稀疏索引
/// block_metas_、块缓存路由，对外提供迭代器、按块读能力。
class ObSSTable : public enable_shared_from_this<ObSSTable>
{
public:
  /**
   * @brief Constructor for ObSSTable.
   *
   * Initializes an SSTable with its unique ID, file name, comparator, and block cache.
   *
   * @param sst_id A unique identifier for the SSTable.
   * @param file_name The name of the file storing the SSTable data.
   * @param comparator A pointer to the comparator used for key comparison.
   * @param block_cache A pointer to the LRU block cache for caching block-level data.
   */
  ObSSTable(uint32_t sst_id, const string &file_name, const ObComparator *comparator,
      ObLRUCache<uint64_t, shared_ptr<ObBlock>> *block_cache)
      : sst_id_(sst_id),
        file_name_(file_name),
        comparator_(comparator),
        file_reader_(nullptr),
        block_cache_(block_cache)
  {
    (void)block_cache_;
  }
  ~ObSSTable() = default;
  /**
   * @brief Initializes the SSTable instance.
   *
   * This function is responsible for performing setup tasks required for the SSTable,
   * such as preparing file readers or pre-loading block_metas_.
   *
   * @warning This function must be called before performing any operations on the SSTable.
   */
  // 读块前必须init
  void                  init();
  uint32_t              sst_id() const { return sst_id_; }
  shared_ptr<ObSSTable> get_shared_ptr() { return shared_from_this(); }
  ObLsmIterator        *new_iterator();
  /**
   * @brief Reads a block from the SSTable using the block cache.
   *
   * Attempts to read the specified block using the block cache. If the block is not
   * in the cache, it will load the block from the SSTable file and update the cache.
   *
   * @param block_idx The index of the block to read.
   *
   * @return shared_ptr<ObBlock> A shared pointer to the requested block.
   */
  shared_ptr<ObBlock> read_block_with_cache(uint32_t block_idx) const;
  /**
   * @brief Reads a block directly from the SSTable file.
   *
   * This function bypasses the block cache and directly reads the requested block
   * from the SSTable file.
   *
   * @param block_idx The index of the block to read.
   *
   * @return shared_ptr<ObBlock> A shared pointer to the requested block.
   */
  shared_ptr<ObBlock> read_block(uint32_t block_idx) const;
  // 总块数
  uint32_t block_count() const { return block_metas_.size(); }
  // 总大小
  uint32_t size() const { return file_reader_->file_size(); }
  // 获取第i个块的meta
  const BlockMeta     block_meta(int i) const { return block_metas_[i]; }
  const ObComparator *comparator() const { return comparator_; }
  void                remove();  // 标记这个 SST 可以被删除。
  string              first_key() const { return block_metas_.empty() ? "" : block_metas_[0].first_key_; }
  string              last_key() const { return block_metas_.empty() ? "" : block_metas_.back().last_key_; }

private:
  uint32_t                                   sst_id_;     // 全局唯一编号，LSM 版本、compaction、缓存 key 都依赖它
  string                                     file_name_;  // 1. 磁盘上 sst 文件名
  const ObComparator                        *comparator_ = nullptr;
  unique_ptr<ObFileReader>                   file_reader_;
  vector<BlockMeta>                          block_metas_;
  ObLRUCache<uint64_t, shared_ptr<ObBlock>> *block_cache_;
};
class TableIterator : public ObLsmIterator
{
public:
  TableIterator(const shared_ptr<ObSSTable> &sst) : sst_(sst), block_cnt_(sst->block_count()) {}
  ~TableIterator() override = default;
  void        seek(const string_view &key) override;
  void        seek_to_first() override;
  void        seek_to_last() override;
  void        next() override;
  bool        valid() const override { return block_iterator_ != nullptr && block_iterator_->valid(); }
  string_view key() const override { return block_iterator_->key(); }
  string_view value() const override { return block_iterator_->value(); }

private:
  void                        read_block_with_cache();
  const shared_ptr<ObSSTable> sst_;  // 绑定所属SST, 保活SST
  uint32_t                    block_cnt_;
  uint32_t                    curr_block_idx_ = 0;
  shared_ptr<ObBlock>         block_;
  unique_ptr<ObLsmIterator>   block_iterator_;
};
/*
- `shared_ptr<ObSSTable>`：单个 SST 文件句柄
- `vector<shared_ptr<ObSSTable>>`：**同一层里的一堆 SST 集合**
- `vector< vector<shared_ptr<ObSSTable>> >`：外层 vector 下标 = **层号**，里面每一个内层 vector 存放该层全部 SST
- 外面包一层 `shared_ptr`：整个 LSM 树的分层结构本身做引用计数，方便并发、快照
*/
// LSM 的分层是为了把随机写变成顺序写，同时控制合并（Compaction）的开销、放大倍数，避免合并风暴。
using SSTablesPtr = shared_ptr<vector<vector<shared_ptr<ObSSTable>>>>;
/*
[
  [SST0, SST1, SST2],   // L0 层
  [SST3, SST4],         // L1 层
  [SST5, SST6, SST7]    // L2 层
  ...
]
*/
}  // namespace oceanbase

```

### ObSSTableBuilder

```cpp
namespace oceanbase {

/**
 * @brief Build a SSTable
 */
// 内存中的 ObMemTable 持久化为磁盘 SSTable 文件，负责分块、序列化、写文件、生成块元数据，
class ObSSTableBuilder
{
public:
  ObSSTableBuilder(const ObComparator *comparator, ObLRUCache<uint64_t, shared_ptr<ObBlock>> *block_cache)
      : comparator_(comparator), block_cache_(block_cache)
  {}
  ~ObSSTableBuilder() = default;

  /**
   * @brief Builds an SSTable from the provided in-memory table and stores it in a file.
   *
   * This function takes an `ObMemTable` as input, partitions the data into blocks,
   * serializes the blocks, and writes them into an SSTable file.
   *
   * @param mem_table A shared pointer to the `ObMemTable` containing the data to be written into the SSTable.
   * @param file_name The name of the file where the constructed SSTable will be stored.
   * @param sst_id A unique identifier assigned to the created SSTable.
   *
   * @return RC A result code indicating the success or failure of the SSTable creation process.
   *
   */
  // 接收memtable, 输出磁盘sst文件
  RC build(shared_ptr<ObMemTable> mem_table, const string &file_name, uint32_t sst_id);

  /**
   * @brief Starts building a new SSTable with the given id and file name.
   *
   * Resets any previous build state and opens a file writer for the new SSTable.
   *
   * @param sst_id The unique identifier assigned to the SSTable to be built.
   * @param file_name The path of the SSTable file.
   * @return RC indicating success or failure to open the file.
   */
  RC start_build(uint32_t sst_id, const string &file_name);

  /**
   * @brief Adds a single key-value pair to the SSTable being built.
   *
   * Handles block boundaries automatically: if the current block is full, it is
   * finalized and a new block is started.
   *
   * @param key The internal key to add.
   * @param value The value to add.
   * @return RC indicating success or failure.
   */
  RC add(const string_view &key, const string_view &value);

  /**
   * @brief Finalizes the current SSTable: flushes the pending block, writes the
   * block meta and footer, and flushes the file.
   */
  void finish_build_table();

  // 生成的 SSTable 文件总字节大小。
  size_t file_size() const { return file_size_; }
  // 当前正在构建的 SSTable 文件已写入的字节数。
  size_t curr_file_size() const { return curr_offset_; }
  // 构建完成后，创建并返回 ObSSTable 对象
  shared_ptr<ObSSTable> get_built_table();
  void                  reset();

private:
  // 结束当前Block的构建
  void finish_build_block();

  // 全局依赖
  const ObComparator                        *comparator_  = nullptr;  // Key 比较器
  ObLRUCache<uint64_t, shared_ptr<ObBlock>> *block_cache_ = nullptr;  // 块缓存

  // 块构建相关
  ObBlockBuilder block_builder_;       // 单个数据块构建器
  string         curr_blk_first_key_;  // 当前正在构建块的第一个Key

  // 文件写入与位置
  unique_ptr<ObFileWriter> file_writer_;      // 文件写入器，负责磁盘IO
  vector<BlockMeta>        block_metas_;      // 所有数据块的元数据（最终写入文件尾部）
  uint32_t                 curr_offset_ = 0;  // 文件当前写入偏移（字节）

  // 统计与标识
  uint32_t sst_id_    = 0;  // 待生成SSTable的唯一ID
  size_t   file_size_ = 0;  // 最终SSTable文件总大小
  bool     has_pending_block_ = false;  // 当前 block 是否已有待落盘数据
};
}  // namespace oceanbase

```

## ObCompaction_Picker

```cpp
class ObCompactionPicker
{
public:
  ObCompactionPicker(ObLsmOptions *options) : options_(options) {}
  virtual ~ObCompactionPicker() = default;
  virtual unique_ptr<ObCompaction> pick(SSTablesPtr sstables) = 0;
  static ObCompactionPicker *create(CompactionType type, ObLsmOptions *options);
protected:
  ObLsmOptions *options_;
};

class TiredCompactionPicker : public ObCompactionPicker
{
public:
  TiredCompactionPicker(ObLsmOptions *options) : ObCompactionPicker(options) {}
  ~TiredCompactionPicker() = default;
  unique_ptr<ObCompaction> pick(SSTablesPtr sstables) override;
private:
};

class LeveledCompactionPicker : public ObCompactionPicker
{
public:
  LeveledCompactionPicker(ObLsmOptions *options) : ObCompactionPicker(options) {}
  ~LeveledCompactionPicker() = default;
  unique_ptr<ObCompaction> pick(SSTablesPtr sstables) override;
private:
};
```

### HashJoinPhysicalOperator

```cpp
class HashJoinPhysicalOperator : public PhysicalOperator
{
public:
  HashJoinPhysicalOperator();
  virtual ~HashJoinPhysicalOperator() = default;

  // 返回算子大类：HASH_JOIN
  PhysicalOperatorType type() const override { return PhysicalOperatorType::HASH_JOIN; }
  // 算子细分类型：内哈希连接
  OpType get_op_type() const override { return OpType::INNERHASHJOIN; }

  /**
   * @brief 代价估算函数，优化器选择执行计划时使用
   * 公式：build侧开销 + probe侧开销 + 结果行组装开销
   * left_card：左表(build)基数，right_card：右表(probe)基数，output：连接结果基数
   */
  double calculate_cost(
      LogicalProperty *prop, const vector<LogicalProperty *> &child_log_props, CostModel *cm) override
  {
    double left_card  = child_log_props[0]->get_card();
    double right_card = child_log_props[1]->get_card();
    double output     = prop->get_card();
    return left_card * cm->hash_cost() + right_card * cm->hash_probe() + output * cm->cpu_op();
  }

  // 火山模型open：打开算子，这里会阻塞，一次性读完build侧，构建哈希表
  RC     open(Trx *trx) override;
  // 火山模型next：获取下一条join结果
  RC     next() override;
  // 关闭算子，释放资源、关闭子算子
  RC     close() override;
  // 获取当前已经组装好的连接元组
  Tuple *current_tuple() override;

  // 设置等值连接条件，移动语义接管表达式，所有权转移
  void set_join_condition(unique_ptr<Expression> &&condition) { join_condition_ = std::move(condition); }

private:
  /**
   * @brief 构建哈希表
   * 遍历left_（build侧）所有元组，提取join key，存入hash_table_
   * 在open内部调用，是HashJoin阻塞的根源
   */
  RC build_hash_table();

  /**
   * @brief 根据等值条件，从一条元组上解析出join key字符串
   * 连接条件是 fieldA = fieldB；
   * 如果当前tuple属于左表，用A表达式求值；属于右表则用B表达式求值
   */
  bool get_join_key(const Tuple &tuple, string &join_key) const;

  PhysicalOperator *left_  = nullptr;   // build构建侧子算子，全部加载进哈希表
  PhysicalOperator *right_ = nullptr;   // probe探测侧子算子，逐行遍历查表
  Trx              *trx_   = nullptr;   // 事务对象，透传给子算子

  unique_ptr<Expression> join_condition_; // 等值连接条件（二元比较表达式，仅支持=）

  // 哈希表：key是序列化后的连接键；value是同一个key对应的所有build侧元组列表（一对多）
  using JoinMap = map<string, vector<unique_ptr<ValueListTuple>>>;
  JoinMap hash_table_;

  vector<unique_ptr<ValueListTuple>> *current_matches_ = nullptr; // 当前probe key命中的build元组列表
  size_t                              current_match_idx_ = 0;      // 当前正在返回第几个匹配元组（遍历一对多）
  Tuple                              *right_tuple_ = nullptr;      // 当前读到的probe侧（右表）元组
  JoinedTuple                         joined_tuple_;               // 复用的连接元组，拼接左+右tuple，减少内存分配
  bool                                right_exhausted_ = false;    // 标记右表probe侧是否已经读完
};

```

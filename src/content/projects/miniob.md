## lab0 布隆过滤器
> 请完成 src/oblsm/util/ob_bloomfilter.h 中的 ObBloomFilter 类，实现布隆过滤器的功能。ObBloomFilter 中提供了必要的接口，请不要修改或删除这些接口，你可以添加任何有助于实现 ObBloomFilter 的成员函数和变量。
- ObBloomFilter::insert：将一个元素插入布隆过滤器中，需要支持并发访问。
- ObBloomFilter::clear：清空布隆过滤器中的所有元素。
- ObBloomFilter::contains：判断一个元素是否在布隆过滤器中，需要支持并发访问。
```Cpp
/*
原始布隆过滤器需要 `k` 个独立哈希函数（比如 k=4，就要写 4 套不同哈希），代价很高。
Kirsch-Mitzenmacher 证明了：**只需要 2 个独立哈希 h1、h2，就可以推导出 k 个哈希：**

size_t pos = (hash1 + i * hash2) % total_bits_;
m 就是总 bit 数量 `total_bits_`
- `hash_val & 0xFFFFFFFF`：取**低 32 位** → `hash1`
- `hash_val >> 32`：右移 32 位，拿到**高 32 位** → `hash2`

1. `pos / 8`：算出是第几个 char（第几个字节）
2. `pos % 8`：算出这个字节内部是第几位（0~7）
3. `1 << (pos %8)`：生成掩码，比如第 2 位就是 `0b00000100`
4. `bits_[字节] & 掩码`：检查这一位是否被置 1
   - 如果该 bit **不是 1** → 说明元素一定不在过滤器，直接 return false
   - 全部 k 个 bit 都是 1 → 返回 true（**可能存在，存在误判，也就是假阳性**）

> 
> insert 函数里是 `bits_[pos / 8] |= static_cast<char>(1 << (pos % 8));`
> `|=` 就是把对应 bit 置为 1，一旦置 1，bit 永远不会变回 0（布隆不支持删除单个元素）
*/
class ObBloomfilter {
public:
  // 构造布隆过滤器：指定哈希函数数量、总bit位数
  ObBloomfilter(size_t hash_func_count = 4, size_t total_bits = 65536);

  // 插入元素，线程安全
  void insert(const string &object);

  // 清空布隆过滤器，线程安全
  void clear();

  // 判断元素是否可能存在；返回false代表一定不存在
  bool contains(const string &object) const;

  // 获取已插入元素个数
  size_t object_count() const;

  // 判断过滤器是否为空
  bool empty() const { return 0 == object_count(); }

private:
  // Kirsch-Mitzenmacher双哈希优化，计算第i个哈希对应的bit下标
  size_t hash(const string &object, size_t i) const;

  size_t hash_func_count_;  // 哈希函数个数
  size_t total_bits_;       // bit数组总位数
  size_t object_count_;     // 已插入元素数量
  std::vector<char> bits_;  // 底层bit存储数组，1字节存8bit
  mutable std::shared_mutex mutex_; // 读写锁：读共享，写独占
};
inline ObBloomfilter::ObBloomfilter(size_t hash_func_count, size_t total_bits)
    : hash_func_count_(hash_func_count), total_bits_(total_bits), object_count_(0)
{
  // Allocate enough bytes to hold total_bits_ bits (rounded up).
  // If total_bits_ is 0, the vector remains empty.
  if (total_bits_ > 0) {
    bits_.resize((total_bits_ + 7) / 8, 0);
  }
}

inline void ObBloomfilter::insert(const string &object)
{
  // 独占锁
  std::unique_lock<std::shared_mutex> lock(mutex_);

  if (total_bits_ == 0 || hash_func_count_ == 0) {
    return;
  }

  uint64_t hash_val = std::hash<string>{}(object);
  uint32_t hash1    = static_cast<uint32_t>(hash_val & 0xFFFFFFFF);
  uint32_t hash2    = static_cast<uint32_t>(hash_val >> 32);

  for (size_t i = 0; i < hash_func_count_; i++) {
    size_t pos = (hash1 + i * hash2) % total_bits_;
    bits_[pos / 8] |= static_cast<char>(1 << (pos % 8));
  }

  object_count_++;
}

inline void ObBloomfilter::clear()
{
  std::unique_lock<std::shared_mutex> lock(mutex_);

  std::fill(bits_.begin(), bits_.end(), 0);
  object_count_ = 0;
}

inline bool ObBloomfilter::contains(const string &object) const
{
  // 共享锁
  std::shared_lock<std::shared_mutex> lock(mutex_);

  if (total_bits_ == 0 || hash_func_count_ == 0) {
    return false;
  }

  uint64_t hash_val = std::hash<string>{}(object);
  uint32_t hash1    = static_cast<uint32_t>(hash_val & 0xFFFFFFFF);
  uint32_t hash2    = static_cast<uint32_t>(hash_val >> 32);

  for (size_t i = 0; i < hash_func_count_; i++) {
    size_t pos = (hash1 + i * hash2) % total_bits_;
    if (!(bits_[pos / 8] & (1 << (pos % 8)))) {
      return false;
    }
  }

  return true;
}

inline size_t ObBloomfilter::object_count() const
{
  std::shared_lock<std::shared_mutex> lock(mutex_);
  return object_count_;
}

```

#### 测试
```Bash
cd build_debug && make ob_bloomfilter_test

./build_debug/unittest/ob_bloomfilter_test
```

## lab1 LSM-Tree存储引擎
> LSM-Tree 将写操作（包括数据插入、修改、删除）采用追加写的方式写入内存中并进行排序（MemTable），当 MemTable 的大小达到一定阈值后再将数据顺序写入磁盘中（Sorted Strings Table, SSTable），这使得 LSM-Tree 具有优秀的写性能；但是读操作时需要查询 MemTable 和 SSTable 中数据。因此，为了提高读性能，LSM-Tree会定期对磁盘中的SSTable文件进行合并（Compaction），合并时会将相同数据进行合并，减少数据量。
> 数据分为静态基线数据（放在 SSTable 中）和动态增量数据（放在 MemTable 中）两部分，其中 SSTable 是只读的，一旦生成就不再被修改，存储于磁盘；MemTable 支持读写，存储于内存.等到 MemTable 达到一定大小时转储到磁盘成为 SSTable。在进行查询时，需要分别对 SSTable 和 MemTable 进行查询，并将查询结果进行归并，返回给 SQL 层归并后的查询结果。同时在内存实现了 Block Cache 和 Row cache，来避免对基线数据的随机读
- ObLsm 的代码位于 src/oblsm/ 目录下
#### 任务1: 实现SkipList 并支持 SkipList 无锁并发写入
- src/oblsm/memtable/ob_skiplist.h
```Cpp
需要实现函数
ObSkipList::find_greater_or_equal
ObSkipList::insert 插入接口
ObSkipList::insert_concurrently 无锁并发查找接口
```
**模板类实现有序跳表，用于内存有序存储，支持单线程插入、并发无锁插入、范围迭代；MemTable 底层就是这个结构。**
整体分层：外层`ObSkipList`主类 → 内嵌`Iterator`迭代器 → 私有内部`Node`节点。
```Cpp
//ob_skiplist.h
template <typename Key, class ObComparator> class ObSkipList {
private:
    struct Node;
public:
    explicit ObSkipList(ObComparator cmp);
    ObSkipList(const ObSkipList &) = delete;
    ObSkipList &operator=(const ObSkipList &) = delete;
    ~ObSkipList();

    void insert(const Key &key);                 // 单线程插入（Lab1 Task1重点）
	void insert_concurrently(const Key &key);    // 多线程无锁并发插入
	bool contains(const Key &key) const;         // 判断key是否存在

	//LSM scan底层
    class Iterator {
    public:
        explicit Iterator(const ObSkipList list);
        bool valid() const;
        const Key &key() const;
        void next();
        void prev();
        // 定位第一个键 >= target的节点
        void seek(const Key &target);
        // 迭代器指向跳表中最小的键所在的节点
        void seek_to_first();
        void seek_to_last();
    private:
        const ObSkipList *list_;
        Node *node_;
    };

private:
    enum {
		//跳表节点最大层数。跳表层从 0 开始（0 层是底层有序链表），最多 0~11 共 12 层。
        kMaxHeight = 12
    };

    inline int get_max_height() const
    {
		//宽松内存序，只读，无跨线程屏障。
        return max_height_.load(std::memory_order_relaxed);
    }

    Node *new_node(const Key &key, int height);
    int random_height();
    bool equal(const Key &a, const Key &b) const { return (compare_(a, b) == 0); }
	//返回**第一个 key >= target 的节点**；找不到返回 nullptr
    Node *find_greater_or_equal(const Key &key, Node **prev) const;
	//找到**最大的 key < target**的节点，迭代器`prev()`底层调用。
    Node *find_less_than(const Key &key) const;
	//找到跳表最大 key 节点。
    Node *find_last() const;

    ObComparator const compare_;
    Node *const head_;
    atomic<int> max_height_;
    static common::RandomGenerator rnd;
};
//implement
template <typename Key, class ObComparator>
ObSkipList<Key, ObComparator>::ObSkipList(ObComparator cmp)
    : compare_(cmp), head_(new_node(0 /* any key will do */, this->kMaxHeight)), max_height_(1)
{
  for (int i = 0; i < this->kMaxHeight; i++) {
    head_->set_next(i, nullptr);
  }
}

template <typename Key, class ObComparator>
ObSkipList<Key, ObComparator>::~ObSkipList()
{
  using Node = typename ObSkipList<Key, ObComparator>::Node;
  typename std::vector<Node *> nodes;
  nodes.reserve(this->get_max_height());
  for (Node *x = this->head_; x != nullptr; x = x->next(0)) {
    nodes.push_back(x);
  }
  // malloc拿到一块裸内存， 没有构造对象。
  // 释放要 先析构在free
  for (auto node : nodes) {
    node->~Node();
    free(node);
  }
}

template <typename Key, class ObComparator>
void ObSkipList<Key, ObComparator>::insert(const Key &key)
{
  using Node = typename ObSkipList<Key, ObComparator>::Node;
  Node *prev[this->kMaxHeight];
  // 1. 查找每层前驱，prev填充每层前置节点
  Node *target = this->find_greater_or_equal(key, prev);
  // 实验要求：不存在相等key才能插入
  ASSERT(target == nullptr || !this->equal(key, target->key), "key duplicated");

  // 2. 随机生成节点高度
  int h = this->random_height();
  // 3. 新建节点
  Node *new_nd = this->new_node(key, h);

  // 4. 逐层挂载到prev后面（单线程无竞争，直接set_next）
  for (int level = 0; level < h; level++) {
    Node *p = prev[level];
    Node *s = p->nobarrier_next(level);
    new_nd->nobarrier_set_next(level, s);
    p->nobarrier_set_next(level, new_nd);
  }

  // 5. 更新全局max_height，如果新节点更高
  // 获取当前记录的最大层高 (一次原子读)
  // release写操作， acquire读操作
  int old_max = this->max_height_.load(std::memory_order_relaxed);
  // while + CAS 尝试把max_height_修改成更高的值h
  while (h > old_max) {
    if (this->max_height_.compare_exchange_weak(old_max, h, std::memory_order_relaxed)) {
      break;
    }
  }
}
// 保证底层level0先插入成功
template <typename Key, class ObComparator>
void ObSkipList<Key, ObComparator>::insert_concurrently(const Key &key)
{
  using Node = typename ObSkipList<Key, ObComparator>::Node;
  // 1. 预先创建节点，此时节点对其他线程不可见
  int   node_h = this->random_height();
  Node *new_nd = this->new_node(key, node_h);

  // 循环重试直到插入成功
  while (true) {
    Node *prev[this->kMaxHeight];
    Node *succ[this->kMaxHeight];
    // 步骤1：查找所有层前驱、后继
    Node *target = this->find_greater_or_equal(key, prev);
    // 重复key直接返回
    if (target != nullptr && this->equal(key, target->key)) {
      free(new_nd);
      return;
    }
    // 收集每层后继
    int cur_h = this->get_max_height();
    //`succ[lv]` = 前驱节点 `prev[lv]` 的下一个节点
    for (int lv = 0; lv < this->kMaxHeight; lv++) {
      succ[lv] = prev[lv]->next(lv);
    }

    // 步骤2：先修改第0层（底层链表，必须CAS成功才能继续上层）
    new_nd->nobarrier_set_next(0, succ[0]);
    bool cas_ok = prev[0]->cas_next(0, succ[0], new_nd);
    if (!cas_ok) {
      // 底层CAS失败，其他线程抢先插入，全部重来
      continue;
    }

    // 步骤3：逐层向上CAS挂载上层指针
    for (int lv = 1; lv < node_h; lv++) {
      while (true) {
        // 重新查找当前层prev/succ（中间可能被其他线程修改）
        Node *tmp_target = this->find_greater_or_equal(key, prev);
        succ[lv]         = prev[lv]->next(lv);
        new_nd->nobarrier_set_next(lv, succ[lv]);
        if (prev[lv]->cas_next(lv, succ[lv], new_nd)) {
          break;  // 当前层插入成功，去上一层
        }
        // 当前层CAS失败，重新查找重试本层
      }
    }

    // 步骤4：尝试更新全局最大层高max_height_
    int old_max = this->max_height_.load(std::memory_order_relaxed);
    while (node_h > old_max) {
      // relaxed只保证原子性， 没有同步， 没有指令屏障
      if (this->max_height_.compare_exchange_weak(old_max, node_h, std::memory_order_relaxed)) {
        break;
      }
    }

    // 全部层插入完成，退出循环
    break;
  }
}
template <typename Key, class ObComparator>
bool ObSkipList<Key, ObComparator>::contains(const Key &key) const
{
  Node *x = this->find_greater_or_equal(key, nullptr);
  if (x != nullptr && this->equal(key, x->key)) {
    return true;
  } else {
    return false;
  }
}
## Node是跳表里面的节点
struct ObSkipList<Key, ObComparator>::Node
{
  explicit Node(const Key &k) : key(k) {}
  Key const key;
  Node *next(int n)
  {
    ASSERT(n >= 0, "n >= 0");
    //acquire读操作
    //只要本次load读到别的线程release / store写入的指针， 该release store之前的所有写操作， 对当前线程全部可见
    return next_[n].load(std::memory_order_acquire);
  }
  void set_next(int n, Node *x)
  {
    ASSERT(n >= 0, "n >= 0");
    //release写操作
    next_[n].store(x, std::memory_order_release);
  }
  //单线程使用
  Node *nobarrier_next(int n)
  {
    ASSERT(n >= 0, "n >= 0");
    return next_[n].load(std::memory_order_relaxed);
  }
  void nobarrier_set_next(int n, Node *x)
  {
    ASSERT(n >= 0, "n >= 0");
    //relaxed对这个atomic变量本身的读写是原子的， CPU可以随意重排这个load前后的指令
    next_[n].store(x, std::memory_order_relaxed);
  }
  bool cas_next(int n, Node *expected, Node *x)
  {
    ASSERT(n >= 0, "n >= 0");
    return next_[n].compare_exchange_strong(expected, x);
  }
private:
  atomic<Node *> next_[1];
};
template <typename Key, class ObComparator>
typename ObSkipList<Key, ObComparator>::Node *ObSkipList<Key, ObComparator>::new_node(const Key &key, int height)
{
  // 先malloc申请一块原始裸内容， malloc返回void*, 强转为char *
  char *const node_memory = reinterpret_cast<char *>(malloc(sizeof(Node) + sizeof(atomic<Node *>) * (height - 1)));
  return new (node_memory) Node(key);
}
template <typename Key, class ObComparator>
int ObSkipList<Key, ObComparator>::random_height()
{
  // 1 / 4概率变高
  static const unsigned int kBranching = 4;
  int                       height     = 1;
  while (height < this->kMaxHeight && this->rnd.next(kBranching) == 0) {
    height++;
  }
  ASSERT(height > 0, "height > 0");
  ASSERT(height <= this->kMaxHeight, "height <= kMaxHeight");
  return height;
}
template <typename Key, class ObComparator>
inline ObSkipList<Key, ObComparator>::Iterator::Iterator(const ObSkipList *list)
{
  list_ = list;
  node_ = nullptr;
}
template <typename Key, class ObComparator>
inline bool ObSkipList<Key, ObComparator>::Iterator::valid() const
{
  return node_ != nullptr;
}
template <typename Key, class ObComparator>
inline const Key &ObSkipList<Key, ObComparator>::Iterator::key() const
{
  ASSERT(valid(), "valid");
  return node_->key;
}
template <typename Key, class ObComparator>
inline void ObSkipList<Key, ObComparator>::Iterator::next()
{
  ASSERT(valid(), "valid");
  node_ = node_->next(0);
}
template <typename Key, class ObComparator>
inline void ObSkipList<Key, ObComparator>::Iterator::prev()
{
  ASSERT(valid(), "valid");
  node_ = list_->find_less_than(node_->key);
  if (node_ == list_->head_) {
    node_ = nullptr;
  }
}
// 1. 跳到 >= target 的第一个节点
inline void ObSkipList<Key, ObComparator>::Iterator::seek(const Key &target)
{
  node_ = list_->find_greater_or_equal(target, nullptr);
}

// 2. 跳到第一个真实节点
inline void ObSkipList<Key, ObComparator>::Iterator::seek_to_first()
{
  node_ = list_->head_->next(0);
}

// 3. 跳到最后一个真实节点
inline void ObSkipList<Key, ObComparator>::Iterator::seek_to_last()
{
  node_ = list_->find_last();
  if (node_ == list_->head_) {
    node_ = nullptr;
  }
}
template <typename Key, class ObComparator>
typename ObSkipList<Key, ObComparator>::Node *ObSkipList<Key, ObComparator>::find_greater_or_equal(
    const Key &key, Node **prev) const
{
  Node *cur       = this->head_;
  int   cur_max_h = this->get_max_height();
  for (int level = cur_max_h - 1; level >= 0; level--) {
    while (true) {
      Node *next_node = cur->next(level);
      if (next_node == nullptr || this->compare_(key, next_node->key) < 0) {
        break;
      }
      cur = next_node;
    }
    if (prev != nullptr) {
      prev[level] = cur;
    }
  }
  Node *succ = cur->next(0);
  return succ;
}
template <typename Key, class ObComparator>
typename ObSkipList<Key, ObComparator>::Node *ObSkipList<Key, ObComparator>::find_less_than(const Key &key) const
{
  Node *x     = this->head_;
  int   level = this->get_max_height() - 1;
  while (true) {
    ASSERT(x == this->head_ || this->compare_(x->key, key) < 0, "x == head_ || compare_(x->key, key) < 0");
    Node *next = x->next(level);
    if (next == nullptr || this->compare_(next->key, key) >= 0) {
      if (level == 0) {
        return x;
      } else {
        level--;
      }
    } else {
      x = next;
    }
  }
}
template <typename Key, class ObComparator>
typename ObSkipList<Key, ObComparator>::Node *ObSkipList<Key, ObComparator>::find_last() const
{
  Node *x     = this->head_;
  int   level = this->get_max_height() - 1;
  while (true) {
    Node *next = x->next(level);
    if (next == nullptr) {
      if (level == 0) {
        return x;
      } else {
        level--;
      }
    } else {
      x = next;
    }
  }
}
```
#### test
```bash
./build_debug/unittest/ob_skiplist_test --gtest_also_run_disabled_tests
```


#### 任务2: 实现 Block Cache 功能，加速 SSTable 的读取，实现 SSTable 组织数据的功能。
> MemTable 的大小达到限制条件，MemTable 的数据以按顺序被转储到磁盘中，被转储到磁盘中的结构称为（SSTable：Sorted Strings table）。
> SSTable 是一种有序的键值对存储结构，它通常包含一个或多个块（block），每个块中包含一组有序的键值对。
```text
需要修改的文件 
1. 数据组织¶
src/oblsm/table/ob_block.cpp
src/oblsm/table/ob_sstable.cpp
src/oblsm/table/ob_sstable_builder.cpp
2. 块缓存¶
src/oblsm/memtable/src/oblsm/util/ob_lru_cache.h
```
> 数据组织需要实现的函数
- ObBlock::decode 从给定的二进制数据中解析并提取出特定格式的数据，数据组织可以参考上面的文档和ObBlockBuilder中的代码。
- ObSSTable::init ObSSTable初始化，初始化file_reader_和block_metas_
- ObSSTable::read_block_with_cache
- ObSSTable::read_block 从文件中读取一个ObBlock。
- ObSSTableBuilder::build 从memtable构建一个ObSSTable，注意查看ObSSTableBuilder内部函数和变量来实现。
> 块缓存需要s实现的函数
- ObLRUCache::get
- ObLRUCache::put
- ObLRUCache::contains
- ObLRUCache<Key, Value> *new_lru_cache(uint32_t capacity)

##### 项目的返回码 Return Code(RC)
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

//
// Created by Longda on 2021/5/2.
//

#pragma once

/**
 * @brief 这个文件定义函数返回码/错误码(Return Code)
 * @enum RC
 */

#define DEFINE_RCS                       \
  DEFINE_RC(SUCCESS)                     \
  DEFINE_RC(INVALID_ARGUMENT)            \
  DEFINE_RC(UNIMPLEMENTED)               \
  DEFINE_RC(SQL_SYNTAX)                  \
  DEFINE_RC(INTERNAL)                    \
  DEFINE_RC(NOMEM)                       \
  DEFINE_RC(NOTFOUND)                    \
  DEFINE_RC(EMPTY)                       \
  DEFINE_RC(FULL)                        \
  DEFINE_RC(EXIST)                       \
  DEFINE_RC(NOT_EXIST)                   \
  DEFINE_RC(BUFFERPOOL_OPEN)             \
  DEFINE_RC(BUFFERPOOL_NOBUF)            \
  DEFINE_RC(BUFFERPOOL_INVALID_PAGE_NUM) \
  DEFINE_RC(RECORD_OPENNED)              \
  DEFINE_RC(RECORD_INVALID_RID)          \
  DEFINE_RC(RECORD_INVALID_KEY)          \
  DEFINE_RC(RECORD_DUPLICATE_KEY)        \
  DEFINE_RC(RECORD_NOMEM)                \
  DEFINE_RC(RECORD_EOF)                  \
  DEFINE_RC(RECORD_NOT_EXIST)            \
  DEFINE_RC(RECORD_INVISIBLE)            \
  DEFINE_RC(SCHEMA_DB_EXIST)             \
  DEFINE_RC(SCHEMA_DB_NOT_EXIST)         \
  DEFINE_RC(SCHEMA_DB_NOT_OPENED)        \
  DEFINE_RC(SCHEMA_TABLE_NOT_EXIST)      \
  DEFINE_RC(SCHEMA_TABLE_EXIST)          \
  DEFINE_RC(SCHEMA_FIELD_NOT_EXIST)      \
  DEFINE_RC(SCHEMA_FIELD_MISSING)        \
  DEFINE_RC(SCHEMA_FIELD_TYPE_MISMATCH)  \
  DEFINE_RC(SCHEMA_INDEX_NAME_REPEAT)    \
  DEFINE_RC(IOERR_READ)                  \
  DEFINE_RC(IOERR_WRITE)                 \
  DEFINE_RC(IOERR_ACCESS)                \
  DEFINE_RC(IOERR_OPEN)                  \
  DEFINE_RC(IOERR_CLOSE)                 \
  DEFINE_RC(IOERR_SEEK)                  \
  DEFINE_RC(IOERR_TOO_LONG)              \
  DEFINE_RC(IOERR_SYNC)                  \
  DEFINE_RC(LOCKED_UNLOCK)               \
  DEFINE_RC(LOCKED_NEED_WAIT)            \
  DEFINE_RC(LOCKED_CONCURRENCY_CONFLICT) \
  DEFINE_RC(FILE_EXIST)                  \
  DEFINE_RC(FILE_NOT_EXIST)              \
  DEFINE_RC(FILE_NAME)                   \
  DEFINE_RC(FILE_BOUND)                  \
  DEFINE_RC(FILE_CREATE)                 \
  DEFINE_RC(FILE_OPEN)                   \
  DEFINE_RC(FILE_NOT_OPENED)             \
  DEFINE_RC(FILE_CLOSE)                  \
  DEFINE_RC(FILE_REMOVE)                 \
  DEFINE_RC(VARIABLE_NOT_EXISTS)         \
  DEFINE_RC(VARIABLE_NOT_VALID)          \
  DEFINE_RC(LOGBUF_FULL)                 \
  DEFINE_RC(LOG_FILE_FULL)               \
  DEFINE_RC(LOG_ENTRY_INVALID)           \
  DEFINE_RC(JSON_PARSE_FAILED)           \
  DEFINE_RC(JSON_MEMBER_MISSING)         \
  DEFINE_RC(RANGE_ERROR)                 \
  DEFINE_RC(WAL_INVALID_FILENAME)        \
  DEFINE_RC(INPUT_EOF)                   \
  DEFINE_RC(INVALID_TOKEN)               \
  DEFINE_RC(UNEXPECTED_END_OF_STRING)    \
  DEFINE_RC(SYNTAX_ERROR)                \
  DEFINE_RC(UNSUPPORTED)
//宏生成 enum class
enum class RC
{
#define DEFINE_RC(name) name,
  DEFINE_RCS
#undef DEFINE_RC
};

extern const char *strrc(RC rc);  // 把RC转字符串，比如 strrc(RC::SUCCESS) 返回 "SUCCESS"，打印日志用
extern bool OB_SUCC(RC rc);       // 判断是否成功：OB_SUCC(rc) <=> rc == RC::SUCCESS
extern bool OB_FAIL(RC rc);       // 判断是否失败：OB_FAIL(rc) <=> rc != RC::SUCCESS

## RC 代表「执行结果类别」，不是详细堆栈 / 错误信息

- `RC::SUCCESS`：正常执行成功
- `RC::NOTFOUND`：查找数据没找到（LSM 查询非常常用）
- `RC::NOMEM`：内存分配失败
- `RC::IOERR_READ`：磁盘读错误
- `RC::RECORD_DUPLICATE_KEY`：唯一键冲突
打印日志时用 `strrc()` 转成可读字符串


//[entry1][entry2]...[entryN][offset1][offset2]...[offsetN][offset_size(n)]

RC ObBlock::decode(const string &data)
{
  RC rc = RC::SUCCESS;
  // 指针指向的内存内容(*buf)不能改，指针buf本身可以修改
  const char    *buf             = data.data();
  uint32_t       block_total_len = static_cast<uint32_t>(data.size());
  const uint32_t uint32_len      = sizeof(uint32_t);
  // 最小长度：至少要存 offset_size(n) 4字节
  if (block_total_len < uint32_len) {
    rc = RC::INVALID_ARGUMENT;
    return rc;
  }
  // Step1：读取Block最后4字节，offset_size(n) = entry数量 N
  uint32_t offset_count       = get_numeric<uint32_t>(buf + block_total_len - uint32_len);
  uint32_t offset_array_bytes = offset_count * uint32_len;
  // Step2：计算offset数组起始位置
  uint32_t offset_array_start = block_total_len - uint32_len - offset_array_bytes;

  // 边界检查：offset_array_start不能溢出、不能负数
  if (offset_array_start > block_total_len) {
    rc = RC::RANGE_ERROR;
    return rc;
  }
  // Step3：entry区域 = [0, offset_array_start)，拷贝到data_、
  // 第二个参数是**字节个数**，不是结束地址。
  data_.assign(buf, offset_array_start);
  offsets_.resize(offset_count);
  const char *offset_ptr = buf + offset_array_start;  // offset数组第一个offset起始地址
  for (uint32_t i = 0; i < offset_count; i++) {
    offsets_[i] = get_numeric<uint32_t>(offset_ptr);
    offset_ptr += uint32_len;
  }

  return rc;
}
void ObSSTable::init()
{
  //**从 SST 文件尾部反向读取 meta 元数据，加载所有 BlockMeta 到内存`block_metas_`数组**。
  // 读文件尾部， 读出BlockMeta列表， 填充到block_metas
  // create_file_reader 内部会 open 文件，失败返回 nullptr
  file_reader_ = ObFileReader::create_file_reader(file_name_);
  if (file_reader_ == nullptr) {
    LOG_ERROR("open sst file failed, file=%s", file_name_.c_str());
    return;
  }
  // 获取整个文件大小；**最小合法性校验**：SST 至少要有末尾 4 字节 footer，否则是损坏空文件。
  uint32_t file_size = file_reader_->file_size();
  // 文件至少要能放下 4 字节的 footer（meta 区偏移）
  if (file_size < sizeof(uint32_t)) {
    LOG_ERROR("sst file is too small, file=%s", file_name_.c_str());
    return;
  }

  // 文件末尾 4 字节 = meta 区起始偏移（即 "meta size(n)" 所在位置）
  string footer = file_reader_->read_pos(file_size - sizeof(uint32_t), sizeof(uint32_t));
  // footer存meta_start： meta区域在整个SST里的起始位置偏移
  if (footer.size() != sizeof(uint32_t)) {
    LOG_ERROR("read sst footer failed, file=%s", file_name_.c_str());
    return;
  }
  uint32_t meta_start = get_numeric<uint32_t>(footer.data());

  // meta 区头部 4 字节 = block 数量 meta_count
  string meta_count_str = file_reader_->read_pos(meta_start, sizeof(uint32_t));
  // 清空`block_metas_`，预分配数组空间，避免 push_back 扩容开销
  if (meta_count_str.size() != sizeof(uint32_t)) {
    LOG_ERROR("read sst meta count failed, file=%s", file_name_.c_str());
    return;
  }
  uint32_t meta_count = get_numeric<uint32_t>(meta_count_str.data());

  block_metas_.clear();
  block_metas_.reserve(meta_count);

  // 依次读取每个 block meta：前面 4 字节是长度，后面是 BlockMeta 编码
  uint32_t pos = meta_start + sizeof(uint32_t);
  // pos是第一个meta起始位置
  for (uint32_t i = 0; i < meta_count; i++) {
    //[meta_count(4B)] [meta1_size(4B)][meta1二进制]
    string meta_size_str = file_reader_->read_pos(pos, sizeof(uint32_t));
    if (meta_size_str.size() != sizeof(uint32_t)) {
      LOG_ERROR("read sst block meta size failed, file=%s", file_name_.c_str());
      return;
    }
    uint32_t meta_size = get_numeric<uint32_t>(meta_size_str.data());
    //**跳过 meta_size 字段，定位到 BlockMeta 二进制数据的起始位置**。
    pos += sizeof(uint32_t);

    string meta_str = file_reader_->read_pos(pos, meta_size);
    if (meta_str.size() != meta_size) {
      LOG_ERROR("read sst block meta failed, file=%s", file_name_.c_str());
      return;
    }
    pos += meta_size;

    BlockMeta meta;
    if (meta.decode(meta_str) != RC::SUCCESS) {
      LOG_ERROR("decode block meta failed, file=%s, meta_idx=%u", file_name_.c_str(), i);
      return;
    }
    block_metas_.push_back(meta);
  }
}

shared_ptr<ObBlock> ObSSTable::read_block_with_cache(uint32_t block_idx) const
{
  // 无缓存时直接读磁盘
  if (block_cache_ == nullptr) {
    return read_block(block_idx);
  }

  // 用 (sst_id, block_id) 拼成单个 uint64 作为缓存 key
  uint64_t cache_key = (static_cast<uint64_t>(sst_id_) << 32) | block_idx;

  shared_ptr<ObBlock> block;
  if (block_cache_->get(cache_key, block)) {
    return block;
  }
  // 读磁盘
  block = read_block(block_idx);
  if (block != nullptr) {
    // 写缓存
    block_cache_->put(cache_key, block);
  }
  return block;
}

shared_ptr<ObBlock> ObSSTable::read_block(uint32_t block_idx) const
{
  // 越界， 返回
  if (block_idx >= block_metas_.size()) {
    return nullptr;
  }
  // 读内存
  const BlockMeta &meta = block_metas_[block_idx];
  // 随机读sst文件
  string data = file_reader_->read_pos(meta.offset_, meta.size_);
  if (data.size() != meta.size_) {
    LOG_ERROR("read block failed, file=%s, block_idx=%u", file_name_.c_str(), block_idx);
    return nullptr;
  }
  // 新建ObBlock智能指针，把二进制 data 反序列化成 block 内部有序 KV 表。**这部分全部是内存计算，没有 IO。**
  shared_ptr<ObBlock> block = make_shared<ObBlock>(comparator_);
  if (block->decode(data) != RC::SUCCESS) {
    LOG_ERROR("decode block failed, file=%s, block_idx=%u", file_name_.c_str(), block_idx);
    return nullptr;
  }
  return block;
}
```
### 实现LRU 模板类的代码，必须放在头文件（.h/.hpp），否则链接阶段报错
| 表达式                  | 含义                       | 类型              |
| -------------------- | ------------------------ | --------------- |
| `it`                 | map 的迭代器                 | `map_iterator`  |
| `it->first`          | map 里的 key               | `KeyType`       |
| `it->second`         | map 里的 value = **链表迭代器** | `list_iterator` |
| `it->second->first`  | 链表节点的 key                | `KeyType`       |
| `it->second->second` | 链表节点的 value              | `ValueType`     |

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
#pragma once
#include <stdint.h>
#include <cstddef>
#include <list>
#include <unordered_map>
#include <mutex>
namespace oceanbase {

template <typename KeyType, typename ValueType>
class ObLRUCache
{
public:
  ObLRUCache(size_t capacity) : capacity_(capacity) {}

  bool get(const KeyType &key, ValueType &value)
  {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = map_.find(key);
    if (it == map_.end()) {
      return false;
    }
    list_.splice(list_.begin(), list_, it->second);
    value = it->second->second;
    return true;
  }

  void put(const KeyType &key, const ValueType &value)
  {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = map_.find(key);
    if (it != map_.end()) {
      it->second->second = value;
      list_.splice(list_.begin(), list_, it->second);
      return;
    }
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
  size_t capacity_;
  mutable std::mutex mutex_;
  std::list<std::pair<KeyType, ValueType>> list_;
  std::unordered_map<KeyType, typename std::list<std::pair<KeyType, ValueType>>::iterator> map_;
};

template <typename Key, typename Value>
ObLRUCache<Key, Value> *new_lru_cache(uint32_t capacity)
{
  return new ObLRUCache<Key, Value>(capacity);
}

}  // namespace oceanbase

```


































#### 任务3: 实现 Leveled Compaction 功能，支持 SSTable 的合并
```Cpp

```
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
```







任务2: 实现 Block Cache 功能，加速 SSTable 的读取，实现 SSTable 组织数据的功能。
任务3: 实现 Leveled Compaction 功能，支持 SSTable 的合并
```Cpp

```
## SkipList

跳表（Skip List）是**有序链表 + 多层索引**，用来替代平衡树（红黑树、AVL 树），实现有序集合的：查找、插入、删除。

> 平衡树靠旋转维持平衡；跳表靠**随机层数**维持近似平衡，实现简单很多，Redis 的 zset 底层就是跳表。

普通有序链表痛点：
链表是有序的，但查找只能从头一个个往后遍历，时间复杂度 \(O(n)\)，很慢。

## 跳表核心思路：建立多层 “高速索引”

我们给底层原始链表（第 0 层，全量数据）往上叠加多层索引：

- level 0：原始链表，保存**全部真实节点**，按 key 有序；
- level 1：抽一部分节点作为一层索引；
- level 2：再从 level1 抽更少节点，更高层索引；
  越上层，节点越稀疏，相当于**高速公路**。

```
level 2:  5 -----------> 13
level 1:  3 ----> 7 ----> 11 ---->15
level 0: 1→3→5→7→9→11→13→15

```

查找 13 的流程：

1. 从最高层起点开始向右走；
2. 如果右边节点 ≤ target：向右；否则：**下沉一层**；
3. 一直下沉到第 0 层，最终找到目标。

查找 13：

- L2：起点→5，下一个是 13，不超，走到 13；找到，结束。
  对比原始链表，跳过了大量节点。

> 本质：用**空间换时间**，多层索引，二分思想，但是链表形态。

## 几个关键定义

1. **节点（Node）**
   每个节点不止一个后继指针，是一个指针数组 `next[]`。
   `next[i]` 代表这个节点在第 i 层的下一个节点。
   比如一个节点层数是 3，它就同时在 L0、L1、L2 三层都存在。

> ✅ 重点：**一个节点占据哪些层，是插入的时候随机投硬币决定的！**
> 这是跳表最灵魂的设计。

2. **最大层数 maxLevel**
   整个跳表允许的最高层数上限（比如 32），防止随机出来层数无限大。
3. **概率 p（晋升概率，一般 p=0.5）**
   插入节点的时候抛硬币：

- 50% 概率：层数 + 1，往上再晋升一层；
- 直到：抛到反面 或者 达到 maxLevel，停止。
  比如：

- 50%：停在 L0
- 25%：到 L1
- 12.5%：到 L2
- ...
  天然保证：高层节点数量指数级变少，分布均匀，近似平衡。
  👉 不需要像红黑树一样做旋转调整！

4. **头结点 head**
   头结点是一个特殊节点，它拥有 `next[0...maxLevel-1]` 所有层的指针，不存真实数据，是每层链表的起点。
   跳表永远从 head、当前最高层开始搜索。

## 三大操作的核心思想（只讲思路）

> `update[]` 数组：**每层上，刚好在目标左边的那个节点（前驱）**
> 插入和删除，都必须先找到每层的前驱，才能改链表指针。

### 🔍 查找 Search (key)

输入目标 key：

1. cur = head，从当前跳表最高层开始；
2. 循环：
   - 如果 cur.next [i] 存在 && cur.next [i].key < key：向右走；
   - 否则：i = i -1，下沉一层；
3. 下沉到第 0 层之后，检查 cur.next [0].key 是否等于 key；等于就找到。

> 时间复杂度期望：\(O(\log n)\)

### ➕ 插入 Insert (key)

目标：插入一个 key，维持有序，并且随机生成新节点的层数。

1. 先做一轮查找，沿途记录**每一层最后一个小于 key 的节点**，保存到 update [] 数组；
   update [i] = 第 i 层，新节点的前驱；
2. 随机生成新节点的 level；
3. 新节点的 next [i] 指向 update [i].next [i]；
4. update [i].next [i] = 新节点；（链表插入，每层修改指针）
5. 如果随机出来的 level 超过当前跳表最高层，更新跳表当前最高层。

```
## 举一个可视化例子


L2: head → 5 → 13
L1: head →3 →7 →11 →15
L0: head →1→3→5→7→9→11→13→15



假设我们要插入 key=9
我们从最高层 L2 开始往下搜：

- L2：head 右边是 5，5 <9；继续右，下一个是 13，13>9 → 停。
✅ L2 这一层，9 的前驱是 `5` → `update[2]=5`
- 下沉 L1：当前在 5，右边是 7，7<9；下一个是 11，11>9 → 停
✅ L1 这一层，9 的前驱是 `7` → `update[1]=7`
- 下沉 L0：当前在 7，右边是 9？还没插入，右边是 11>9 → 前驱是 7
✅ L0 这一层，9 的前驱是 `7` → `update[0]=7`

>
> 现在 update = [7,7,5]
> update [0]：L0 前驱；update [1]：L1 前驱；update [2]：L2 前驱

然后抛硬币，假设随机给新节点 9 生成 level=1。
意思：**这个节点只存在 L0、L1 两层，不会出现在 L2**。

### 第 3、4 步：逐层挂上新节点

我们只需要循环 i 从 0 到 newLevel-1（i=0，i=1）


// 新节点 next[i] 先接住原来前驱后面的节点
newNode.next[i] = update[i].next[i]
// 前驱的 next 指向新节点，完成链表插入
update[i].next[i] = newNode


- i=0（L0）：
update [0]=7。7 原来 L0 后面是 11。
newNode.next [0] = 11；7.next [0]=9。
- i=1（L1）：
update [1]=7。7 原来 L1 后面是 11。
newNode.next [1] =11；7.next [1]=9。
- i=2 不处理！因为新节点 level=1，不上 L2。

L2 链表不变，L1、L0 插入 9。
插入之后：


L2: head →5 →13
L1: head →3 →7 →9 →11 →15
L0: head →1→3→5→7→9→11→13→15



这就是插入全过程。
```

> update 数组是插入、删除共用的核心，记录每层前驱。

### ➖ 删除 Delete (key)

1. 同样查找，填充 update []；
2. 如果找到目标节点：遍历每一层 i，如果 update [i].next [i] == target，修改 update [i].next [i] = target.next [i]；
3. 删除之后，检查高层是不是空了，如果最高层没有节点了，把跳表当前层高往下缩。

## 复杂度总结（期望复杂度，不是最坏）

> 最坏情况（极端倒霉，所有节点都只在一层，退化成普通链表）O (n)，但概率极低。

- 查找：\(O(\log n)\)
- 插入：\(O(\log n)\)
- 删除：\(O(\log n)\)
- 空间：期望 \(O(n)\)，额外索引开销很小

##### 实现代码

```cpp
#include <cstdlib>
#include <ctime>
#include <iostream>
#include <vector>

using namespace std;
const int MAX_LEVEL = 32;
const double P = 0.5;
// skiplist node
struct Node {
  int key;
  // next[i] 代表第i层Node的后继节点
  vector<Node *> next;
  Node(int k, int level) : key(k), next(level, nullptr) {}
};
class SkipList {
private:
  Node *head;
  // 当前实际最高层 从0开始
  int curMaxLevel;
  // random generate newNode level
  int randomLevel() {
    int level = 0;
    while ((rand() / double(RAND_MAX)) < P && level < MAX_LEVEL - 1) {
      level++;
    }
    return level;
  }

public:
  SkipList() {
    srand((unsigned)time(nullptr));
    curMaxLevel = 0;
    // 头节点有MAX_LEVEL个后继指针
    head = new Node(-1, MAX_LEVEL + 1);
  }
  // 查找 + 填充update数组 (插入， 删除共用)
  /*
  目标：插入一个 key，维持有序，并且随机生成新节点的层数。

  1. 先做一轮查找，沿途记录**每一层最后一个小于 key 的节点**，保存到 update []
  数组； update [i] = 第 i 层，新节点的前驱；
  2. 随机生成新节点的 level；
  3. 新节点的 next [i] 指向 update [i].next [i]；
  4. update [i].next [i] = 新节点；（链表插入，每层修改指针）
  5. 如果随机出来的 level 超过当前跳表最高层，更新跳表当前最高层。
   删除 Delete (key)

  1. 同样查找，填充 update []；
  2. 如果找到目标节点：遍历每一层 i，如果 update [i].next [i] == target，修改
  update [i].next [i] = target.next [i]；
  3. 删除之后，检查高层是不是空了，如果最高层没有节点了，把跳表当前层高往下缩。
  */
  bool searchAndUpdate(int key, vector<Node *> &update) {
    update.assign(MAX_LEVEL, nullptr);
    Node *cur = head;
    for (int i = MAX_LEVEL - 1; i >= 0; i--) {
      while (cur->next[i] != nullptr && cur->next[i]->key < key) {
        cur = cur->next[i];
      }
      // cur就是第i层， Node的前驱
      update[i] = cur;
    }
    // 到第0层， 有序链表
    cur = cur->next[0];
    return (cur != nullptr && cur->key == key);
  }
  // 查找key, 对外接口
  bool search(int key) {
    vector<Node *> update;
    return searchAndUpdate(key, update);
  }
  // 插入key
  void insert(int key) {
    vector<Node *> update;
    bool exist = searchAndUpdate(key, update);
    if (exist) {
      cout << key << " 已经存在， 跳过插入\n";
      return;
    }
    // 生成随机层数
    int newLevel = randomLevel();
    cout << "insert " << key << ", 随机层数 level = " << newLevel << '\n';

    Node *newNode = new Node(key, newLevel + 1);
    // 从0层开始挂
    for (int i = 0; i <= newLevel; i++) {
      newNode->next[i] = update[i]->next[i];
      update[i]->next[i] = newNode;
    }
    //  如果新节点层数超过当前全局最高层，抬升最高层
    if (newLevel > curMaxLevel)
      curMaxLevel = newLevel;
  }
  // 删除key
  void remove(int key) {
    vector<Node *> update;
    bool exist = searchAndUpdate(key, update);
    if (!exist) {
      cout << key << " 不存在， 删除失败\n";
      return;
    }
    Node *target = update[0]->next[0];
    for (int i = 0; i <= curMaxLevel; i++) {
      if (update[i]->next[i] != target) {
        continue;
      }
      update[i]->next[i] = target->next[i];
    }
    delete target;
    // 顶层空， 收缩高度
    while (curMaxLevel > 0 && head->next[curMaxLevel] == nullptr) {
      curMaxLevel--;
    }
  }
  void print() {
    cout << "\n===== SkipList =====\n";
    for (int i = curMaxLevel; i >= 0; i--) {
      cout << "Level " << i << ": head";
      Node *p = head->next[i];
      while (p != nullptr) {
        cout << " -> " << p->key;
        p = p->next[i];
      }
      cout << "\n";
    }
    cout << "====================\n\n";
  }
  ~SkipList() {
    Node *cur = head;
    while (cur != nullptr) {
      Node *next = cur->next[0];
      delete cur;
      cur = next;
    }
  }
};

int main() {
  SkipList sl;

  // 先插入我们示例里的原始数据：1,3,5,7,11,13,15
  sl.insert(1);
  sl.insert(3);
  sl.insert(5);
  sl.insert(7);
  sl.insert(11);
  sl.insert(13);
  sl.insert(15);
  sl.print();

  cout << "-------- 插入 9 --------\n";
  sl.insert(9);
  sl.print();

  cout << "-------- 查找 9 --------\n";
  if (sl.search(9)) {
    cout << "找到 9\n";
  } else {
    cout << "没找到 9\n";
  }

  cout << "-------- 删除 9 --------\n";
  sl.remove(9);
  sl.print();

  return 0;
}
```

# LSM-Tree 笔记

LSM树：放弃单棵有序树，原地更新；
每层有序文件合并，把随机写转成顺序写。

整体分为两块：内存 + Immutable MemTable

- MemTable：内存里的有序结构，所有写入先落这里；
  插入、更新、删除 O(log n)；
  刷盘：不直接改老数据，追加新记录。
- Immutable MemTable：只读内存表
  MemTable 达到阈值（默认4MB）转为 Immutable；
  同时新开 MemTable 承接新写入；
  后台线程把 Immutable 转成磁盘上的 SSTable（有序持久化文件），顺序刷盘。

磁盘层：多层 SSTable（Level(n)），SSTable 磁盘上不可修改的有序文件
内部按 key 排序，带索引、布隆过滤器加速查询；
**高层 SSTable 之间 key 区间可能重叠；
L0层（Immutable落盘生成）SSTable之间 key 区间大量重叠；
L1及以后，同层 SSTable key 区间不重叠（跳表有序）**

## Compaction 策略

1. Leveled Compaction（分层压缩）
   分层区间隔离，后台合并生成新文件；
   读性能一般，写性能好。

2. Size-Tiered Compaction（分层大小合并）
   同大小文件一组合并；
   写吞吐更高，但读放大明显。

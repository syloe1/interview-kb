## 分布式缓存
直接接创建一个 map，每次有新数据就往 map 中插入不就好了，这不就是键值对缓存么？
issue: 内存有限， 如何处理？需要一个合理的淘汰策略
并发写入怎么保证安全 ？  lock
单机缓存性能不够， 怎么做负载均衡？   一致性哈希
## tutucache/lru/lru.go
> 实现LRU缓存
```Go
package lru
import (
	"container/list"
	"time"
)

// Cache 带TTL过期能力的LRU缓存
// 内存上限maxBytes；同时支持惰性过期(Get时检查) + 主动全量扫描过期(CleanupExpired)
type Cache struct {
	maxBytes int64                    // 最大允许占用字节数，0代表不限制内存
	nbytes   int64                    // 当前已经占用总内存(key+value)
	ll       *list.List               // 双向链表：Front是最近访问，Back是最久未访问
	cache    map[string]*list.Element // 哈希表，key映射链表节点，O(1)查找
	OnEvicted func(key string, value Value) // 元素被淘汰/过期删除时的回调
}

// entry 链表里面存储的单元，保存key、value、过期时间
type entry struct {
	key       string
	value     Value
	expiresAt time.Time // 过期时间；零值time.Time代表永不过期
}

// Value 接口，要求缓存值可以计算自身字节长度
type Value interface {
	Len() int
}

// New 创建LRU缓存实例
func New(maxBytes int64, onEvicted func(string, Value)) *Cache {
	return &Cache{
		maxBytes:  maxBytes,
		ll:        list.New(),
		cache:     make(map[string]*list.Element),
		OnEvicted: onEvicted,
	}
}

// Get 根据key读取缓存
// 惰性过期：命中时检查过期；已过期直接删除，返回ok=false
func (c *Cache) Get(key string) (value Value, ok bool) {
	if ele, ok := c.cache[key]; ok {
		kv := ele.Value.(*entry)
		// 判断是否过期
		if !kv.expiresAt.IsZero() && time.Now().After(kv.expiresAt) {
			c.ll.Remove(ele)
			delete(c.cache, kv.key)
			c.nbytes -= int64(len(kv.key)) + int64(kv.value.Len())
			if c.OnEvicted != nil {
				c.OnEvicted(kv.key, kv.value)
			}
			return nil, false
		}
		// 命中未过期，移到链表头部（最近访问）
		c.ll.MoveToFront(ele)
		return kv.value, true
	}
	return
}

// RemoveOldest 删除最久未访问节点（链表尾部），内存超限时调用
func (c *Cache) RemoveOldest() {
	ele := c.ll.Back()
	if ele != nil {
		c.ll.Remove(ele)
		kv := ele.Value.(*entry)
		delete(c.cache, kv.key)
		c.nbytes -= int64(len(kv.key)) + int64(kv.value.Len())
		if c.OnEvicted != nil {
			c.OnEvicted(kv.key, kv.value)
		}
	}
}

// Add 添加/更新缓存key，支持TTL
// ttl>0 设置过期时间；ttl=0代表永不过期
// 添加完成后循环检查内存上限，超出则持续淘汰最旧节点
func (c *Cache) Add(key string, value Value, ttl time.Duration) {
	var expiresAt time.Time
	if ttl > 0 {
		expiresAt = time.Now().Add(ttl)
	}

	if ele, ok := c.cache[key]; ok {
		// key已存在：更新value、过期时间，移动到头部
		c.ll.MoveToFront(ele)
		kv := ele.Value.(*entry)
		// 更新内存占用：新value大小减去旧value大小
		c.nbytes += int64(value.Len()) - int64(kv.value.Len())
		kv.value = value
		kv.expiresAt = expiresAt
	} else {
		// 新增key：插入链表头部，写入map，累加内存
		ele := c.ll.PushFront(&entry{key: key, value: value, expiresAt: expiresAt})
		c.cache[key] = ele
		c.nbytes += int64(len(key)) + int64(value.Len())
	}
	// 内存超限，循环淘汰最久未访问
	for c.maxBytes != 0 && c.maxBytes < c.nbytes {
		c.RemoveOldest()
	}
}

// Len 返回当前缓存条目数量
func (c *Cache) Len() int {
	return c.ll.Len()
}

// CleanupExpired 主动扫描，删除全部已过期条目
// 注意：调用这个方法前，外部必须自行加锁！
// 返回本次清理删除的条目数量
func (c *Cache) CleanupExpired() int {
	count := 0
	// 从尾部向前遍历，避免删除节点导致迭代器失效
	for e := c.ll.Back(); e != nil; {
		kv := e.Value.(*entry)
		prev := e.Prev()
		if !kv.expiresAt.IsZero() && time.Now().After(kv.expiresAt) {
			c.ll.Remove(e)
			delete(c.cache, kv.key)
			c.nbytes -= int64(len(kv.key)) + int64(kv.value.Len())
			if c.OnEvicted != nil {
				c.OnEvicted(kv.key, kv.value)
			}
			count++
		}
		e = prev
	}
	return count
}

```
## tutucache/lru/lru_test.go
> 测试LRU缓存
```Go
package lru

import (
	"container/list"
	"time"
)

// Cache 带TTL过期能力的LRU缓存
// 内存上限maxBytes；同时支持惰性过期(Get时检查) + 主动全量扫描过期(CleanupExpired)
type Cache struct {
	maxBytes  int64                         // 最大允许占用字节数，0代表不限制内存
	nbytes    int64                         // 当前已经占用总内存(key+value)
	ll        *list.List                    // 双向链表：Front是最近访问，Back是最久未访问
	cache     map[string]*list.Element      // 哈希表，key映射链表节点，O(1)查找
	OnEvicted func(key string, value Value) // 元素被淘汰/过期删除时的回调
}

// entry 链表里面存储的单元，保存key、value、过期时间
type entry struct {
	key       string
	value     Value
	expiresAt time.Time // 过期时间；零值time.Time代表永不过期
}

// Value 接口，要求缓存值可以计算自身字节长度
type Value interface {
	Len() int
}

// New 创建LRU缓存实例
func New(maxBytes int64, onEvicted func(string, Value)) *Cache {
	return &Cache{
		maxBytes:  maxBytes,
		ll:        list.New(),
		cache:     make(map[string]*list.Element),
		OnEvicted: onEvicted,
	}
}

// Get 根据key读取缓存
// 惰性过期：命中时检查过期；已过期直接删除，返回ok=false
func (c *Cache) Get(key string) (value Value, ok bool) {
	if ele, ok := c.cache[key]; ok {
		kv := ele.Value.(*entry)
		// 判断是否过期
		if !kv.expiresAt.IsZero() && time.Now().After(kv.expiresAt) {
			c.ll.Remove(ele)
			delete(c.cache, kv.key)
			c.nbytes -= int64(len(kv.key)) + int64(kv.value.Len())
			if c.OnEvicted != nil {
				c.OnEvicted(kv.key, kv.value)
			}
			return nil, false
		}
		// 命中未过期，移到链表头部（最近访问）
		c.ll.MoveToFront(ele)
		return kv.value, true
	}
	return
}

// RemoveOldest 删除最久未访问节点（链表尾部），内存超限时调用
func (c *Cache) RemoveOldest() {
	ele := c.ll.Back()
	if ele != nil {
		c.ll.Remove(ele)
		kv := ele.Value.(*entry)
		delete(c.cache, kv.key)
		c.nbytes -= int64(len(kv.key)) + int64(kv.value.Len())
		if c.OnEvicted != nil {
			c.OnEvicted(kv.key, kv.value)
		}
	}
}

// Add 添加/更新缓存key，支持TTL
// ttl>0 设置过期时间；ttl=0代表永不过期
// 添加完成后循环检查内存上限，超出则持续淘汰最旧节点
func (c *Cache) Add(key string, value Value, ttl time.Duration) {
	var expiresAt time.Time
	if ttl > 0 {
		expiresAt = time.Now().Add(ttl)
	}

	if ele, ok := c.cache[key]; ok {
		// key已存在：更新value、过期时间，移动到头部
		c.ll.MoveToFront(ele)
		kv := ele.Value.(*entry)
		// 更新内存占用：新value大小减去旧value大小
		c.nbytes += int64(value.Len()) - int64(kv.value.Len())
		kv.value = value
		kv.expiresAt = expiresAt
	} else {
		// 新增key：插入链表头部，写入map，累加内存
		ele := c.ll.PushFront(&entry{key: key, value: value, expiresAt: expiresAt})
		c.cache[key] = ele
		c.nbytes += int64(len(key)) + int64(value.Len())
	}
	// 内存超限，循环淘汰最久未访问
	for c.maxBytes != 0 && c.maxBytes < c.nbytes {
		c.RemoveOldest()
	}
}

// Len 返回当前缓存条目数量
func (c *Cache) Len() int {
	return c.ll.Len()
}

// CleanupExpired 主动扫描，删除全部已过期条目
// 注意：调用这个方法前，外部必须自行加锁！
// 返回本次清理删除的条目数量
func (c *Cache) CleanupExpired() int {
	count := 0
	// 从尾部向前遍历，避免删除节点导致迭代器失效
	for e := c.ll.Back(); e != nil; {
		kv := e.Value.(*entry)
		prev := e.Prev()
		if !kv.expiresAt.IsZero() && time.Now().After(kv.expiresAt) {
			c.ll.Remove(e)
			delete(c.cache, kv.key)
			c.nbytes -= int64(len(kv.key)) + int64(kv.value.Len())
			if c.OnEvicted != nil {
				c.OnEvicted(kv.key, kv.value)
			}
			count++
		}
		e = prev
	}
	return count
}

```     
## tutucache/cache.go
> `cache` 是对我们刚才写的`lru.Cache`的**并发安全包装层**。
原生 lru 没有锁，直接多协程读写会 data race；这个 struct 加`sync.Mutex`把`add/get/CleanupExpired`保护起来。
```Go
package geecache

import (
	"geecache/lru"
	"log"
	"sync"
	"time"
)

// cache 封装 lru.Cache，增加互斥锁保证并发安全
// ByteView 作为缓存值类型，对外屏蔽底层lru细节
type cache struct {
	mu         sync.Mutex
	lru        *lru.Cache
	cacheBytes int64 // 当前cache实例最大内存上限
}

// add 添加/更新缓存，带ttl过期时间
func (c *cache) add(key string, value ByteView, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	// 懒初始化：第一次add才创建lru实例
	if c.lru == nil {
		c.lru = lru.New(c.cacheBytes, func(key string, v lru.Value) {
			// 淘汰回调：LRU淘汰 / TTL过期删除都会进入这里，统计淘汰指标
			globalMetrics.RecordEviction()
		})
	}
	c.lru.Add(key, value, ttl)
}

// get 查询缓存
// 内部调用 lru.Get，命中时会自动执行MoveToFront更新LRU访问时序
func (c *cache) get(key string) (value ByteView, ok bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.lru == nil {
		return
	}
	if v, ok := c.lru.Get(key); ok {
		return v.(ByteView), ok
	}
	return
}

// StartCleanup 启动后台goroutine定时扫描清理过期key
// interval：扫描间隔；调用后会创建ticker循环执行 lru.CleanupExpired
// 注意：只需要调用一次，多次调用会创建多个清理协程
func (c *cache) StartCleanup(interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			c.mu.Lock()
			if c.lru != nil {
				n := c.lru.CleanupExpired()
				if n > 0 {
					log.Printf("[cache] cleaned up %d expired entries", n)
				}
			}
			c.mu.Unlock()
		}
	}()
}

```
## tutucache/byteview.go
> `ByteView` 包装`[]byte`，**做只读保护**，同时实现`lru.Value`接口，能够存入前面写的 LRU 缓存。
```Go
package geecache

// ByteView 缓存值的只读视图，实现 lru.Value 接口
// b 存储原始字节切片，对外不直接暴露底层数组，防止外部修改缓存内容
type ByteView struct {
	b []byte
}

// Len 实现 lru.Value 接口，返回字节长度，LRU用来统计内存占用
func (v ByteView) Len() int {
	return len(v.b)
}

// ByteSlice 返回一份底层字节的拷贝（深拷贝）
// 不直接return v.b，避免外部拿到切片引用后修改底层数组，污染缓存内数据
func (v ByteView) ByteSlice() []byte {
	return cloneBytes(v.b)
}

// String 将字节转为字符串返回，方便打印、调试
func (v ByteView) String() string {
	return string(v.b)
}

// cloneBytes 对[]byte做深拷贝，生成独立新切片
func cloneBytes(b []byte) []byte {
	c := make([]byte, len(b))
	copy(c, b)
	return c
}

```
### q： ByteView 是值类型，那`ByteView{b: buf}`赋值的时候，会拷贝底层数组吗？
> A：**不会**。结构体拷贝只会拷贝切片头指针、长度、容量，底层数组仍然共享。
> 所以外部想要拿到数据，必须调用`ByteSlice()`，触发 cloneBytes 深拷贝。
```
                            是
接收 key --> 检查是否被缓存 -----> 返回缓存值 ⑴
                |  否                         是
                |-----> 是否应当从远程节点获取 -----> 与远程节点交互 --> 返回缓存值 ⑵
                            |  否
                            |-----> 调用`回调函数`，获取值并添加到缓存 --> 返回缓存值 ⑶
```
### 如果缓存不存在， 应从数据源获取数据并添加到缓存中， 设计一个回调函数， 当缓存不存在时，调用这个函数， 得到源数据


## tutucache/geecache.go
> 分布式本地缓存，支持单机 + 多节点集群。Group 就是**缓存命名空间**。
> Group 是 GeeCache 的核心调度模块，作为缓存命名空间；对外提供 Get 查询，先查本地 LRU 缓存，miss 后通过 singleflight 合并并发请求，优先从集群其他节点读取，远程失败再调用 getter 回源数据库；同时集成熔断、TTL 过期、指标统计能力。
````
Group.Get(key)
    ├─ mainCache.get(key) ✅命中 → 返回（缓存命中）
    └─ 未命中 → g.load(key)（singleflight包裹，合并并发请求）
          ├─ PeerPicker挑选远程节点peer
          │   ├─ getFromPeer：访问远程节点
          │   │   ├─ 熔断器打开 → 快速失败
          │   │   ├─ 请求成功：返回ByteView，更新熔断器成功计数
          │   │   └─ 请求失败：熔断器失败计数+1，降级本地
          └─ getLocal：调用getter回源DB，拿到数据
               ├─ 封装ByteView（深拷贝）
               └─ populateCache写入mainCache（使用DefaultTTL）

````
```Go
，这是 Go 的【函数类型 + 接口适配】经典技巧：
1. 先定义接口 `Getter`，要求具备 `Get(key string) ([]byte, error)` 方法
2. 定义**自定义函数类型 `GetterFunc`**（它底层本质就是 `func(key string) ([]byte, error)`）
3. 给这个**函数类型 `GetterFunc` 添加方法 `Get()`**，于是 `GetterFunc` 自动满足 `Getter` 接口
// 提供被其他节点访问的能力
type Getter interface {
	Get(key string) ([]byte, error)
}

type GetterFunc func(key string) ([]byte, error)

func (f GetterFunc) Get(key string) ([]byte, error) {
	return f(key)
}

// Group 独立缓存命名空间，一组KV使用同一个Group，隔离不同业务缓存
type Group struct {
	name        string
	getter      Getter       // 缓存未命中时加载源数据的回调（DB/文件）
	mainCache   cache        // 本机并发安全LRU缓存
	peers       PeerPicker   // 节点选择器（一致性哈希，挑选远程节点）
	loader      *singleflight.Group // singleflight：合并同一个key并发请求，防止缓存击穿
	DefaultTTL  time.Duration       // 缓存默认过期时间，0代表永不过期
	breaker     *CircuitBreaker     // 远程节点熔断器，连续失败触发熔断降级
}

// RegisterPeers 注册节点选择器PeerPicker，只能调用一次
func (g *Group) RegisterPeers(peers PeerPicker) {
	if g.peers != nil {
		panic("RegisterPeerPicker called more than once")
	}
	g.peers = peers
}

var (
	mu     sync.RWMutex
	groups = make(map[string]*Group) // 全局保存所有Group
)

// NewGroup 创建Group实例，全局注册到groups map
func NewGroup(name string, cacheBytes int64, getter Getter) *Group {
	if getter == nil {
		panic("nil Getter")
	}
	mu.Lock()
	defer mu.Unlock()
	g := &Group{
		name:   name,
		getter: getter,
		mainCache: cache{
			cacheBytes: cacheBytes,
		},
		loader:  singleflight.NewGroup(),
		breaker: NewCircuitBreaker(3, 10*time.Second), // 连续失败3次，熔断10s
	}
	groups[name] = g
	return g
}

// GetGroup 根据name获取已经创建好的Group，读锁提升并发
func GetGroup(name string) *Group {
	mu.RLock()
	g := groups[name]
	mu.RUnlock()
	return g
}

// Get 缓存核心入口，查询key
func (g *Group) Get(key string) (ByteView, error) {
	if key == "" {
		return ByteView{}, fmt.Errorf("key is required")
	}
	// 1. 优先查本地缓存
	if v, ok := g.mainCache.get(key); ok {
		log.Println("[GeeCache] hit")
		globalMetrics.RecordHit()
		return v, nil
	}
	// 缓存未命中
	globalMetrics.RecordMiss()
	return g.load(key)
}

// load 缓存未命中：singleflight包装，并发请求合并
// 先尝试远程peer，远程失败再降级本地getter
func (g *Group) load(key string) (value ByteView, err error) {
	viewi, err := g.loader.Do(key, func() (interface{}, error) {
		if g.peers != nil {
			// 使用一致性哈希选择对应的远程节点
			if peer, ok := g.peers.PickPeer(key); ok {
				value, err = g.getFromPeer(peer, key)
				if err == nil {
					return value, nil
				}
				log.Println("[GeeCache] Failed to get from peer", err)
			}
		}
		// 没有远程节点 / 远程节点请求失败，回源本地getter
		return g.getLocal(key)
	})
	if err == nil {
		return viewi.(ByteView), nil
	}
	return
}

// getFromPeer 访问远程GeeCache节点获取缓存
func (g *Group) getFromPeer(peer PeerGetter, key string) (ByteView, error) {
	// 熔断器打开，直接快速失败，降级本地
	if g.breaker.IsOpen() {
		return ByteView{}, ErrCircuitOpen
	}
	req := &pb.Request{
		Group: g.name,
		Key:   key,
	}
	res := &pb.Response{}
	err := peer.Get(req, res)
	if err != nil {
		g.breaker.RecordFailure()
		return ByteView{}, err
	}
	g.breaker.RecordSuccess()
	globalMetrics.RecordPeerLoad()
	return ByteView{b: res.Value}, nil
}

// getLocal 本地回源：调用getter从DB/文件加载原始数据，写入缓存
func (g *Group) getLocal(key string) (ByteView, error) {
	globalMetrics.RecordLocalLoad()
	bytes, err := g.getter.Get(key)
	if err != nil {
		return ByteView{}, err
	}
	value := ByteView{
		b: cloneBytes(bytes),
	}
	g.populateCache(key, value)
	return value, nil
}

// populateCache 将加载出来的数据写入mainCache，使用Group默认TTL
func (g *Group) populateCache(key string, value ByteView) {
	g.mainCache.add(key, value, g.DefaultTTL)
}

// SetTTL 设置缓存默认TTL；cleanupInterval>0则启动后台过期清理协程
// cleanupInterval=0：只使用惰性过期（Get的时候才检查过期）
func (g *Group) SetTTL(ttl time.Duration, cleanupInterval time.Duration) {
	g.DefaultTTL = ttl
	if cleanupInterval > 0 {
		g.mainCache.StartCleanup(cleanupInterval)
	}
}
```

## tutucache/peer.go
> PeerPicker 和 PeerGetter 是分布式缓存的抽象接口。PeerPicker 通过一致性哈希根据 key 挑选远端节点；PeerGetter 负责和选中节点进行网络通信，获取缓存。两者解耦节点路由与网络传输，方便切换通信实现。
```Go
package geecache

import (
	pb "geecache/geecachepb"
)

// PeerPicker：用一致性哈希，找到key属于哪台服务器
// 负责【挑选节点】
type PeerPicker interface {
	PickPeer(key string) (peer PeerGetter, ok bool)
}

// PeerGetter：负责【和选中的远程节点通信，获取缓存】
type PeerGetter interface {
	Get(in *pb.Request, out *pb.Response) error
}

```

## 在标准库中，http.Handler接口
```Go
package http

type Handler interface {
    ServeHTTP(w ResponseWriter, r *Request)
}
```
## tutucache/http.go
> GeeCache **集群节点之间 HTTP 通信层**，同时包含**服务端**和**客户端**，并且实现了前面定义的两个接口：`PeerPicker`、`PeerGetter`
1. **HTTPPool**

- ✅ 实现 `PeerPicker`：内置一致性哈希，根据 key 挑选远端节点
- ✅ 实现 `http.Handler`（ServeHTTP）：作为**HTTP 服务端**，接收其他节点发来的缓存查询请求
- 维护集群节点列表、每个节点对应的 http 客户端
- 支持 TLS/mTLS、共享 Token 认证、服务发现自动更新节点

2. **httpGetter**

- ✅ 实现 `PeerGetter`：**HTTP 客户端**，用来向选中的远端节点发送 GET 请求
- 使用 protobuf 传输数据，带超时、token、tls 配置
```Go
Group.load()
  └── g.peers.PickPeer(key) → HTTPPool.PickPeer（一致性哈希选节点）
       └── peer (httpGetter).Get(req,res) → httpGetter发起http请求访问远端节点

package geecache

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"geecache/consistenthash"
	pb "geecache/geecachepb"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang/protobuf/proto"
)

const (
	defaultBasePath   = "/_geecache/"
	defaultReplicas   = 50
	// SharedTokenHeader 节点间认证 token 的 HTTP 头
	SharedTokenHeader = "X-Geecache-Token"
)

// =============================================================================
// HTTPPool — 节点间 HTTP 通信（服务端 + 客户端管理）
// HTTPPool 同时实现 PeerPicker 接口：负责节点选择
// =============================================================================
type HTTPPool struct {
	self         string        // 当前节点地址，例如 "http://127.0.0.1:8001"
	basePath     string        // 缓存接口路由前缀 /_geecache/
	mu           sync.Mutex
	peers        *consistenthash.Map // 一致性哈希实例，维护集群节点
	httpGetters  map[string]*httpGetter // key:节点地址，value：该节点http客户端
	tlsConfig    *tls.Config           // TLS/mTLS配置
	sharedToken  string                // 节点之间通信的共享token，用于简单认证
}

func NewHTTPPool(self string) *HTTPPool {
	return &HTTPPool{
		self:     self,
		basePath: defaultBasePath,
	}
}

// EnableTLS 加载证书，启用节点间 TLS 通信
// caCertFile 为空时只加密不校验客户端证书；非空时开启 mTLS
func (p *HTTPPool) EnableTLS(certFile, keyFile, caCertFile string) error {
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return fmt.Errorf("load cert: %w", err)
	}
	cfg := &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
	}
	if caCertFile != "" {
		caCert, err := os.ReadFile(caCertFile)
		if err != nil {
			return fmt.Errorf("read CA cert: %w", err)
		}
		caCertPool := x509.NewCertPool()
		caCertPool.AppendCertsFromPEM(caCert)
		cfg.RootCAs = caCertPool
	}
	p.tlsConfig = cfg
	return nil
}

// SetSharedToken 设置共享 Token（最简单内网认证方式）
func (p *HTTPPool) SetSharedToken(token string) {
	p.sharedToken = token
}

// TLSConfig 返回服务端 TLS 配置（供 main.go 的 http.Server 使用）
func (p *HTTPPool) TLSConfig() *tls.Config {
	return p.tlsConfig
}

func (p *HTTPPool) Log(format string, v ...interface{}) {
	log.Printf("[Server %s] %s", p.self, fmt.Sprintf(format, v...))
}

// =============================================================================
// 服务端：实现 http.Handler，接收其他节点发来的HTTP缓存查询请求
// =============================================================================
func (p *HTTPPool) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// /health 和 /metrics 不校验 token
	if r.URL.Path == "/health" {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
		return
	}
	if r.URL.Path == "/metrics" {
		MetricsHandler().ServeHTTP(w, r)
		return
	}
	// 节点间通信 — 校验共享 token
	if p.sharedToken != "" && r.Header.Get(SharedTokenHeader) != p.sharedToken {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if !strings.HasPrefix(r.URL.Path, p.basePath) {
		panic("HTTPPool serving unexpected path: " + r.URL.Path)
	}
	p.Log("%s %s", r.Method, r.URL.Path)
	// path格式 /_geecache/<group>/<key>
	parts := strings.SplitN(r.URL.Path[len(p.basePath):], "/", 2)
	if len(parts) != 2 {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	groupName := parts[0]
	key := parts[1]
	group := GetGroup(groupName)
	if group == nil {
		http.Error(w, "no such group: "+groupName, http.StatusNotFound)
		return
	}
	view, err := group.Get(key)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// protobuf序列化返回
	body, err := proto.Marshal(&pb.Response{Value: view.ByteSlice()})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Write(body)
}

// =============================================================================
// 节点管理
// =============================================================================
// Set 更新集群节点列表，构建一致性哈希环，初始化每个远端节点对应的httpGetter
func (p *HTTPPool) Set(peers ...string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.peers = consistenthash.New(defaultReplicas, nil)
	p.peers.Add(peers...)
	p.httpGetters = make(map[string]*httpGetter, len(peers))
	for _, peer := range peers {
		if peer == p.self {
			continue
		}
		p.httpGetters[peer] = newHTTPGetter(peer+p.basePath, p.tlsConfig, p.sharedToken)
	}
}

// ServiceDiscovery 是服务发现接口（这里只声明，后面单独实现）
type ServiceDiscovery interface {
	Register(addr string) error
	Watch(callback func(peers []string))
}

// StartDiscovery 接入服务发现，自动监听节点变更，动态更新peer列表
func (p *HTTPPool) StartDiscovery(d ServiceDiscovery) error {
	if err := d.Register(p.self); err != nil {
		return err
	}
	d.Watch(func(peers []string) {
		p.Log("discovery: peers updated %v", peers)
		p.Set(peers...)
	})
	return nil
}

// PickPeer 实现 PeerPicker 接口：根据key用一致性哈希挑选远端节点
func (p *HTTPPool) PickPeer(key string) (PeerGetter, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.peers == nil {
		return nil, false
	}
	peer := p.peers.Get(key)
	if peer != "" && peer != p.self {
		p.Log("Pick peer %s", peer)
		if getter, ok := p.httpGetters[peer]; ok {
			return getter, true
		}
	}
	return nil, false
}

// 编译期断言：HTTPPool 实现 PeerPicker
var _ PeerPicker = (*HTTPPool)(nil)

// =============================================================================
// HTTP 客户端 — httpGetter，实现 PeerGetter 接口
// 专门用来向远端节点发送HTTP请求获取缓存
// =============================================================================
type httpGetter struct {
	baseURL     string
	httpClient  *http.Client
	sharedToken string
}

// newHTTPGetter 创建客户端（包内使用）
func newHTTPGetter(baseURL string, tlsCfg *tls.Config, sharedToken string) *httpGetter {
	transport := &http.Transport{
		TLSClientConfig: tlsCfg,
	}
	return &httpGetter{
		baseURL: baseURL,
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   2 * time.Second,
		},
		sharedToken: sharedToken,
	}
}

// Get 实现PeerGetter，请求远端节点缓存
func (h *httpGetter) Get(in *pb.Request, out *pb.Response) error {
	u := fmt.Sprintf(
		"%v%v/%v",
		h.baseURL,
		url.QueryEscape(in.GetGroup()),
		url.QueryEscape(in.GetKey()),
	)
	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return err
	}
	if h.sharedToken != "" {
		req.Header.Set(SharedTokenHeader, h.sharedToken)
	}
	res, err := h.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned: %v", res.Status)
	}
	bytes, err := io.ReadAll(res.Body)
	if err != nil {
		return fmt.Errorf("reading response body: %v", err)
	}
	if err = proto.Unmarshal(bytes, out); err != nil {
		return fmt.Errorf("decoding response body: %v", err)
	}
	return nil
}

// 编译期断言：httpGetter 实现 PeerGetter
var _ PeerGetter = (*httpGetter)(nil)

````

## tutucache/consistenthash/consistenthash.go
> **一致性哈希算法实现**，专门给前面`HTTPPool`使用，用来决定 key 分配到集群里哪台节点。

```Go
package consistenthash

import (
	"hash/crc32"
	"sort"
	"strconv"
)

// Hash 自定义哈希函数类型，输入字节数组，输出uint32哈希值
type Hash func(data []byte) uint32

// Map 一致性哈希环结构体
type Map struct {
	hash     Hash           // 哈希函数
	replicas int            // 每个真实节点对应的虚拟节点数量
	keys     []int          // 哈希环上所有虚拟节点的哈希值，升序保存
	hashMap  map[int]string // key：虚拟节点hash值；value：对应的真实节点名称
}

// New 创建一致性哈希环实例
// replicas：每个真实节点生成多少虚拟节点；fn：自定义哈希函数，传nil默认使用crc32
func New(replicas int, fn Hash) *Map {
	m := &Map{
		replicas: replicas,
		hash:     fn,
		hashMap:  make(map[int]string),
	}
	// 如果没有传入哈希函数，默认使用 crc32.ChecksumIEEE
	if m.hash == nil {
		m.hash = crc32.ChecksumIEEE
	}
	return m
}

// Add 添加真实节点，支持一次性传入多个节点
func (m *Map) Add(keys ...string) {
	for _, key := range keys {
		// 一个真实节点生成 replicas 个虚拟节点
		for i := 0; i < m.replicas; i++ {
			// 构造虚拟节点标识，i用来区分同一个真实节点下不同虚拟副本
			virtualKey := strconv.Itoa(i) + key
			hashVal := int(m.hash([]byte(virtualKey)))
			m.keys = append(m.keys, hashVal)
			m.hashMap[hashVal] = key
		}
	}
	// 将所有虚拟节点哈希值升序排序，方便后续二分查找
	sort.Ints(m.keys)
}

// Get 根据缓存key，查找它归属的真实节点名称
func (m *Map) Get(key string) string {
	// 环上无节点直接返回空
	if len(m.keys) == 0 {
		return ""
	}
	// 计算缓存key对应的哈希值
	hashVal := int(m.hash([]byte(key)))
	// 二分查找：找到第一个 >= hashVal 的虚拟节点下标
	idx := sort.Search(len(m.keys), func(i int) bool {
		return m.keys[i] >= hashVal
	})
	// 环形逻辑：idx到数组末尾时，取第0号节点
	return m.hashMap[m.keys[idx%len(m.keys)]]
}

````
## tutucache/singleflight.go
>  经典**合并相同 key 并发请求**组件，GeeCache 在 `Group.load()` 里面调用，用来解决**缓存击穿**。
多个 goroutine 同时调用`Do同一个key`：

1. 第一个进来的协程：map 里没有这个 key → 创建`call`，写入 map，释放锁，执行 fn（回源 DB / 访问远程节点）
2. 同一时间其他协程：发现 map 已经存在这个 key 对应的 call → 释放锁，调用`c.wait()`阻塞等待
3. fn 执行完，执行`wg.Done()`，所有等待的协程被唤醒，拿到同一份 val、err 返回
4. 最后从 map 删除这个 key，下一次请求重新走一遍流程
```Go
package singleflight

import "sync"

// call 代表一次正在执行 / 已经执行完成的请求
type call struct {
	wg  sync.WaitGroup // 等待组，其他协程阻塞等待本次请求完成
	val interface{}    // fn 返回的结果
	err error          // fn 返回的错误
}

// Group singleflight 管理器，维护各个key对应的请求
type Group struct {
	mu sync.Mutex        // 保护map m并发安全
	m  map[string]*call  // key -> call：记录当前key是否有正在跑的请求
}

// NewGroup 构造Group实例，初始化map
func NewGroup() *Group {
	return &Group{
		m: make(map[string]*call),
	}
}

// Do 针对同一个key，并发多次调用Do时，fn只会执行一次
// 其余相同key的调用阻塞等待，复用第一次fn的返回结果
func (g *Group) Do(key string, fn func() (interface{}, error)) (interface{}, error) {
	g.mu.Lock()
	// 懒初始化兜底，防止外部直接new Group而不是NewGroup导致m为nil
	if g.m == nil {
		g.m = make(map[string]*call)
	}
	// 该key已有正在执行的请求
	if c, ok := g.m[key]; ok {
		g.mu.Unlock()
		return c.wait() // 阻塞等待结果，直接复用
	}
	// 当前key没有请求，新建call
	c := &call{}
    //只有第一个 goroutine 去启动任务，给 wg+1；
	// 其他 goroutine 全部阻塞等待这个任务完成。
	// 任务 Done 之后，所有等待 goroutine 被唤醒，拿到同一份返回值。wg 计数器记录的是【正在执行的任务数】，不是等待协程数量。
	c.wg.Add(1) //请求前加锁
	g.m[key] = c
	g.mu.Unlock()

	// 执行回源函数fn
	c.val, c.err = fn()
	c.wg.Done() // fn执行完毕，唤醒所有等待的协程

	// 清理map里这条记录
	g.mu.Lock()
	delete(g.m, key)
	g.mu.Unlock()

	return c.val, c.err
}

// wait 阻塞直到call对应的fn执行完成，返回结果
func (c *call) wait() (interface{}, error) {
	c.wg.Wait()
	return c.val, c.err
}

````
## tutucache/metrics.go
> GeeCache 监控指标模块，负责统计缓存运行状态：命中、未命中、本地回源、远程回源、淘汰次数、内存占用，并对外提供 Prometheus 风格 HTTP 指标接口，实现可观测性。
```Go
package geecache

import (
	"fmt"
	"net/http"
	"sync/atomic"
)

// =============================================================================
// 全局指标
// =============================================================================

type Metrics struct {
	Hits       int64 // 命中次数
	Misses     int64 // 未命中次数
	LocalLoads int64 // 从本地数据源加载次数
	PeerLoads  int64 // 从远程节点加载次数
	Evictions  int64 // 淘汰条目数
	TotalBytes int64 // 当前占用内存（近似值）
}

var globalMetrics = &Metrics{}

// =============================================================================
// 写入方法 — 在关键路径上由 Group / cache 调用
// =============================================================================

func (m *Metrics) RecordHit()       { atomic.AddInt64(&m.Hits, 1) }
func (m *Metrics) RecordMiss()      { atomic.AddInt64(&m.Misses, 1) }
func (m *Metrics) RecordLocalLoad() { atomic.AddInt64(&m.LocalLoads, 1) }
func (m *Metrics) RecordPeerLoad()  { atomic.AddInt64(&m.PeerLoads, 1) }
func (m *Metrics) RecordEviction()  { atomic.AddInt64(&m.Evictions, 1) }
func (m *Metrics) SetTotalBytes(n int64) {
	atomic.StoreInt64(&m.TotalBytes, n)
}

// =============================================================================
// 读取方法 — 供外部查询
// =============================================================================
// 命中率
func (m *Metrics) HitRate() float64 {
	hits := atomic.LoadInt64(&m.Hits)
	misses := atomic.LoadInt64(&m.Misses)
	total := hits + misses
	if total == 0 {
		return 0
	}
	return float64(hits) / float64(total)
}

// 指标快照，返回一份值拷贝
func (m *Metrics) Snapshot() Metrics {
	return Metrics{
		Hits:       atomic.LoadInt64(&m.Hits),
		Misses:     atomic.LoadInt64(&m.Misses),
		LocalLoads: atomic.LoadInt64(&m.LocalLoads),
		PeerLoads:  atomic.LoadInt64(&m.PeerLoads),
		Evictions:  atomic.LoadInt64(&m.Evictions),
		TotalBytes: atomic.LoadInt64(&m.TotalBytes),
	}
}

// =============================================================================
// HTTP 端点 — 注册到 HTTPPool 的路由中
// =============================================================================

// MetricsHandler 返回一个 http.Handler，对外暴露 Prometheus 风格指标
func MetricsHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s := globalMetrics.Snapshot()
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintf(w, "# HELP geecache_hits_total Total number of cache hits\n")
		fmt.Fprintf(w, "# TYPE geecache_hits_total counter\n")
		fmt.Fprintf(w, "geecache_hits_total %d\n", s.Hits)
		fmt.Fprintf(w, "# HELP geecache_misses_total Total number of cache misses\n")
		fmt.Fprintf(w, "# TYPE geecache_misses_total counter\n")
		fmt.Fprintf(w, "geecache_misses_total %d\n", s.Misses)
		fmt.Fprintf(w, "# HELP geecache_local_loads_total Total number of local loads\n")
		fmt.Fprintf(w, "# TYPE geecache_local_loads_total counter\n")
		fmt.Fprintf(w, "geecache_local_loads_total %d\n", s.LocalLoads)
		fmt.Fprintf(w, "# HELP geecache_peer_loads_total Total number of peer loads\n")
		fmt.Fprintf(w, "# TYPE geecache_peer_loads_total counter\n")
		fmt.Fprintf(w, "geecache_peer_loads_total %d\n", s.PeerLoads)
		fmt.Fprintf(w, "# HELP geecache_evictions_total Total number of evictions\n")
		fmt.Fprintf(w, "# TYPE geecache_evictions_total counter\n")
		fmt.Fprintf(w, "geecache_evictions_total %d\n", s.Evictions)
		fmt.Fprintf(w, "# HELP geecache_hit_rate Cache hit rate\n")
		fmt.Fprintf(w, "# TYPE geecache_hit_rate gauge\n")
		fmt.Fprintf(w, "geecache_hit_rate %.4f\n", s.HitRate())
		fmt.Fprintf(w, "# HELP geecache_cache_bytes Current cache size in bytes\n")
		fmt.Fprintf(w, "# TYPE geecache_cache_bytes gauge\n")
		fmt.Fprintf(w, "geecache_cache_bytes %d\n", s.TotalBytes)
	})
}

```
## tutucache/circuitbreaker.go
> 熔断器，保护 GeeCache 节点，防止远端 peer 节点故障时，大量请求持续访问故障节点，拖垮当前节点。核心思想：**故障时快速失败、自动探测恢复**。
```Go
package geecache

import (
	"fmt"
	"sync"
	"time"
)

// =============================================================================
// CircuitBreaker — 熔断器，保护本节点不被故障远端拖垮
//
// 状态机：
//   Closed ──连续N次失败──► Open ──timeout到期──► HalfOpen
//     ▲                                              │
//     └────── 请求成功 ◄──────────────────────────────┘
//               请求失败 → 重新回到 Open
// =============================================================================

type State int

const (
	StateClosed   State = iota // 正常：允许请求
	StateOpen                  // 熔断：直接拒绝，快速失败
	StateHalfOpen              // 半开：放行一个探测请求
)

// ErrCircuitOpen 熔断打开时返回的错误，调用方据此触发降级
var ErrCircuitOpen = fmt.Errorf("circuit breaker is open")

type CircuitBreaker struct {
	mu            sync.Mutex
	state         State
	failureCount  int
	failureThresh int           // 连续失败 N 次 → 熔断
	timeout       time.Duration // 熔断多久后尝试恢复
	lastFailure   time.Time
}

// NewCircuitBreaker 创建熔断器，thresh 为失败阈值，timeout 为熔断恢复等待
func NewCircuitBreaker(thresh int, timeout time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		state:         StateClosed,
		failureThresh: thresh,
		timeout:       timeout,
	}
}

// IsOpen 返回 true 表示熔断中，调用方应跳过远程请求直接降级
func (cb *CircuitBreaker) IsOpen() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case StateClosed:
		return false
	case StateOpen:
		// 到了恢复时间 → 进入半开状态，放行一个探测请求
		if time.Since(cb.lastFailure) > cb.timeout {
			cb.state = StateHalfOpen
			return false // 半开状态允许请求
		}
		return true // 熔断中，拒绝
	case StateHalfOpen:
		return false // 放行
	}
	return false
}

// RecordSuccess 请求成功时调用：半开→关闭，重置计数
func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.state = StateClosed
	cb.failureCount = 0
}

// RecordFailure 请求失败时调用：递增计数，达到阈值进入熔断
func (cb *CircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.failureCount++
	cb.lastFailure = time.Now()

	if cb.failureCount >= cb.failureThresh || cb.state == StateHalfOpen {
		// 连续失败达阈值 或 半开探测失败 → 进入熔断
		cb.state = StateOpen
	}
}

```
## tutucache/discovery.go
> 定义**服务发现抽象接口**，解耦 GeeCache 和具体注册中心实现（etcd/consul/nacos 或者静态配置）。
作用：集群节点自动感知，节点上下线自动更新 peer 列表，更新一致性哈希环。
```Go
type ServiceDiscovery interface {
	// GetPeers 获取集群所有节点地址列表
	GetPeers() ([]string, error)
	// Register 将当前节点注册到注册中心
	Register(add string) error
	// Watch 监听节点列表变更；节点变化时回调onChange，传入最新节点列表
	Watch(onChange func([]string))
}
1. `GetPeers() ([]string, error)`
主动拉取全部集群节点地址。启动时初始化 peer 列表、构建一致性哈希环使用。
2. `Register(add string) error`
把当前节点地址注册到注册中心，告知集群 “我上线了”。程序启动时调用。
3. `Watch(onChange func([]string))`
持续监听注册中心节点变更（新节点加入 / 节点下线）。
一旦节点列表变化，自动执行回调函数 `onChange`；回调内部一般**重建一致性哈希环、更新 HTTPPool peers**。
```
## tutucache/filediscovery.go
`FileDiscovery` 是 `Discovery` 接口的**本地 JSON 文件实现**
- 通过读写 peers.json 维护集群节点列表，后台定时轮询检测文件变更，节点变化触发回调更新 GeeCache 的 peer 节点与一致性哈希环。
- peers.json 格式：`["http://localhost:8001", "http://localhost:8002"]`

```Go
package geecache

import (
	"encoding/json"
	"log"
	"os"
	"time"
)

// =============================================================================
// FileDiscovery — 基于 JSON 文件的服务发现（无外部依赖）
//
// peers.json 格式: ["http://localhost:8001", "http://localhost:8002", ...]
//
// 使用方式：
//
//	d := geecache.NewFileDiscovery("http://localhost:8001", "peers.json")
//	pool.StartDiscovery(d)
// =============================================================================

type FileDiscovery struct {
	self     string //本节点地址（如 "http://localhost:8001"）
	filePath string //共享peers.json路径
	stopCh   chan struct{}
}

func NewFileDiscovery(self, filePath string) *FileDiscovery {
	return &FileDiscovery{
		self:     self,
		filePath: filePath,
		stopCh:   make(chan struct{}),
	}
}

// GetPeers 读取 peers.json，返回所有节点地址
func (d *FileDiscovery) GetPeers() ([]string, error) {
	data, err := os.ReadFile(d.filePath)
	if err != nil {
		return nil, err
	}
	var peers []string
	if err := json.Unmarshal(data, &peers); err != nil {
		return nil, err
	}
	return peers, nil
}

// Register 将当前节点地址写入 peers.json（去重合并写入）
func (d *FileDiscovery) Register(addr string) error {
	existing, _ := d.GetPeers() // 文件不存在，得到nil
	seen := make(map[string]bool)
	for _, p := range existing {
		seen[p] = true
	}
	seen[addr] = true //把当前节点加入集合

	var merged []string
	for p := range seen {
		merged = append(merged, p)
	}

	data, err := json.MarshalIndent(merged, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(d.filePath, data, 0644)
}

// Watch 启动后台轮询：每 3 秒读一次文件，发现变化时回调 onChange
func (d *FileDiscovery) Watch(onChange func([]string)) {
	var lastPeers []string //保存上一次读的节点列表， 用来对比是否发生变更
	go func() {
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop() 

		if peers, err := d.GetPeers(); err == nil {
			onChange(peers) //执行回调， initialize nodes 
			lastPeers = peers
		}
		for {
			select {
			case <- d.stopCh: //收到关闭信号
				return 
			case <-ticker.C:
				peers, err := d.GetPeers()
				if err != nil {
					log.Printf("[FileDiscovery] read peers error: %v", err)
					continue 
				}
				if !sameSlice(peers, lastPeers) {
					log.Printf("[FileDiscovery] peers changed: %v", peers)
					onChange(peers)       // 节点变化！触发回调通知上层
					lastPeers = peers     // 更新基准列表
				}
			}
		}
	}()
}

// Close 停止后台 Watch 轮询
func (d *FileDiscovery) Close() {
	close(d.stopCh)
}

func sameSlice(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	m := make(map[string]bool, len(a))
	for _, s := range a {
		m[s] = true
	}
	for _, s := range b {
		if !m[s] {
			return false
		}
	}
	return true
}

```
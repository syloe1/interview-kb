### OPtion模式

```go
type Server struct {
    addr string
    timeout time.Duration
    logger *log.Logger
}
type Option func(*Server)

func WithAddr(s string) Option {
    return func(srv *Server) { srv.addr = s }
}
func WithTimeout(d time.Duration) Option {
    return func(srv *Server) { srv.timeout = d }
}

func NewServer(opts ...Option) *Server {
    srv := &Server{addr: ":8080"}
    for _, o := range opts {
        o(srv)
    }
    return srv
}
// 使用：NewServer(WithAddr(":9000"), WithTimeout(5*time.Second))

```

### 装饰器模式 中间件

> 内部能力不变， 外部叠加能力

```go
type Handler interface {
    ServeHTTP(w http.ResponseWriter, r *http.Request)
}
// 日志中间件，包装 handler
func LogMiddleware(h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        h.ServeHTTP(w, r)
        fmt.Println("cost:", time.Since(start))
    })
}

```

### 策略模式

> 接口抽象算法， 多种失效， 运行时替换

```go
type Payment interface {
    Pay(amount int64) error
}
type WechatPay struct{}
func (w *WechatPay) Pay(amount int64) error { ... }
type AliPay struct{}
func (a *AliPay) Pay(amount int64) error { ... }

```

### 单例模式

```go
var (
    dbInstance *DB
    once       sync.Once
)
func GetDB() *DB {
    once.Do(func() {
        dbInstance = &DB{}
    })
    return dbInstance
}

```

### 工厂模式

> 统一入口函数，根据参数，返回不同接口实现，使用者只依赖接口，不关心具体结构体

```go
package main

import "fmt"

// 抽象产品：存储接口
type Storage interface {
	Save(key string, val string) error
	Get(key string) (string, error)
}

// 实现1：MySQL存储
type MysqlStore struct{}

func (m *MysqlStore) Save(key string, val string) error {
	fmt.Printf("mysql save %s=%s\n", key, val)
	return nil
}
func (m *MysqlStore) Get(key string) (string, error) {
	return "mysql-data:" + key, nil
}

// 实现2：Redis存储
type RedisStore struct{}

func (r *RedisStore) Save(key string, val string) error {
	fmt.Printf("redis save %s=%s\n", key, val)
	return nil
}
func (r *RedisStore) Get(key string) (string, error) {
	return "redis-data:" + key, nil
}

// ===== 简单工厂 =====
func NewStorage(typ string) Storage {
	switch typ {
	case "mysql":
		return &MysqlStore{}
	case "redis":
		return &RedisStore{}
	default:
		panic("unknown storage type")
	}
}

func main() {
	s := NewStorage("redis")
	s.Save("name", "lizhe")
	fmt.Println(s.Get("name"))
}

```

### 适配器模式

> 包装一层， 兼容旧代码， 第三方SDK

```go
package main

import "fmt"

// 我们项目期望的统一 Logger 接口
type Logger interface {
	Info(msg string)
	Error(msg string)
}

// 第三方老日志库，接口不一样！
type ThirdLog struct{}

func (t *ThirdLog) LogPrint(level int, s string) {
	if level == 1 {
		fmt.Println("[Third INFO]", s)
	} else {
		fmt.Println("[Third ERROR]", s)
	}
}

// ===== 适配器：把 ThirdLog 适配成 Logger =====
type LogAdapter struct {
	third *ThirdLog
}

func (a *LogAdapter) Info(msg string) {
	a.third.LogPrint(1, msg)
}
func (a *LogAdapter) Error(msg string) {
	a.third.LogPrint(2, msg)
}

func main() {
	var log Logger = &LogAdapter{third: &ThirdLog{}}
	log.Info("start server")
	log.Error("connect failed")
}

```

### 代理模式

> 一句话：持有真实对象，对外暴露一样的接口；在调用真实对象**前后做控制、缓存、鉴权、延迟初始化**，调用方感知不到代理存在

```go
package main

import "fmt"

type DataStore interface {
	Query(id int) string
}

// 真实对象：DB查询，比较慢
type RealDB struct{}

func (r *RealDB) Query(id int) string {
	fmt.Println("==== 访问真实DB ====")
	return fmt.Sprintf("data-%d", id)
}

// 代理对象：增加缓存
type CacheProxy struct {
	real  DataStore
	cache map[int]string
}

func NewCacheProxy(real DataStore) *CacheProxy {
	return &CacheProxy{
		real:  real,
		cache: make(map[int]string),
	}
}

func (p *CacheProxy) Query(id int) string {
	// 先查缓存
	if v, ok := p.cache[id]; ok {
		fmt.Println("hit cache")
		return v
	}
	// 没命中，走真实DB
	res := p.real.Query(id)
	p.cache[id] = res
	return res
}

func main() {
	db := &RealDB{}
	proxy := NewCacheProxy(db)
	fmt.Println(proxy.Query(1))
	fmt.Println(proxy.Query(1)) // 第二次命中缓存
}

```

### 观察者模式

> 主题（被观察者）维护一堆订阅者；当事件发生，自动通知所有订阅者；解耦发布方和订阅方

```go
package main

import "fmt"

// 观察者接口
type Observer interface {
	OnEvent(msg string)
}

// 主题（被观察者）
type Subject struct {
	obs []Observer
}

// 订阅
func (s *Subject) Attach(o Observer) {
	s.obs = append(s.obs, o)
}

// 取消订阅
func (s *Subject) Detach(o Observer) {
	for i, v := range s.obs {
		if v == o {
			s.obs = append(s.obs[:i], s.obs[i+1:]...)
			break
		}
	}
}

// 推送事件给所有观察者
func (s *Subject) Notify(msg string) {
	for _, o := range s.obs {
		o.OnEvent(msg)
	}
}

// 订阅者A
type UserA struct{}

func (u *UserA) OnEvent(msg string) {
	fmt.Printf("UserA receive: %s\n", msg)
}

// 订阅者B
type UserB struct{}

func (u *UserB) OnEvent(msg string) {
	fmt.Printf("UserB receive: %s\n", msg)
}

func main() {
	sub := &Subject{}
	sub.Attach(&UserA{})
	sub.Attach(&UserB{})

	sub.Notify("服务器启动成功！")
}

```

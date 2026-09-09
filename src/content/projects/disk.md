## cmd/file-service/main.go
> main包只做 启动， 信号监听， 优雅退出。 业务逻辑在 file-service/server 包中。
> file-service文件元数据服务入口， 提供文件夹CURD, 回收站，目录树。 
- gRPC:9002 / HTTP:8002 / Metrics:9102
```Go
// Package main 文件服务 (file-service) 入口
// 提供文件元数据管理：创建文件夹、列表、重命名、移动、删除、恢复、回收站、目录树
//
// 服务端口: gRPC :9002 | HTTP :8002 | Metrics :9102
package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/kratos/clouddisk/app/file/server"
)

var (
	// configPath 配置文件路径，通过 -conf 命令行参数指定
	configPath string
)
//go 特殊函数，**在 main 函数执行之前自动运行**
//`flag.StringVar(变量地址, 参数名, 默认值, 帮助提示)`
func init() {
	flag.StringVar(&configPath, "conf", "../../app/file/configs/config.yaml", "配置文件路径")
}

func main() {
	flag.Parse()

	// 验证配置文件存在 
    //os.Stat获取文件信息 `os.IsNotExist(err)` 判断是不是文件不存在错误
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "配置文件不存在: %s\n", configPath)
		fmt.Fprintf(os.Stderr, "用法: file-service -conf <配置文件路径>\n")
		os.Exit(1)
	}

	// 初始化服务器
	app, cleanup, err := server.InitServer(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "初始化服务失败: %v\n", err)
        //`os.Exit(1)`：非 0 退出码，代表进程异常退
		os.Exit(1)
	}
	defer cleanup()

	// 监听操作系统信号，实现优雅关闭
	quit := make(chan os.Signal, 1)
    /*
    `signal.Notify`：告诉 Go 运行时，把 `SIGINT`、`SIGTERM` 转发到 quit 通道
    - `SIGINT`：按下 `Ctrl+C`
    - `SIGTERM`：`docker stop` / `k8s pod delete` 发送的终止信号
    */
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-quit
		fmt.Printf("\n收到信号 %v，正在优雅关闭...\n", sig)
        //一旦收到信号，调用 `app.Stop()`
        // /`app.Stop()` 是 kratos 内置方法：
    //停止 http、grpc 监听，等待正在处理的请求执行完毕
		if err := app.Stop(); err != nil {
			fmt.Fprintf(os.Stderr, "关闭服务失败: %v\n", err)
		}
	}()

	// 启动服务（阻塞直到 app.Stop() 被调用）
	fmt.Printf("file-service 启动成功\n")
	fmt.Printf("  gRPC:  %s\n", "0.0.0.0:9002")
	fmt.Printf("  HTTP:  %s\n", "0.0.0.0:8002")
	fmt.Printf("  Metrics: %s\n", "0.0.0.0:9102")

	if err := app.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "服务运行出错: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("file-service 已停止")
}

```
## cmd/user-service/main.go
> 解析命令行参数 → 读取 yaml 配置到结构体 → 调用 server.InitServer 初始化 Kratos app、db、redis、路由 → 注册 defer 资源清理 → 开 goroutine 监听关闭信号 → app.Run 阻塞启动服务 → 收到信号调用 app.Stop 优雅关闭 → main 退出执行 cleanup
```Go
// Package main user-service 入口
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/go-kratos/kratos/v2/config"
	"github.com/go-kratos/kratos/v2/config/file"

	"github.com/kratos/clouddisk/app/user/server"
)

// ============================================================================
// main user-service 启动入口
// ============================================================================

func main() {
	// 解析命令行参数
	confPath := flag.String("conf", "../../app/user/configs/config.yaml", "配置文件路径")
	flag.Parse()

	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Printf("[INFO] ========================================")
	log.Printf("[INFO]   user-service starting...")
	log.Printf("[INFO]   config: %s", *confPath)
	log.Printf("[INFO] ========================================")

	// 加载配置文件
	cfg := &server.AppConfig{}
	if err := loadConfig(*confPath, cfg); err != nil {
		log.Printf("[WARN] 无法加载配置文件 %s: %v, 使用默认配置", *confPath, err)
	}

	// 初始化服务器
	app, cleanup, err := server.InitServer(cfg)
	if err != nil {
		log.Fatalf("[FATAL] 初始化服务器失败: %v", err)
	}
	defer cleanup()

	// 监听系统信号用于优雅关闭
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-quit
		log.Println("[INFO] 收到关闭信号, 正在优雅关闭...")
		if err := app.Stop(); err != nil {
			log.Printf("[ERROR] 关闭服务器失败: %v", err)
		}
	}()

	// 启动服务器
	if err := app.Run(); err != nil {
		log.Fatalf("[FATAL] 启动服务器失败: %v", err)
	}
}

// loadConfig 从 YAML 文件加载配置
func loadConfig(path string, cfg *server.AppConfig) error {
    //stat判断文件是否存在
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return fmt.Errorf("config file not found: %s", path)
	}

	c := config.New(
		config.WithSource(
			file.NewSource(path),
		),
	)

	if err := c.Load(); err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	if err := c.Scan(cfg); err != nil {
		return fmt.Errorf("scan config: %w", err)
	}

	return nil
}

```


## 项目结构
```
kratos/
├── api/                     ← 第1步看：接口定义（Proto）
├── cmd/                     ← 第5步看：启动入口（一行启动代码）
├── app/                     ← 第3-4步看：业务代码（DDD 四层）
├── internal/                ← 第2步看：共享基础设施
├── third_party/             ← Proto 依赖（不用管）
├── db/migrations/           ← SQL 建表
├── gen/go/                  ← Proto 编译出的 Go 代码
├── scripts/                 ← 工具脚本
├── go.mod                   ← Go 模块定义（module github.com/kratos/clouddisk）
└── Makefile

Go 规定：`internal/` 目录下的包，**只能被它的父目录树内的代码导入**。
```

## 在 Kratos 中，**写任何代码之前，先写 Proto**。Proto 是：

- 接口定义（gRPC Service + Method）
- 数据结构（Message）
- HTTP 路由映射（google.api.http annotation）
- 参数校验规则（validate 注解）
## app/服务名/configs 下面是yaml配置文件
## app/服务名/server 依赖注入，不写业务
```
1. 初始化链路追踪 Tracer（Jaeger），注册 shutdown 到 cleanup 数组
2. 初始化 MySQL：Open → 设置连接池参数 → Ping 校验，注册 db.Close 到 cleanup
3. 初始化 Redis 客户端 → Ping 校验，注册 rdb.Close 到 cleanup
4. 初始化 JWT Manager（生成 / 解析 token）
5. **依赖注入组装链路：data.Repo → biz.UseCase → service.Servic**
```
## app/服务名/internal/biz层 仓储层，领域实体 + Repo抽象接口 + UseCase(业务用例)
````
**User 实体 = 单个用户自身的数据 + 自身行为（设置密码、校验密码）**
**UserRepo 接口 = 存取用户的抽象能力（增删查改）**
**UserUseCase = 业务流程编排器：把实体、Repo、外部工具（JWT）串起来，完成一整套业务动作**
````
## app/服务名/internal/data层  实现biz层定义的接口， 与数据库交互
````
**UserRepo 实现 = 数据库操作：增删查改用户**
````

**先打开 `app/user/internal/biz/user.go`**，看前 50 行：

```go
// User 是领域实体——只包含业务字段，不包含数据库 tag
type User struct {
    ID           int64
    Username     string
    PasswordHash string
    // ...
}

// UserRepo 是接口——Biz 层只依赖这个接口，不依赖具体实现
type UserRepo interface {
    CreateUser(ctx context.Context, user *User) (*User, error)
    GetByUsername(ctx context.Context, username string) (*User, error)
    // ...
}

// UserUseCase 是业务用例——所有业务逻辑在这里
type UserUseCase struct {
    repo       UserRepo        // 依赖接口
    jwtManager *jwt.JWTManager // 依赖外部工具
}

func (uc *UserUseCase) Register(ctx context.Context, username, password, email, phone string) (*User, error) {
    // 1. 参数验证（这是业务规则）
    if len(username) < 3 { return nil, errors.New("用户名太短") }

    // 2. 检查用户是否已存在
    existing, _ := uc.repo.GetByUsername(ctx, username)
    if existing != nil { return nil, errors.New("用户已存在") }

    // 3. 加密密码
    user := &User{Username: username}
    user.SetPassword(password)  // bcrypt

    // 4. 持久化
    return uc.repo.CreateUser(ctx, user)
}
```

**然后打开 `app/user/internal/data/user.go`**：

```go
// userRepo 实现了 biz.UserRepo 接口
type userRepo struct {
    db  *sql.DB
    rdb *redis.Client
}

func (r *userRepo) GetByUsername(ctx context.Context, username string) (*biz.User, error) {
    // 这就是纯粹的数据库操作，不做任何业务判断
    row := r.db.QueryRowContext(ctx, "SELECT id, username, ... FROM users WHERE username = ?", username)
    var u biz.User
    err := row.Scan(&u.ID, &u.Username, ...)
    return &u, err
}
```

**对比总结**：Biz 里的 `GetByUsername` 调用者不知道数据从哪来，Data 里的 `GetByUsername` 不关心数据用来做什么。这就是**关注点分离**。


## 一个 Proto，两个协议

打开 `api/user/v1/user.proto`，看一个典型的 RPC 定义：

```protobuf
service UserService {
  rpc Register(RegisterRequest) returns (RegisterResponse) {
    option (google.api.http) = {
      post: "/api/v1/user/register"    // ← HTTP 路由
      body: "*"
    };
  }
}
```

编译后生成三份代码：

| 文件              | 作用                    | 关键函数                             |
| ----------------- | ----------------------- | ------------------------------------ |
| `user.pb.go`      | Message 结构体          | `RegisterRequest{}`                  |
| `user_grpc.pb.go` | gRPC Server/Client 接口 | `RegisterUserServiceServer()`        |
| `user.pb.gw.go`   | HTTP→gRPC 网关          | `RegisterUserServiceHandlerServer()` |

### 6.2 调用方式对比

**gRPC 调用**（服务间通信用这个）：

```go
// 性能高，二进制协议，强类型
conn, _ := grpc.Dial("localhost:9001")
client := userv1.NewUserServiceClient(conn)
resp, _ := client.Register(ctx, &userv1.RegisterRequest{Username: "foo"})
```

**HTTP 调用**（前端 / curl 用这个）：

```bash
curl -X POST localhost:8001/api/v1/user/register \
  -H "Content-Type: application/json" \
  -d '{"username":"foo","password":"123456"}'
```

**同一个后端方法处理两种请求**——grpc-gateway 自动把 HTTP JSON 转成 gRPC Message。

## 微服务架构

```
                    ┌────────────────────────────────────┐
                    │            Nginx / Gateway           │
                    └───┬───┬───┬───┬───┬───┬────────────┘
                        │   │   │   │   │   │
         ┌──────────────┼───┼───┼───┼───┼───┼───────────┐
         │              │   │   │   │   │   │              │
         ▼              ▼   ▼   ▼   ▼   ▼   ▼              │
   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
   │  user    │  │  upload  │  │  share   │  │ search  │  │
   │ service  │  │ service  │  │ service  │  │ service │  │
   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘  │
        │             │             │             │         │
   ┌────┴─────┐  ┌────┴─────┐  ┌────┴─────┐  ┌────┴─────┐  │
   │  file    │  │  MinIO   │  │  Kafka   │  │  Redis   │  │
   │ service  │  │  (分片+   │  │  (异步   │  │  (缓存+   │  │
   │ (元数据) │  │   正式)   │  │   事件)  │  │   热词)   │  │
   └────┬─────┘  └──────────┘  └────┬─────┘  └──────────┘  │
        │                           │                       │
   ┌────┴─────┐                ┌────┴─────┐                │
   │  MySQL   │                │  notify  │                │
   │ (元数据) │                │ service  │                │
   └──────────┘                └──────────┘                │
                                                           │
         ┌─────────────────────────────────────┐           │
         │     Etcd (服务注册发现 + 配置中心)    │           │
         └─────────────────────────────────────┘           │
         ┌─────────────────────────────────────┐           │
         │  Jaeger (链路追踪) + Prometheus (监控) │           │
         └─────────────────────────────────────┘           │
                                                           │
         ┌──────────────────────────────────────────────┐  │
         │         所有服务均提供 gRPC + HTTP Gateway      │  │
         └──────────────────────────────────────────────┘  │
```

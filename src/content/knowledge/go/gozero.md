## go-zero代码生成工具

```yaml
go install github.com/zeromicro/go-zero/tools/goctl@latest
```

## 生成代码

```yaml
goctrl api go -api gateway.api -dir .
goctl api go：生成 Go 代码
-api gateway.api：指定你的 api 文件
-dir .：把代码生成到当前文件夹
```

## GenerateFromPassword函数

```yaml
func GenerateFromPassword(password []byte, cost int) ([]byte, error)
```

## CompareHashAndPassword

```yaml
func CompareHashAndPassword(hashedPassword []byte, password []byte) error
```

## 组装真正的Token

```yaml
func (t *Token) SignedString(key interface{}) (string, error)
```

## protoc生成RPC代码

```yaml
goctl rpc protoc desc/order.proto --go_out=. --go-grpc_out=. --zrpc_out=. -m
--go_out=.
生成：
order.pb.go
结构体代码（message）
--go-grpc_out=.
生成：
order_grpc.pb.go
gRPC 接口、客户端、服务端
--zrpc_out=.
生成：
整套 go-zero 框架代码
internal/*
etc/
main.go
server、logic、svc、config
-m
mode，生成多文件模式
每个接口一个 logic 文件
```

## 创建deploy/sql/user.sql文件

```yaml
goctl model mysql ddl -src deploy/sql/order.sql -dir app/rpc/order/internal/model -c
-c是开启缓存， go-zero自带redis缓存，
```

给/etc/user.yaml加上mysql配置

```yaml
Mysql:
  DataSource: root:你的数据库密码@tcp(127.0.0.1:3306)/go-zero?charset=utf8mb4&parseTime=True&loc=Local
```

## 给servicecontext.go加上数据库模型

```go
type ServiceContext struct {
	Config    config.Config
	UserModel model.UserModel // 数据库模型
}

func NewServiceContext(c config.Config) *ServiceContext {
	// 连接MySQL
	mysqlConn := sqlx.NewMysql(c.Mysql.DataSource)

	return &ServiceContext{
		Config:    c,
		UserModel: model.NewUserModel(mysqlConn),
	}
}
```

## 给config.go加上mysql

```go
type Config struct {
	zrpc.RpcServerConf
	Mysql struct {
		DataSource string
	}
}

```

## logic写你的业务

## 网关层只调用RPC，不操作数据库

## 校验密码

bcrypt.CompareHashAndPasword([]byte(db密码), []byte(in.Password))

```go

api/
  ├── etc/             # 配置文件
  ├── internal/
  │   ├── config/      # 配置结构体
  │   ├── handler/     # HTTP 入口层（=你熟悉的 handler）
  │   ├── logic/       # 业务逻辑层（=你熟悉的 service）
  │   ├── svc/         # 全局依赖（DB、RPC、MQ 都放这）
  │   └── types/       # 请求/返回结构体
  ├── xxx.api          # 定义文件
  └── xxx.go           # main 入口
```

## RPC

```go

rpc/
  ├── etc/             # 配置
  ├── internal/
  │   ├── config/
  │   ├── dao/         # 数据库操作（可选，=model/dao）
  │   ├── logic/       # 业务逻辑（=service）
  │   ├── server/      # gRPC 接口入口（=handler）
  │   └── svc/         # 全局依赖
  ├── pb/              # gRPC 生成的协议文件
  ├── xxx.proto
  └── xxx.go

  app/rpc/order/
├── desc/          # 协议描述文件目录
├── etc/           # 配置文件目录
├── internal/      # 内部业务代码（核心）
├── order/         # pb 生成的 proto 代码目录
├── order.go       # 服务启动入口 main.go
└── orderclient/   # 给其他服务调用的客户端（SDK）

app/rpc/order/internal/
├── config/   # 配置结构体
├── model/    # 数据库模型 + CRUD（=你熟悉的 dao/model）
├── server/   # gRPC 接口入口（=你熟悉的 handler）
├── logic/    # 业务逻辑层（=你熟悉的 service）
├── mq/       # 消息队列（RabbitMQ/Kafka 相关，你刚才的代码就在这）
└── svc/      # 服务全局资源（所有依赖都在这）
```

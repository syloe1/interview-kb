## zero框架思路

```txt
yaml->config->svcCtx->logic 依赖注入
yaml放值， config.go 定义这个服务有什么配置， svcCtx把配置和资源传给logic

业务Mysql Redis, JWt要在COnfig结构体里额外定义


多服务， 根目录是common, deploy, service
service里放各种具体service, 每个具体的service里面有api rpc model
	单个服务直接放在Internal/model里面， 多个服务就让model和api rpc同层级
model写user.sql goctl model mysql ddl -src xxx.sql -dir 文件夹位子 -c 带缓存
### 构建api服务 架构 https://go-zero.dev/zh-cn/guides/quickstart/api-service/
	进入api文件夹 创建 .api
	goctl api go -api xx.api -dir 文件夹
### 构建rpc服务  架构 https://go-zero.dev/zh-cn/guides/quickstart/rpc-service/
	进入rpc文件夹 创建 .proto
	   proto文件的option go_package = “” 这存pb.go grpc.pb.go
	 goctl rpc protoc .proto    //types就是请求响应结构体
				--go_out =./rpc/types
				--go-grpc_out=./rpc/types
				--zrpc_out=./rpc
改配置    数据流 yaml->config->svcCtx->logic 依赖注入
-------------------------------------
	改rpc/etc的yaml文件 写Etcd mysql redis配置
	改rpc/internal/config/config.go
			你用到的业务对象 mysql redis jwt你要声明
			写入Config结构体
			type Config struct {
				zrpc.RpcServerConf
				//add
				Mysql structP{ DataSource string}
				CacheRedis cache.CacheConf
			}
----------------------------------------
注入服务Model model.ProduceModel
	conn := sqlx.NewMysql(c.Mysql.DataSource)
	ProductModel: model.NewProductModel(conn, c.CacheRedis
		3. 改写servicecontext.go
注册服务上下文user model的依赖  rpc/internal/svc/servicecontext.go
	Svc 是手动实现的简易依赖容器， 作用和wire， dig类注入框架， 集中管理服务生命周期内的共享资源， 统一初始化，到处可拿
增加依赖就是 在ServiceContext结构体夹加字段-> 在NewServiceContext里面初始化，赋值
common文件夹 可以放多个服务都会复用的公共代码
	cryptx
	jwtx
	validator
	errx
	etc
--------------------------
4. 完善产品
完善业务逻辑rpc/internal/logic的东西  logic
logic函数就是使用l.svcCtx 全局资源， 用我们注入的userModel这种DB
	res, err := l.svcCtx.UserModel.Find(ctx, x)
	model生成了curd接口，第一个参数传入上下文
	就是调用DB接口去做东西

---------------
进入api层
1. 修etc/yaml文件，  加入user rpc模块服务配置
		https://go-zero.dev/zh-cn/guides/grpc/server/example/
		https://go-zero.dev/zh-cn/guides/grpc/server/configuration/
		就是加  Etcd然后配置
2. 修改api/internal/config/config.go. 比如etc/yaml配置了JWT, 就在
		这个config.go 中添加JWT config
		配置 zrpc.RpcClientConf   https://go-zero.dev/zh-cn/guides/grpc/client/configuration/
api 是 HTTP 网关，它本身不实现注册、登录逻辑；它要作为 RPC 客户端，去调用 user.rpc 这个微服务。

gozero规则， yaml配置必须映射到结构体字段
3. 注册rpc进入svc/servicecontext.go
//func MustNewClient(c RpcClientConf, options ...ClientOption) Client {
	type ServiceContext struct {
		Config config.Config
		// add  //rpc包下面的userclient (client包名字
		UserRpc userclient.User
		// 不知道名字看types/grpc_pb.go
	}
	func NewServiceContext(c config.Config) *ServiceContext {
		return &ServiceContext {
			Config: c,
			UserRpc: userclient.NewUser(zrpc.MustNewClient(c.UserRpc)),
		}
	}
4. 做logic的逻辑
	调用svc全局资源注入的RPC模块，的函数
	res, err := l.svcCtx.UserRPC.Register{}
	参数上下文， &user.RegisterRequest


---------------rpc 依赖别rpc
1. yaml配置 别的RPCconf
	UserRpc:
	  Etcd:
		Hosts:
		- etcd:2379
		Key: user.rpc

	ProductRpc:
	  Etcd:
		Hosts:
		- etcd:2379
		Key: product.rpc
2. rpc/internal/config/config.go
	在Config结构体住粗 rpc zrpc.RpcClientConf
	servicecontext中注入UserRpc user.User
3. 做logic
```

## go-zero代码生成工具

```yaml
go install github.com/zeromicro/go-zero/tools/goctl@latest
```

## 多服务

```
project-root/
├── service/
│   ├── user/
│   │   ├── api/             # user-api
│   │   └── rpc/             # user-rpc
│   ├── order/
│   │   ├── api/
│   │   └── rpc/
│   └── payment/
│       └── rpc/
├── common/                  # 公共工具（错误码、中间件等）
└── deploy/
    ├── docker-compose.yaml
    └── k8s/
```

## 生成代码

```yaml
goctrl api go -api gateway.api -dir .
goctl api go：生成 Go 代码
-api gateway.api：指定你的 api 文件
-dir .：把代码生成到当前文件夹
```

## RPC数据流

userClient -> zrpc->server->logic->svc->DB

## GenerateFromPassword函数

```yaml
func GenerateFromPassword(password []byte, cost int) ([]byte, error)
```

## SSE

- 服务器通过持久化的HTTP连接向客户端推送事件
- 头部 text/event-stream

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

## 微服务

- 服务发现
- 负载均衡
- 配置中心
- 可观测性

```
gozero可以限流-> 熔断-> 降级 -> 超时
.api 定义接口  业务在logic 共享依赖在svc
业务逻辑在logic写 curl -> handle(router.go) ->
    handler.go 解析校验 -> logic.go 业务调用svc的底层DB资源

API层： HTTP websocket JWT认证
api 是 HTTP 网关，它本身不实现注册、登录逻辑；它要作为 RPC 客户端，去调用 user.rpc 这个微服务。
RPC层， rpc通信。 服务发现etcd
```

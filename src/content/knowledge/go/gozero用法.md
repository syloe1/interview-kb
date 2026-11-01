## gozero用法

```txt
yaml->config->svcCtx->logic 依赖注入
yaml放值， config.go 定义这个服务有什么配置， svcCtx把配置和资源传给logic

鉴权在api文件的 service上面加 @server {jwt: Auth}
service {

}


业务Mysql Redis, JWt要在COnfig结构体里额外定义


多服务， 根目录是common, deploy, service
service里放各种具体service, 每个具体的service里面有api rpc model
	单个服务直接放在Internal/model里面， 多个服务就让model和api rpc同层级
model写user.sql
goctl model mysql ddl -src xxx.sql -dir 文件夹位子 -c 带缓存
goctl model mysql ddl \
  -src storage.sql \
  -dir . \
  -c
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
.................................
脚手架跑完改rpc的yaml config  servicecontext
rpc直接操作model, 给model注入进来
yaml加入Mysql CacheRedis  cache.CacheConf
config加入
rpc和db交互 xxxModel model.UserModel
conn := sqlx.NewMysql(c.Mysql.Datasource)
return UserModel: model.NewUserModel(conn, c.CacheRedis)
........................
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
3. 注册rpc进入svc/servicecontext.go  注册client
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



yaml配置值，
Config定义字段结构，字段名要和yaml键对应
SVC 读取Config 中的配置值， 创建model 或rpc对象
核心规则：goctl 生成的模型名 = 表名的驼峰形式 + Model；表名是复数时，模型名也保留复数后缀。

表 users → UsersModel / NewUsersModel（不是 UserModel）
表 user_quotas → UserQuotasModel
表 files → FilesModel
表 storage_objects → StorageObjectsModel

多表服务   一个conn在多个模型之间共享， 所有模型共用一个CacheRedis
type ServiceContext struct {
	Config      config.Config
	UsersModel  model.UsersModel
	QuotasModel model.UserQuotasModel
	TokensModel model.RefreshTokensModel
}

func NewServiceContext(c config.Config) *ServiceContext {
	conn := sqlx.NewMysql(c.Mysql.DataSource)
	return &ServiceContext{
		Config:      c,
		UsersModel:  model.NewUsersModel(conn, c.CacheRedis),
		QuotasModel: model.NewUserQuotasModel(conn, c.CacheRedis),
		TokensModel: model.NewRefreshTokensModel(conn, c.CacheRedis),
	}
}
rpc/svc/servicecontext.go 注册model， 不知道什么名字。去看model,看gen后缀的文件


密码加密  user/rpc/etc/user.yaml配置 salt
Salt: HWVOFkGgPTryzICwd7qnJaZR9KQ2i8xe
配置Config ， 加一个Salt string 结构体成员
多表
svc 加入 Conn sqlx.SqlConn 做事务
	✅ users 成功 && user_quotas 成功 → 提交
	❌ users 成功，但是 user_quotas 报错（网络断、主键冲突、DB 满）→ **全部回滚，users 这条删掉**
```

## 做RPC层的logic

> 看请求/响应 pb.go / xxxclient/xx.go 看字段名 类型
> 看查询方法 model/xxmodel.go 看方法签名 返回
> 依赖注入 internal/svc/servicecontext.go 字段叫什么

- 不确定就停下来别写。 搞清楚才写。

```go
func (l *XLogic) X(in *file.XRequest) (*file.XResponse, error) {
    // 1. 校验参数      → codes.InvalidArgument
    // 2. 查            → ErrNotFound → codes.NotFound；其他 → 日志 + codes.Internal
    // 3. 校验权限      → codes.PermissionDenied
    // 4. 写            → 错误同上
    // 5. 组装响应       ← 最后才写，因为字段名要抄 pb.go
}
先读 model 接口 / pb.go     ← 你跳过了这步，所以写出了不存在的 API
→ 再定 yaml → config → svc
→ 再写 logic
```

## 做API层的logic

```txt
yaml配置 RPC客户端
Config去注入RPC客户端 zrpc.RpcClientConf
svc/servicecontext.go 注入 客户端 xxxclient.xxx
			xxxRpc: xxclient.Newxxx(zrpc.MustNewClient(c.xxRpc))
logic 鉴权(需要鉴权的接口) 调rpc 处理错误  映射响应
```

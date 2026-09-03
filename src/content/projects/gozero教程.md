创建api model rpc
在model里面写sql
命令
goctl model mysql ddl -src ./model/order.sql -dir ./model -c
写 .api文件
goctl api go -api ./api/order.api -dir ./api
写 .proto
goctl rpc protoc ./rpc/order.proto --go_out=./rpc/types --go-grpc_out=./rpc/types --zrpc_out=./rpc
编译proto
$ goctl rpc protoc ./rpc/order.proto --go_out=./rpc/types --go-grpc_out=./rpc/types --zrpc_out=./rpc

rpc
/etc/xxx.yaml
Mysql:
DataSource: root:123456@tcp(127.0.0.1:3307)/iot?charset=utf8mb4&parseTime=true&loc=Local
CacheRedis: - Host: redis:16379  
 Type: node # 单节点模式
Pass:
先补config/config.go的配置
Mysql struct {
DataSource string
}
CacheRedis cache.CacheConf
/svc/servicecontext.go注入
xxxModel model.xxxModel
xxx model 工厂函数中初始化
conn := sqlx.NewMysql(c.Mysql.DataSource)
xxxModel: model.NewxxxModel(conn, c.CacheRedis),
/rpc/etc/yaml注入RPC
UserRpc:
Etcd:
Hosts: - etcd:2379
Key: user.rpc

    OrderRpc:
      Etcd:
    	Hosts:
    	- etcd:2379
    	Key: order.rpc
    /rpc/internal/config/config.go实现
    type Config struct {

    	UserRpc  zrpc.RpcClientConf
    	OrderRpc zrpc.RpcClientConf
    }

    注册上下文
    type ServiceContext struct {
    	UserRpc  user.User
    	OrderRpc order.Order
    }
    UserRpc:  user.NewUser(zrpc.MustNewClient(c.UserRpc)),
    OrderRpc: order.NewOrder(zrpc.MustNewClient(c.OrderRpc)),
    //可以在model/xxxmodel.go的 interface{} 去声明接口
    /实现/logic下面的函数

api
先写.api
修改/etc/xxx.yaml
添加mysql redis jwt配置
Mysql:
DataSource: root:123456@tcp(127.0.0.1:3307)/juejinmall?charset=utf8mb4&parseTime=true&loc=Local

    CacheRedis:
      - Host: redis:16379
    	Type: node # 单节点模式
    	Pass:



    Auth:
      AccessSecret: uOvKLmVfztaXGpNYd4Z0I1SiT7MweJhl
      AccessExpire: 86400 # 1天

    在yaml中添加rpc服务
    UserRpc:
      Etcd:
    	Hosts:
    	- etcd:12379
    	Key: user.rpc
    修改api/internal/config/config.go
    UserRpc zrpc.RpcClientConf
    在api/internal/svc/servicecontext.go注册rpc
    	UserRpc userclient.User
    	PayRpc: payclient.NewPay(zrpc.MustNewClient(c.PayRpc)),
    	xxxRpc xxxclient.xxx
    初始化 xxxRpc: xxxclient.Newxxx(zrpc.MustNewClient(c.xxxRpc))
    	在工厂函数中注册
    	func NewServiceContext(c config.Config) *ServiceContext {
    		return &ServiceContext{
    			Config:     c,
    			ProductRpc: productclient.NewProduct(zrpc.MustNewClient(c.ProductRpc)),
    		}
    	}

    rpc goctl生成的是int64
    db用的是uint64
    goctl api go -api .api -dir .
    实现internal/logic/.go里面调用rpc的方法

Go 底层原理
GMP 调度、内存模型、slice/map 底层、channel 原理、逃逸分析、接口实现、unsafe 包。
中间件深挖
Redis 缓存淘汰 / 集群、Raft；RabbitMQ/Kafka 存储、高可用；ES 分片机制。
MySQL 深度
MVCC、锁机制、索引底层 B + 树、SQL 优化、分库分表。
二、分布式核心（大厂必考）
CAP/BASE、一致性协议 Raft、分布式事务（2PC/TCC/SAGA）、分布式 ID、限流降级熔断、本地消息表 / Outbox 进阶。
三、微服务进阶（你做过 go-zero）
服务注册发现原理、服务治理、网关、配置中心、链路追踪底层原理。
四、计算机基础（笔试必考）
算法：继续 LeetCode Hot100 + 中等高频（树、DP、贪心、图），每周 6~10 题
操作系统：进程线程、IO 模型 (select/poll/epoll)、内存、TCP/IP（三次握手、滑动窗口、拥塞控制）
计算机网络：HTTP1.1/2/3、QUIC 原理（简历写过）
五、工程 & 云原生
Docker 镜像原理、k8s 基础资源 (pod/deployment/service)、CI/CD 简单流程。
六、项目升级（用来更新简历、秋招面试）
在原有电商 / 聊天项目加新功能：分库分表、多级缓存、限流熔断；
上传优化后的代码到 GitHub，完善 README。
时间分配（开学日常上课之余）
工作日：1h 算法 + 1.5h 技术深挖
周末：复盘项目 + 系统梳理一个大专题（如 TCP/Redis）

拿到需求不再直接写 CRUD，先画 ER 图、梳理业务边界、做技术选型权衡，思考：
这个场景同步还是异步？要不要加缓存？要不要削峰？锻炼判断能力。
onfig/config.go
所有要配置的模块， 依赖ConfigProvider接口， 不直接依赖结构体

依赖接口， 配置来源从 yaml -> etcd配置， 只需要新写一个结构体实现接口就行， 不用改代码

通过接口暴露字Getxx(), 隔离多余配置字段。

单元测试方便， Mock配置

为什么RabbitMQ没放进接口， 可选组件， 不是全服务通用配置

使用Viper读文件 v.ReadInConfig()
反序列化->结构体 v.Unmarshal()

container/container.go
结构体Container放所有资源 基础配置， service/handler
NewContainer构造函数， 依赖组装
service依赖db, hanlder依赖service
dao/xxxdao.go
声明接口， 只定义要做什么，
dao/gorm_dao.go
具体落地实现
灵活切换数据源 切成mongoDB直接
type MongoRepo struct {
coll \*mongo.Collection
}
然后实现xxxdao.go接口中的函数
domain/model 对应的mysql数据表里面的东西

gateway/presence.go 生成接口
gateway/redis*presence.go实现接口
gateway/quic_server.go QUIC网关
用了sync.map的range函数
func Range(f func(key, value any) bool)
sync.Once
Quic关闭时 1. 关channal 2. 关QUIC连接
s.closeOnce.Do(func(){
close(s.done)
* = s.conn.CloseWithError()
})
钩子 = 提前预留一个空位，将来事件发生时自动执行你塞进去的代码，
比直接赋值更加灵活
handler就先做dto层参数绑定， 然后用service去绑定， 然后统一封装去返回

middleware/rate_limit.go IP/用户ID限流

mq/consumer_pool.go
同一个channel不能重复close, 重复close会panic
向关闭的channel读零值
select {
case <-p.quitChan: //已经关闭 直接跳过
default:
close(p.quitChan)
}
pkg/migrate.go
return db.AutoMigrate(&model.User{}, &model.Post{})
service/group_message_publisher.go
RabbitMQ 群消息生产者实现，面向接口编程，负责把群消息事件发布到 RabbitMQ 交换机
WSHUB 先关闭channel 在关闭底层的网络连接

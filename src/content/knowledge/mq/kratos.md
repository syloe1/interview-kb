`cmd/server` 程序入口 main + wire 依赖注入

`api/todo/v1` protobuf 定义 API

`internal/service` 处理 http/grpc 请求

`internal/biz` biz 层，业务逻辑

`internal/data` Data 层，数据库 / 缓存访问

`internal/server` 服务启动定义

`internal/conf` 配置结构体定义

krutos wire upgrade 自动补全 wire
## 4种RPC
- 一元 RPC：普通 增删改查
- 客户端流：客户端、大文件分批推送
- 服务端流：批量下发，批量导入
- 双向流：实时推送、即时通讯

## pb.go数据结构代码，message → go struct

> grpc.pb.go处理HTTP-> GRPC二进制协议
> pb.go proto文件描述符对象
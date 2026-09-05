gRPC 基于 HTTP2 /protobuf

一次调用：客户端单个请求；服务端单向 / 流式

## 流量控制

底层 HTTP2 每个流有接收窗口，接收方通过 `window‑update` 帧告知发送方剩余接收容量，窗口满停止发送。

读写接口上阻塞时，发送方触发往外。
若接收窗口已满，缓冲区已满，调用会阻塞，直到接收方消费数据，释放窗口。



## service Greeter 定义一个服务，类名接口，一组 RPC 方法集合
`(入参) returns (出参)` 服务描述

rpc , 加stream 代表流

- message 定义传输数据结构体
proto 序列化，不写字段名，只靠数字编号

```bash
grotoc --go_out=. --go-grpc_out=. helloworld.proto
- `--go‑out`生成消息结构体方法
- `--go-grpc‑out`生成 grpc 服务代码 
```

`xx.pb.go` 是 protobuf 消息序列化，和grpc框架相关
消息结构体 HelloRequest / HelloReply

pb.go() 只管消息二进制解码， grpc调用只管 grpc.pb.go 


# 客户端接口 GreeterClient，方法 SayHello
实例化构造 greeter_client
服务端接口 GreeterServer

- UnimplementedGreeterServer 占位结构体
- 注册函数 RegisterGreeterServer
- 方法处理器 __Greeter_SayHello_Handler

## 服务端：建立 TCP 连接 → 创建 grpc 服务实例
注册服务到 grpc 框架,服务启动，循环接收 TCP 连接

## 客户端：grpc::Dial 创建客户端连接,基于连接创建 GreeterClient
创建带超时的上下文,发起 RPC 调用



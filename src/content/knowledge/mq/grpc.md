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



## 学习一个proto文件
> protobuf 是**接口定义语言**，用来定义 gRPC 服务 + 数据结构体；Kratos 通过 `google.api.http` 注解自动映射 HTTP 接口。
> 统一定义用户模块所有接口、入参、出参，**一份 proto 同时生成 gRPC 代码 + HTTP 路由**。
```Proto
syntax = "proto3";

package user.v1;

option go_package = "github.com/kratos/clouddisk/gen/go/user/v1;userv1";

import "google/api/annotations.proto";
import "common/v1/common.proto";

// ============================================================================
// UserService - 用户服务
// ============================================================================
service UserService {
  // 用户注册
  rpc Register(RegisterRequest) returns (RegisterResponse) {
    option (google.api.http) = {
        //option是Kratos http映射注解
      post: "/api/v1/user/register"
      //HTTP 整个 json body 全部映射到 `RegisterRequest` 入参
      body: "*"
    };
  }

  // 用户登录
  rpc Login(LoginRequest) returns (LoginResponse) {
    option (google.api.http) = {
      post: "/api/v1/user/login"
      body: "*"
    };
  }

  // 刷新 Token
  rpc RefreshToken(RefreshTokenRequest) returns (RefreshTokenResponse) {
    option (google.api.http) = {
      post: "/api/v1/user/refresh"
      body: "*"
    };
  }

  // 获取当前用户信息
  rpc GetUserInfo(GetUserInfoRequest) returns (GetUserInfoResponse) {
    option (google.api.http) = {
      get: "/api/v1/user/info"
    };
  }

  // 更新用户信息
  rpc UpdateUserInfo(UpdateUserInfoRequest) returns (UpdateUserInfoResponse) {
    option (google.api.http) = {
      put: "/api/v1/user/info"
      body: "*"
    };
  }

  // 获取存储配额信息
  rpc GetStorageQuota(GetStorageQuotaRequest) returns (GetStorageQuotaResponse) {
    option (google.api.http) = {
      get: "/api/v1/user/storage"
    };
  }
}

// ============================================================================
// 注册
// ============================================================================
message RegisterRequest {
  string username = 1;   // 用户名，3-32 字符
  string password = 2;   // 密码，6-64 字符
  string email = 3;      // 邮箱（可选）
  string phone = 4;      // 手机号（可选）
}

message RegisterResponse {
  int64 user_id = 1;
  string username = 2;
}

// ============================================================================
// 登录
// ============================================================================
message LoginRequest {
  string username = 1;   // 用户名
  string password = 2;   // 密码
}

message LoginResponse {
  string access_token = 1;   // JWT Access Token
  string refresh_token = 2;  // Refresh Token
  int64 expires_in = 3;      // Access Token 有效期（秒）
  UserInfo user = 4;
}

// ============================================================================
// 刷新 Token
// ============================================================================
message RefreshTokenRequest {
  string refresh_token = 1;
}

message RefreshTokenResponse {
  string access_token = 1;
  string refresh_token = 2;
  int64 expires_in = 3;
}

// ============================================================================
// 用户信息
// ============================================================================
message GetUserInfoRequest {
  // 从 JWT Token 中获取用户 ID，无需传参
}

message GetUserInfoResponse {
  UserInfo user = 1;
}

message UpdateUserInfoRequest {
  string nickname = 1;   // 昵称
  string avatar = 2;     // 头像 URL
  string email = 3;      // 邮箱
  string phone = 4;      // 手机号
}

message UpdateUserInfoResponse {
  UserInfo user = 1;
}

// ============================================================================
// 存储配额
// ============================================================================
message GetStorageQuotaRequest {}

message GetStorageQuotaResponse {
  int64 used_bytes = 1;    // 已使用空间（字节）
  int64 total_bytes = 2;   // 总配额（字节），默认 10GB
  double usage_percent = 3; // 使用百分比
}

// ============================================================================
// 用户信息结构体
// ============================================================================
message UserInfo {
  int64 id = 1;
  string username = 2;
  string nickname = 3;
  string avatar = 4;
  string email = 5;
  string phone = 6;
  int64 created_at = 7;
  int64 updated_at = 8;
}

```
#### message消息结构体，等价golang的struct, 字段名=编号


## proto 里用 `option (google.api.http) = { ... }` 注解，给 gRPC 接口绑定 HTTP 路径、请求方法，**一套 proto 同时提供 gRPC 接口 + RESTful HTTP 接口**。
```Proto
syntax = "proto3";

package google.api;

option go_package = "google.golang.org/genproto/googleapis/api/annotations;annotations";

message HttpRule {
  string selector = 1;
  oneof pattern {
    string get = 2;
    string put = 3;
    string post = 4;
    string delete = 5;
    string patch = 6;
    CustomHttpPattern custom = 8;
  }
  string body = 7;
  repeated HttpRule additional_bindings = 11;
}

message CustomHttpPattern {
  string kind = 1;
  string path = 2;
}

```
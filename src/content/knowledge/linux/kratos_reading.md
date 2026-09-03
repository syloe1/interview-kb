your-project/
├── api/ # proto定义：对外接口（grpc/http）、Request/Response结构体
├── cmd/
│ └── server/ # main入口：组装wire依赖、启动服务
├── internal/
│ ├── biz/ # 业务逻辑层！核心：业务规则、领域模型、接口定义（Repository 抽象）
│ ├── service/ # 传输层适配器：grpc handler，接收请求，调用biz，组装返回
│ ├── data/ # 数据层实现：数据库、Redis、AI模型客户端、向量库、HTTP远端模型调用
│ └── server/ # 服务实例：grpc server、http server、中间件注册
├── configs/ # yaml配置
└── third_party/ # 外部proto、依赖

客户端请求 → HTTP/gRPC Server → 中间件（日志/鉴权/限流/追踪）
→ Service（grpc handler） → Biz（业务逻辑）
→ Data（Repository实现，调用AI模型/数据库/缓存）
← Data ← Biz ← Service → 组装Response → 返回客户端

进入/api文件夹，查找proto文件

找internal/service对应的方法实现代码
看Biz层具体业务， 然后看data层

看config
看wire.go

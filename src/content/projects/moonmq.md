moonmq
`app.go`
tcp listener http listener

`conn/MsgHandler`
 `‑channel`

`direct/chan‑lock`

`store`
mem / leveldb / netty

消息结构
`total length(4字节) | header length(4字节) | header json | body`

有 Marshal 和 Unmarshal 方法

msg.go 有 publish proto 发送消息请求包
‑`publishReq proto` 发消息
‑`push proto` 推送消息
‑`ack proto` 确认消息包

---

`app.go → store.go → memstore.go → queue.go → channel.go`

`main.go` 解析配置，创建一个 broker 实例

`proto`
‑`base.go` heartbeat proto 心跳包
‑`codec.go` 编解码器
 `type Codec struct {`
  `e *Encoder` 编码发送，封装方法 Encode
  `w *Decoder` 解码接收  Decode

`const.go` 各种定义的常量

`error.go` ProtoErr 错误，生成 # Error 接口

`proto.go`

```
type proto struct {
 Method uint32
 Field map[string]string
 Body []byte
}
```

`queue.go`
‑`bind proto` 绑定包
‑`bindOk proto` 绑定 ok 包
‑`unbind proto` 解绑定包
‑`unbindOk proto` 解绑定 ok 包

## channel.go

```
type channelMsg struct {
	ID  string // 做消息id用于ack确认
	Body []byte // 消息体二进制
}

type channel struct {
	c     *Conn // 底层tcp连接
	queue string // 绑定的队列名
	routingKey string // 路由key
	noAck bool // true自动ack

	msg chan *channelMsg // 消息队列
	closed bool // 判断通道是否已经关闭
	lastId string // 上一条获取的消息id,ack时用
}
```

方法：`Close()、Ack()、GetMsg()、WaitMsg()、pushMsg()`

## client.go

```
type Client struct {
	sync.Mutex
	cfg *Config

	conns *ConnList // 生成tcp连接，复用tcp连接
	closed bool // 判断客户端是否关闭
}
```

方法：`Close()、Get()、Publish()、PublishFunc()、PublishDirect()、PopConn() // 拿走tcp连接`
  `PushConn() // 归还tcp连接`

## conn.go

```
type Conn struct {
	sync.Mutex
	writeLock sync.Mutex // 写锁
	client *Client // 客户端对象
	cfg *Config // 连接配置

	conn net.Conn // 原生tcp/unix socket连接
	decoder *proto.Decoder // 解码器
	ch chan *proto.Proto // 同步返回的channel
	observer 状态主回调
	channels map[string]*Channel // 管理多个channel
	lastHeartBeat time.Time // 上一次心跳
}
```

`broker/http_msg.go`
方法：`ServeHTTP()，publishMsg()，push、getMsg()`

`broker/msg.go`
方法：`Encode()，decode()`

生产者通过 TCP / HTTP 发送消息，指定队列
broker 把消息持久化，根据路由策略推送到
匹配的 channel

消费者绑定队列后，通过 channel 接收消息
确认之后 broker 从 store 删除

客户端自动管理 TCP 长连接池

## conn.go 方法

`Close()、keepAlive()`
封装 tcp 的：`close()、run()、request()`
`writeProto()、publish()、bind()`
`unbindAll()、unbind()、ack()`

## app.go

```
type App struct {
	cfg *Config
	listener net.Listener // tcp服务监听
	httpListener // http服务监听端口
	redis *redis.Pool
	ms Store // 持久化接口
	es *Shrkers // 队列管理器
	passMsg []byte // 密码hash
}
```

方法：`Config()、Close()、startHttp()、startTcp()、Run()`

## broker/conn.go

方法：`checkKeepAlive()、WriteProto()、protoError()、WriteError()、onRead()、Run()、unbindAll()`

## broker/channel.go

```
type MsgHandler interface {
	push(ch *channel, m *msg) error
}

type channel struct {
	p MsgPusher
	s *queue
	routingKey string
	noAck bool // 自动ack
}
```

方法：
`Reset()` 重置门状态
`Close()` 解绑关闭
`push()` 去往消息推送
`Ack()` 确认消息

## conn_msg.go

函数：`checkPublish()`
方法：`SaveMsg()、handlePublish()、handleAck()`

## conn_queue.go

函数：`checkQueue()`
方法：`push()、handleBind()、handleUnbind()`

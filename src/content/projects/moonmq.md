

核心特征：

- 自研二进制协议（不是 AMQP/STOMP），协议层独立成 `proto` 包
- 支持 TCP 长连接和 HTTP 两种访问方式
- 存储可插拔：内置内存存储（mem）和 Redis 存储（redis）
- 两种投递模式：`direct`（点对点轮询）和 `fanout`（广播）
- 通过 Ack 机制实现"至少投递一次"

**一个消息的生命周期**（建议先背下来，再看代码）：

```
生产者                    broker                         消费者
   │  Publish(queue, body)  │                                │
   ├───────────────────────►│  1. saveMsg：GenerateID + 存入 store
   │                        │  2. queue.Push 触发推送
   │                        │  3. 把 Push 协议写给匹配的消费者
   │                        ├───────────────────────────────►│
   │                        │  4. 消息进入 waitingAcks（待确认）
   │                        │                    处理消息    │
   │                        │◄─────────── Ack(msg_id)────────┤
   │                        │  5. Ack 后 store.Delete 删除消息
   │                        │  6. 继续 push 下一条
```
协议格式注释：

```
| total length(4字节) | header length(4字节) | header json | body |
```

- `Marshal` / `Unmarshal`：如何把结构体变成字节流，再从字节流还原
- `codec.go`：如何在 `net.Conn` 上一条条读消息（`io.ReadFull` + 先 Peek 长度）
- `const.go`：方法号的约定 —— **偶数 = 同步请求，奇数 = 同步回复，>10000 = 异步**

## 存储抽象
- `RegisterStore` + `init()`：一个简单的**注册表模式**，怎么用 `map[string]StoreDriver` 做可插拔
- `msg.go`：内部消息结构，`Encode/Decode` 是**手写大端序**（`binary.BigEndian`）

- `queue` 结构体里有一个 `ch chan func()`，后台 `run()` goroutine 循环执行这些函数 —— 这是 Go 里**用 channel 串行化操作、避免锁竞争**的经典惯用法

`push()`：根据 `pubType` 走 `pushFanout` 或 `pushDirect`
- `pushDirect`：遍历 channels，用 `match()` 找 routingKey 匹配的，**把选中的移到链表尾部**实现 round-robin
- `Ack`：只有 `msgId == lastPushId` 才删除 + 清空 `waitingAcks` + 推下一条（这就是"一次只推一条、等确认"的语义）
- `getMsg`：处理消息超时（`MessageTimeout`）


- `POST/PUT /msg`：发布；`GET /msg`：消费（**长轮询，最长等 60 秒**）
- 注意 HTTP 的消费是用一个**临时 channel** 完成的（`httpMsgPusher` 用两个 chan 做同步）

## 思考
1. **单 goroutine 事件循环**：`queue` 用 `ch chan func()` 把 bind/unbind/ack/push 全部串行化，整个 queue 状态只在一条 goroutine 里被修改，天然无锁。
2. **手写二进制协议**：为什么用 JSON 做 header + 原始字节做 body？长度字段怎么分帧？（对比一下如果全用 JSON 会怎样）
3. **可靠投递**：`lastPushId` + `waitingAcks` 这套"推一条等一条"的设计，牺牲了吞吐换可靠性；`direct` 模式尤其如此。
4. **存储可插拔**：`Store` 接口 + 注册表；Redis 版用 `ZADD`/`ZRANGE`（sorted set）按 msgId 排序，`ZREMRANGEBYSCORE` 精确删。
5. **连接池**：客户端怎么复用连接、怎么处理心跳、怎么在"同步请求"和"异步 push"之间共享同一条连接。
6. **长轮询 vs 推送**：TCP 走真正的推送，HTTP 用 60 秒长轮询模拟，体会两种模型的差异。
## moonmq/proto/proto.go
```Go
package proto

import (
	"encoding/binary"
	"encoding/json"
	"errors"
)

// 预定义错误
var (
	ErrInvalidBuf = errors.New("invalid decode buf") // 非法报文
	ErrBufShort   = errors.New("decode buf is too short") // 缓冲区不足
)

/*
   Proto binary format is

   |total length(4 bytes)|header length(4 bytes)|header json|body|

   total length = 4 + len(header json) + len(body)
   header length = len(header json)
*/

// Proto：消息结构体
type Proto struct {
	Method uint32            `json:"method"`    // 消息方法号，区分消息类型
	Fields map[string]string `json:"fields"`    // 扩展KV，存放queue、routingkey、msgId等
	Body   []byte            `json:"-"`         // 业务二进制body，json:"-" 不参与json序列化
}

// NewProto 构造函数，初始化Proto对象，对nil做兜底，防止panic
func NewProto(method uint32, fields map[string]string, body []byte) *Proto {
	p := new(Proto)
	p.Method = method
	// nil map 替换为空map，避免直接读写map panic
	if fields == nil {
		p.Fields = map[string]string{}
	} else {
		p.Fields = fields
	}
	// nil切片替换为空[]byte
	if body == nil {
		p.Body = []byte{}
	} else {
		p.Body = body
	}
	return p
}
// Value 根据key读取Fields里的值
func (p *Proto) Value(key string) string {
	return p.Fields[key]
}

// Queue 读取队列名，QueueStr是外部常量，如"queue"
func (p *Proto) Queue() string {
	return p.Value(QueueStr)
}

// RoutingKey 读取路由键
func (p *Proto) RoutingKey() string {
	return p.Value(RoutingKeyStr)
}

// PubType 读取发布类型
func (p *Proto) PubType() string {
	return p.Value(PubTypeStr)
}

// MsgId 读取消息ID
func (p *Proto) MsgId() string {
	return p.Value(MsgIdStr)
}
// Marshal 编码：Proto结构体 → 二进制报文
func Marshal(p *Proto) ([]byte, error) {
	// 序列化结构体，Body因为json:"-"不会被序列化，只序列化Method、Fields
	header, err := json.Marshal(p)
	if err != nil {
		return nil, err
	}
	// total length = 4(headerLen字段) + len(header) + len(body)
	length := 4 + len(header) + len(p.Body)
	// 初始化底层数组容量length，初始长度8字节（两个4字节长度头）
	buf := make([]byte, 8, length)
	/*
	01234567

	01
	23
	45
	67
	大端序
	*/

	// 大端写入total length，网络传输标准
	binary.BigEndian.PutUint32(buf[0:4], uint32(length))
	// 大端写入header长度
	binary.BigEndian.PutUint32(buf[4:8], uint32(len(header)))
	// 追加header json
	buf = append(buf, header...)
	// 追加原始body二进制
	buf = append(buf, p.Body...)
	return buf, nil
}


// Unmarshal 解码：二进制buf → 填入Proto结构体
func Unmarshal(buf []byte, p *Proto) error {
	// 报文最小长度：8字节（两个4字节长度头），小于等于8直接返回太短
	if len(buf) <= 8 {
		return ErrBufShort
	}
	// 读出总长度、header长度
	totalLen := binary.BigEndian.Uint32(buf[0:4])
	headerLen := binary.BigEndian.Uint32(buf[4:8])

	// 校验：buf实际长度 = totalLen + 4
	// totalLen定义是 4 + header + body，所以整个报文总字节 = 4 + totalLen
	if uint32(len(buf)) != (totalLen + 4) {
		return ErrInvalidBuf
	}
	// 校验headerLen不能超过header+body部分的总大小，防止越界
	if headerLen > (totalLen - 4) {
		return ErrInvalidBuf
	}

	// 截取8 ~ 8+headerLen区间作为header json，反序列化到p
	if err := json.Unmarshal(buf[8:8+headerLen], p); err != nil {
		return err
	}

	// 兜底，防止反序列化后Fields为nil
	if p.Fields == nil {
		p.Fields = map[string]string{}
	}
	if p.Body == nil {
		p.Body = []byte{}
	}
	// 截取body部分：8+headerLen 到 4+totalLen
	p.Body = buf[8+headerLen : 4+totalLen]
	return nil
}

```

## moonmq/proto/codec.go

> 封装 Encoder / Decoder / Coder，基于上面 `Proto.Marshal` / `Proto.Unmarshal`，实现流式读写（适配 TCP 流）。

- **Encoder**：将 Proto 对象编码成二进制报文，写入 io.Writer
- **Decoder**：从 io.Reader 流式读取、按协议帧解析报文，自动处理 TCP 流（粘包），读取完整一帧后反序列化为 Proto
- **Coder**：组合 Encoder + Decoder，同时支持读写，直接传入 `io.ReadWriter`（如 net.Conn）

```Go
package proto

import (
	"bufio"
	"encoding/binary"
	"io"
)

// Encoder 编码器：把Proto消息写入io.Writer
type Encoder struct {
	w io.Writer
}

func NewEncoder(w io.Writer) *Encoder {
	e := new(Encoder)
	e.w = w
	return e
}

func (e *Encoder) Encode(p *Proto) error {
	if buf, err := Marshal(p); err != nil {
		return err
	} else {
		_, err = e.w.Write(buf)
		return err
	}
}

// Decoder 解码器：从io.Reader流式读取，解析Proto消息
type Decoder struct {
	r *bufio.Reader
}

const defaultReaderSize = 128

func NewDecoder(r io.Reader) *Decoder {
	d := new(Decoder)
	// 如果传入已经是bufio.Reader，直接复用；否则新建带缓冲区的Reader
	if v, ok := r.(*bufio.Reader); ok {
		d.r = v
	} else {
		d.r = bufio.NewReaderSize(r, defaultReaderSize)
	}
	return d
}

func (d *Decoder) Decode() (*Proto, error) {
	p := new(Proto)
	// Peek 预读前4字节，不消费数据，拿到total length
	buf, err := d.r.Peek(4)
	if err != nil {
		return nil, err
	}
	lenght := binary.BigEndian.Uint32(buf)
	// 整个报文长度 = lenght + 4
	buf = make([]byte, lenght+4)
	if _, err := io.ReadFull(d.r, buf); err != nil {
		return nil, err
	}
	err = Unmarshal(buf, p)
	return p, err
}

// Coder 同时持有Encoder和Decoder，读写一体，用于net.Conn这类io.ReadWriter
type Coder struct {
	e *Encoder
	d *Decoder
}

func NewCoder(rb io.ReadWriter) *Coder {
	c := Coder{e: NewEncoder(rb), d: NewDecoder(rb)}
	return &c
}

func (c *Coder) Encode(p *Proto) error {
	return c.e.Encode(p)
}

func (c *Coder) Decode() (*Proto, error) {
	return c.d.Decode()
}

```

## moonmq/proto/const.go
> 协议常量定义文件，参考 AMQP 协议设计，存放**消息 Method 方法号、消息头字段 key 常量、交换机类型、长度限制**。
> 区分同步请求 / 同步应答 / 异步消息的 method 编号；消息 Header 的 Fields 里使用固定字符串 key；提供发布类型字符串与枚举的映射。
> **偶数 = 同步请求，奇数 = 同步回复，>10000 = 异步**
```Go
package proto

// Refer ampq protocol, we have below methods:
// 1, synchronous request, must wait for the special reply method,
//
//	but can handle asynchronous method when waits
//
// 2, synchronous reply, to a special synchronous request
// 3, asynchronous request or reply
// synchronous request is even number
// synchronous reply is odd number
// asynchronous is even number
const (
	Publish    uint32 = 10
	Publish_OK uint32 = 11
	Bind       uint32 = 20
	Bind_OK    uint32 = 21
	Unbind     uint32 = 30
	Unbind_OK  uint32 = 31
	//asynchronous > 10000
	Error     uint32 = 10010
	Heartbeat uint32 = 10020
	Push      uint32 = 10030
	Ack       uint32 = 10040
)

// Fields 里面用到的key常量，就是前面Proto.Fields map的key
const (
	MsgIdStr      = "msg_id"
	VersionStr    = "version"
	PubTypeStr    = "pub_type"
	QueueStr      = "queue"
	RoutingKeyStr = "routing_key"
	NoAckStr      = "no_ack"
	CodeStr       = "code"
)

// 发布类型枚举
const (
	DirectType uint8 = 0
	FanoutType uint8 = 1
)

// 发布类型字符串常量，放在Fields["pub_type"]的值
const (
	DirectPubTypeStr = "direct"
	FanoutPubTypeStr = "fanout"
)

// PublishTypeMap：字符串 -> 数字枚举映射，方便业务转换
var PublishTypeMap = map[string]uint8{
	DirectPubTypeStr: DirectType,
	FanoutPubTypeStr: FanoutType,
}

// 参数长度上限，参数校验用
const (
	MaxQueueName      = 200
	MaxRoutingKeyName = 200
)

```
## moonmq/proto/error.go
> 封装协议层错误消息结构体 `ProtoError`，用来快速构造 **Error 类型协议消息（Method = Error，10010）**。
```Go
package proto

import (
	"strconv"
)

// Method: Error
// Fields:
//
//	code: xxx (http error code, int string)
//
// Body: message
type ProtoError struct {
	P *Proto
}

func NewProtoError(code int, message string) *ProtoError {
	return &ProtoError{
		P: NewProto(Error,
			map[string]string{
				CodeStr: strconv.Itoa(code),
			},
			[]byte(message),
		),
	}
}

func (p *ProtoError) Error() string {
	return string(p.P.Body)
}

```
##  moonmq/proto/msg.go
> 对常用协议消息做包装封装，分别定义 `PublishProto / PublishOKProto / PushProto / AckProto`。
内部都持有 `*Proto`，提供构造函数快速构建对应 Method 的消息，上层不用每次手动调用`NewProto`、填 Method 常量和 Fields，简化开发
- PublishProto：客户端发送**Publish（10）同步发布请求**
- PublishOKProto：网关回复 **Publish_OK（11）发布成功应答**
- PushProto：网关向消费者推送消息，Push（10030，异步消息）
- AckProto：消费者回复 Ack 确认消息，Ack（10040，异步消息）
```Go
package proto

// Method: Publish
// Fields:
//
//	queue: xxx
//	routing_key: xxx
//	//type: direct|fanout
//	//direct select a consumer to push using round-robin
//	//fanout broadcast to all consumers, ignore routing key
//	pub_type: xxx
//
// Body:
//
//	body
type PublishProto struct {
	P *Proto
}

func NewPublishProto(queue string, routingKey string, pubType string, body []byte) *PublishProto {
	return &PublishProto{
		P: NewProto(Publish, map[string]string{
			QueueStr:      queue,
			RoutingKeyStr: routingKey,
			PubTypeStr:    pubType,
		}, body),
	}
}

// Method: Publish_OK
// Fields: nil
// Body: msg id (int64 string)
type PublishOKProto struct {
	P *Proto
}

func NewPublishOKProto(msgId string) *PublishOKProto {
	return &PublishOKProto{
		P: NewProto(Publish_OK, nil, []byte(msgId)),
	}
}

// Method: Push
// Fields:
//
//	queue: xxx
//	msg_id: xxx
//
// Body:
//
//	body
type PushProto struct {
	P *Proto
}

func NewPushProto(queue string, msgId string, body []byte) *PushProto {
	return &PushProto{
		P: NewProto(Push, map[string]string{
			QueueStr: queue,
			MsgIdStr: msgId,
		}, body),
	}
}

// Method: Ack
// Fields:
//
//	queue: xxx
//	msg_id: xxx (int64 string)
type AckProto struct {
	P *Proto
}

func NewAckProto(queue string, msgId string) *AckProto {
	return &AckProto{
		P: NewProto(Ack, map[string]string{
			QueueStr: queue,
			MsgIdStr: msgId,
		}, nil),
	}
}

```
## moonmq/proto/base.go
> 用来**封装心跳协议消息**，属于这套自定义消息协议里的心跳包。
```Go
package proto

// Method: Heartbeat
// Fields: nil
// Body: nil
type HeartbeatProto struct {
	P *Proto
}

func NewHeartbeatProto() *HeartbeatProto {
	return &HeartbeatProto{
		P: NewProto(Heartbeat, nil, nil),
	}
}

```

## moonmq/proto/queue.go
> **消费者绑定 / 解绑队列**的协议消息封装，参考 AMQP 模式
 - `BindProto`：消费者发送 **Bind（20，同步请求）**，把当前连接绑定到指定队列；可设置 `no_ack` 模式。
  - no_ack=1：消费者收到消息后**不需要回复 Ack**，网关投递后直接标记消息完成；
  - no_ack 不存在：消费者收到消息后必须回复 Ack。
- `BindOKProto`：网关回复 **Bind_OK（21，同步应答）**，告知消费者绑定成功。
- `UnbindProto`：消费者发送 **Unbind（30，同步请求）**，解除当前连接和队列的绑定，不再接收该队列消息。
- `UnbindOKProto`：网关回复 **Unbind_OK（31，同步应答）**，告知解绑成功；queue 为空时代表解绑全部队列。

> 
> Bind / Unbind 属于同步请求应答对：客户端发 Bind，必须等待 Bind_OK；Unbind 同理。
```Go
package proto

// Method: Bind
// Fields:
//
//	queue: xxx
//	routing_key: xxx
//	no_ack: 1 or none
//
// Body: nil
type BindProto struct {
	P *Proto
}

func NewBindProto(queue string, routingKey string, noAck bool) *BindProto {
	fields := map[string]string{
		QueueStr:      queue,
		RoutingKeyStr: routingKey,
	}
	if noAck {
		fields[NoAckStr] = "1"
	}
	return &BindProto{
		P: NewProto(Bind, fields, nil),
	}
}

// Method: Bind_OK
// Fields:
//
//	queue: xxx
type BindOKProto struct {
	P *Proto
}

func NewBindOKProto(queue string) *BindOKProto {
	return &BindOKProto{
		P: NewProto(Bind_OK, map[string]string{
			QueueStr: queue,
		}, nil),
	}
}

// Method: Unbind
// Fields:
//
//	queue: xxx
//
// Body: nil
type UnbindProto struct {
	P *Proto
}

func NewUnbindProto(queue string) *UnbindProto {
	return &UnbindProto{
		P: NewProto(Unbind, map[string]string{
			QueueStr: queue,
		}, nil),
	}
}

// Method: Unbind_OK
// Fields:
//
	//if queue is empty, we will unbind all queues
//	queue: xxx
type UnbindOKProto struct {
	P *Proto
}

func NewUnbindOKProto(queue string) *UnbindOKProto {
	return &UnbindOKProto{
		P: NewProto(Unbind_OK, map[string]string{
			QueueStr: queue,
		}, nil),
	}
}

```
## moonmq/broker/store.go
> **存储驱动插件化注册机制**，为 broker 消息队列提供可插拔存储层。
> 注册 `memory` 驱动、`sqlite` 驱动；启动时传名字，自动加载对应的存储。
1. `StoreDriver`：存储驱动工厂接口，负责根据配置创建存储实例
2. `Store`：存储能力接口，定义队列需要的所有操作（生成消息 ID、保存消息、删消息、队首、弹出、长度、关闭）
3. 包级变量 `stores`：全局注册表，保存驱动名称 → StoreDriver 的映射
4. `RegisterStore`：注册驱动（插件注册）
5. `OpenStore`：根据驱动名 + 配置，打开对应的存储实例
```GO
package broker

import (
	"encoding/json"
	"fmt"
)

// StoreDriver 存储驱动工厂接口，用来创建Store实例
type StoreDriver interface {
	Open(configJson json.RawMessage) (Store, error)
}

// Store 存储实例接口，定义队列的底层存储操作
type Store interface {
	Close() error                           // 关闭存储，释放资源
	GenerateID() (int64, error)             // 生成全局唯一消息ID
	Save(queue string, m *msg) error        // 保存消息到指定队列
	Delete(queue string, msgId int64) error // 删除指定队列里的msgId消息
	Pop(queue string) error                 // 弹出队首消息（消费完之后弹出）
	Front(queue string) (*msg, error)       // 获取队首消息，不弹出
	Len(queue string) (int, error)          // 获取队列消息数量
}

// stores 全局驱动注册表：驱动名称 -> StoreDriver
var stores = map[string]StoreDriver{}

// RegisterStore 注册存储驱动，驱动注册一般在init()里调用
func RegisterStore(name string, d StoreDriver) error {
	if _, ok := stores[name]; ok {
		return fmt.Errorf("%s has been registered", name)
	}
	stores[name] = d
	return nil
}

// OpenStore 根据驱动名+配置json，创建对应的Store实例
func OpenStore(name string, configJson json.RawMessage) (Store, error) {
	d, ok := stores[name]
	if !ok {
		return nil, fmt.Errorf("%s has not been registered", name)
	}
	return d.Open(configJson)
}

```

## moonmq/broker/memstore.go
> **内存存储驱动实现**，实现前面 `StoreDriver` + `Store` 接口，是 broker 的默认内存版消息存储：
1. `MemStoreDriver`：存储工厂，实现 `StoreDriver`，调用 `Open()` 创建内存存储实例
2. `MemStore`：内存存储实例，实现 `Store` 全部方法；用 map + slice 保存队列消息
   - `msgs map[string][]*msg`：key = 队列名，value = 消息切片（FIFO 队列）
   - `sync.Mutex`：保护并发读写（生产者、多个消费者并发访问）
   - `msgID`：自增全局消息 id
3. `init()`：包初始化时自动注册驱动名字 `mem`，上层可以用 `OpenStore("mem", cfg)` 打开内存存储
```Go
package broker

import (
	"encoding/json"
	"fmt"
	"sync"
)

// MemStoreDriver 内存存储驱动工厂，实现 StoreDriver 接口
type MemStoreDriver struct {
}

func (d MemStoreDriver) Open(jsonConfig json.RawMessage) (Store, error) {
	return newMemStore()
}

// MemStore 内存存储实例，实现 Store 接口
type MemStore struct {
	sync.Mutex
	msgID int64
	msgs  map[string][]*msg
}

func newMemStore() (*MemStore, error) {
	return &MemStore{
		msgID: 0,
		msgs:  make(map[string][]*msg),
	}, nil
}

// GenerateID 生成全局自增消息ID
func (s *MemStore) GenerateID() (int64, error) {
	s.Lock()
	defer s.Unlock()
	s.msgID++
	return s.msgID, nil
}

func (s *MemStore) key(queue string) string {
	return fmt.Sprintf("%s", queue)
}

// Close 关闭内存存储，内存版不需要释放资源
func (s *MemStore) Close() error {
	return nil
}

// Save 保存消息，追加到队列尾部
func (s *MemStore) Save(queue string, m *msg) error {
	key := s.key(queue)
	s.Lock()
	defer s.Unlock()
	q, ok := s.msgs[key]
	if !ok {
		q = make([]*msg, 0, 1)
	}
	s.msgs[key] = append(q, m)
	return nil
}

// Delete 根据msgId删除队列中指定消息
func (s *MemStore) Delete(queue string, msgId int64) error {
	key := s.key(queue)
	s.Lock()
	defer s.Unlock()
	q, ok := s.msgs[key]
	if !ok {
		return nil
	}
	for i, m := range q {
		if m.id == msgId {
			copy(q[i:], q[i+1:])
			q[len(q)-1] = nil
			q = q[:len(q)-1]
			if len(q) == 0 {
				delete(s.msgs, key)
			} else {
				s.msgs[key] = q
			}
			return nil
		}
	}
	return nil
}

// Pop 弹出队首消息（消费成功之后弹出）
func (s *MemStore) Pop(queue string) error {
	key := s.key(queue)
	s.Lock()
	defer s.Unlock()
	q, ok := s.msgs[key]
	if !ok {
		return nil
	}
	if len(q) == 0 {
		return nil
	}
	copy(q[0:], q[1:])
	q[len(q)-1] = nil
	s.msgs[key] = q[:len(q)-1]
	return nil
}

// Len 获取队列消息数量
func (s *MemStore) Len(queue string) (int, error) {
	key := s.key(queue)
	s.Lock()
	defer s.Unlock()
	q, ok := s.msgs[key]
	if !ok {
		return 0, nil
	}
	return len(q), nil
}

// Front 获取队首消息，不弹出
func (s *MemStore) Front(queue string) (*msg, error) {
	key := s.key(queue)
	s.Lock()
	defer s.Unlock()
	q, ok := s.msgs[key]
	if !ok {
		return nil, nil
	}
	if len(q) == 0 {
		return nil, nil
	}
	return q[0], nil
}

// init包初始化：注册mem驱动，名字叫mem
func init() {
	RegisterStore("mem", MemStoreDriver{})
}

```
## moonmq/broker/redisstore.go
> **Redis 持久化存储驱动**，实现前面定义的 `StoreDriver` 和 `Store` 接口。
-- MemStore：内存、进程重启消息丢失，测试用
- RedisStore：消息存在 Redis，broker 重启消息不丢，可以用于生产
底层利用 Redis **有序集合 ZSet** 实现消息队列；使用 `msgId` 作为 score，天然保证有序。
> ZSet 特性：score 从小到大排序；msgId 是自增 ID，score=msgId，消息顺序就是入队顺序（FIFO）
```Go
package broker

import (
	"encoding/json"
	"fmt"
	"github.com/garyburd/redigo/redis"
	"strings"
)

// RedisStoreConfig redis驱动配置结构体，会从json.RawMessage反序列化
type RedisStoreConfig struct {
	Addr      string `json:"addr"`
	DB        int    `json:"db"`
	Password  string `json:"password"`
	IdleConns int    `json:"idle_conns"`
	KeyPrefix string `json:"key_prefix"`
}

// RedisStore redis存储实例，实现Store接口
type RedisStore struct {
	redis     *redis.Pool
	cfg       *RedisStoreConfig
	keyPrefix string
}

// RedisStoreDriver redis驱动工厂，实现StoreDriver
type RedisStoreDriver struct {
}

func (d RedisStoreDriver) Open(jsonConfig json.RawMessage) (Store, error) {
	return newRedisStore(jsonConfig)
}

func newRedisStore(jsonConfig json.RawMessage) (*RedisStore, error) {
	cfg := new(RedisStoreConfig)
	err := json.Unmarshal(jsonConfig, cfg)
	if err != nil {
		return nil, err
	}
	s := new(RedisStore)
	s.cfg = cfg
	s.keyPrefix = cfg.KeyPrefix

	// redis连接工厂函数，连接池内部调用
	f := func() (redis.Conn, error) {
		n := "tcp"
		if strings.Contains(cfg.Addr, "/") {
			n = "unix"
		}
		c, err := redis.Dial(n, cfg.Addr)
		if err != nil {
			return nil, err
		}
		// 密码认证
		if len(cfg.Password) > 0 {
			if _, err = c.Do("AUTH", cfg.Password); err != nil {
				c.Close()
				return nil, err
			}
		}
		// 切换redis db
		if cfg.DB != 0 {
			if _, err = c.Do("SELECT", cfg.DB); err != nil {
				c.Close()
				return nil, err
			}
		}
		return c, nil
	}
	// 创建redis连接池
	s.redis = redis.NewPool(f, cfg.IdleConns)
	return s, nil
}

// key 拼接redis key：前缀 + queue名称，隔离不同业务
func (s *RedisStore) key(queue string) string {
	return fmt.Sprintf("%s:queue:%s", s.keyPrefix, queue)
}

// Close 关闭redis连接池
func (s *RedisStore) Close() error {
	s.redis.Close()
	s.redis = nil
	return nil
}

// GenerateID 利用Redis INCR全局自增，生成唯一msgId
func (s *RedisStore) GenerateID() (int64, error) {
	key := fmt.Sprintf("%s:base:msg_id", s.keyPrefix)
	c := s.redis.Get()
	n, err := redis.Int64(c.Do("INCR", key))
	c.Close()
	return n, err
}

// Save 保存消息：ZADD 队列key score=msgId value=msg序列化后的数据
func (s *RedisStore) Save(queue string, m *msg) error {
	key := s.key(queue)
	buf, _ := m.Encode()
	c := s.redis.Get()
	_, err := c.Do("ZADD", key, m.id, buf)
	c.Close()
	return err
}

// Delete 根据msgId删除指定消息：删除score=msgId的元素
func (s *RedisStore) Delete(queue string, msgId int64) error {
	key := s.key(queue)
	c := s.redis.Get()
	_, err := c.Do("ZREMRANGEBYSCORE", key, msgId, msgId)
	c.Close()
	return err
}

// Pop 弹出队首消息（rank=0），移除有序集合第0号元素
func (s *RedisStore) Pop(queue string) error {
	key := s.key(queue)
	c := s.redis.Get()
	_, err := c.Do("ZREMRANGEBYRANK", key, 0, 0)
	c.Close()
	return err
}

// Len 获取队列消息总数，ZCOUNT统计全部元素
func (s *RedisStore) Len(queue string) (int, error) {
	key := s.key(queue)
	c := s.redis.Get()
	n, err := redis.Int(c.Do("ZCOUNT", key, "-inf", "+inf"))
	c.Close()
	return n, err
}

// Front 获取队首消息，ZRANGE拿rank=0元素，不删除
func (s *RedisStore) Front(queue string) (*msg, error) {
	key := s.key(queue)
	c := s.redis.Get()
	vs, err := redis.Values(c.Do("ZRANGE", key, 0, 0))
	c.Close()
	if err != nil && err != redis.ErrNil {
		return nil, err
	} else if err == redis.ErrNil {
		return nil, nil
	} else if len(vs) == 0 {
		return nil, nil
	} else if len(vs) > 1 {
		return nil, fmt.Errorf("front more than one msg")
	}
	buf := vs[0].([]byte)
	m := new(msg)
	if err = m.Decode(buf); err != nil {
		return nil, err
	}
	return m, nil
}

// init包初始化，注册redis驱动，名字redis
func init() {
	RegisterStore("redis", RedisStoreDriver{})
}

```
## moonmq/broker/msg.go
> 消息结构体定义 + **二进制编解码（Encode / Decode）**
1. `msg`：broker 内部消息模型，承载一条消息全部元数据 + 消息体
2. `newMsg`：消息构造函数
3. `Encode`：把 msg 结构体 → 二进制字节数组（存 Redis / MemStore 里）
4. `Decode`：二进制字节数组 → 还原 msg 结构体
> 不是 json 序列化！是**自定义二进制协议**，好处：体积更小、序列化速度更快，适合消息队列存储。
```Go
package broker

import (
	"encoding/binary"
	"fmt"
	"time"
)

// msg broker内部消息结构
type msg struct {
	id         int64  // 全局唯一消息id
	ctime      int64  // 创建时间，unix时间戳(秒)
	pubType    uint8  // 发布类型
	routingKey string // 路由key
	body       []byte // 消息主体内容
}

// newMsg 构造消息，一次性字面量写法（和前面风格对齐）
func newMsg(id int64, pubType uint8, routingKey string, body []byte) *msg {
	return &msg{
		id:         id,
		ctime:      time.Now().Unix(),
		pubType:    pubType,
		routingKey: routingKey,
		body:       body,
	}
}

// Encode msg结构体编码成二进制大端字节数组
func (m *msg) Encode() ([]byte, error) {
	// 总长度 = 4(总长度) +8(id)+8(ctime)+1(pubType)+1(routingKey长度)+routingKey字节 + body字节
	lenBuf := 4 + 8 + 8 + 1 + 1 + len(m.routingKey) + len(m.body)
	buf := make([]byte, lenBuf)
	pos := 0

	// 1. 写入总长度 uint32 大端
	binary.BigEndian.PutUint32(buf[pos:], uint32(lenBuf))
	pos += 4

	// 2. msg id int64
	binary.BigEndian.PutUint64(buf[pos:], uint64(m.id))
	pos += 8

	// 3. 创建时间 ctime
	binary.BigEndian.PutUint64(buf[pos:], uint64(m.ctime))
	pos += 8

	// 4. pubType 1字节
	buf[pos] = byte(m.pubType)
	pos++

	// 5. routingKey长度 1字节（限制routingKey最长255）
	buf[pos] = byte(len(m.routingKey))
	pos++

	// 6. routingKey字符串
	copy(buf[pos:], m.routingKey)
	pos += len(m.routingKey)

	// 7. body消息体
	copy(buf[pos:], m.body)

	return buf, nil
}

// Decode 二进制字节数组解码还原msg
func (m *msg) Decode(buf []byte) error {
	if len(buf) < 4 {
		return fmt.Errorf("buf too short")
	}
	pos := 0

	// 读取包总长度
	lenBuf := int(binary.BigEndian.Uint32(buf[0:4]))
	if lenBuf != len(buf) {
		return fmt.Errorf("invalid buf len")
	}
	pos += 4

	// 读取msg id
	m.id = int64(binary.BigEndian.Uint64(buf[pos : pos+8]))
	pos += 8

	// 读取ctime
	m.ctime = int64(binary.BigEndian.Uint64(buf[pos : pos+8]))
	pos += 8

	// pubType
	m.pubType = uint8(buf[pos])
	pos++

	// routingKey长度
	keyLen := int(uint8(buf[pos]))
	pos++

	// routingKey内容
	m.routingKey = string(buf[pos : pos+keyLen])
	pos += keyLen

	// 剩下全部是body
	m.body = buf[pos:]
	return nil
}

```
## moonmq/broker/queue.go
> 这是**队列核心业务逻辑**，实现消息分发、消费者绑定解绑、消息投递、ACK 确认，支持两种分发模式：
1. `direct`：直连模式，轮询路由匹配的消费者（一条消息只发给一个消费者）
2. `fanout`：广播模式，消息发给当前队列**所有绑定的消费者**
> 关键设计：每个`queue`内部维护一个任务通道 `ch chan func()`，所有操作（Bind/Unbind/Ack/Push）封装成函数丢进通道，由独立`run()`协程串行执行。
✅ 单协程串行处理，**不用大量锁**，天然解决并发竞争，这是这个 MQ 很经典的设计。
```Go
package broker

import (
	"container/list"
	"fmt"
	"sync"
	"time"

	"github.com/siddontang/moonmq/proto"
)

/*
	push rule
	1, push type: fanout, push to all channels， ignore routing key
	2, push type: direct, roll-robin to select a channel which routing-key match
		msg routing-key, if no channel match, discard msg
*/

// queue 消息队列实例，一个队列对应一个topic/queue名称
type queue struct {
	qs          *queues
	app         *App
	store       Store
	name        string
	channels    *list.List            // 绑定到这个队列的消费者channel列表
	ch          chan func()           // 任务通道，所有操作丢进这个channel，run协程串行执行
	waitingAcks map[*channel]struct{} // 已经推送消息，等待消费者ack的channel集合
	lastPushId  int64                 // 当前等待ack的消息id；-1代表无消息待ack
}

func newQueue(qs *queues, name string) *queue {
	rq := &queue{
		qs:          qs,
		app:         qs.app,
		store:       qs.app.ms,
		name:        name,
		channels:    list.New(),
		lastPushId:  -1,
		waitingAcks: make(map[*channel]struct{}),
		ch:          make(chan func(), 32),
	}
	go rq.run()
	return rq
}

// run queue的主循环协程：串行执行所有任务 + 定时检测队列空闲
func (rq *queue) run() {
	for {
		select {
		case f := <-rq.ch:
			f()
		case <-time.After(5 * time.Minute):
			// 5分钟超时：没有消费者，并且存储里没有消息，则删除队列，释放资源
			if rq.channels.Len() == 0 {
				m, _ := rq.getMsg()
				if m == nil {
					//no conn, and no msg
					rq.qs.Delete(rq.name)
					return
				}
			}
		}
	}
}

// Bind 消费者绑定队列，加入channels列表，绑定成功后尝试推送消息
func (rq *queue) Bind(c *channel) {
	f := func() {
		// 防止重复绑定
		for e := rq.channels.Front(); e != nil; e = e.Next() {
			if e.Value.(*channel) == c {
				return
			}
		}
		rq.channels.PushBack(c)
		rq.push()
	}
	rq.ch <- f
}

// Unbind 消费者解绑队列，从channels移除；如果该channel有等待ack的消息，触发重推
func (rq *queue) Unbind(c *channel) {
	f := func() {
		var repush bool = false
		for e := rq.channels.Front(); e != nil; e = e.Next() {
			if e.Value.(*channel) == c {
				rq.channels.Remove(e)
				if _, ok := rq.waitingAcks[c]; ok {
					//conn not ack
					delete(rq.waitingAcks, c)
					if len(rq.waitingAcks) == 0 {
						//all waiting conn not send ack
						//repush
						repush = true
					}
				}
				break
			}
		}
		if repush {
			rq.lastPushId = -1
			rq.push()
		}
	}
	rq.ch <- f
}

// Ack 消费者回复确认：删除该消息，清空等待ack集合，继续推送下一条消息
func (rq *queue) Ack(msgId int64) {
	f := func() {
		if msgId != rq.lastPushId {
			return
		}
		rq.store.Delete(rq.name, msgId)
		rq.waitingAcks = map[*channel]struct{}{}
		rq.lastPushId = -1
		rq.push()
	}
	rq.ch <- f
}

// Push 外部收到新消息，触发一次消息推送尝试
func (rq *queue) Push(m *msg) {
	f := func() {
		rq.push()
	}
	rq.ch <- f
}

// getMsg 获取队首有效消息，自动过滤超时消息
func (rq *queue) getMsg() (*msg, error) {
	var m *msg
	var err error
	for {
		m, err = rq.store.Front(rq.name)
		if err != nil {
			return nil, err
		} else if m == nil {
			return nil, nil
		}
		if rq.app.cfg.MessageTimeout > 0 {
			now := time.Now().Unix()
			if m.ctime+int64(rq.app.cfg.MessageTimeout) < now {
				//消息超时，直接删除
				if err := rq.store.Delete(rq.name, m.id); err != nil {
					return nil, err
				}
			} else {
				break
			}
		}
	}
	return m, nil
}

// push 核心分发入口：判断是否有待ack消息、有没有消费者，根据pubType选择fanout/direct
func (rq *queue) push() {
	if rq.lastPushId != -1 {
		return
	}
	if rq.channels.Len() == 0 {
		return
	}
	m, err := rq.getMsg()
	if err != nil {
		return
	} else if m == nil {
		return
	}
	switch m.pubType {
	case proto.FanoutType:
		err = rq.pushFanout(m)
	default:
		err = rq.pushDirect(m)
	}
	if err == nil {
		rq.lastPushId = m.id
	}
}

// pushMsg 异步推送消息给单个channel，用done通道返回推送结果
func (rq *queue) pushMsg(done chan bool, m *msg, c *channel) {
	go func() {
		if err := c.Push(m); err == nil {
			//push suc
			done <- true
		} else {
			done <- false
		}
	}()
}

// match 判断消息routingKey 和消费者订阅routingKey是否匹配（当前简单全等匹配）
func (rq *queue) match(m *msg, c *channel) bool {
	pubKey := m.routingKey
	subKey := c.routingKey
	//now simple check same, later check regexp like rabbitmq
	return pubKey == subKey
}

// pushDirect direct模式：找到匹配routingKey的消费者，轮询（移到链表尾部实现简单轮询）
func (rq *queue) pushDirect(m *msg) error {
	var c *channel = nil
	for e := rq.channels.Front(); e != nil; e = e.Next() {
		ch := e.Value.(*channel)
		if !rq.match(m, ch) {
			continue
		}
		//轮询：取出当前消费者放到链表尾部，下一条消息选下一个
		rq.channels.Remove(e)
		rq.channels.PushBack(ch)
		c = ch
		break
	}
	if c == nil {
		//no channel match, discard msg and push next
		rq.store.Delete(rq.name, m.id)
		f := func() {
			rq.push()
		}
		rq.ch <- f
		return fmt.Errorf("discard msg")
	}
	rq.waitingAcks[c] = struct{}{}
	done := make(chan bool, 1)
	rq.pushMsg(done, m, c)
	if r := <-done; r == true {
		return nil
	} else {
		return fmt.Errorf("push direct error")
	}
}

// pushFanout fanout广播模式，发给所有绑定的channel
func (rq *queue) pushFanout(m *msg) error {
	done := make(chan bool, rq.channels.Len())
	for e := rq.channels.Front(); e != nil; e = e.Next() {
		c := e.Value.(*channel)
		rq.waitingAcks[c] = struct{}{}
		rq.pushMsg(done, m, c)
	}
	for i := 0; i < rq.channels.Len(); i++ {
		r := <-done
		if r == true {
			return nil
		}
	}
	return fmt.Errorf("push fanout error")
}

// queues：全局队列管理器，管理所有queue
type queues struct {
	sync.RWMutex
	app *App
	qs  map[string]*queue
}

func newQueues(app *App) *queues {
	return &queues{
		app: app,
		qs:  make(map[string]*queue),
	}
}

// Get 获取队列，不存在则新建queue
func (qs *queues) Get(name string) *queue {
	qs.Lock()
	if r, ok := qs.qs[name]; ok {
		qs.Unlock()
		return r
	} else {
		r := newQueue(qs, name)
		qs.qs[name] = r
		qs.Unlock()
		return r
	}
}

// Getx 获取队列，不存在返回nil（只读，RLock）
func (qs *queues) Getx(name string) *queue {
	qs.RLock()
	r, ok := qs.qs[name]
	qs.RUnlock()
	if ok {
		return r
	} else {
		return nil
	}
}

// Delete 删除队列
func (qs *queues) Delete(name string) {
	qs.Lock()
	delete(qs.qs, name)
	qs.Unlock()
}

```
## moonmq/broker/channel.go
> `channel` 代表**消费者与队列之间的订阅连接**。
> 一个消费者连接订阅某个队列时，就会创建一个 `channel`；它本身不维护网络 IO，**委托 `msgPusher` 去完成底层消息推送**，解耦队列业务逻辑和网络层。
```Go
package broker

// msgPusher 消息推送接口，抽象底层网络发送逻辑
type msgPusher interface {
	Push(ch *channel, m *msg) error
}

// channel：代表绑定到队列的消费者订阅通道
type channel struct {
	p          msgPusher // 底层推送实现（网络层）
	q          *queue    // 所属队列
	routingKey string    // 订阅的路由key，direct模式用于消息匹配
	noAck      bool      // 是否开启noAck模式（自动ack，不需要消费者手动ack）
}

// newChannel 创建订阅通道，并自动绑定到队列
func newChannel(p msgPusher, q *queue, routingKey string, noAck bool) *channel {
	ch := &channel{
		p:          p,
		q:          q,
		routingKey: routingKey,
		noAck:      noAck,
	}
	q.Bind(ch)
	return ch
}

// Reset 重置订阅参数：更换routingKey、修改noAck
func (c *channel) Reset(routingKey string, noAck bool) {
	c.routingKey = routingKey
	c.noAck = noAck
}

// Close 关闭订阅：从队列解绑channel
func (c *channel) Close() {
	c.q.Unbind(c)
}

// Push 将消息推送给当前channel对应的消费者（调用msgPusher的底层推送）
func (c *channel) Push(m *msg) error {
	return c.p.Push(c, m)
}

// Ack 消费者回复消息确认，转发给queue处理
func (c *channel) Ack(msgId int64) {
	c.q.Ack(msgId)
}

```
## moonmq/broker/conn.go
> conn 是客户端 TCP 连接的封装层
1. 持有原生 TCP 连接，循环读取客户端协议包
2. 根据 Method 分发：Publish / Bind / Unbind / Ack / Heartbeat
3. 维护当前连接所有的订阅 channel
4. 心跳保活、超时断开连接
5. 统一向外写响应包、错误包
6. 连接断开时自动解绑所有队列
```Go
package broker

import (
	"fmt"
	"io"
	"net"
	"runtime"
	"sync"
	"time"

	"github.com/siddontang/go-log/log"
	"github.com/siddontang/moonmq/proto"
)

// conn 单个客户端TCP连接管理器
type conn struct {
	sync.Mutex //写TCP加锁，防止并发写乱包
	app        *App
	c          net.Conn
	decoder    *proto.Decoder
	lastUpdate int64
	channels   map[string]*channel
}

// newConn 新建连接，一次性字面量构造
func newConn(app *App, co net.Conn) *conn {
	c := &conn{
		app:        app,
		c:          co,
		decoder:    proto.NewDecoder(co),
		lastUpdate: time.Now().Unix(),
		channels:   make(map[string]*channel),
	}
	c.checkKeepAlive()
	return c
}

// run 连接主逻辑：读消息 -> 关闭解绑 -> 关闭连接
func (c *conn) run() {
	c.onRead()
	c.unBindAll()
	_ = c.c.Close()
}

// unBindAll 连接断开，解绑当前所有订阅队列
func (c *conn) unBindAll() {
	for _, ch := range c.channels {
		ch.Close()
	}
	// 清空map
	c.channels = make(map[string]*channel)
}

// onRead 循环读取客户端协议，核心事件循环
func (c *conn) onRead() {
	defer func() {
		// 全局崩溃捕获，防止单个连接panic拖垮整个mq
		if err := recover(); err != nil {
			buf := make([]byte, 1024)
			buf = buf[:runtime.Stack(buf, false)]
			log.Fatal("conn crash %v:\n%s", err, buf)
		}
	}()

	for {
		p, err := c.decoder.Decode()
		if err != nil {
			if err != io.EOF {
				log.Info("read client err: %v", err)
			}
			return
		}

		// 每次收到数据刷新保活时间
		c.lastUpdate = time.Now().Unix()

		// 根据协议方法分发处理
		var handleErr error
		switch p.Method {
		case proto.Publish:
			handleErr = c.handlePublish(p)
		case proto.Bind:
			handleErr = c.handleBind(p)
		case proto.Unbind:
			handleErr = c.handleUnbind(p)
		case proto.Ack:
			handleErr = c.handleAck(p)
		case proto.Heartbeat:
			// 心跳只刷新时间，无需处理业务
		default:
			log.Info("invalid method:%d", p.Method)
			return
		}

		if handleErr != nil {
			_ = c.writeError(handleErr)
		}
	}
}

// writeError 统一返回错误协议包
func (c *conn) writeError(err error) {
	var p *proto.Proto
	if pe, ok := err.(*proto.ProtoError); ok {
		p = pe.P
	} else {
		pe = proto.NewProtoError(500, err.Error())
		p = pe.P
	}
	_ = c.writeProto(p)
}

// protoError 快速构造协议错误
func (c *conn) protoError(code int, message string) error {
	return proto.NewProtoError(code, message)
}

// writeProto 安全写入协议包到客户端TCP
func (c *conn) writeProto(p *proto.Proto) error {
	buf, err := proto.Marshal(p)
	if err != nil {
		return err
	}

	c.Lock()
	n, err := c.c.Write(buf)
	c.Unlock()

	if err != nil {
		_ = c.c.Close()
		return err
	}
	if n != len(buf) {
		_ = c.c.Close()
		return fmt.Errorf("write incomplete %d/%d", n, len(buf))
	}
	return nil
}

// checkKeepAlive 心跳超时检测（递归定时检测）
func (c *conn) checkKeepAlive() {
	var f func()
	f = func() {
		timeout := int64(1.5 * float32(c.app.cfg.KeepAlive))
		if time.Now().Unix()-c.lastUpdate > timeout {
			log.Info("client keepalive timeout, close conn")
			_ = c.c.Close()
			return
		}
		time.AfterFunc(time.Duration(c.app.cfg.KeepAlive)*time.Second, f)
	}
	time.AfterFunc(time.Duration(c.app.cfg.KeepAlive)*time.Second, f)
}

```
## moonmq/broker/conn_msg.go
> 该文件实现 MQ 最核心的两个客户端请求逻辑：
- Publish 消息发布：生产者推送消息到队列
- Ack 消息确认：消费者消费完成回复确认
> 客户端Publish请求 → 参数校验 → 存储消息 → 触发队列推送 → 消费者消费 → 客户端Ack → 删除消息
- (app *App) saveMsg：真正存储消息、队列限流、生成消息ID
- (c *conn) handlePublish：处理生产者发布消息请求（核心入口）
- (c *conn) handleAck：处理消费者ACK确认请求
```Go
package broker

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/siddontang/moonmq/proto"
)

// checkPublish 发布消息前置参数校验，拦截非法请求
// queue: 队列名
// routingKey: 路由key
// tp: 发布类型 direct/fanout（字符串）
// message: 消息体
func checkPublish(queue string, routingKey string, tp string, message []byte) error {
	if len(message) == 0 {
		return fmt.Errorf("publish empty data forbidden")
	} else if len(queue) == 0 {
		return fmt.Errorf("queue empty forbidden")
	} else if len(queue) > proto.MaxQueueName {
		return fmt.Errorf("queue too long")
	} else if len(routingKey) > proto.MaxRoutingKeyName {
		return fmt.Errorf("routingkey too long")
	}
	// 转小写，校验发布类型是否在支持的类型map内
	_, ok := proto.PublishTypeMap[strings.ToLower(tp)]
	if !ok {
		return fmt.Errorf("invalid publish type %s", tp)
	}
	return nil
}

// saveMsg 保存消息到存储层，处理队列上限限流逻辑
// 返回构造好的msg对象
func (app *App) saveMsg(queue string, routingKey string, tp string, message []byte) (*msg, error) {
	// 将字符串类型转为枚举类型
	t, _ := proto.PublishTypeMap[strings.ToLower(tp)]

	// 如果配置了队列最大消息数量，执行限流淘汰
	if app.cfg.MaxQueueSize > 0 {
		// 查询当前队列消息总数
		if n, err := app.ms.Len(queue); err != nil {
			return nil, err
		} else if n >= app.cfg.MaxQueueSize {
			// 队列已满，弹出队首旧消息（FIFO淘汰）
			if err = app.ms.Pop(queue); err != nil {
				return nil, err
			}
		}
	}

	// 存储层生成全局唯一消息ID
	id, err := app.ms.GenerateID()
	if err != nil {
		return nil, err
	}
	// 构造msg结构体
	msg := newMsg(id, t, routingKey, message)
	// 将消息写入存储（内存/redis）
	if err := app.ms.Save(queue, msg); err != nil {
		return nil, err
	}
	return msg, nil
}

// handlePublish 处理生产者 Publish 请求
// 完整流程：参数校验 -> 消息持久化 -> queue触发推送 -> 返回PublishOK
func (c *conn) handlePublish(p *proto.Proto) error {
	// 从协议包取出字段
	tp := p.PubType()
	queue := p.Queue()
	routingKey := p.RoutingKey()
	message := p.Body

	// 前置校验，参数非法返回400错误包
	if err := checkPublish(queue, routingKey, tp, message); err != nil {
		return c.protoError(http.StatusBadRequest, err.Error())
	}
	// 保存消息到底层存储
	msg, err := c.app.saveMsg(queue, routingKey, tp, message)
	if err != nil {
		return c.protoError(http.StatusInternalServerError, err.Error())
	}

	// 获取队列实例，调用Push触发消息分发，推给在线消费者
	q := c.app.qs.Get(queue)
	q.Push(msg)

	// 构造成功响应，写回客户端
	np := proto.NewPublishOKProto(strconv.FormatInt(msg.id, 10))
	c.writeProto(np.P)
	return nil
}

// handleAck 处理消费者ACK请求：通知broker消息消费成功，可以删除
func (c *conn) handleAck(p *proto.Proto) error {
	queue := p.Queue()
	// 队列名不能为空
	if len(queue) == 0 {
		return c.protoError(http.StatusForbidden, "queue must supplied")
	}
	// 权限校验：当前连接必须订阅过该队列（channel存在），防止伪造ACK
	ch, ok := c.channels[queue]
	if !ok {
		return c.protoError(http.StatusForbidden, "invalid queue")
	}
	// 把字符串msgId转为int64
	msgId, err := strconv.ParseInt(p.MsgId(), 10, 64)
	if err != nil {
		return err
	}
	// 转发ack给channel，最终流转到queue.Ack
	ch.Ack(msgId)
	return nil
}

```
## moonmq/broker/conn_queue.go
> 这是 **消费者订阅处理器**，负责处理客户端 `Bind`（订阅队列）、`Unbind`（取消订阅）请求，同时定义了 `connMsgPusher` —— **消息推送器（实现 msgPusher 接口），队列分发消息后，通过它把消息推送给消费者 TCP 连接**。
-`queue` 准备推送消息给 channel 的时候，调用 `pusher.Push()`，最终走到这个结构体的 Push 方法。
内部就是调用 conn 的 writeProto，把消息打包成 Push 协议包，通过 TCP 发给消费者。
特性：如果 channel 开启 `noAck`，消息一旦推送成功，直接自动 Ack，不需要消费者回复 ack。
```Go
package broker

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/siddontang/moonmq/proto"
)

// checkBind Bind订阅前置参数校验
// queue: 要订阅的队列名
// routingKey: 订阅使用的路由key，direct模式用于消息匹配
func checkBind(queue string, routingKey string) error {
	if len(queue) == 0 {
		return fmt.Errorf("queue empty forbidden")
	} else if len(queue) > proto.MaxQueueName {
		return fmt.Errorf("queue too long")
	} else if len(routingKey) > proto.MaxRoutingKeyName {
		return fmt.Errorf("routingkey too long")
	}
	return nil
}

// connMsgPusher 实现msgPusher接口，网络层消息推送器
// 作用：把queue分发过来的消息，序列化后通过TCP写给当前客户端连接
type connMsgPusher struct {
	c *conn // 持有客户端连接
}

// Push msgPusher接口实现：将消息推送给消费者客户端
// ch: 当前订阅通道
// m: 待推送消息
func (p *connMsgPusher) Push(ch *channel, m *msg) error {
	// 构造Push协议包：队列名、msgId、消息体
	po := proto.NewPushProto(ch.q.name,
		strconv.FormatInt(m.id, 10), m.body)
	// 打包成Push协议包， 通过TCP写消息给消费者
	err := p.c.writeProto(po.P)
	// 推送成功 + noAck模式：自动ack，不需要客户端回复ack
	// 1 自动ack
	if err == nil && ch.noAck {
		ch.Ack(m.id)
	}
	return err
}

// handleBind 处理消费者Bind订阅请求
// 逻辑：参数校验 -> 判断是否已有channel，新建/复用重置channel -> 返回BindOK
func (c *conn) handleBind(p *proto.Proto) error {
	queue := p.Queue()
	routingKey := p.RoutingKey()
	// 订阅参数合法性校验
	if err := checkBind(queue, routingKey); err != nil {
		return c.protoError(http.StatusBadRequest, err.Error())
	}
	// 读取noAck标记，值为"1"代表开启noAck
	noAck := (p.Value(proto.NoAckStr) == "1")

	// 当前连接是否已经存在该队列的订阅channel
	ch, ok := c.channels[queue]
	if !ok {
		// 不存在：获取队列实例，新建channel存入连接channel map
		q := c.app.qs.Get(queue)
		ch = newChannel(&connMsgPusher{c}, q, routingKey, noAck)
		c.channels[queue] = ch
	} else {
		// 已存在channel：直接重置订阅参数（routingKey/noAck），不复用新对象
		ch.Reset(routingKey, noAck)
	}

	// 返回订阅成功响应BindOK
	np := proto.NewBindOKProto(queue)
	c.writeProto(np.P)
	return nil
}

// handleUnbind 处理消费者取消订阅Unbind请求
// 两种场景：不带队列名（全部取消订阅） / 指定队列（只取消这个队列订阅）
func (c *conn) handleUnbind(p *proto.Proto) error {
	queue := p.Queue()
	// 队列名为空：解绑当前连接下所有channel
	if len(queue) == 0 {
		c.unBindAll()
		np := proto.NewUnbindOKProto(queue)
		c.writeProto(np.P)
		return nil
	}
	// 指定队列：找到对应channel，从map删除，调用Close解绑队列
	if ch, ok := c.channels[queue]; ok {
		delete(c.channels, queue)
		ch.Close()
	}
	// 返回取消订阅成功响应UnbindOK
	np := proto.NewUnbindOKProto(queue)
	c.writeProto(np.P)
	return nil
}

```		
## broker/config.go
> **MQ 配置模块**，负责定义 Broker 全部可配置项、提供默认配置、从本地 json 文件加载配置。
```Go
package broker

import (
	"encoding/json"
	"fmt"
	"os"
)

// Config MQ broker全局配置结构体
// 使用json标签，支持从json配置文件反序列化加载
type Config struct {
	Version        uint32          `json:"version"`        // 配置版本号，方便后续配置兼容升级
	Addr           string          `json:"addr"`           // MQ TCP服务监听地址，客户端通信端口
	HttpAddr       string          `json:"http_addr"`      // HTTP管理接口监听地址
	KeepAlive      int             `json:"keepalive"`      // TCP连接心跳保活时长(秒)，超过1.5倍该值断开死连接
	MaxMessageSize int             `json:"max_msg_size"`   // 单条消息最大字节上限
	MessageTimeout int             `json:"msg_timeout"`    // 消息超时时间，超时未ack会重新投递
	MaxQueueSize   int             `json:"max_queue_size"` // 队列最大消息数量，满了会淘汰旧消息
	Store          string          `json:"store"`          // 存储引擎类型：mem内存 / redis
	StoreConfig    json.RawMessage `json:"store_config"`   // 存储引擎自定义配置，原始json，交给对应store解析
}

// NewDefaultConfig 生成默认配置，不加载外部文件
func NewDefaultConfig() *Config {
	cfg := new(Config)
	cfg.Version = 1
	cfg.Addr = "127.0.0.1:11181"
	cfg.HttpAddr = "127.0.0.1:11180"
	cfg.KeepAlive = 65
	cfg.MaxMessageSize = 1024
	cfg.MessageTimeout = 3600 * 24 // 24小时消息超时
	cfg.MaxQueueSize = 1024
	cfg.Store = "mem" // 默认内存存储
	cfg.StoreConfig = nil
	return cfg
}

// parseConfigJson 从json原始字节解析配置，并做参数校验
func parseConfigJson(buf json.RawMessage) (*Config, error) {
	cfg := new(Config)
	err := json.Unmarshal(buf, cfg)
	if err != nil {
		return nil, err
	}
	// 心跳最大限制：不能超过600秒
	if cfg.KeepAlive > 600 {
		return nil, fmt.Errorf("keepalive must less than 600s, not %d", cfg.KeepAlive)
	}
	return cfg, nil
}

// parseConfigFile 读取本地配置文件，加载并解析为Config
func parseConfigFile(configFile string) (*Config, error) {
	buf, err := os.ReadFile(configFile)
	if err != nil {
		return nil, err
	}
	return parseConfigJson(buf)
}

```
## moonmq/broker/app.go
> Broker **顶层 App 入口文件**，MQ 服务的主对象，串联所有模块
1. 创建全局 App 实例，加载配置、初始化监听器、队列管理器、存储层
2. 同时启动两套服务：TCP 服务（生产者消费者收发消息） + HTTP 管理接口
3. TCP Accept 循环：每来一个客户端连接，新建 conn，开 goroutine 独立处理连接
- main → NewApp / NewAppWithConfig → app.Run ()
→ go startHttp () 启动 http 管理接口
→ startTcp () 阻塞循环 Accept
→ 客户端 TCP 连接进来 → newConn (app, conn) → go co.run ()
→ conn.run () 进入 onRead 循环处理 Publish/Bind/Ack/Unbind
```Go
package broker

import (
	"encoding/json"
	"net"
	"net/http"
	"strings"

	"github.com/garyburd/redigo/redis"
)

// App Broker顶层应用实例，全局单例对象
// 持有所有核心组件、监听端口、队列管理器、存储层，是整个MQ服务入口
type App struct {
	cfg          *Config      // 全局配置
	listener     net.Listener // TCP服务监听器（生产者/消费者客户端连接）
	httpListener net.Listener // HTTP管理接口监听器
	redis        *redis.Pool  // redis连接池，redis存储模式使用
	ms           Store        // 消息存储层接口（mem/redis实现）
	qs           *queues      // 队列管理器，管理所有queue实例
	passMD5      []byte       // 密码md5（预留鉴权字段）
}

// NewAppWithConfig 根据已经解析好的配置，初始化App实例
func NewAppWithConfig(cfg *Config) (*App, error) {
	app := new(App)
	app.cfg = cfg
	var err error

	// 启动TCP监听，接收生产者、消费者TCP连接
	app.listener, err = net.Listen(getNetType(cfg.Addr), cfg.Addr)
	if err != nil {
		return nil, err
	}

	// 如果配置了HttpAddr，则开启HTTP管理接口监听
	if len(cfg.HttpAddr) > 0 {
		app.httpListener, err = net.Listen(getNetType(cfg.HttpAddr), cfg.HttpAddr)
		if err != nil {
			return nil, err
		}
	}

	// 初始化队列管理器
	app.qs = newQueues(app)
	// 根据配置打开存储引擎（mem内存存储 / redis存储）
	app.ms, err = OpenStore(cfg.Store, cfg.StoreConfig)
	if err != nil {
		return nil, err
	}
	return app, nil
}

// getNetType 判断地址类型：包含/ 就是unix域套接字，否则tcp
func getNetType(addr string) string {
	if strings.Contains(addr, "/") {
		return "unix"
	} else {
		return "tcp"
	}
}

// NewApp 从原始json配置字节，先解析Config再创建App
func NewApp(jsonConfig json.RawMessage) (*App, error) {
	cfg, err := parseConfigJson(jsonConfig)
	if err != nil {
		return nil, err
	}
	return NewAppWithConfig(cfg)
}

// Config 返回app持有的全局配置
func (app *App) Config() *Config {
	return app.cfg
}

// Close 关闭Broker资源，优雅退出
func (app *App) Close() {
	if app.listener != nil {
		app.listener.Close()
	}
	if app.httpListener != nil {
		app.httpListener.Close()
	}
	//关闭消息存储层
	app.ms.Close()
}

// startHttp 启动http管理服务，单独协程运行
func (app *App) startHttp() {
	if app.httpListener == nil {
		return
	}
	s := new(http.Server)
	// 注册http接口 /msg，消息管理handler
	http.Handle("/msg", newMsgHandler(app))
	s.Serve(app.httpListener)
}

// startTcp TCP主循环：持续Accept客户端连接
// 每accept一个客户端连接，新建conn对象，单独goroutine执行conn.run()独立处理连接
func (app *App) startTcp() {
	for {
		conn, err := app.listener.Accept()
		if err != nil {
			continue
		}
		co := newConn(app, conn)
		go co.run() // 每个连接一个goroutine，连接之间相互隔离
	}
}

// Run 启动Broker服务入口
// 单独协程启动HTTP管理服务；当前协程阻塞运行TCP服务
func (app *App) Run() {
	go app.startHttp()
	app.startTcp()
}

```
## moonmq/broker/http_msg.go
> 实现 `/msg` HTTP 管理接口，给 MQ 提供**HTTP 版本的发布、拉消息能力**，和 TCP 客户端共用同一套底层逻辑（checkPublish /saveMsg/queue /channel）
> TCP：长连接持续消费；HTTP：单次请求拉一条消息，短连接。
1. `httpMsgPusher`：实现 `msgPusher` 接口，**HTTP 版本的消息推送器**
   - TCP 版本：`connMsgPusher` → 直接 writeProto 写到 TCP 连接
   - HTTP 版本：`httpMsgPusher` → 通过 chan 把消息交给 HTTP handler 协程

```Go
package broker

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

// MsgHandler HTTP接口处理器，对应路由 /msg
// 提供HTTP方式发布消息、拉取消息，作为TCP协议之外的管理接口
type MsgHandler struct {
	app *App // 持有全局Broker实例
}

// newMsgHandler 创建MsgHandler实例，注入App
func newMsgHandler(app *App) *MsgHandler {
	h := new(MsgHandler)
	h.app = app
	return h
}

// ServeHTTP 实现http.Handler接口，接收/msg路由的请求，按Method分发
func (h *MsgHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "POST":
		h.publishMsg(w, r)
	case "PUT":
		h.publishMsg(w, r)
	case "GET":
		h.getMsg(w, r)
	default:
		http.Error(w, "invalid http method", http.StatusMethodNotAllowed)
	}
}

// publishMsg HTTP发布消息接口 POST/PUT /msg
// 使用表单参数：queue、routing_key、pub_type；request body作为消息体
func (h *MsgHandler) publishMsg(w http.ResponseWriter, r *http.Request) {
	// 读取body作为消息内容
	message, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// 从url表单提取参数
	queue := r.FormValue("queue")
	routingKey := r.FormValue("routing_key")
	tp := r.FormValue("pub_type")
	// 复用TCP发布同样的参数校验逻辑
	if err := checkPublish(queue, routingKey, tp, message); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	// 复用App层saveMsg保存消息、队列限流逻辑
	var m *msg
	m, err = h.app.saveMsg(queue, routingKey, tp, message)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// 获取队列并推送消息，和TCP publish逻辑完全一致
	q := h.app.qs.Get(queue)
	q.Push(m)
	// 返回msgId给调用方
	w.Write([]byte(strconv.FormatInt(m.id, 10)))
}

// httpMsgPusher HTTP场景专用消息推送器，同样实现msgPusher接口
// 和connMsgPusher对应；TCP用conn写消息，HTTP用chan把消息传给getMsg协程
type httpMsgPusher struct {
	m chan *msg  // 消息通道：channel推过来的消息放入此通道
	e chan error // 错误返回通道：把写响应的错误传回channel
}

// Push msgPusher接口实现：channel准备推送消息时调用
func (p *httpMsgPusher) Push(ch *channel, m *msg) error {
	p.m <- m // 将消息投递到消息channel，交给getMsg处理
	e, ok := <-p.e
	if e != nil {
		return e
	} else if !ok {
		return fmt.Errorf("push invalid channel")
	} else {
		return nil
	}
}

// getMsg HTTP拉取消息接口 GET /msg
// 短轮询：创建临时channel，等待一条消息，60s超时返回204 NoContent
func (h *MsgHandler) getMsg(w http.ResponseWriter, r *http.Request) {
	queue := r.FormValue("queue")
	routingKey := r.FormValue("routing_key")
	// 复用bind参数校验
	if err := checkBind(queue, routingKey); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	// 创建两个通道用于httpMsgPusher和当前http handler通信
	mc := make(chan *msg, 1)
	ec := make(chan error, 1)
	q := h.app.qs.Get(queue)
	// 创建临时channel，noAck=true（http拉取默认自动ack）
	ch := newChannel(&httpMsgPusher{mc, ec}, q, routingKey, true)
	defer ch.Close() // http请求结束，销毁临时channel，取消订阅

	select {
	case m := <-mc:
		// 拿到消息，写入http响应body
		_, err := w.Write(m.body)
		if err == nil && ch.noAck {
			ch.Ack(m.id)
		}
		ec <- err
		close(ec)
	case <-time.After(60 * time.Second):
		// 60s没有消息，超时返回204
		w.WriteHeader(http.StatusNoContent)
	}
}

```
## cmd/mmqd/main.go
> 整个 moonmq 服务启动入口。只做启动相关工作，业务逻辑全部放在 broker 包。
流程：
1. 解析命令行 flag，读取 `-config` 参数
2. 判断：必须指定配置文件，否则 panic
3. os.ReadFile 读取本地 json 配置文件
4. 调用 `broker.NewApp(buf)`：内部先解析 Config，再初始化 App（listener、queue、store 等）
5. `app.Run()`：启动 http 协程 + 阻塞 TCP Accept 循环，服务正式开始接收客户端连接
```Go
package main

import (
	"flag"
	"os"

	"github.com/siddontang/moonmq/broker"
)

// 定义命令行参数：-config 指定配置文件路径
var configFile = flag.String("config", "", "config file")

func main() {
	// 解析命令行参数
	flag.Parse()

	// 必须传入配置文件，否则直接panic退出
	if len(*configFile) == 0 {
		panic("config file must set")
	}

	// 读取json配置文件内容（已经替换为os.ReadFile，不再使用ioutil）
	buf, err := os.ReadFile(*configFile)
	if err != nil {
		panic(err)
	}

	// 传入配置json字节，创建broker顶层App实例
	var app *broker.App
	app, err = broker.NewApp(buf)
	if err != nil {
		panic(err)
	}

	// 启动Broker，内部会并行启动HTTP管理服务 + TCP消息服务，阻塞运行
	app.Run()
}

```
## moonmq/client/config.go
> 定义 MQ 客户端的配置结构体、默认配置、json 解析逻辑。
```Go
package client
import (
	"encoding/json"
)

// defaultQueueSize 默认客户端内部队列大小常量
const defaultQueueSize int = 16

// Config moonmq客户端配置结构体
type Config struct {
	BrokerAddr   string `json:"broker_addr"`   // broker服务TCP地址，连接moonmq服务端
	KeepAlive    int    `json:"keepalive"`     // TCP心跳保活时长(秒)，和broker侧keepalive配合
	IdleConns    int    `json:"idle_conns"`    // 连接池空闲连接数量
	MaxQueueSize int    `json:"max_queue_size"`// 客户端本地消息队列上限
}

// NewDefaultConfig 返回客户端默认配置
func NewDefaultConfig() *Config {
	cfg := new(Config)
	cfg.BrokerAddr = "127.0.0.1:11181"
	cfg.KeepAlive = 60
	cfg.IdleConns = 2
	cfg.MaxQueueSize = 16
	return cfg
}

// parseConfigJson 从原始json字节解析客户端配置
// 如果MaxQueueSize小于等于0，则使用默认值16
func parseConfigJson(buf json.RawMessage) (*Config, error) {
	c := new(Config)
	if err := json.Unmarshal(buf, c); err != nil {
		return nil, err
	}
	// 容错：配置没填或者非法时，使用默认队列大小
	if c.MaxQueueSize <= 0 {
		c.MaxQueueSize = defaultQueueSize
	}
	return c, nil
}

```
## moonmq/client/conn.go
> client 包的Conn：客户端 TCP 连接封装，负责和 moonmq broker 通信。
> 一条 TCP 连接可以绑定多个 Channel，同时订阅多个队列。
1. `newConn` 创建连接，启动两个逻辑：
   - `keepAlive`：递归定时心跳，维持连接，检测断连
   - `go c.run()`：**读协程**，持续从 socket 读取服务端数据包
2. run 协程两种包处理分支：
   - `proto.Push`：服务端推送消息 → 交给对应 channel 投递消息给业务代码
   - 其它响应包 → 丢进`wait`通道，唤醒`request`阻塞等待
```Go
package client

import (
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/siddontang/moonmq/proto"
)

// Conn 客户端与Broker之间的TCP连接封装
// 一条TCP连接上可以绑定多个Channel（多个队列订阅）
type Conn struct {
	sync.Mutex                        // 普通锁，保护channels、closed等连接状态
	writeLock     sync.Mutex          // 写锁：TCP写操作串行化，防止并发写导致数据包错乱
	client        *Client             // 归属的客户端对象（连接池上层Client）
	cfg           *Config             // 客户端配置
	conn          net.Conn            // 底层TCP/Unix socket连接
	decoder       *proto.Decoder      // proto解码器，读取服务端推送的协议包
	grab          chan struct{}       // 连接池抢连接信号通道（信号量，容量1）
	wait          chan *proto.Proto   // 存放服务端响应包，同步请求等待回复
	closed        bool                // 连接是否关闭标记
	lastHeartbeat int64               // 上次心跳时间戳（代码里这里暂时未使用）
	channels      map[string]*Channel // 当前连接上所有订阅的队列channel，key=队列名
}

// newConn 创建一条新连接，连接Broker，启动读协程+心跳定时器
func newConn(client *Client) (*Conn, error) {
	c := new(Conn)
	c.client = client
	c.cfg = client.cfg
	var n string = "tcp"
	// 判断地址是否unix域套接字
	if strings.Contains(c.cfg.BrokerAddr, "/") {
		n = "unix"
	}
	var err error
	// 建立到broker的网络连接
	if c.conn, err = net.Dial(n, c.cfg.BrokerAddr); err != nil {
		return nil, err
	}
	c.decoder = proto.NewDecoder(c.conn)
	c.grab = make(chan struct{}, 1)
	c.grab <- struct{}{} // 初始状态：连接空闲，可以被获取
	c.channels = make(map[string]*Channel)
	c.wait = make(chan *proto.Proto, 1)
	c.closed = false
	c.lastHeartbeat = 0
	c.keepAlive() // 启动心跳定时发送
	go c.run()    // 启动读循环协程，持续读取服务端数据
	return c, nil
}

// Close 不是直接关闭TCP！解除所有订阅，归还连接到客户端连接池
func (c *Conn) Close() {
	c.unbindAll()
	c.client.pushConn(c)
}

// keepAlive 心跳逻辑：定时发送Heartbeat包给Broker
// 递归time.AfterFunc，每次发送成功再注册下一次心跳
func (c *Conn) keepAlive() {
	var f func()
	f = func() {
		p := proto.NewHeartbeatProto()
		err := c.writeProto(p.P)
		if err != nil {
			// 写失败，关闭连接
			c.close()
			return
		} else {
			// 发送成功，继续等待下一个keepAlive周期
			time.AfterFunc(time.Duration(c.cfg.KeepAlive)*time.Second, f)
		}
	}
	time.AfterFunc(time.Duration(c.cfg.KeepAlive)*time.Second, f)
}

// close 底层真正关闭socket，标记closed=true
func (c *Conn) close() {
	c.conn.Close()
	c.closed = true
}

// run 读协程主循环：持续decode服务端下发协议包
func (c *Conn) run() {
	defer func() {
		c.conn.Close()
		close(c.wait)
		c.closed = true
	}()
	for {
		p, err := c.decoder.Decode()
		if err != nil {
			return // 读取出错，退出循环，defer关闭连接
		}
		if p.Method == proto.Push {
			// Push包：服务端推送消息给消费者，交给对应channel处理
			queueName := p.Queue()
			c.Lock()
			ch, ok := c.channels[queueName]
			if !ok {
				c.Unlock()
				return
			}
			c.Unlock()
			ch.pushMsg(p.MsgId(), p.Body)
		} else {
			// 普通响应包（PublishOK/BindOK等）放入wait通道，唤醒request等待
			c.wait <- p
		}
	}
}

// request 同步请求封装：发送协议包，阻塞等待预期method的响应包
func (c *Conn) request(p *proto.Proto, expectMethod uint32) (*proto.Proto, error) {
	err := c.writeProto(p)
	if err != nil {
		return nil, err
	}
	rp, ok := <-c.wait
	if !ok {
		return nil, fmt.Errorf("wait channel closed")
	}
	if rp.Method == proto.Error {
		return nil, fmt.Errorf("error:%s, code:%s", rp.Body, rp.Fields[proto.CodeStr])
	} else if rp.Method != expectMethod {
		return nil, fmt.Errorf("invalid return method %d != %d", rp.Method, expectMethod)
	}
	return rp, nil
}

// writeProto 将proto结构体序列化，写入TCP连接；加writeLock保证串行写
func (c *Conn) writeProto(p *proto.Proto) error {
	buf, err := proto.Marshal(p)
	if err != nil {
		return err
	}
	c.writeLock.Lock()
	n, err := c.conn.Write(buf)
	c.writeLock.Unlock()
	if err != nil {
		c.close()
		return err
	} else if n != len(buf) {
		// 短写：只写了部分字节，连接异常直接关闭
		c.close()
		return fmt.Errorf("write short %d != %d", n, len(buf))
	}
	return nil
}

// Publish 发布消息到队列，阻塞等待PublishOK，返回msgId
func (c *Conn) Publish(queue string, routingKey string, body []byte, pubType string) (int64, error) {
	p := proto.NewPublishProto(queue, routingKey, pubType, body)
	c.Lock()
	defer c.Unlock()
	np, err := c.request(p.P, proto.Publish_OK)
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(string(np.Body), 10, 64)
}

// Bind 订阅队列，创建/复用Channel，向Broker发送Bind请求
func (c *Conn) Bind(queue string, routingKey string, noAck bool) (*Channel, error) {
	c.Lock()
	defer c.Unlock()
	ch, ok := c.channels[queue]
	if !ok {
		// 当前连接无此队列channel，新建
		ch = newChannel(c, queue, routingKey, noAck)
		c.channels[queue] = ch
	} else {
		// 已存在，直接更新routingKey和noAck配置
		ch.routingKey = routingKey
		ch.noAck = noAck
	}
	p := proto.NewBindProto(queue, routingKey, noAck)
	rp, err := c.request(p.P, proto.Bind_OK)
	if err != nil {
		return nil, err
	}
	if rp.Queue() != queue {
		return nil, fmt.Errorf("invalid bind response queue %s", rp.Queue())
	}
	return ch, nil
}

// unbindAll 取消当前连接全部队列订阅（Unbind不带队列名）
func (c *Conn) unbindAll() error {
	c.Lock()
	defer c.Unlock()
	c.channels = make(map[string]*Channel)
	p := proto.NewUnbindProto("")
	_, err := c.request(p.P, proto.Unbind_OK)
	return err
}

// unbind 取消单个队列订阅
func (c *Conn) unbind(queue string) error {
	c.Lock()
	defer c.Unlock()
	_, ok := c.channels[queue]
	if !ok {
		return fmt.Errorf("queue %s not bind", queue)
	}
	delete(c.channels, queue)
	p := proto.NewUnbindProto(queue)
	rp, err := c.request(p.P, proto.Unbind_OK)
	if err != nil {
		return nil
	}
	if rp.Queue() != queue {
		return fmt.Errorf("invalid bind response queue %s", rp.Queue())
	}
	return nil
}

// ack 发送ACK包，通知broker消息消费成功
func (c *Conn) ack(queue string, msgId string) error {
	p := proto.NewAckProto(queue, msgId)
	return c.writeProto(p.P)
}

```
## moonmq/client/client.go
> 客户端**连接池管理器**，是业务代码直接使用的顶层对象。
> 业务层一般不会直接操作`Conn`，而是调用`Client.Publish`。
> 连接池控制空闲长连接数量，复用 TCP 连接，减少频繁建连开销。
1. `c.Publish()` → `c.Get()`
2. `Get()` → `popConn()`：尝试从链表拿空闲 Conn
   - 拿到且有效：直接返回
   - 链表空 / 取出的连接已经断了：调用`newConn()`新建 TCP 连接
3. 使用 conn.Publish 发消息
4. `defer conn.Close()` → 调用`conn.Close()` → `c.pushConn(co)` 归还连接
5. pushConn 判断：
   - 客户端已关闭 或 空闲连接 ≥ IdleConns：直接 close 丢弃
   - 否则放回空闲链表等待复用
```Go
package client

import (
	"container/list"
	"encoding/json"
	"sync"

	"github.com/siddontang/moonmq/proto"
)

// Client MoonMQ顶层客户端对象，实现连接池管理
// 对外暴露Publish系列方法，内部维护一组空闲Conn长连接
type Client struct {
	sync.Mutex            // 保护连接池列表、closed状态
	cfg        *Config    // 客户端配置
	conns      *list.List // 空闲连接池，存放*Conn，用链表管理空闲连接
	closed     bool       // Client是否关闭标记
}

// NewClientWithConfig 根据已解析好的配置创建Client实例
func NewClientWithConfig(cfg *Config) (*Client, error) {
	c := new(Client)
	c.cfg = cfg
	c.conns = list.New()
	c.closed = false
	return c, nil
}

// NewClient 从原始json配置字节，先解析Config再创建Client
func NewClient(jsonConfig json.RawMessage) (*Client, error) {
	cfg, err := parseConfigJson(jsonConfig)
	if err != nil {
		return nil, err
	}
	return NewClientWithConfig(cfg)
}

// Close 关闭整个客户端，清空连接池，关闭所有空闲TCP连接
func (c *Client) Close() {
	c.Lock()
	defer c.Unlock()
	c.closed = true
	// 循环取出链表里面所有连接，逐个底层close
	for {
		if c.conns.Len() == 0 {
			break
		}
		e := c.conns.Front()
		c.conns.Remove(e)
		conn := e.Value.(*Conn)
		conn.close()
	}
}

// Get 获取一条可用连接：优先从空闲池拿；无空闲则新建Conn
func (c *Client) Get() (*Conn, error) {
	co := c.popConn()
	if co != nil {
		return co, nil
	} else {
		return newConn(c)
	}
}

// Publish 通用消息发布入口：拿到连接，发布消息，defer归还连接
func (c *Client) Publish(queue string, routingKey string, body []byte, pubType string) (int64, error) {
	conn, err := c.Get()
	if err != nil {
		return 0, err
	}
	defer conn.Close() // 发布完成，归还连接到连接池
	return conn.Publish(queue, routingKey, body, pubType)
}

// PublishFanout fanout模式发布消息，routingKey填空字符串
func (c *Client) PublishFanout(queue string, body []byte) (int64, error) {
	return c.Publish(queue, "", body, proto.FanoutPubTypeStr)
}

// PublishDirect direct模式发布消息，指定routingKey
func (c *Client) PublishDirect(queue string, routingKey string, body []byte) (int64, error) {
	return c.Publish(queue, routingKey, body, proto.DirectPubTypeStr)
}

// popConn 从空闲链表取出一条有效空闲连接
// 如果取出的连接已经closed，则丢弃，继续取下一个
func (c *Client) popConn() *Conn {
	c.Lock()
	defer c.Unlock()
	for {
		if c.conns.Len() == 0 {
			return nil
		} else {
			e := c.conns.Front()
			c.conns.Remove(e)
			conn := e.Value.(*Conn)
			if !conn.closed {
				return conn
			}
		}
	}
}

// pushConn 使用完的连接归还到连接池
// 如果客户端已经关闭 或者 空闲连接数量达到上限IdleConns，则直接关闭这条连接，不放入池
func (c *Client) pushConn(co *Conn) {
	c.Lock()
	defer c.Unlock()
	if c.closed || c.conns.Len() >= c.cfg.IdleConns {
		co.close()
	} else {
		c.conns.PushBack(co)
	}
}

```
## moonmq/client/channel.go
> 客户端消费者订阅通道。**一个 Channel 代表对一个队列的消费订阅**。
Broker 推送消息 → Conn 读协程 → Channel.pushMsg → 存入`msg`chan → 用户调用 GetMsg/WaitMsg 读取。
```Go
package client

import (
	"errors"
	"time"
)

// ErrChannelClosed Channel已关闭错误
var ErrChannelClosed = errors.New("channel has been closed")

// channelMsg 封装投递到Channel内部的消息
type channelMsg struct {
	ID   string // 消息ID
	Body []byte // 消息内容
}

// Channel 消费者订阅通道，对应一个队列订阅
// 一条TCP Conn上可以创建多个Channel，每个Channel对应一个队列消费
type Channel struct {
	c          *Conn            // 归属的TCP连接
	queue      string           // 订阅队列名
	routingKey string           // 订阅使用的routingKey
	noAck      bool             // 是否自动ack；true代表收到消息无需手动调用Ack
	msg        chan *channelMsg // 本地消息缓冲通道，容量MaxQueueSize
	closed     bool             // Channel关闭标记
	lastId     string           // 最近取出消息的msgId，用于Ack
}

// newChannel 创建消费者Channel
func newChannel(c *Conn, queue string, routingKey string, noAck bool) *Channel {
	ch := new(Channel)
	ch.c = c
	ch.queue = queue
	ch.routingKey = routingKey
	ch.noAck = noAck
	// 缓冲区大小使用客户端配置MaxQueueSize
	ch.msg = make(chan *channelMsg, c.cfg.MaxQueueSize)
	ch.closed = false
	return ch
}

// Close 关闭Channel：标记closed，并向Broker发送unbind取消订阅
func (c *Channel) Close() error {
	c.closed = true
	return c.c.unbind(c.queue)
}

// Ack 确认消费成功，通知Broker这条消息处理完成
// 发送Ack包，使用上一次GetMsg/WaitMsg拿到的lastId
func (c *Channel) Ack() error {
	if c.closed {
		return ErrChannelClosed
	}
	return c.c.ack(c.queue, c.lastId)
}

// GetMsg 阻塞读取消息，无消息会一直阻塞
func (c *Channel) GetMsg() []byte {
	if c.closed && len(c.msg) == 0 {
		return nil
	}
	msg := <-c.msg
	c.lastId = msg.ID
	return msg.Body
}

// WaitMsg 带超时读取消息
// d：超时时间；超时返回nil，读到消息返回消息body
func (c *Channel) WaitMsg(d time.Duration) []byte {
	if c.closed && len(c.msg) == 0 {
		return nil
	}
	select {
	case <-time.After(d):
		return nil
	case msg := <-c.msg:
		c.lastId = msg.ID
		return msg.Body
	}
}

// pushMsg 由Conn读协程调用：把Broker推送过来的消息放入Channel本地chan
// 如果本地msg通道满了，丢弃最旧消息（FIFO丢弃，保证通道永远可以写入新消息）
func (c *Channel) pushMsg(msgId string, body []byte) {
	for {
		select {
		case c.msg <- &channelMsg{msgId, body}:
			return
		default:
			// 缓冲区已满，弹出一条旧消息
			<-c.msg
		}
	}
}

```
SDP及报文
V=0
O=
m= video RTP/AVP 96
a=
a= packetization-mask=1
a=
// 表示用FU-A分片
SETUP 针对媒体媒体进行协商
SDP一般有 m=video 和 m=audio
协商后客户端发送调TEARDOWN。
RTSP session会话超时时间

ICE/STUN/TURN：
两台处在内网的终端要找到一条通路，直接收发UDP包。
STUN：客户端自己向公网STUN服务器查询，拿到自己的公网IP+端口
内网主机发给STUN服务器，STUN看到包
的外层源IP端口，再把返回告诉客户端，你的
公网映射地址

TURN：数据包全通过TURN服务器中转

TCP保证字节流不乱，RTP负责媒体帧的时序标记
RTCP负责丢包反馈监控
推流：
ANNOUNCE携带SDP，再SETUP之后RECORD
kyle：npt=00- 点播指定起止时间，暂停，seek后设
服务器会话状态：Init / Ready / Play
WebRTC：浏览器端P2P实时音视
SRTP：webRTC里的加密，UDP端口打包，音视频payload类型
通信双方UDP失败打TLS包，协商出主密钥。
主密钥再派生出SRTP加密密钥，校验密钥

ICE：用一套候选地址收集+连通性探测
的算法框架
①收集所有候选地址
②STUN拿到公网地址

STUN：拿到公网地址，尽量直连
TURN：实在连不通，我来帮你转发
ICE：统一管理所有候选，自动试路

A端创建 offer SDP，通过信令发给B
B收到 offer，生成 Answer SDP
这一步叫媒体协商

两端开启ICE：
候选地址互换，ICE开始连通性检测
找到 UDP 通路 DTLS 握手
开始互发 SRTP / SRTCP

P2P 两人直接通话
SFU 多人会议场景

RTP：运媒体的车，RTCP 跟车的调度员。
RTSP：流媒体控制协议，指挥车什么时候开、什么时候停的遥控器。
RTSP 控制流媒体开始、暂停。
RTSP有状态靠Session ID， 端口554。
RTSP 方法：DESCRIBE → SETUP → PLAY-> Pause -> TEARDOWN.

ANNOUNCE 推流
Record 开始往服务器推流
TEARDOWN 结束流

#### RTSP请求

方法： URL + 协议版本
序号
会话ID： setup阶段服务器发的
Range： 从哪开始播

#### RTSP响应：

    状态行
    序号
    会话ID, timeout = 60

### Transport; Client-port = 50000~50001

两种传输模式：RTP/AVP（UDP直连），延迟低
缺点：防火墙/NAT 穿透不好
RTP/AVP/TCP 交织模式：把RTP包塞进TCP连接
格式：$(0x24)+channel+长度+RTP数据

SSRC冲突：两个发送者相同SSRC，产生重映射
RTP包是复合包，多个RTP包封装在一个UDP报文
MTU最大传输单元：默认1500字节
IP头(20B)+UDP头(8B)+RTP头(12B)=40
Payload最大1460字节，NALU>1460就分片

1. IP分片：一个IP包丢，整包失效
2. RTP分片：H264 FU-A
   把大NALU切割成多个RTP包，每个包都不是完整的
   FU-A分片头部：
   S=1：分片起始
   E=1：分片最后一包

外网无法直接向内网发送UDP.

#### ICE

ICE：收集所有候选地址，找到一条可以通过RTP链路

```
安防            直播
RTSP           RTMP         应用层
RTP + RTCP     FLV          媒体层
UDP            TCP          传输层
```

SDP：会话描述协议，描述编码、端口
SIP：是建立会话的多媒体信令协议

### RTP头部（12字节）

版本V：2bit，固定2
P填充位：1bit
X扩展位：1bit
CC CSRC计数：4bit
标记M：1bit，关键帧/结束标记
PT负载类型：7bit（H.264、AAC）
序列号 seq：16bit（0~65535）
每发一个RTP包 +1，用于丢包、乱序检测

timestamp 时间戳：32bit
SSRC同步源：32bit，标识一条RTP流

### RTP基于UDP

发送流程：

1. 把帧切片，装进RTP包
2. 填充V、M、seq、时间戳
3. 本流唯一的SSRC
4. 最后一个RTP分片，标记位M=1

接收：
UDP接收RTP包 → Jitter Buffer
用户包3种状态：OK、丢包、乱序
重排序：乱序包通过时间戳排序，A/V同步

### RTCP（配套控制协议）

端口：RTP端口 +1

SR发送端报告、发送方统计信息，包含NTP时间戳、RTP时间戳
RR接收端报告、接收方上报丢包、抖动、乱序，反馈给发送端做拥塞控制

SDES：源描述，名字，CNAME识别同个发送者。
BYE：离开、结束流。

## RTSP、信令：协商两端的媒体参数

一个流：RTP媒体端口，RTCP控制端口

### Jitter（抖动）：接收端的内存队列。

1. 缓存一段RTP包
2. 利用序列号对乱序包排序
3. 等待包，凑齐一帧再送给解码器

时间戳：媒体采样计数器，单位：采样点
H.264：90000 Hz
每采样一个样本，时间戳+1
H.264 FU分片所有包TS一样

CSRC：贡献源，混音场景，把多路音频混合成一路输出，CSRC用来记录原始各路的SSRC

### RTCP报文

SR发送报告：一个SR对应一个SSRC

- SSRC：这份报告属于哪个流
- NTP timestamp：绝对世界时间
- RTP timestamp：RTP时间戳
- SPC：发送总包数
- SOC：发送总字节数

RR接收报告：

- fraction loss：丢包比例
- cumulative：累计丢包
- Seq：收到的最大序列号
- jitter：抖动
- LSR：上一次收到SR的NTP时间
- DLSR：距离上次收到SR过去了多久
- RTT = 当前NTP − LSR − DLSR

抖动计算公式：
$$D_i = (R_i-R_{i-1})-(S_i-S_{i-1})$$
$$J_i = J_{i-1} + \frac{|D_i|-J_{i-1}}{16}$$

# WebRTC 流程笔记

1. **信令交换：SDP（offer / answer）**
   内容：双端协商“通信信息”
   WebRTC 不绑定信令协议，可以用 WebSocket、HTTP 等。

2. **NAT穿透 / ICE：解决内网设备互相找到对方**

- ICE：自动收集所有可用网络地址（内网、公网IP、中继地址）
- STUN：获取自己的公网IP
- TURN：穿透失败时的中继服务器，走转发

3. **Peer 连接成功**
   底层走 SRTP（加密的RTP），直接收发音视频

### 报文角色

- Offer：发起方发送的 SDP，描述自己编码、媒体、地址
- Answer：接收方回复的 SDP，做协商，同意连接
- ICE Candidate：网络地址（ip+port，双向连接），发给对端
- SDP：描述音视频编码、媒体轨道、RTP信息

### 协议对照

# GB28181 国标监控国标笔记

核心：**SIP（信令） + SDP（会话） + RTP（媒体）**
端口：UDP 5060（SIP），媒体流 UDP 1000+

## 信令层：SIP（UDP 5060）

设备注册、注销、心跳
目录查询（获取摄像头列表）
实时视频/回放后台控制（ZLM/ZNVR）

## 会话：SDP

和 RTP / WebRTC 里 SDP 含义一致，协商媒体、编码、端口
协商 H.264 / H.265，建立 RTP 媒体流
媒体：RTP / RTCP
和 RTSP 同源：H.264 RTP打包

GB28181 用 PS 封装（RTP封装PS流）

### SIP 消息流程

1. 设备注册：摄像头→平台，携带国标ID
2. 心跳：摄像头定时上报，平台判断链路在线
3. 目录查询：平台下发，获取摄像头预览通道
4. 视频请求：平台发起，给摄像头发预览请求
5. 媒体拉起：协商SDP，推流

### 国标ID（20位国标ID）

- 前8位：行政区划（340104 合肥蜀山区）
- 中间10位：行业/类型
- 后2位：设备编号

# SDP + RTSP + WebRTC 笔记

SDP：会话描述协议
RTSP DESCRIBE 返回 SDP 媒体描述；
告诉播放器：媒体是什么编码、用什么端口、怎么组包。

SDP 每行都是 `key=value` 格式

- `v=`：版本，固定为0
- `o=`：发起者，会话标识
- `s=`：会话名
- `c=`：连接信息，媒体服务器IP
- `m=`：媒体描述，音视频、端口、传输协议、负载类型
- `a=rtpmap`：编码信息，PT值+编码名
- `a=fmtp`：编码参数，H264 里面放 SPS、PPS
- `a=control`：轨道标识，SETUP 时使用，`trackID=xxx`

流程：
`DESCRIBE` → 拿到 SDP，解析出 track
`SETUP` 使用 track 里的 control

编码示例：`96 H264`、`8 PCMA / PCMU`

## WebRTC

WebRTC：浏览器实时音视频通信技术
浏览器之间点对点，直接音视频/数据，底层基于RTP

- `getUserMedia`：获取摄像头/麦克风
- `RTCPeerConnection`：P2P连接，音视频
- `RTCDataChannel`：任意数据/文件

## RTSP 与 WebRTC 对比

- RTSP：客户端 ↔ 服务器（拉流）
- WebRTC：浏览器 ↔ 浏览器（P2P直播）
- WebRTC 优势：NAT穿透，适合公网/内网穿透

# RTSP 笔记

RTSP：实时流控制协议，**只负责控制，不传输媒体数据**
端口：554 / TCP

- 客户端：拉流、播放、暂停、停止（播放器/平台）
- 服务端：摄像头、NVR、流媒体服务

信令通道：RTSP 命令基于 TCP 长连接

- TCP 模式：RTP 数据混在 RTSP TCP 端口内，防防火墙拦截
- UDP 模式：单独端口传输，延迟低，是安防摄像头主流

## RTSP 方法

- OPTIONS：查询服务端支持哪些方法
- DESCRIBE：获取媒体信息（SDP、编码、分辨率、RTP端口）
- SETUP：建立 RTP 传输通道，协商端口、传输模式
- PLAY：正式开始推送音视频流
- PAUSE：暂停流
- TEARDOWN：断开连接，释放资源

## 关键头部字段

- CSeq：请求序列号，请求和响应一一对应
- Session：会话ID，SETUP之后生成，后续操作携带
- Transport：指定传输方式（UDP/TCP，客户端端口）

## 标准流程

1. OPTIONS 握手探测
2. DESCRIBE 获取 SDP 媒体描述
3. SETUP 绑定 RTP 收发端口
4. PLAY 开始播放，服务端推送 RTP 音视频
5. 客户端接收 RTP 流
6. TEARDOWN 结束会话

## SDP 的作用

DESCRIBE 响应携带 SDP，描述媒体轨道、H264/H265、采样率、RTP负载类型、IP端口；
没有 SDP，客户端不知道怎么解析 RTP 包。

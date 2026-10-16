## buffer.go

| 函数            | 核心功能                       | 关键特性                                                             | 内存类型                          | 拷贝范围                      | 特殊要点                                      |
| --------------- | ------------------------------ | -------------------------------------------------------------------- | --------------------------------- | ----------------------------- | --------------------------------------------- |
| NewBuffer       | 用传入 []byte 创建 Buffer 实例 | 直接引用传入切片作为底层 buf；初始化 off=0，lastRead=opInvalid       | 堆内存                            | -                             | 共享传入切片内存；外部修改原切片会影响 Buffer |
| NewBufferString | 根据 string 构造 Buffer        | string 转 []byte，新建底层数组，构造 Buffer                          | 堆内存                            | -                             | string 不可变，内部会拷贝生成 []byte          |
| Reset           | 清空 Buffer 可读数据           | buf[:0] 保留底层数组；重置 off=0；lastRead 置 opInvalid              | 复用原有堆内存                    | -                             | 不释放底层内存，复用内存减少 GC 分配          |
| Write           | 追加字节切片写入 buffer        | append 追加到底层 buf；扩容；写后 lastRead 强制置 opInvalid          | 堆内存                            | [oldLen, newLen) 新增写入区域 | 任意写操作都会废掉 Unread 标记，写完不能撤销  |
| WriteByte       | 写入单个 byte                  | append 单个字节到底层 buf；扩容；lastRead=opInvalid                  | 堆内存                            | -                             | 单字节写入，适合小数据                        |
| WriteRune       | 写入一个 UTF8 rune             | 对 rune 做 UTF8 编码后写入底层 buf；lastRead=opInvalid               | 堆内存                            | -                             | 自动编码 rune，写入多字节字符                 |
| WriteString     | 写入字符串                     | string 转 []byte 调用 Write；底层复用 Write 逻辑；lastRead=opInvalid | 堆内存                            | -                             | 减少临时变量，方便直接写入字符串              |
| Read            | 读取 n 字节到外部切片          | 拷贝 buf[off:] 数据到 p；移动 off；读取成功 lastRead=opRead(-1)      | 源：Buffer 堆内存，目标：传入切片 | min(len(p), b.Len()) 字节     | 标准 io.Reader 实现；返回 EOF 当无数据        |
| ReadByte        | 读取单个字节                   | 取出 buf[off]，off++；成功读设置 lastRead=opRead(-1)                 | 堆内存                            | 1 字节                        | 只读 1 字节；配套 UnreadByte 回退该字节       |
| Next            | 取出接下来 n 字节，返回子切片  | 返回 buf 子切片，不拷贝；off+=n；成功读 lastRead=opRead(-1)          | 堆内存（共享底层）                | min(n, b.Len())               | 零拷贝；外部拿到切片与 buffer 共享内存        |
| readSlice       | 私有，读到 delim 分隔符        | 查找 delim，返回底层子切片；移动 off；lastRead=opRead(-1)            | 堆内存（共享底层）                | 读到 delim 为止全部字节       | 私有方法，零拷贝；外部不可直接调用            |
| ReadBytes       | 读到 delim，返回独立 []byte    | 调用 readSlice，append 拷贝一份新切片，脱离 buffer 内存              | 堆内存（新分配）                  | 读到 delim 为止全部字节       | 拷贝副本，后续 buffer 修改不影响结果          |
| ReadString      | 读到 delim，返回 string        | 调用 readSlice，转 string，内存拷贝                                  | 堆内存（新分配）                  | 读到 delim 为止全部字节       | 返回字符串，底层存在拷贝                      |
| ReadRune        | 读取单个 UTF8 rune             | 解析 buf[off:]，取出 rune；off+=n；lastRead = rune 字节数(1~4)       | 堆内存                            | n 字节（rune 长度）           | lastRead 保存 rune 字节数；配套 UnreadRune    |
| UnreadByte      | 撤销上一次普通读操作           | 校验 lastRead==opRead；off--；执行后 lastRead 置 opInvalid           | 不分配新内存                      | -                             | 仅回退 1 字节；只能调用一次，不可连续撤销     |
| UnreadRune      | 撤销上一次 ReadRune            | 校验 lastRead>=1；off -= N；执行后 lastRead 置 opInvalid             | 不分配新内存                      | -                             | 一次性回退整个 rune 的 N 字节；只能调用一次   |
| Len             | 返回当前可读字节长度           | return len(b.buf) - b.off                                            | -                                 | -                             | 只读计算，无内存操作                          |
| Cap             | 返回底层 buf 总容量            | return cap(b.buf)                                                    | -                                 | -                             | 获取底层切片 cap，包含已读旧空间              |

```go
// 当 Buffer 是 nil，第一次写入需要分配内存时，若需要的容量 ≤64，直接创建 `make([]byte, n, 64)`。
// 目的：小对象优化，避免频繁小内存分配。
const smallBufferSize = 64
// 一块底层字节切片 buf + 读偏移 off
// Buffer 有效可读数据：`buf[off : len(buf)]`
// **不是每次 Read 都拷贝数据，只是移动 off 指针！**
// 例：buf = [a,b,c,d], off=1，可读数据是 `buf[1:]` → `b,c,d`。
// Read 读走 2 字节 → off +=2 → off=3，可读 `buf[3:]` → `d`。
// >
// > 这就是 Buffer 零拷贝读的核心。
type Buffer struct {
    buf     []byte
    off     int
//     //记录**上一次读操作类型**，专门给 `UnreadByte / UnreadRune` 回退读指针使用。
// 只记录最近一次成功读，写操作会把它置为 `opInvalid`。
    lastRead readOp
}
//**标记上一次读操作类型**。
type readOp int8

const (
    opRead      readOp = -1 // 普通Read/Next这类读操作（不是ReadRune）
    opInvalid   readOp = 0  // 无效：写操作、读失败、需要禁止Unread
    opReadRune1 readOp = 1  // ReadRune读了1字节rune（ASCII）
    opReadRune2 readOp = 2  // ReadRune读了2字节UTF8
    opReadRune3 readOp = 3  // ReadRune读了3字节UTF8
    opReadRune4 readOp = 4  // ReadRune读了4字节UTF8
)
// buffer 扩容时，超出 int 可表示上限，panic 抛出。对外暴露，用户可以捕获 panic 判断。
var ErrTooLarge = errors.New("bytes.Buffer: too large")
var errNegativeRead = errors.New("bytes.Buffer: reader returned negative count from Read")
// 求当前系统int的最大值
// 000000 取反FFFFF
const maxInt = int(^uint(0) >> 1)
func (b *Buffer) Bytes() []byte { return b.buf[b.off:] }
// /`.buf[len(b.buf):]` 就是**buf 中还没使用、空闲的尾部**
func (b *Buffer) AvailableBuffer() []byte { return b.buf[len(b.buf):] }

func (b *Buffer) String() string {
	if b == nil {
		return "<nil>"
	}
	return string(b.buf[b.off:])
}
```

#### Peek 返回接下来 n 个可读字节，但**不移动读偏移 off**（不消费数据）

```go
// b.Len() = len(b.buf-b.off)
// 可读区间 b.buf[b.off : len(b.buf)]
func (b *Buffer) Peek(n int) ([]byte, error) {
	// 缓冲区剩余可读数据**不足 n 字节**：
    //     - 返回**当前全部剩余可读字节**
    //     - 返回错误 `io.EOF`
    if b.Len() < n {
		return b.buf[b.off:], io.EOF
	}
	return b.buf[b.off : b.off+n], nil
}
```

```go
// 可读数据 len(buf) - off
func (b *Buffer) empty() bool { return len(b.buf) <= b.off }

func (b *Buffer) Len() int { return len(b.buf) - b.off }

func (b *Buffer) Cap() int { return cap(b.buf) }
// cap(b.buf) 底层数组容量
// len(b.buf) 写指针位置
func (b *Buffer) Available() int { return cap(b.buf) - len(b.buf) }
// Truncate：**保留当前可读数据的前 n 字节，删掉后面的可读数据，不会移动读偏移 off！**
func (b *Buffer) Truncate(n int) {
	if n == 0 {
		b.Reset()
		return
	}
	b.lastRead = opInvalid //**只要修改缓冲区内容，就把 lastRead 置为无效**，不能再 Unread。
	if n < 0 || n > b.Len() {
		panic("bytes.Buffer: truncation out of range")
	}
	b.buf = b.buf[:b.off+n]
}

func (b *Buffer) Reset() {
	b.buf = b.buf[:0]
	b.off = 0
	b.lastRead = opInvalid
}
```

#### tryGrowByReslice

> 看看**切片尾部还有没有空余位置**。如果有空位，**直接把 len 拉长**，不用新开内存。**底层数组不变，没有拷贝！**

```go

func (b *Buffer) tryGrowByReslice(n int) (int, bool) {
	if l := len(b.buf); n <= cap(b.buf)-l {
		//原来 len = l，新 len = l+n → **len 变大，就是拉长**
        b.buf = b.buf[:l+n]
		return l, true
	}
	return 0, false
}
```

#### grow(n) 慢速扩容函数

> 目标：保证缓冲区能再写入 `n` 个字节；返回**写入起始下标**，给上层 Write 用来 copy 数据。
> 前置变量回顾：

- `m := b.Len()`：当前**可读字节总数**（`len(buf)-off`）
- `off`：读偏移；可读数据：`buf[off : len(buf)]`
- smallBufferSize = 64

```go
// 保证扩容之后， 总共能放下m + n字节
func (b *Buffer) grow(n int) int {
	m := b.Len()

	if m == 0 && b.off != 0 {
		b.Reset()
	}
    // 尝试快速路径
	if i, ok := b.tryGrowByReslice(n); ok {
		return i
	}
    // 没分配
	if b.buf == nil && n <= smallBufferSize {
		b.buf = make([]byte, n, smallBufferSize)
        // 小对象优化，防止一直扩容
		return 0
	}
	c := cap(b.buf)
	if n <= c/2-m {
        // 原地前拷贝， 把数据往前挪，腾出尾部大空间
		copy(b.buf, b.buf[b.off:])
	} else if c > maxInt-c-n {
        // 溢出检查
        //c + c + n > max
        // why not  c + n < max
        // growSlice会按倍数扩容，新容量会至少变成原来 cap 的 2 倍！
		panic(ErrTooLarge)
	} else {
        // 分配更大空间
		b.buf = growSlice(b.buf[b.off:], b.off+n)
	}
	b.off = 0
	b.buf = b.buf[:m+n]
	return m
}
```

#### Grow

`Grow(n)` 的作用：**提前扩容，确保后面可以直接写入 n 字节，不用再触发扩容。只占位置，不写数据。**

```go
func (b *Buffer) Grow(n int) {
	if n < 0 {
		panic("bytes.Buffer.Grow: negative count")
	}
	m := b.grow(n)
	b.buf = b.buf[:m]
}
```

#### Write把字节切片p内容追加写入Buffer

```go
func (b *Buffer) Write(p []byte) (n int, err error) {
//     只要修改缓冲区内容（Write 写入数据），**把 lastRead 设置为 opInvalid**。
// 含义：上次的读操作作废，不能再调用 `UnreadByte / UnreadRune`。
	b.lastRead = opInvalid
	m, ok := b.tryGrowByReslice(len(p))
	if !ok {
		m = b.grow(len(p))
	}
    // copy(dst, src)`：把 p 里面所有字节拷贝到 `b.buf[m:]`。
// copy 返回**实际拷贝的字节数量**，也就是 len (p)。
// bytes.Buffer.Write 永远不会返回错误，err 固定为 nil。
	return copy(b.buf[m:], p), nil
}
func (b *Buffer) WriteString(s string) (n int, err error) {
	b.lastRead = opInvalid
	m, ok := b.tryGrowByReslice(len(s))
	if !ok {
		m = b.grow(len(s))
	}
	return copy(b.buf[m:], s), nil
}

```

#### `ReadFrom(r io.Reader)`：**从 io.Reader 源源不断读数据，读到 Buffer 里面**。

> 特点：一次性预预留一块空间（`MinRead=512`）循环读取，减少频繁扩容。

```go
const MinRead = 512

func (b *Buffer) ReadFrom(r io.Reader) (n int64, err error) {
    // 操作缓冲区
	b.lastRead = opInvalid
	for {
        // 保证有MinRead的可读空间
		i := b.grow(MinRead)
		b.buf = b.buf[:i]
		m, e := r.Read(b.buf[i:cap(b.buf)])
		if m < 0 {
			panic(errNegativeRead)
		}
		b.buf = b.buf[:i+m]
		n += int64(m)
		if e == io.EOF {
			return n, nil
		}
		if e != nil {
			return n, e
		}
	}
}

```

#### growSlice

> 生成一个新的更大切片，把旧切片 b 的数据复制进去，返回新切片

```go

func growSlice(b []byte, n int) []byte {
	//make([]byte, c) 如果c太大， 超过平台int上限
    defer func() {
		if recover() != nil {
			panic(ErrTooLarge)
		}
	}()
	c := len(b) + n
    // 优先翻倍
    //如果**这个最小需要的空间，比旧 cap 的 2 倍还要小**，那就干脆直接把新容量设成 `2*cap(b)`
	if c < 2*cap(b) {
		c = 2 * cap(b)
	}
    // 把新的全0切片给b2
	b2 := append([]byte(nil), make([]byte, c)...)
    // 把旧切片b拷贝到b2
	i := copy(b2, b)
	return b2[:i]
}
```

#### WriteTo 把 Buffer 内部所有可读数据，写入 io.Writer w

> 把 Buffer 里现存的数据一次性输出到 w，输出完清空 Buffer

```go
func (b *Buffer) WriteTo(w io.Writer) (n int64, err error) {
	b.lastRead = opInvalid
	if nBytes := b.Len(); nBytes > 0 {
        //m：w 本次实际成功写入多少字节
		m, e := w.Write(b.buf[b.off:])
		if m > nBytes {
			panic("bytes.Buffer.WriteTo: invalid Write count")
		}
		b.off += m
        //把本次写入的字节数保存到返回值 n（int64，支持大数据）。
		n = int64(m)
        // w.Write返回错误，立即返回
		if e != nil {
			return n, e
		}
        // w.Write没写完， 短写错误
		if m != nBytes {
			return n, io.ErrShortWrite
		}
	}
	b.Reset()
	return n, nil
}
// WriteByte 写入单个字节 c 到 Buffer
func (b *Buffer) WriteByte(c byte) error {
	b.lastRead = opInvalid
    //`m` = 写入位置下标（旧的`len(b.buf)`）
	m, ok := b.tryGrowByReslice(1)
	if !ok {
		m = b.grow(1)
	}
	b.buf[m] = c
	return nil
}
// WriteRune 把一个rune写入Buffer，返回写入的字节数量
func (b *Buffer) WriteRune(r rune) (n int, err error) {
    //- `utf8.RuneSelf = 0x80`（128）：小于 128 的 rune，是**单字节 ASCII 字符**
	if uint32(r) < utf8.RuneSelf {
		b.WriteByte(byte(r))
		return 1, nil
	}
	b.lastRead = opInvalid
	m, ok := b.tryGrowByReslice(utf8.UTFMax)
	if !ok {
		m = b.grow(utf8.UTFMax)
	}
    // `utf8.AppendRune` 做两件事：

    //     1. 把 rune `r` 编码成 UTF-8 字节；
    //     2. 把编码后的字节追加到 `b.buf[:m]` 的后面；
    //     3. 返回**新切片**，这个新切片的 len = m + 编码后的字节长度。
	b.buf = utf8.AppendRune(b.buf[:m], r)
	return len(b.buf) - m, nil
}

```

#### Read 从 Buffer 读取字节填充到切片 p，返回读到字节数 n

```go
func (b *Buffer) Read(p []byte) (n int, err error) {
	b.lastRead = opInvalid
	if b.empty() {
		b.Reset()
        // 传入为0
		if len(p) == 0 {
			return 0, nil
		}
		return 0, io.EOF
	}
	n = copy(p, b.buf[b.off:])
	b.off += n
	if n > 0 {
		b.lastRead = opRead
	}
	return n, nil
}
```

#### ReadString 读到分隔符， 返回一行字符串

```go
func (b *Buffer) ReadBytes(delim byte) (line []byte, err error) {
	slice, err := b.readSlice(delim)
    // **把 slice 里面所有字节拷贝到一块新的内存**，赋值给 line。
	line = append(line, slice...)
	return line, err
}
var errUnreadByte = errors.New("bytes.Buffer: UnreadByte: previous operation was not a successful read")
//回退读偏移 `off` 往前 1 字节，把上一次读到的最后 1 个字节放回可读区域；只能执行一次，前提是上次是合法读操作。
func (b *Buffer) UnreadByte() error {
	if b.lastRead == opInvalid {
		return errUnreadByte
	}
	b.lastRead = opInvalid
	if b.off > 0 {
		b.off--
	}
	return nil
}



func (b *Buffer) ReadString(delim byte) (line string, err error) {
	slice, err := b.readSlice(delim)
	return string(slice), err
}
//**从当前偏移 off 开始查找分隔符 delim；返回从 off 到分隔符（包含 delim）的切片，同时移动读偏移 off**。
func (b *Buffer) readSlice(delim byte) (line []byte, err error) {
    // 返回delim的下标
	i := IndexByte(b.buf[b.off:], delim)
	end := b.off + i + 1
	if i < 0 {
		end = len(b.buf)
		err = io.EOF
	}
	line = b.buf[b.off:end]
	b.off = end
	b.lastRead = opRead
	return line, err
}


// 给字节切片buf新建一个Buffer
func NewBuffer(buf []byte) *Buffer { return &Buffer{buf: buf} }
// 从字符串新建Buffer
func NewBufferString(s string) *Buffer {
	return &Buffer{buf: []byte(s)}
}
```

#### Next

> 从缓冲区取出接下来 n 个字节，返回底层切片引用（无拷贝），同时消费掉这段数据。

```go
func (b *Buffer) Next(n int) []byte {
	b.lastRead = opInvalid
	m := b.Len()
	if n > m {
		n = m
	}
	data := b.buf[b.off : b.off+n]
	b.off += n
	if n > 0 {
        // 成功读到数据， 打上标记
		b.lastRead = opRead
	}
	return data
}

func (b *Buffer) ReadByte() (byte, error) {
	if b.empty() {
		b.Reset()
		return 0, io.EOF
	}
	c := b.buf[b.off]
	b.off++
	b.lastRead = opRead
	return c, nil
}

```

#### ReadRune

```go

func (b *Buffer) ReadRune() (r rune, size int, err error) {
	if b.empty() {
		b.Reset()
		return 0, 0, io.EOF
	}
	c := b.buf[b.off]
	if c < utf8.RuneSelf {
		b.off++
		b.lastRead = opReadRune1
		return rune(c), 1, nil
	}
    // 非ASCII, 多字节 UTF8 字符
	r, n := utf8.DecodeRune(b.buf[b.off:])
	b.off += n
	b.lastRead = readOp(n)
	return r, n, nil
}

func (b *Buffer) UnreadRune() error {
	if b.lastRead <= opInvalid {
		return errors.New("bytes.Buffer: UnreadRune: previous operation was not a successful ReadRune")
	}
    // 回退
	if b.off >= int(b.lastRead) {
		b.off -= int(b.lastRead)
	}
	b.lastRead = opInvalid
	return nil
}


```

## bufio.go

> bufio.Reader 是**预读缓冲**：先一次性读一大块放进内存 buf，减少系统调用，提升 IO 效率

```go
//NewReader默认缓冲区大小 4KB
const (
	defaultBufSize = 4096
)

var (
    //没有读过任何字节，就回退一个字节；或者已经回退过一次
	ErrInvalidUnreadByte = errors.New("bufio: invalid use of UnreadByte")
    //同上，针对 rune（utf8 字符）
	ErrInvalidUnreadRune = errors.New("bufio: invalid use of UnreadRune")
    //缓冲区没有空余位置，无法写入更多数据
	ErrBufferFull        = errors.New("bufio: buffer full")
    //Read 请求传入负数 n
	ErrNegativeCount     = errors.New("bufio: negative count")
)

type Reader struct {
	buf          []byte  // 缓冲区字节数组
	rd           io.Reader // 底层原始io读取源（文件/网络等）
	r, w         int     // r：读下标；w：写下标
	err          error   // 读操作产生的错误（io.EOF / 其他error）
	lastByte     int     // 上一次读取的字节，用于 UnreadByte，-1表示无效
	lastRuneSize int     // 上一次rune占用字节数，用于 UnreadRune，0表示无效
}

//缓冲区最小下限，防止传入 size=0/1 这种过小值
//连续空读上限，防止 io.Reader 无限返回 0,nil 死循环
const minReadBufferSize = 16
const maxConsecutiveEmptyReads = 100
//自定义缓冲区大小创建 bufio.Reader
func NewReaderSize(rd io.Reader, size int) *Reader {
	b, ok := rd.(*Reader)
	if ok && len(b.buf) >= size {
        // 如果已经是bufio Reader，并且它的缓冲区大小 >= 要求size，直接返回原对象，不再嵌套包装！
		return b
	}
	r := new(Reader)
    // reset：初始化buf，绑定底层io.Reader
	// max(size, minReadBufferSize) 保证缓冲区最小16字节，防止size传0、负数导致slice长度0
	r.reset(make([]byte, max(size, minReadBufferSize)), rd)
	return r
}
//简单封装，默认缓冲区 4096 字节。
func NewReader(rd io.Reader) *Reader {
	return NewReaderSize(rd, defaultBufSize)
}

func (b *Reader) Size() int { return len(b.buf) }

func (b *Reader) Reset(r io.Reader) {
	if b == r {
		return
	}
	if b.buf == nil {
		b.buf = make([]byte, defaultBufSize)
	}
	b.reset(b.buf, r)
}
// 替换了底层的io源
func (b *Reader) reset(buf []byte, r io.Reader) {
	*b = Reader{
		buf:          buf,
		rd:           r,
		lastByte:     -1,
		lastRuneSize: -1,
	}
}

```

#### fill readErr Peek

> **核心填充缓冲区**，把底层 io 数据读到 buf；会移动缓冲区残留数据

```go
var errNegativeRead = errors.New("bufio: reader returned negative count from Read")
>
func (b *Reader) fill() {
    // 读取过的旧空间， 把【未读有效数据】挪到buf头部
	if b.r > 0 {
		copy(b.buf, b.buf[b.r:b.w])
		b.w -= b.r
		b.r = 0
	}
	if b.w >= len(b.buf) {
		panic("bufio: tried to fill full buffer")
	}
    // 100次尝试
	for i := maxConsecutiveEmptyReads; i > 0; i-- {
		n, err := b.rd.Read(b.buf[b.w:])
		if n < 0 {
			panic(errNegativeRead)
		}
		b.w += n
		if err != nil {
			b.err = err
			return
		}
		if n > 0 {
			return // 读到数据，直接返回
		}
	}
    // 连续100次空读，判定io没有进展，设置ErrNoProgress
	b.err = io.ErrNoProgress
}

func (b *Reader) readErr() error {
	err := b.err
	b.err = nil
	return err
}

func (b *Reader) Peek(n int) ([]byte, error) {
	if n < 0 {
		return nil, ErrNegativeCount
	}
    // Peek不支持UnreadByte/UnreadRune，直接标记lastByte失效
	b.lastByte = -1
	b.lastRuneSize = -1
    // 循环：可读数据不足n，并且buf没满，并且无错误，就调用fill填充
	for b.w-b.r < n && b.w-b.r < len(b.buf) && b.err == nil {
		b.fill()
	}
    // 如果要求预读n超过整个buffer容量，最多只能返回整个缓冲区内容，返回ErrBufferFull
	if n > len(b.buf) {
		return b.buf[b.r:b.w], ErrBufferFull
	}
	var err error
	if avail := b.w - b.r; avail < n {
		n = avail
		err = b.readErr()
		if err == nil {
			err = ErrBufferFull
		}
	}
	return b.buf[b.r : b.r+n], err
}

```

#### Discard Read ReadByte UnreadByte

> 丢弃后面 n 个字节（跳过数据，不读出来），返回实际丢弃数量
> 标准 io.Reader 接口实现，把数据拷贝到 p 切片
> 读取单个字节，移动读指针 r，更新 lastByte
> 回退最近读取的 1 个字节，仅支持一次回退

```go
func (b *Reader) Discard(n int) (discarded int, err error) {
	if n < 0 {
		return 0, ErrNegativeCount
	}
	if n == 0 {
		return
	}
	// 丢弃操作后，无法UnreadByte，标记lastByte失效
	b.lastByte = -1
	b.lastRuneSize = -1
	remain := n // remain：还需要丢弃多少字节
	for {
		skip := b.Buffered() // 当前缓冲区还有多少可读字节
		if skip == 0 {
			b.fill()        // 缓冲区空，填充
			skip = b.Buffered()
		}
		if skip > remain {
			skip = remain   // 现有可读数据比剩余要丢的多，只丢remain个
		}
		b.r += skip          // ✅ 核心：直接移动读指针，跳过数据，不拷贝
		remain -= skip
		if remain == 0 {
			return n, nil
		}
		if b.err != nil {
			// 读到错误，返回已经丢弃的字节 + 错误
			return n - remain, b.readErr()
		}
	}
}


func (b *Reader) Read(p []byte) (n int, err error) {
	n = len(p)
	if n == 0 {
		// p是空切片
		if b.Buffered() > 0 {
			return 0, nil
		}
		return 0, b.readErr()
	}
	// 缓冲区没有可读数据 b.r == b.w
	if b.r == b.w {
		if b.err != nil {
			return 0, b.readErr()
		}
		// ✅ 优化：上层传入p足够大（>=buf大小），**绕过buf，直接读到底层p**，减少一次拷贝
		if len(p) >= len(b.buf) {
			n, b.err = b.rd.Read(p)
			if n < 0 {
				panic(errNegativeRead)
			}
			if n > 0 {
				b.lastByte = int(p[n-1])
				b.lastRuneSize = -1
			}
			return n, b.readErr()
		}
		// p比较小，走缓冲模式：重置r/w，把底层io读到buf里
		b.r = 0
		b.w = 0
		n, b.err = b.rd.Read(b.buf)
		if n < 0 {
			panic(errNegativeRead)
		}
		if n == 0 {
			return 0, b.readErr()
		}
		b.w += n
	}
	// 把缓冲区[b.r:b.w]拷贝到p
	n = copy(p, b.buf[b.r:b.w])
	b.r += n
	// 更新lastByte：最后读到的字节，支持UnreadByte
	b.lastByte = int(b.buf[b.r-1])
	b.lastRuneSize = -1
	return n, nil
}


func (b *Reader) ReadByte() (byte, error) {
	b.lastRuneSize = -1
	// 缓冲区空，循环fill填充
	for b.r == b.w {
		if b.err != nil {
			return 0, b.readErr()
		}
		b.fill()
	}
	c := b.buf[b.r]
	b.r++
	b.lastByte = int(c) // 保存本次读出的字节，用于UnreadByte
	return c, nil
}

func (b *Reader) UnreadByte() error {
	// 判断非法场景：
	// lastByte<0：没有有效上一字节；特殊边界：r==0 && b.w>0
	if b.lastByte < 0 || b.r == 0 && b.w > 0 {
		return ErrInvalidUnreadByte
	}
	if b.r > 0 {
		b.r--
	} else {
		b.w = 1
	}
	b.buf[b.r] = byte(b.lastByte)
	b.lastByte = -1 // 只能回退一次，置为无效，不能连续UnreadByte
	b.lastRuneSize = -1
	return nil
}

```

#### ReadRune UnreadRune

```go

// 读取 1 个 UTF-8 字符（rune），返回 unicode 码点、占用字节长度
func (b *Reader) ReadRune() (r rune, size int, err error) {
	for b.r+utf8.UTFMax > b.w && !utf8.FullRune(b.buf[b.r:b.w]) && b.err == nil && b.w-b.r < len(b.buf) {
		b.fill()
	}
	b.lastRuneSize = -1
	if b.r == b.w {
		return 0, 0, b.readErr()
	}
	r, size = utf8.DecodeRune(b.buf[b.r:b.w])
	b.r += size
	b.lastByte = int(b.buf[b.r-1])
	b.lastRuneSize = size
	return r, size, nil
}
// 回退**上一次 ReadRune 读出的整个 rune**，一次性回退多个字节（和 UnreadByte 只回退 1 字节区分）
func (b *Reader) UnreadRune() error {
	if b.lastRuneSize < 0 || b.r < b.lastRuneSize {
		return ErrInvalidUnreadRune
	}
	b.r -= b.lastRuneSize
    // 清空标记：只能回退一次
	b.lastByte = -1
	b.lastRuneSize = -1
	return nil
}
```

#### Buffered ReadSlice ReadLine

```go
// 极简：有效可读字节 = 写下标 - 读下标。
func (b *Reader) Buffered() int { return b.w - b.r }
func (b *Reader) ReadSlice(delim byte) (line []byte, err error) {
	s := 0
	for {
		// 1. 在 b.buf[b.r+s : b.w] 区间搜索分隔符
		if i := bytes.IndexByte(b.buf[b.r+s:b.w], delim); i >= 0 {
			i += s
			line = b.buf[b.r : b.r+i+1]
			b.r += i + 1
			break
		}
		// 2. 没找到分隔符：检查底层io是否出错（EOF等）
		if b.err != nil {
			line = b.buf[b.r:b.w]
			b.r = b.w
			err = b.readErr()
			break
		}
		// 3. 缓冲区已经塞满，仍然没有找到分隔符
		if b.Buffered() >= len(b.buf) {
			b.r = b.w
			line = b.buf
			err = ErrBufferFull
			break
		}
		// 4. 记录本次已经扫描过的数据长度，fill填充新数据，继续循环
		s = b.w - b.r
		b.fill()
	}
	// 更新lastByte，支持UnreadByte；禁用UnreadRune
	if i := len(line) - 1; i >= 0 {
		b.lastByte = int(line[i])
		b.lastRuneSize = -1
	}
	return
}

func (b *Reader) ReadLine() (line []byte, isPrefix bool, err error) {
	// 调用底层ReadSlice，分隔符是换行符\n
	line, err = b.ReadSlice('\n')
	// 分支1：ReadSlice返回缓冲区满（一行太长超过buf）
	if err == ErrBufferFull {
		// 特殊处理：末尾是\r，需要回退r，去掉\r
		if len(line) > 0 && line[len(line)-1] == '\r' {
			if b.r == 0 {
				panic("bufio: tried to rewind past start of buffer")
			}
			b.r--
			line = line[:len(line)-1]
		}
		// isPrefix=true：代表本行数据还没完，后续还要继续调用ReadLine读剩下部分
		return line, true, nil
	}
	// 分支2：line为空
	if len(line) == 0 {
		if err != nil {
			line = nil
		}
		return
	}
	// 分支3：正常读到带\n的一行，清除err，剥离行尾换行
	err = nil
	if line[len(line)-1] == '\n' {
		drop := 1
		// 如果是Windows换行 \r\n，要删掉2个字符 \r + \n
		if len(line) > 1 && line[len(line)-2] == '\r' {
			drop = 2
		}
		line = line[:len(line)-drop]
	}
	return
}

```

#### collectFragments ReadBytes ReadString

```go
// 搜集所有分片， 拿到总长度
func (b *Reader) collectFragments(delim byte) (fullBuffers [][]byte, finalFragment []byte, totalLen int, err error) {
	var frag []byte
	for {
		var e error
		frag, e = b.ReadSlice(delim)
		if e == nil {
			break
		}
		if e != ErrBufferFull {
			err = e
			break
		}
		// 走到这里：e == ErrBufferFull，代表这一段是超长行的片段，还没读到分隔符
		buf := bytes.Clone(frag)      // 重点！拷贝，脱离原buf内存，防止被fill覆盖
		fullBuffers = append(fullBuffers, buf)
		totalLen += len(buf)
	}
	totalLen += len(frag)
	return fullBuffers, frag, totalLen, err
}
func (b *Reader) ReadBytes(delim byte) ([]byte, error) {
	full, frag, n, err := b.collectFragments(delim)
	// 一次性分配整块内存，大小为总长度n，减少多次内存分配
	buf := make([]byte, n)
	n = 0
    // 依次把所有分片copy到新buf, 再copy最后的frag
	for i := range full {
		n += copy(buf[n:], full[i])
	}
	copy(buf[n:], frag)
	return buf, err
}
func (b *Reader) ReadString(delim byte) (string, error) {
	full, frag, n, err := b.collectFragments(delim)
	var buf strings.Builder
	buf.Grow(n) // 预分配，底层一次性分配[]byte，避免多次扩容
	for _, fb := range full {
		buf.Write(fb)
	}
	buf.Write(frag)
	return buf.String(), err
}

```

#### write

```go
//把当前缓冲区剩余 + 底层 io 源全部数据写入 w；做了接口类型断言优化，减少内存拷贝
func (b *Reader) WriteTo(w io.Writer) (n int64, err error) {
	b.lastByte = -1
	b.lastRuneSize = -1
	// 1. 如果缓冲区还有缓存数据，先把当前缓存写出去
	if b.r < b.w {
		n, err = b.writeBuf(w)
		if err != nil {
			return
		}
	}
	// 优化分支1：底层rd本身实现 io.WriterTo
	// rd是b.rd，也就是构造bufio.NewReader传入的底层io.Reader
	if r, ok := b.rd.(io.WriterTo); ok {
		m, err := r.WriteTo(w)
		n += m
		return n, err
	}
	// 优化分支2：目标w实现 io.ReaderFrom，让w直接从底层rd读取
	if w, ok := w.(io.ReaderFrom); ok {
		m, err := w.ReadFrom(b.rd)
		n += m
		return n, err
	}
	// 上面两个接口优化都不命中，走普通循环读写逻辑
	if b.w-b.r < len(b.buf) {
		b.fill()
	}
	for b.r < b.w {
		m, err := b.writeBuf(w)
		n += m
		if err != nil {
			return n, err
		}
		b.fill()
	}
	// 处理EOF标记
	if b.err == io.EOF {
		b.err = nil
	}
	return n, b.readErr()
}
//把当前缓冲区未读片段 `b.buf[b.r:b.w]` 写入 io.Writer；写完移动读指针`b.r`，做非法返回值校验
var errNegativeWrite = errors.New("bufio: writer returned negative count from Write")
func (b *Reader) writeBuf(w io.Writer) (int64, error) {
	n, err := w.Write(b.buf[b.r:b.w])
	if n < 0 {
		panic(errNegativeWrite)
	}
	b.r += n
	return int64(n), err
}

```

#### writer

```go



type Writer struct {
	err error
	buf []byte
	n   int
	wr  io.Writer
}
// 创建指定缓冲区大小的 bufio.Writer
func NewWriterSize(w io.Writer, size int) *Writer {
	b, ok := w.(*Writer)
	if ok && len(b.buf) >= size {
		return b
	}
	if size <= 0 {
		size = defaultBufSize
	}
	return &Writer{
		buf: make([]byte, size),
		wr:  w,
	}
}
// 使用默认缓冲区大小创建 Writer，封装 NewWriterSize
func NewWriter(w io.Writer) *Writer {
	return NewWriterSize(w, defaultBufSize)
}

func (b *Writer) Size() int { return len(b.buf) }

func (b *Writer) Reset(w io.Writer) {
	if b == w {
		return
	}
	if b.buf == nil {
		b.buf = make([]byte, defaultBufSize)
	}
	b.err = nil
	b.n = 0
	b.wr = w
}
```

#### Flush

> ``把缓冲区中缓存的数据，一次性写入底层`b.wr`；处理短写、IO 错误、缓冲区残留迁移

```go
func (b *Writer) Flush() error {
	// 1. 如果之前已经存在错误，直接返回，不再执行
	if b.err != nil {
		return b.err
	}
	// 2. 缓冲区没有待写数据，直接返回nil
	if b.n == 0 {
		return nil
	}
	// 3. 将buf[0:b.n]全部交给底层wr写入
	n, err := b.wr.Write(b.buf[0:b.n])
	// 4. 短写判定：写入n < 待写总量，且err为nil → 报io.ErrShortWrite
	if n < b.n && err == nil {
		err = io.ErrShortWrite
	}
	// 5. 出现错误分支
	if err != nil {
		// 部分写入成功：已经写了n字节，剩下的留在缓冲区头部
		if n > 0 && n < b.n {
			copy(b.buf[0:b.n-n], b.buf[n:b.n])
		}
		b.n -= n        // 更新缓冲区计数，保留未写完数据
		b.err = err     // 永久保存错误，后续所有写操作都会被拦截
		return err
	}
	// 6. 全部写入成功，清空缓冲区计数
	b.n = 0
	return nil
}
```

#### Avaiable AvailableBuffer Buffered

```go
//- `len(b.buf)`：缓冲区总容量
//- `b.n`：已经占用、待刷的数据长度
func (b *Writer) Available() int { return len(b.buf) - b.n }
func (b *Writer) AvailableBuffer() []byte {
    /*
        `b.buf` 底层数组总容量 4096，`b.n = 1000`（已经写了 1000 字节在缓冲区）

        1. `b.buf[b.n:]` → `b.buf[1000:]`
        - 切片：`len=3096，cap=3096`
            `[b.buf[b.n:]][:0]` 在上面这个切片基础上，再切片 `[:0]`
        - `[:0]`：取从起始位置开始，长度为 0
        - ✅ **len = 0**
        - ✅ **cap 不变，仍然等于 3096
    */
    return b.buf[b.n:][:0]
}
func (b *Writer) Buffered() int { return b.n }
```

#### Write

> 把字节切片 p 写入缓冲；缓冲区不够时自动 Flush；超大块数据直接走底层写，避免拷贝

```go
func (b *Writer) Write(p []byte) (nn int, err error) {
	for len(p) > b.Available() && b.err == nil {
		var n int
		if b.Buffered() == 0 {
			// 缓冲区是空的，直接写给底层wr，跳过bufio缓冲
			n, b.err = b.wr.Write(p)
		} else {
			// 缓冲区还有旧数据：先把p填满剩余空间，再Flush刷走
			n = copy(b.buf[b.n:], p)
			b.n += n
			b.Flush()
		}
		nn += n
		p = p[n:]
	}
	if b.err != nil {
		return nn, b.err
	}
	// 剩余p长度足够放进空闲缓冲区，直接拷贝进buf
	n := copy(b.buf[b.n:], p)
	b.n += n
	nn += n
	return nn, nil
}

```

#### WriteByte WriteRune

```go
//写入单个字节，缓冲区满则先 Flush
func (b *Writer) WriteByte(c byte) error {
	if b.err != nil {
		return b.err
	}
	if b.Available() <= 0 && b.Flush() != nil {
		return b.err
	}
	b.buf[b.n] = c
	b.n++
	return nil
}
func (b *Writer) WriteRune(r rune) (size int, err error) {
	// 单字节ASCII：r < 128，直接走WriteByte快速路径
	if uint32(r) < utf8.RuneSelf {
		err = b.WriteByte(byte(r))
		if err != nil {
			return 0, err
		}
		return 1, nil
	}
	// 非ASCII，先检查全局错误锁
	if b.err != nil {
		return 0, b.err
	}
	// 获取当前缓冲区剩余空间
	n := b.Available()
	// utf8.UTFMax = 4，一个rune最多占4字节
	if n < utf8.UTFMax {
		// 剩余空间不足4字节，先Flush
		if b.Flush(); b.err != nil {
			return 0, b.err
		}
		n = b.Available()
		// Flush之后仍然不够4字节 → 降级走WriteString
		if n < utf8.UTFMax {
			return b.WriteString(string(r))
		}
	}
	// 缓冲区有至少4字节空闲，直接编码到buf
	size = utf8.EncodeRune(b.buf[b.n:], r)
	b.n += size
	return size, nil
}
//写入字符串；优先尝试底层 wr 的 WriteString 接口，避免 string 转 [] byte 拷贝，其余逻辑和 Write 高度相似
func (b *Writer) WriteString(s string) (int, error) {
	var sw io.StringWriter
	tryStringWriter := true
	nn := 0
	for len(s) > b.Available() && b.err == nil {
		var n int
		if b.Buffered() == 0 && sw == nil && tryStringWriter {
			sw, tryStringWriter = b.wr.(io.StringWriter)
		}
		if b.Buffered() == 0 && tryStringWriter {
			n, b.err = sw.WriteString(s)
		} else {
			n = copy(b.buf[b.n:], s)
			b.n += n
			b.Flush()
		}
		nn += n
		s = s[n:]
	}
	if b.err != nil {
		return nn, b.err
	}
	n := copy(b.buf[b.n:], s)
	b.n += n
	nn += n
	return nn, nil
}

```

#### ReadFrom

```go
// ReadFrom 实现 io.ReaderFrom 接口
// 从 r 读取数据，写入当前 bufio.Writer，返回总共拷贝的字节数n和错误
func (b *Writer) ReadFrom(r io.Reader) (n int64, err error) {
	// 失败锁：之前已经发生错误，直接返回，不再处理任何IO
	if b.err != nil {
		return 0, b.err
	}
	// 一次性类型断言底层wr是否实现 io.ReaderFrom 接口
	// 如果底层支持ReadFrom，并且当前bufio缓冲区是空，可以直接交给底层做零拷贝传输
	readerFrom, readerFromOK := b.wr.(io.ReaderFrom)
	var m int // m：单次r.Read读到的字节数量

	// 主循环：反复从r读数据，填充bufio缓冲区
	for {
		// 判断缓冲区是否已满，没有空闲位置
		if b.Available() == 0 {
			// 缓冲区满，先刷写到底层writer
			if err1 := b.Flush(); err1 != nil {
				return n, err1 // Flush失败，返回已经成功写入的字节
			}
		}

		// ✅ 高性能快速路径
		// 前提：底层wr支持ReadFrom && bufio当前缓冲区为空（无旧缓存数据）
		// 直接调用底层wr的ReadFrom，绕过bufio缓冲区，减少内存拷贝
		if readerFromOK && b.Buffered() == 0 {
			nn, err := readerFrom.ReadFrom(r)
			b.err = err // 保存错误，开启失败锁
			n += nn
			return n, err
		}

		// nr：连续空读计数器
		nr := 0
		// 内层循环：处理io.Reader返回 m=0, err=nil 的空读场景
		// maxConsecutiveEmptyReads = 100，最多允许连续100次空读
		for nr < maxConsecutiveEmptyReads {
			// 把读到的数据直接写入buf空闲区域 b.buf[b.n:]
			m, err = r.Read(b.buf[b.n:])
			// 读到数据(m!=0) 或者出现错误(err!=nil)，退出内层空读循环
			if m != 0 || err != nil {
				break
			}
			// m=0,err=nil，空读，计数器+1，继续尝试读
			nr++
		}
		// 连续100次都是空读，判定读取卡住，返回无进展错误
		if nr == maxConsecutiveEmptyReads {
			return n, io.ErrNoProgress
		}

		// 读到m个字节，更新缓冲区计数，总字节累加
		b.n += m
		n += int64(m)

		// err不为nil（EOF或者其他IO错误），跳出主循环
		if err != nil {
			break
		}
	}

	// 读到io.EOF，正常读完源reader
	if err == io.EOF {
		// 如果缓冲区刚好填满，执行Flush刷写
		if b.Available() == 0 {
			err = b.Flush()
		} else {
			// 缓冲区还有空余空间，数据留在buf缓存，EOF不算错误
			err = nil
		}
	}
	return n, err
}


type ReadWriter struct {
	*Reader
	*Writer
}

func NewReadWriter(r *Reader, w *Writer) *ReadWriter {
	return &ReadWriter{r, w}
}

```

### 基础定义 常量 Error

```go
// io包基础常量、预定义错误、Reader/Writer接口
const (
	SeekStart   = 0 // 起始位置：Seek(offset, io.SeekStart)，从流/文件开头偏移offset
	SeekCurrent = 1 // 当前位置：从当前读写指针位置偏移offset
	SeekEnd     = 2 // 末尾位置：从流/文件末尾偏移offset（offset通常负数向前）
)

// ErrShortWrite 写入成功字节数 n < len(p)，且err为nil时必须返回该错误
var ErrShortWrite = errors.New("short write")
// errInvalidWrite 私有错误。Write返回非法n(n<0 或 n>len(p))，属于接口实现bug，io内部校验使用，外部不可访问
var errInvalidWrite = errors.New("invalid write result")
// ErrShortBuffer 缓冲区空间不足，无法容纳所需数据，典型出现在ReadAt等场景
var ErrShortBuffer = errors.New("short buffer")
// EOF 流正常结束标记。Read返回 n=0, io.EOF 代表没有更多数据；允许 n>0 同时返回EOF
var EOF = errors.New("EOF")
// ErrUnexpectedEOF 意外EOF：预期读取指定长度数据，中途提前遇到EOF，读到的数据不完整
var ErrUnexpectedEOF = errors.New("unexpected EOF")
// ErrNoProgress 多次调用Read，每次都返回n=0、err=nil，无任何进展，防止死循环
var ErrNoProgress = errors.New("multiple Read calls return no data or error")

// Reader 读接口：从底层流读取数据填充到切片p
// 返回n：实际读到的字节数(0 ≤ n ≤ len(p))，err：读取错误
// 重要语义：n>0时err可以是EOF；n=0 && err=nil 仅代表暂时无数据，不是EOF
type Reader interface {
	Read(p []byte) (n int, err error)
}

// Writer 写接口：将切片p的数据写入底层流
// 返回n：成功写入字节(0 ≤ n ≤ len(p))，err：写入错误
// 重要语义：若 n < len(p) 且 err == nil，必须返回ErrShortWrite，属于接口契约
type Writer interface {
	Write(p []byte) (n int, err error)
}

```

### io组合接口

```go

type Closer interface {
	Close() error
}

type Seeker interface {
	Seek(offset int64, whence int) (int64, error)
}

type ReadWriter interface {
	Reader
	Writer
}

type ReadCloser interface {
	Reader
	Closer
}

type WriteCloser interface {
	Writer
	Closer
}

type ReadWriteCloser interface {
	Reader
	Writer
	Closer
}

type ReadSeeker interface {
	Reader
	Seeker
}

type ReadSeekCloser interface {
	Reader
	Seeker
	Closer
}

type WriteSeeker interface {
	Writer
	Seeker
}

type ReadWriteSeeker interface {
	Reader
	Writer
	Seeker
}

// ReaderFrom 一次性从Reader r读取数据写入当前对象，直到r返回EOF
// 返回n：总共读取的字节数；err：读取出错（不含EOF）
// 优势：底层可做零拷贝，避免中间缓冲区，io.Copy会优先判断是否实现ReaderFrom
type ReaderFrom interface {
	ReadFrom(r Reader) (n int64, err error)
}

// WriterTo 将当前对象的数据全部写入Writer w，直到数据读完
// 返回n：总共写出字节数；err：写入过程错误
// io.Copy会优先判断源是否实现WriterTo，同样用于优化拷贝
type WriterTo interface {
	WriteTo(w Writer) (n int64, err error)
}

// ReaderAt 定点读接口：从偏移off位置读取数据填充p，**不改变底层读写指针**
// off是绝对偏移，不受当前读写位置影响；并发安全
// 返回n实际读到字节，err读到末尾返回io.EOF
type ReaderAt interface {
	ReadAt(p []byte, off int64) (n int, err error)
}

// WriterAt 定点写接口：从偏移off位置写入p的数据，**不改变底层读写指针**
// off是绝对偏移；不会移动普通Read/Write的游标
type WriterAt interface {
	WriteAt(p []byte, off int64) (n int, err error)
}

// ByteReader 单字节读取接口，一次读1个byte
type ByteReader interface {
	ReadByte() (byte, error)
}

// ByteScanner 内嵌ByteReader，增加回退一个字节能力
// UnreadByte：把最近ReadByte读到的字节放回缓冲区；连续两次UnreadByte一般会报错
type ByteScanner interface {
	ByteReader
	UnreadByte() error
}

// ByteWriter 写入单个字节
type ByteWriter interface {
	WriteByte(c byte) error
}

// RuneReader 读取一个utf8字符(rune)，返回rune、占用字节size、错误
type RuneReader interface {
	ReadRune() (r rune, size int, err error)
}

// RuneScanner 内嵌RuneReader，支持回退一个rune（utf8字符）
type RuneScanner interface {
	RuneReader
	UnreadRune() error
}

// StringWriter 写入字符串，相比Write([]byte(s))，底层实现可避免string转byte切片拷贝
type StringWriter interface {
	WriteString(s string) (n int, err error)
}

// WriteString 将字符串s写入Writer w
// 类型断言优化：如果w实现了StringWriter接口，优先调用sw.WriteString(s)，避免string转[]byte带来内存拷贝
// 否则降级：将s强制转为[]byte，调用普通w.Write
// 返回n：成功写入字节数；err：写入错误
func WriteString(w Writer, s string) (n int, err error) {
	if sw, ok := w.(StringWriter); ok {
		return sw.WriteString(s)
	}
	return w.Write([]byte(s))
}
// ReadAtLeast 从Reader r至少读取 min 个字节存入buf
// 保证：返回时要么读到 >=min 字节，要么返回错误
// 参数 buf：接收数据缓冲区；min：要求最少读取字节数量
// 返回 n：总共读到的字节数，err：错误
func ReadAtLeast(r Reader, buf []byte, min int) (n int, err error) {
	// 前置校验：缓冲区长度小于需要的最小字节，直接返回 ErrShortBuffer
	if len(buf) < min {
		return 0, ErrShortBuffer
	}
	// 循环读：没读到min字节且无错误，继续读
	for n < min && err == nil {
		var nn int
		// buf[n:] 从当前已读位置继续填充剩余空间
		nn, err = r.Read(buf[n:])
		n += nn
	}
	// 读完循环后判断err
	if n >= min {
		// 已经读到足够数据，清空错误（哪怕最后一次Read返回EOF，只要数据够就不算错）
		err = nil
	} else if n > 0 && err == EOF {
		// 读到部分数据，但还不足min就遇到EOF → 意外截断 ErrUnexpectedEOF
		err = ErrUnexpectedEOF
	}
	return
}
// ReadFull 尝试把buf完整填满，从Reader r读取 len(buf) 字节
// 底层直接复用 ReadAtLeast，min设置为缓冲区总长度 len(buf)
// 保证：尽可能读满整个buf；要么读满，要么返回错误
func ReadFull(r Reader, buf []byte) (n int, err error) {
	return ReadAtLeast(r, buf, len(buf))
}

```

#### CopyN Copy CopyBuffer copyBuffer

```go
// CopyN 从src最多拷贝 n 字节到dst
// 底层：把src包装成LimitReader（最多读n字节），调用Copy
// 返回written：已经成功写入的字节；err：错误
// 规则：
// 1. written == n：成功读完指定长度，返回nil
// 2. written < n && err==nil：源提前EOF，不足n字节，err置为EOF
func CopyN(dst Writer, src Reader, n int64) (written int64, err error) {
	written, err = Copy(dst, LimitReader(src, n))
	if written == n {
		return n, nil
	}
	if written < n && err == nil {
		err = EOF
	}
	return
}

// Copy 拷贝全部src数据到dst，内部调用copyBuffer，buf传nil使用内置32KB缓冲区
func Copy(dst Writer, src Reader) (written int64, err error) {
	return copyBuffer(dst, src, nil)
}

// CopyBuffer 自定义缓冲区版本的Copy
// buf 外部传入缓冲区；buf非nil但长度0直接panic
func CopyBuffer(dst Writer, src Reader, buf []byte) (written int64, err error) {
	if buf != nil && len(buf) == 0 {
		panic("empty buffer in CopyBuffer")
	}
	return copyBuffer(dst, src, buf)
}

// copyBuffer Copy/CopyBuffer/CopyN的底层核心实现
func copyBuffer(dst Writer, src Reader, buf []byte) (written int64, err error) {
	// 优化路径1：源src实现WriterTo，直接调用src.WriteTo(dst)，绕过缓冲区拷贝
	if wt, ok := src.(WriterTo); ok {
		return wt.WriteTo(dst)
	}
	// 优化路径2：目标dst实现ReaderFrom，直接调用dst.ReadFrom(src)，绕过缓冲区拷贝
	if rf, ok := dst.(ReaderFrom); ok {
		return rf.ReadFrom(src)
	}
	// 没有优化接口，需要缓冲区中转
	if buf == nil {
		size := 32 * 1024 // 默认32KB buffer
		// 如果src是LimitReader，并且限制长度小于32KB，则buffer缩小到l.N，减少内存浪费
		if l, ok := src.(*LimitedReader); ok && int64(size) > l.N {
			if l.N < 1 {
				size = 1
			} else {
				size = int(l.N)
			}
		}
		buf = make([]byte, size)
	}
	// 循环：读src -> 写dst
	for {
		nr, er := src.Read(buf)
		if nr > 0 {
			nw, ew := dst.Write(buf[0:nr])
			// 非法返回值校验：nw不能负数，nw不能大于读到的nr
			if nw < 0 || nr < nw {
				nw = 0
				if ew == nil {
					ew = errInvalidWrite
				}
			}
			written += int64(nw)
			// 写发生错误，直接退出循环
			if ew != nil {
				err = ew
				break
			}
			// 读到nr字节，但是只写入nw，nr != nw 并且ew==nil → ErrShortWrite
			if nr != nw {
				err = ErrShortWrite
				break
			}
		}
		// er不为nil，结束循环；er=EOF属于正常结束，不赋值err
		if er != nil {
			if er != EOF {
				err = er
			}
			break
		}
	}
	return written, err
}
// LimitReader 包装一个Reader，返回新的Reader，最多只能读取 n 字节
// 返回 *LimitedReader，实现 io.Reader 接口
func LimitReader(r Reader, n int64) Reader { return &LimitedReader{r, n} }

// LimitedReader 结构体，对底层Reader做读取字节数限制
type LimitedReader struct {
	R Reader // 原始底层Reader
	N int64  // 剩余还允许读取的字节数
}
// Read 实现 io.Reader 接口
// LimitedReader 的Read方法：控制最多只能读取剩余 l.N 字节
func (l *LimitedReader) Read(p []byte) (n int, err error) {
	// 剩余配额 <= 0，直接返回EOF，不再读取底层流
	if l.N <= 0 {
		return 0, EOF
	}
	// 如果传入缓冲区p的长度 > 剩余可读取字节l.N，截断p，只取前l.N个位置
	// 防止底层R一次性读出超过限额的数据
	if int64(len(p)) > l.N {
		p = p[0:l.N]
	}
	// 调用底层原始Reader读取，此时p已经被截断，最多读到l.N字节
	n, err = l.R.Read(p)
	// 扣除本次读到的字节，剩余配额减少
	l.N -= int64(n)
	return
}

```

#### SectionReader

```go
// NewSectionReader 从 ReaderAt 数据源上截取一段【子区域切片】，返回 SectionReader
// r：底层数据源，必须实现 ReaderAt（定点读，不移动游标）
// off：子区域在底层r里的起始绝对偏移
// n：子区域允许读取的最大字节长度
func NewSectionReader(r ReaderAt, off int64, n int64) *SectionReader {
	var remaining int64
	const maxint64 = 1<<63 - 1 // int64最大值
	// 溢出保护：判断 off + n 是否会溢出int64
	if off <= maxint64-n {
		remaining = n + off // 正常：子区域末尾位置 = base + n
	} else {
		remaining = maxint64 // 溢出时limit设为int64上限
	}
	// base：片段在底层r的起始偏移
	// off：片段内部当前读写位置（相对底层r的绝对偏移）
	// limit：片段允许读到的最大底层绝对偏移(base+n)
	// n：片段总长度
	return &SectionReader{r, off, off, remaining, n}
}

// SectionReader 对 ReaderAt 的局部切片包装，实现 Reader + Seeker
// 可以把底层大文件的一段，单独当成一个独立流操作，支持Read、Seek
type SectionReader struct {
	r     ReaderAt // 底层定点读数据源（如os.File）
	base  int64    // 该片段在底层r的【起始绝对偏移】
	off   int64    // 当前读写指针：底层r的绝对偏移
	limit int64    // 片段可读的最大底层绝对偏移，超过就EOF
	n     int64    // 片段总长度（创建时传入的n）
}

// Read 实现 io.Reader 接口，读取片段内数据
func (s *SectionReader) Read(p []byte) (n int, err error) {
	// 当前指针已经超出片段末尾 → EOF
	if s.off >= s.limit {
		return 0, EOF
	}
	// 剩余可读字节，截断buffer，防止读到片段外面
    // - `s.off`：当前**底层绝对偏移**（SectionReader 自己维护的虚拟游标）
    // - `s.limit`：这个片段允许读到的最大底层绝对偏移（片段末尾边界）
    // - `max = s.limit - s.off`：**当前还剩多少字节可以读（片段内剩余字节）**
	if max := s.limit - s.off; int64(len(p)) > max {
		p = p[0:max]
	}
	// 调用底层ReaderAt定点读，从s.off（底层绝对偏移）读取，不改动底层r游标
	n, err = s.r.ReadAt(p, s.off)
	// 移动片段自己的内部指针off
	s.off += int64(n)
	return
}

var errWhence = errors.New("Seek: invalid whence")
var errOffset = errors.New("Seek: invalid offset")

// Seek 实现 io.Seeker 接口，可以在这个片段内部移动读写指针
func (s *SectionReader) Seek(offset int64, whence int) (int64, error) {
	switch whence {
	default:
		return 0, errWhence // 非法whence
	case SeekStart:
		// SeekStart：offset相对于片段开头，加上base转为底层绝对偏移
		offset += s.base
	case SeekCurrent:
		// SeekCurrent：offset相对于片段当前off，加上当前底层绝对位置
		offset += s.off
	case SeekEnd:
		// SeekEnd：offset相对于片段末尾limit
		offset += s.limit
	}
	// 不能小于片段起始位置base
	if offset < s.base {
		return 0, errOffset
	}
	s.off = offset
	// 返回值：相对于片段自身起点的偏移（减去base），不是底层绝对偏移
	return offset - s.base, nil
}


// ReadAt 实现 io.ReaderAt 接口，在【片段内部相对偏移 off】定点读取
// off：相对于SectionReader片段起点的偏移（不是底层文件绝对偏移）
func (s *SectionReader) ReadAt(p []byte, off int64) (n int, err error) {
	// 边界校验：off不能负数，不能超过片段总大小，越界直接EOF
	if off < 0 || off >= s.Size() {
		return 0, EOF
	}
	// 片段相对偏移 → 转换成底层ReaderAt的绝对偏移
	off += s.base

	// max：从当前底层off到片段末尾limit，剩余可读字节数量
	if max := s.limit - off; int64(len(p)) > max {
		// buffer太长，截断，最多只能读到片段末尾
		p = p[0:max]
		n, err = s.r.ReadAt(p, off)
		// 刚好读到片段末尾，读完后强制设置EOF
		if err == nil {
			err = EOF
		}
		return n, err
	}
	// buffer大小合适，不会越界，直接底层ReadAt
	return s.r.ReadAt(p, off)
}

// Size 返回当前SectionReader片段总字节大小
func (s *SectionReader) Size() int64 { return s.limit - s.base }

// Outer 返回底层原始ReaderAt、片段在底层的起始偏移、片段长度n
// 方便上层拿到包装前的底层信息，对外暴露底层信息
func (s *SectionReader) Outer() (r ReaderAt, off int64, n int64) {
	return s.r, s.base, s.n
}

```

#### OffsetWriter

```go
// OffsetWriter 包装 WriterAt，提供带偏移的顺序写入能力；类似SectionReader的写入版本
// 对外伪装成独立的顺序Writer，内部自动做坐标转换
type OffsetWriter struct {
	w    WriterAt // 底层定点写入对象（例如*os.File，实现WriterAt）
	base int64    // 片段在底层w的起始绝对偏移
	off  int64    // 当前写入游标：底层w的绝对偏移
}

// NewOffsetWriter 构造函数：把WriterAt从底层off位置包装成OffsetWriter
func NewOffsetWriter(w WriterAt, off int64) *OffsetWriter {
	return &OffsetWriter{w, off, off}
}

// Write 实现 io.Writer，顺序写入；每次写入后自动移动内部游标 o.off
func (o *OffsetWriter) Write(p []byte) (n int, err error) {
	// 在当前底层游标 o.off 位置定点写入
	n, err = o.w.WriteAt(p, o.off)
	// 游标前进，和普通Writer行为一致
	o.off += int64(n)
	return
}

// WriteAt 实现 io.WriterAt；off 是【片段内部相对偏移】，内部转底层绝对偏移再写
func (o *OffsetWriter) WriteAt(p []byte, off int64) (n int, err error) {
	if off < 0 {
		return 0, errOffset
	}
	// 片段相对偏移 + base → 底层绝对偏移
	off += o.base
	return o.w.WriteAt(p, off)
}

// Seek 实现 io.Seeker，在片段内移动写入游标；语义和SectionReader.Seek几乎一样
func (o *OffsetWriter) Seek(offset int64, whence int) (int64, error) {
	switch whence {
	default:
		return 0, errWhence
	case SeekStart:
		// SeekStart：offset相对于片段起点，加上base转为底层绝对偏移
		offset += o.base
	case SeekCurrent:
		// SeekCurrent：offset相对于当前游标o.off
		offset += o.off
		// 没有SeekEnd分支！OffsetWriter不支持SeekEnd
	}
	// 不能跳到base左边
	if offset < o.base {
		return 0, errOffset
	}
	o.off = offset
	// 返回片段内相对偏移
	return offset - o.base, nil
}
```

#### teeReader

```go
// TeeReader 返回一个Reader：从r读取数据的同时，把读到的数据原样写入w
// 类似Unix tee命令，一读同时复制一份写入目标writer
func TeeReader(r Reader, w Writer) Reader {
	return &teeReader{r, w}
}

// teeReader 包装结构体，实现 io.Reader 接口
type teeReader struct {
	r Reader // 原始数据源，主读取源
	w Writer // 镜像写入目标，读到的数据会复制一份写这里
}
// **读源 Reader 的数据，读到的同时自动把读到的数据镜像复制一份写入 w。**
// 功能类似 Linux 的 `tee` 命令，**一份读取，两份输出**。
// Read 实现io.Reader接口
func (t *teeReader) Read(p []byte) (n int, err error) {
	// 第一步：从底层r读取数据到p缓冲区
	n, err = t.r.Read(p)
	// 如果本次读到字节>0，把读到的n字节，写入w
	if n > 0 {
		// 短变量n是本次Write返回的n，局部变量，遮蔽外层n
		if n, err := t.w.Write(p[:n]); err != nil {
			return n, err
		}
	}
	return
}

```

#### discard

```go
// Discard：全局变量，一个黑洞Writer，所有写入的数据直接丢弃，不保存任何内容
var Discard Writer = discard{}

// discard 空结构体，实现 io.Writer, io.StringWriter, io.ReaderFrom
type discard struct{}
// 编译期断言，保证 discard 实现了 ReaderFrom 接口
var _ ReaderFrom = discard{}

// Write 实现 io.Writer，接收p，直接返回 len(p)，数据扔掉，不存储
func (discard) Write(p []byte) (int, error) {
	return len(p), nil
}

// WriteString 实现 StringWriter，字符串版本写入，同样直接丢弃
func (discard) WriteString(s string) (int, error) {
	return len(s), nil
}

// 内存池，复用 8KB 的缓冲区，避免每次ReadFrom都新建切片GC压力
var blackHolePool = sync.Pool{
	New: func() any {
		b := make([]byte, 8192)
		return &b
	},
}

// ReadFrom 实现 io.ReaderFrom，一次性把 r 的数据全部读走并丢弃
//`discard.ReadFrom`：**源源不断从 r 把数据读出来，读完直接扔掉，只消耗、不落地**，作用是排空 Reader 流。
func (discard) ReadFrom(r Reader) (n int64, err error) {
	// 从对象池取出一块 8192 字节缓冲区
	bufp := blackHolePool.Get().(*[]byte)
	readSize := 0
	for {
		// 从r读入缓冲区，读到的数据直接扔掉
		readSize, err = r.Read(*bufp)
		n += int64(readSize)
		if err != nil {
			// 无论正常EOF还是错误，用完把缓冲区放回sync.Pool
			blackHolePool.Put(bufp)
			if err == EOF {
				// 读到EOF，正常结束，返回已经读取的总字节n，err=nil
				return n, nil
			}
			return
		}
	}
}

```

## nopCloser & nopCloserWriterTo & ReadAll

> 包: io
> 用途: NopCloser给普通Reader增加空Close方法，转为ReadCloser；ReadAll 一次性读取Reader全部数据返回[]byte

### 结构体总表

| 结构体            | 嵌入字段 | 实现接口             | 核心作用                                  |
| ----------------- | -------- | -------------------- | ----------------------------------------- |
| nopCloser         | Reader   | ReadCloser           | 基础包装，提供空Close()                   |
| nopCloserWriterTo | Reader   | ReadCloser, WriterTo | 增强包装，保留底层Reader的WriteTo优化接口 |

### 源码

```go
// NopCloser 把一个普通 io.Reader 包装成 io.ReadCloser
// ReadCloser = Reader + Close() 方法
func NopCloser(r Reader) ReadCloser {
	// 类型断言：如果r还实现了WriterTo接口，返回带WriterTo的包装类型（优化分支）
	if _, ok := r.(WriterTo); ok {
		return nopCloserWriterTo{r}
	}
	// 普通情况，返回基础包装器
	return nopCloser{r}
}

// nopCloser 结构体，嵌入Reader，匿名嵌入
type nopCloser struct {
	Reader
}
// Close 空操作，什么都不干，直接返回nil
func (nopCloser) Close() error { return nil }

type nopCloserWriterTo struct {
	Reader
}
func (nopCloserWriterTo) Close() error { return nil }
func (c nopCloserWriterTo) WriteTo(w Writer) (n int64, err error) {
	return c.Reader.(WriterTo).WriteTo(w)
}

// ReadAll 读取Reader全部数据，返回完整[]byte
func ReadAll(r Reader) ([]byte, error) {
	b := make([]byte, 0, 512)
	next := 256
	chunks := make([][]byte, 0, 4)
	var finalSize int
	for {
		n, err := r.Read(b[len(b):cap(b)])
		b = b[:len(b)+n]
		if err != nil {
			if err == EOF {
				err = nil
			}
			if len(chunks) == 0 {
				return b, err
			}
			finalSize += len(b)
			final := append([]byte(nil), make([]byte, finalSize)...)[:0]
			for _, chunk := range chunks {
				final = append(final, chunk...)
			}
			final = append(final, b...)
			return final, err
		}
		// 剩余空闲空间不足 cap(b)/16，当前块存进chunks，新建更大buffer
		if cap(b)-len(b) < cap(b)/16 {
			chunks = append(chunks, b)
			finalSize += len(b)
			b = append([]byte(nil), make([]byte, next)...)[:0]
			next += next / 2 // 1.5倍扩容下一块buffer
		}
	}
}
```

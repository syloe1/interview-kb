#### sql驱动

```go
// 保护Drivers map的并发读写
var driversMu sync.RWMutex

//go:linkname drivers
// 全局 map，存放所有数据库驱动。
var drivers = make(map[string]driver.Driver)

func Register(name string, driver driver.Driver) {
	driversMu.Lock()
	defer driversMu.Unlock()
	if driver == nil {
		panic("sql: Register driver is nil")
	}
    // 重复注册panic
	if _, dup := drivers[name]; dup {
		panic("sql: Register called twice for driver " + name)
	}
	drivers[name] = driver
}
// 清空所有驱动
func unregisterAllDrivers() {
	driversMu.Lock()
	defer driversMu.Unlock()
	drivers = make(map[string]driver.Driver)
}
// 获取驱动名列表
func Drivers() []string {
	driversMu.RLock()
	defer driversMu.RUnlock()
	return slices.Sorted(maps.Keys(drivers))
}

type NamedArg struct {
    //零大小空结构体，**强制调用方必须使用命名字段初始化**。
	_NamedFieldsRequired struct{}
	Name string
	Value any
}

```

#### Named函数 & 事务隔离级别 IsolationLevel

```go
func Named(name string, value any) NamedArg {
	return NamedArg{Name: name, Value: value}
}

type IsolationLevel int

const (
	LevelDefault IsolationLevel = iota
	LevelDefault//：驱动默认隔离级别
    LevelReadUncommitted//：读未提交
    LevelReadCommitted//：读已提交
    LevelWriteCommitted//：写提交
    LevelRepeatableRead//：可重复读
    LevelSnapshot//：快照隔离
    LevelSerializable//：串行化
    LevelLinearizable//：线性一致性
)

func (i IsolationLevel) String() string {
	switch i {
	case LevelDefault:
		return "Default"
	case LevelReadUncommitted:
		return "Read Uncommitted"
	case LevelReadCommitted:
		return "Read Committed"
	case LevelWriteCommitted:
		return "Write Committed"
	case LevelRepeatableRead:
		return "Repeatable Read"
	case LevelSnapshot:
		return "Snapshot"
	case LevelSerializable:
		return "Serializable"
	case LevelLinearizable:
		return "Linearizable"
	default:
		return "IsolationLevel(" + strconv.Itoa(int(i)) + ")"
	}
}
//编译阶段校验：`IsolationLevel` 必须实现 `fmt.Stringer`。
var _ fmt.Stringer = LevelDefault
```

#### TxOptions / RawBytes / NullString

```go
//事务配置结构体
type TxOptions struct {
	Isolation IsolationLevel
	ReadOnly  bool
}
// 引用数据库底层内存
type RawBytes []byte
//处理数据库`NULL`字符串的类型
type NullString struct {
	String string
	Valid  bool
}
//实现`sql.Scanner`接口，**读数据库（Scan 阶段）**
func (ns *NullString) Scan(value any) error {
	if value == nil {
		ns.String, ns.Valid = "", false
		return nil
	}
	err := convertAssign(&ns.String, value)
	ns.Valid = err == nil
	return err
}
//时机：Exec/Query 绑定时，把 Go 变量传给数据库驱动时调用
func (ns NullString) Value() (driver.Value, error) {
	if !ns.Valid {
		return nil, nil
	}
	return ns.String, nil
}
```

#### NullInt64

```go
type NullInt64 struct {
	Int64 int64
	Valid bool
}

func (n *NullInt64) Scan(value any) error {
	if value == nil {
		n.Int64, n.Valid = 0, false
		return nil
	}
	err := convertAssign(&n.Int64, value)
	n.Valid = err == nil
	return err
}

func (n NullInt64) Value() (driver.Value, error) {
	if !n.Valid {
		return nil, nil
	}
	return n.Int64, nil
}
```

#### NullInt32

```go
type NullInt32 struct {
	Int32 int32
	Valid bool
}

func (n *NullInt32) Scan(value any) error {
	if value == nil {
		n.Int32, n.Valid = 0, false
		return nil
	}
	err := convertAssign(&n.Int32, value)
	n.Valid = err == nil
	return err
}

func (n NullInt32) Value() (driver.Value, error) {
	if !n.Valid {
		return nil, nil
	}
	return int64(n.Int32), nil
}

```

#### NullInt16 / NullByte

```go
type NullInt16 struct {
	Int16 int16
	Valid bool
}

func (n *NullInt16) Scan(value any) error {
	if value == nil {
		n.Int16, n.Valid = 0, false
		return nil
	}
	err := convertAssign(&n.Int16, value)
	n.Valid = err == nil
	return err
}

func (n NullInt16) Value() (driver.Value, error) {
	if !n.Valid {
		return nil, nil
	}
	return int64(n.Int16), nil
}

type NullByte struct {
	Byte  byte
	Valid bool
}

func (n *NullByte) Scan(value any) error {
	if value == nil {
		n.Byte, n.Valid = 0, false
		return nil
	}
	err := convertAssign(&n.Byte, value)
	n.Valid = err == nil
	return err
}

func (n NullByte) Value() (driver.Value, error) {
	if !n.Valid {
		return nil, nil
	}
	return int64(n.Byte), nil
}

```

#### NullFloat64 / NullBool

```go
type NullFloat64 struct {
	Float64 float64
	Valid   bool
}

func (n *NullFloat64) Scan(value any) error {
	if value == nil {
		n.Float64, n.Valid = 0, false
		return nil
	}
	err := convertAssign(&n.Float64, value)
	n.Valid = err == nil
	return err
}

func (n NullFloat64) Value() (driver.Value, error) {
	if !n.Valid {
		return nil, nil
	}
	return n.Float64, nil
}

type NullBool struct {
	Bool  bool
	Valid bool
}

func (n *NullBool) Scan(value any) error {
	if value == nil {
		n.Bool, n.Valid = false, false
		return nil
	}
	err := convertAssign(&n.Bool, value)
	n.Valid = err == nil
	return err
}

func (n NullBool) Value() (driver.Value, error) {
	if !n.Valid {
		return nil, nil
	}
	return n.Bool, nil
}
```

#### NullTime / 泛型 Null[T]

```go
type NullTime struct {
	Time  time.Time
	Valid bool
}

func (n *NullTime) Scan(value any) error {
	if value == nil {
		n.Time, n.Valid = time.Time{}, false
		return nil
	}
	err := convertAssign(&n.Time, value)
	n.Valid = err == nil
	return err
}

func (n NullTime) Value() (driver.Value, error) {
	if !n.Valid {
		return nil, nil
	}
	return n.Time, nil
}

type Null[T any] struct {
	V     T
	Valid bool
}

func (n *Null[T]) Scan(value any) error {
	if value == nil {
		n.V, n.Valid = *new(T), false
		return nil
	}
	err := convertAssign(&n.V, value)
	n.Valid = err == nil
	return err
}

func (n Null[T]) Value() (driver.Value, error) {
	if !n.Valid {
		return nil, nil
	}
	v := any(n.V)
	if valuer, ok := v.(driver.Valuer); ok {
		val, err := callValuerValue(valuer)
		if err != nil {
			return val, err
		}
		v = val
	}
	return driver.DefaultParameterConverter.ConvertValue(v)
}
```

#### Scanner / Out / ErrNoRows / DB连接池核心结构体

```go
// Scanner 接口：Rows.Scan使用，从数据库驱动读取值到Go变量
type Scanner interface {
	// Scan：src来自驱动，类型固定为driver.Value那7种类型
	Scan(src any) error
}

// Out：用于存储过程的OUT/INOUT输出参数
type Out struct {
	_NamedFieldsRequired struct{} // 强制使用命名结构体初始化，语法约束
	Dest any                      // 指针，接收存储过程输出结果
	In   bool                     // true=INOUT参数（带输入同时带回输出）；false=OUT仅输出
}

// ErrNoRows：QueryRow查询无数据，延迟到Scan调用时才返回该错误
var ErrNoRows = errors.New("sql: no rows in result set")

// DB 数据库句柄，连接池核心结构体，多goroutine并发安全
type DB struct {
	waitDuration atomic.Int64      // 等待连接总耗时，原子操作
	connector    driver.Connector  // 底层驱动连接器，用来创建连接
	numClosed    atomic.Uint64     // 已关闭连接总数，原子计数器

	mu                sync.Mutex        // 保护下面所有非原子字段
	freeConn          []*driverConn     // 空闲连接池，按归还时间从旧到新排序
	connRequests      connRequestSet    // 等待获取连接的请求队列
	numOpen           int               // 已打开+待打开连接总数
	openerCh          chan struct{}     // 通知后台goroutine新建连接的信号通道
	closed            bool              // DB是否已经调用Close关闭
	dep               map[finalCloser]depSet
	lastPut           map[*driverConn]string // 调试用：连接归还时堆栈信息
	maxIdleCount      int                   // 最大空闲连接数
	maxOpen           int                   // 最大打开连接数，<=0代表无上限
	maxLifetime       time.Duration         // 连接最大复用生命周期
	maxIdleTime       time.Duration         // 连接最大空闲时长，超时关闭
	cleanerCh         chan struct{}
	waitCount         int64                 // 总共等待连接的次数
	maxIdleClosed     int64                 // 因空闲连接数超限而关闭的连接计数
	maxIdleTimeClosed int64                 // 因空闲超时关闭连接计数
	maxLifetimeClosed int64                 // 因连接生命周期到期关闭计数
	stop              func()                // 取消后台连接创建协程
}

// connReuseStrategy：DB获取连接时的复用策略
type connReuseStrategy uint8

const (
	alwaysNewConn    connReuseStrategy = iota // 每次强制新建连接，不走连接池缓存
	cachedOrNewConn                          // 优先拿空闲缓存连接，没有则新建/等待
)
```

#### driverConn 结构体与配套方法（连接池内单个连接包装层）

```go
// driverConn：包装底层driver.Conn，连接池里的连接实例
type driverConn struct {
	db          *DB            // 归属哪个连接池DB
	createdAt   time.Time      // 连接创建时间，用于maxLifetime过期判断
	sync.Mutex                  // 保护下面ci/needReset/closed/finalClosed/openStmt
	ci          driver.Conn    // 驱动原生数据库连接
	needReset   bool           // 归还复用前是否需要重置会话（事务/会话状态残留）
	closed      bool           // 连接是否标记关闭
	finalClosed bool           // 底层ci.Close()是否已经执行
	openStmt    map[*driverStmt]bool // 当前连接上还没关闭的预编译语句

	// 下面字段由db.mu（DB全局锁）保护，不是上面的dc.Mutex
	inUse       bool          // true：连接正在被goroutine占用
	dbmuClosed  bool          // closed副本，db.mu保护，清理stmt用
	returnedAt  time.Time     // 连接创建/归还到空闲池的时间，用于maxIdleTime
	onPut       []func()      // 归还连接时执行的回调（持有db.mu运行）
}

// releaseConn：用完连接，归还回连接池
func (dc *driverConn) releaseConn(err error) {
	dc.db.putConn(dc, err, true)
}

// removeOpenStmt：从当前连接的预编译stmt集合中删除一条stmt
func (dc *driverConn) removeOpenStmt(ds *driverStmt) {
	dc.Lock()
	defer dc.Unlock()
	delete(dc.openStmt, ds)
}

// expired 判断连接是否超过最大生命周期maxLifetime
func (dc *driverConn) expired(timeout time.Duration) bool {
	if timeout <= 0 {
		return false
	}
	return dc.createdAt.Add(timeout).Before(time.Now())
}

// resetSession 重置会话，复用连接前清理会话状态
func (dc *driverConn) resetSession(ctx context.Context) error {
	dc.Lock()
	defer dc.Unlock()
	if !dc.needReset {
		return nil
	}
	// 判断驱动是否实现SessionResetter接口，执行重置
	if cr, ok := dc.ci.(driver.SessionResetter); ok {
		return cr.ResetSession(ctx)
	}
	return nil
}

// validateConnection 校验连接是否可用；标记needReset
func (dc *driverConn) validateConnection(needsReset bool) bool {
	dc.Lock()
	defer dc.Unlock()
	if needsReset {
		dc.needReset = true
	}
	// 驱动实现Validator接口则调用IsValid做连接有效性检查
	if cv, ok := dc.ci.(driver.Validator); ok {
		return cv.IsValid()
	}
	return true
}

// prepareLocked 在当前连接上预编译SQL，dc锁已持有（Locked后缀含义）
func (dc *driverConn) prepareLocked(ctx context.Context, cg stmtConnGrabber, query string) (*driverStmt, error) {
	si, err := ctxDriverPrepare(ctx, dc.ci, query)
	if err != nil {
		return nil, err
	}
	ds := &driverStmt{Locker: dc, si: si}
	// cg不为nil：单连接绑定stmt，不需要维护openStmt集合
	if cg != nil {
		return ds, nil
	}
	// 跟踪当前连接所有打开的预编译语句，关闭连接前先关闭所有stmt
	if dc.openStmt == nil {
		dc.openStmt = make(map[*driverStmt]bool)
	}
	dc.openStmt[ds] = true
	return ds, nil
}
```

#### driverConn 关闭相关方法：closeDBLocked / Close / finalClose

```go
// closeDBLocked：db.mu已经持有，标记连接关闭，返回清理依赖的闭包
func (dc *driverConn) closeDBLocked() func() error {
	dc.Lock()
	defer dc.Unlock()
	if dc.closed {
		// 重复关闭：返回闭包，调用时返回重复关闭错误
		return func() error { return errors.New("sql: duplicate driverConn close") }
	}
	dc.closed = true
	// 移除依赖关系，返回finalClose执行函数
	return dc.db.removeDepLocked(dc, dc)
}

// Close：对外关闭driverConn入口，标记closed，触发依赖清理
func (dc *driverConn) Close() error {
	dc.Lock()
	if dc.closed {
		dc.Unlock()
		return errors.New("sql: duplicate driverConn close")
	}
	dc.closed = true
	dc.Unlock() // 不使用defer，finalClose内部可能还要拿锁，提前释放dc锁

	// 下面操作需要持有db.mu（连接池全局锁）
	dc.db.mu.Lock()
	dc.dbmuClosed = true
	fn := dc.db.removeDepLocked(dc, dc)
	dc.db.mu.Unlock()
	return fn()
}

// finalClose 真正执行底层资源释放：关闭所有openStmt，关闭原生driver.Conn
func (dc *driverConn) finalClose() error {
	var err error
	// 拷贝当前连接上所有未关闭预编译stmt，避免遍历中map被修改
	var openStmt []*driverStmt
	withLock(dc, func() {
		openStmt = make([]*driverStmt, 0, len(dc.openStmt))
		for ds := range dc.openStmt {
			openStmt = append(openStmt, ds)
		}
		dc.openStmt = nil // 清空map
	})
	// 逐个关闭该连接上全部预编译语句，防止数据库资源泄漏
	for _, ds := range openStmt {
		ds.Close()
	}

	// 关闭底层原生driver.Conn，标记finalClosed
	withLock(dc, func() {
		dc.finalClosed = true
		err = dc.ci.Close()
		dc.ci = nil // 置空，GC回收
	})

	// 持有db.mu更新连接池统计
	dc.db.mu.Lock()
	dc.db.numOpen--        // 已打开连接计数-1
	dc.db.maybeOpenNewConnections() // 尝试新建连接补池
	dc.db.mu.Unlock()
	dc.db.numClosed.Add(1)  // 原子：累计关闭连接+1
	return err
}
```

#### driverStmt / depSet / finalCloser 依赖引用计数系统

```go
// driverStmt：绑定底层driver.Stmt与来源driverConn，调用stmt时持有连接锁
type driverStmt struct {
	sync.Locker        // 嵌入接口，实际是*driverConn，复用driverConn的Mutex
	si         driver.Stmt // 驱动原生预编译语句对象
	closed     bool        // 标记stmt是否已关闭
	closeErr   error       // 缓存Close返回结果，保证多次Close返回相同err
}

// Close 关闭预编译stmt，保证只执行一次，重复调用直接返回缓存错误
func (ds *driverStmt) Close() error {
	ds.Lock()
	defer ds.Unlock()
	if ds.closed {
		return ds.closeErr
	}
	ds.closed = true
	ds.closeErr = ds.si.Close()
	return ds.closeErr
}

// depSet：finalCloser对象的依赖集合，map实现集合
type depSet map[any]bool

// finalCloser 接口：依赖计数归0时，触发finalClose做真正资源释放
type finalCloser interface {
	// 依赖全部移除后调用finalClose，调用时不持有db.mu
	finalClose() error
}

// addDep：增加依赖关系，x依赖dep；x要等所有dep移除后才执行finalClose
func (db *DB) addDep(x finalCloser, dep any) {
	db.mu.Lock()
	defer db.mu.Unlock()
	db.addDepLocked(x, dep)
}

// addDepLocked：addDep的内部实现，调用前必须持有db.mu
func (db *DB) addDepLocked(x finalCloser, dep any) {
	if db.dep == nil {
		db.dep = make(map[finalCloser]depSet)
	}
	xdep := db.dep[x]
	if xdep == nil {
		xdep = make(depSet)
		db.dep[x] = xdep
	}
	xdep[dep] = true // 标记x新增依赖dep
}

// removeDep：移除x对dep的依赖；依赖清零会执行finalClose
func (db *DB) removeDep(x finalCloser, dep any) error {
	db.mu.Lock()
	fn := db.removeDepLocked(x, dep)
	db.mu.Unlock()
	return fn()
}

// removeDepLocked：移除依赖核心逻辑，必须持有db.mu
// 返回闭包：若依赖清空，闭包就是x.finalClose；否则返回空函数
func (db *DB) removeDepLocked(x finalCloser, dep any) func() error {
	xdep, ok := db.dep[x]
	if !ok {
		panic(fmt.Sprintf("unpaired removeDep: no deps for %T", x))
	}
	l0 := len(xdep)
	delete(xdep, dep)
	switch len(xdep) {
	case l0:
		// 长度没变，说明dep不在集合，非法调用
		panic(fmt.Sprintf("unpaired removeDep: no %T dep on %T", dep, x))
	case 0:
		// 依赖全部移除，从db.dep删掉记录，返回finalClose方法闭包
		delete(db.dep, x)
		return x.finalClose
	default:
		// 还有剩余依赖，返回空函数，不执行资源释放
		return func() error { return nil }
	}
}
```

#### connectionRequestQueueSize / dsnConnector / OpenDB / Open

```go
// connectionRequestQueueSize：openerCh缓冲通道大小，100万
// 建议大于maxOpen；过小会导致大量请求阻塞等待新建连接
var connectionRequestQueueSize = 1000000

// dsnConnector：适配老驱动，把dsn字符串包装成driver.Connector接口
type dsnConnector struct {
	dsn    string          // 数据库连接串
	driver driver.Driver   // 底层驱动实例
}

// Connect 实现driver.Connector接口，调用driver.Open(dsn)创建原生连接
func (t dsnConnector) Connect(_ context.Context) (driver.Conn, error) {
	return t.driver.Open(t.dsn)
}

// Driver 返回绑定的底层驱动实例
func (t dsnConnector) Driver() driver.Driver {
	return t.driver
}

// OpenDB：接收driver.Connector，创建DB连接池实例（底层核心构造函数）
// 不会立刻建立数据库连接，懒连接；需要Ping验证连通性
func OpenDB(c driver.Connector) *DB {
	ctx, cancel := context.WithCancel(context.Background())
	db := &DB{
		connector: c,
		openerCh:  make(chan struct{}, connectionRequestQueueSize), // 信号通道，通知后台协程建连接
		lastPut:   make(map[*driverConn]string),                    // 调试：归还连接堆栈
		stop:      cancel,                                          // 关闭DB时取消后台协程
	}
	go db.connectionOpener(ctx) // 启动后台goroutine，负责创建新连接
	return db
}

// Open：用户入口函数，根据驱动名+dsn打开数据库
// 优先使用DriverContext接口创建Connector；老驱动则包装成dsnConnector再调用OpenDB
func Open(driverName, dataSourceName string) (*DB, error) {
	driversMu.RLock()
	driveri, ok := drivers[driverName] // 从全局驱动注册表查找驱动
	driversMu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("sql: unknown driver %q (forgotten import?)", driverName)
	}
	// 判断驱动是否实现DriverContext（新版驱动支持OpenConnector）
	if driverCtx, ok := driveri.(driver.DriverContext); ok {
		connector, err := driverCtx.OpenConnector(dataSourceName)
		if err != nil {
			return nil, err
		}
		return OpenDB(connector), nil
	}
	// 旧驱动：包装dsn到dsnConnector，再调用OpenDB
	return OpenDB(dsnConnector{dsn: dataSourceName, driver: driveri}), nil
}
```

#### pingDC / PingContext / Ping

```go
// pingDC：在指定driverConn上执行Ping探测，探测完成调用release归还连接
func (db *DB) pingDC(ctx context.Context, dc *driverConn, release func(error)) error {
	var err error
	// 判断底层驱动连接是否实现Pinger接口
	if pinger, ok := dc.ci.(driver.Pinger); ok {
		withLock(dc, func() {
			err = pinger.Ping(ctx)
		})
	}
	release(err) // 无论ping成功失败，都归还连接回连接池
	return err
}

// PingContext：校验数据库连接存活，没有可用连接时会新建连接
func (db *DB) PingContext(ctx context.Context) error {
	var dc *driverConn
	var err error
	// retry：尝试从连接池获取连接（重试机制，策略默认cachedOrNewConn）
	err = db.retry(func(strategy connReuseStrategy) error {
		dc, err = db.conn(ctx, strategy)
		return err
	})
	if err != nil {
		return err
	}
	return db.pingDC(ctx, dc, dc.releaseConn)
}

// Ping：不带上下文，底层直接调用PingContext，使用context.Background()
func (db *DB) Ping() error {
	return db.PingContext(context.Background())
}
```

#### DB.Close / 连接池参数相关：maxIdle、maxOpen、SetMaxIdleConns、SetMaxOpenConns

```go
// Close：关闭整个DB连接池，幂等，多次调用不会重复执行
func (db *DB) Close() error {
	db.mu.Lock()
	if db.closed { // 幂等保护，已经关闭直接返回nil
		db.mu.Unlock()
		return nil
	}
	if db.cleanerCh != nil {
		close(db.cleanerCh) // 关闭空闲连接清理协程通道
	}
	var err error
	fns := make([]func() error, 0, len(db.freeConn))
	// 遍历所有空闲连接，标记待关闭，收集finalClose闭包
	for _, dc := range db.freeConn {
		fns = append(fns, dc.closeDBLocked())
	}
	db.freeConn = nil    // 清空空闲连接列表
	db.closed = true    // 标记DB连接池已关闭
	db.connRequests.CloseAndRemoveAll() // 清空等待获取连接的请求队列
	db.mu.Unlock()
	// 释放db.mu之后，逐个执行空闲连接的finalClose，避免持有全局锁做IO
	for _, fn := range fns {
		err1 := fn()
		if err1 != nil {
			err = err1
		}
	}
	db.stop() // 取消context，停止connectionOpener后台协程
	// 如果connector实现io.Closer，关闭connector
	if c, ok := db.connector.(io.Closer); ok {
		err1 := c.Close()
		if err1 != nil {
			err = err1
		}
	}
	return err
}

const defaultMaxIdleConns = 2 // 默认最大空闲连接数

// maxIdleConnsLocked：获取当前生效的maxIdleCount，调用前持有db.mu
func (db *DB) maxIdleConnsLocked() int {
	n := db.maxIdleCount
	switch {
	case n == 0:
		// 未设置，使用默认值2
		return defaultMaxIdleConns
	case n < 0:
		return 0 // n<0 不保留空闲连接
	default:
		return n
	}
}

// shortestIdleTimeLocked：取maxIdleTime和maxLifetime中较小值，作为空闲连接淘汰判断
func (db *DB) shortestIdleTimeLocked() time.Duration {
	if db.maxIdleTime <= 0 {
		return db.maxLifetime
	}
	if db.maxLifetime <= 0 {
		return db.maxIdleTime
	}
	return min(db.maxIdleTime, db.maxLifetime)
}

// SetMaxIdleConns 设置空闲连接池最大数量
func (db *DB) SetMaxIdleConns(n int) {
	db.mu.Lock()
	if n > 0 {
		db.maxIdleCount = n
	} else {
		db.maxIdleCount = -1 // n<=0：不保留空闲连接
	}
	// 约束：maxIdle不能超过maxOpen
	if db.maxOpen > 0 && db.maxIdleConnsLocked() > db.maxOpen {
		db.maxIdleCount = db.maxOpen
	}
	idleCount := len(db.freeConn)
	maxIdle := db.maxIdleConnsLocked()
	var closing []*driverConn
	// 空闲连接超过上限，多出的连接收集起来，后面关闭
	if idleCount > maxIdle {
		closing = db.freeConn[maxIdle:]
		db.freeConn = db.freeConn[:maxIdle]
	}
	db.maxIdleClosed += int64(len(closing)) // 统计被关闭的空闲连接数量
	db.mu.Unlock()
	// 释放锁之后关闭超额空闲连接，不要在db.mu内执行IO
	for _, c := range closing {
		c.Close()
	}
}

// SetMaxOpenConns 设置最大打开连接数（整个连接池的总连接上限）
func (db *DB) SetMaxOpenConns(n int) {
	db.mu.Lock()
	db.maxOpen = n
	if n < 0 {
		db.maxOpen = 0
	}
	// 如果新maxOpen < 当前maxIdle，同步缩小maxIdle，保证maxIdle <= maxOpen
	syncMaxIdle := db.maxOpen > 0 && db.maxIdleConnsLocked() > db.maxOpen
	db.mu.Unlock()
	if syncMaxIdle {
		db.SetMaxIdleConns(n)
	}
}
```

#### SetConnMaxLifetime / SetConnMaxIdleTime / connectionCleaner 空闲连接后台清理器

```go
// SetConnMaxLifetime 设置连接最大复用总时长（从连接创建开始计时）
// 过期连接会在复用前惰性关闭；d<=0 不按连接年龄关闭
func (db *DB) SetConnMaxLifetime(d time.Duration) {
	if d < 0 {
		d = 0
	}
	db.mu.Lock()
	// 缩短生命周期时，唤醒清理协程，立刻检查过期连接
	if d > 0 && d < db.shortestIdleTimeLocked() && db.cleanerCh != nil {
		select {
		case db.cleanerCh <- struct{}{}:
		default:
		}
	}
	db.maxLifetime = d
	db.startCleanerLocked() // 启动清理协程（如未启动）
	db.mu.Unlock()
}

// SetConnMaxIdleTime 设置连接最大空闲闲置时长（归还到空闲池后开始计时）
// d<=0 不根据空闲超时关闭连接
func (db *DB) SetConnMaxIdleTime(d time.Duration) {
	if d < 0 {
		d = 0
	}
	db.mu.Lock()
	defer db.mu.Unlock()
	// 缩短空闲超时，唤醒清理协程
	if d > 0 && d < db.shortestIdleTimeLocked() && db.cleanerCh != nil {
		select {
		case db.cleanerCh <- struct{}{}:
		default:
		}
	}
	db.maxIdleTime = d
	db.startCleanerLocked()
}

// startCleanerLocked：按需启动connectionCleaner，调用前持有db.mu
func (db *DB) startCleanerLocked() {
	// 满足：开启了maxLifetime或maxIdleTime，有打开的连接，cleanerCh未初始化
	if (db.maxLifetime > 0 || db.maxIdleTime > 0) && db.numOpen > 0 && db.cleanerCh == nil {
		db.cleanerCh = make(chan struct{}, 1)
		go db.connectionCleaner(db.shortestIdleTimeLocked())
	}
}

// connectionCleaner 后台清理协程主循环，定时清理freeConn中过期空闲连接
func (db *DB) connectionCleaner(d time.Duration) {
	const minInterval = time.Second // 最小检查间隔，防止CPU空转
	if d < minInterval {
		d = minInterval
	}
	t := time.NewTimer(d)
	for {
		select {
		case <-t.C:          // 定时器到期，触发一轮清理
		case <-db.cleanerCh: // 参数修改/DB关闭，主动唤醒清理
		}
		db.mu.Lock()
		d = db.shortestIdleTimeLocked()
		// DB已关闭 / 无连接 / 无需超时，退出清理协程
		if db.closed || db.numOpen == 0 || d <= 0 {
			db.cleanerCh = nil
			db.mu.Unlock()
			return
		}
		// 执行清理，拿到需要关闭的连接列表，更新下次检查间隔
		d, closing := db.connectionCleanerRunLocked(d)
		db.mu.Unlock()
		// 释放锁，批量关闭过期连接（IO操作放锁外）
		for _, c := range closing {
			c.Close()
		}
		if d < minInterval {
			d = minInterval
		}
		// 重置timer，重置前清理timer残留
		if !t.Stop() {
			select {
			case <-t.C:
			default:
			}
		}
		t.Reset(d)
	}
}

// connectionCleanerRunLocked：清理核心逻辑，持有db.mu执行
// 扫描freeConn，挑出过期连接，从freeConn移除，返回待关闭列表和下次检查间隔
func (db *DB) connectionCleanerRunLocked(d time.Duration) (time.Duration, []*driverConn) {
	var idleClosing int64
	var closing []*driverConn
	// 处理maxIdleTime：空闲超时的连接
	if db.maxIdleTime > 0 {
		idleSince := time.Now().Add(-db.maxIdleTime)
		last := len(db.freeConn) - 1
		// freeConn按returnedAt有序，倒序遍历，快速找到第一个未过期位置
		for i := last; i >= 0; i-- {
			c := db.freeConn[i]
			if c.returnedAt.Before(idleSince) {
				i++
                /*
                `s[low : high : max]` → **容量限制切片（full slice expression）**
                语法：`切片[起始:结束:容量上限]`
                closing = db.freeConn[:i:i]
                // 等价：db.freeConn[0 : i : i]
                // low=0，high=i，max=i
                */
				closing = db.freeConn[:i:i]
				db.freeConn = db.freeConn[i:]
				idleClosing = int64(len(closing))
				db.maxIdleTimeClosed += idleClosing
				break
			}
		}
		// 计算最近一个连接到期时间，更新d，提前触发下一轮扫描
		if len(db.freeConn) > 0 {
			c := db.freeConn[0]
			if d2 := c.returnedAt.Sub(idleSince); d2 < d {
				d = d2
			}
		}
	}
	// 处理maxLifetime：连接总生命周期过期
	if db.maxLifetime > 0 {
		expiredSince := time.Now().Add(-db.maxLifetime)
		for i := 0; i < len(db.freeConn); i++ {
			c := db.freeConn[i]
			if c.createdAt.Before(expiredSince) {
				closing = append(closing, c)
				last := len(db.freeConn) - 1
				// 拷贝前移，维持freeConn顺序（LRU，最久空闲放队首）
				copy(db.freeConn[i:], db.freeConn[i+1:])
				db.freeConn[last] = nil
				db.freeConn = db.freeConn[:last]
				i--
			} else if d2 := c.createdAt.Sub(expiredSince); d2 < d {
				d = d2
			}
		}
		db.maxLifetimeClosed += int64(len(closing)) - idleClosing
	}
	return d, closing
}
```

#### DBStats / Stats / maybeOpenNewConnections / connectionOpener / openNewConnection

```go
// DBStats：连接池监控指标结构体，用来暴露池状态指标
type DBStats struct {
	MaxOpenConnections int // 连接池最大总连接上限，SetMaxOpenConns设置的值
	// 池状态快照
	OpenConnections int // 已建立TCP连接总数 = InUse + Idle
	InUse           int // 正在被业务代码使用中的连接数量
	Idle            int // 空闲连接数量，保存在freeConn队列

	// 统计计数器
	WaitCount         int64         // 因为拿不到连接而阻塞等待的总次数
	WaitDuration      time.Duration // 所有等待连接阻塞耗时总和
	MaxIdleClosed     int64         // 因 SetMaxIdleConns 上限，被关闭的空闲连接总数
	MaxIdleTimeClosed int64         // 因 SetConnMaxIdleTime 空闲超时关闭的连接总数
	MaxLifetimeClosed int64         // 因 SetConnMaxLifetime 总生命周期到期关闭的连接总数
}

// Stats：获取连接池当前统计快照，并发安全
func (db *DB) Stats() DBStats {
	wait := db.waitDuration.Load()
	db.mu.Lock()
	defer db.mu.Unlock()
	stats := DBStats{
		MaxOpenConnections: db.maxOpen,
		Idle:              len(db.freeConn),
		OpenConnections:   db.numOpen,
		InUse:             db.numOpen - len(db.freeConn), // 在用 = 总连接数 - 空闲连接数
		WaitCount:         db.waitCount,
		WaitDuration:      time.Duration(wait),
		MaxIdleClosed:     db.maxIdleClosed,
		MaxIdleTimeClosed: db.maxIdleTimeClosed,
		MaxLifetimeClosed: db.maxLifetimeClosed,
	}
	return stats
}

// maybeOpenNewConnections：必须持有db.mu调用
// 存在等待连接的请求，且未达maxOpen上限，往openerCh发送信号，通知后台协程新建连接
func (db *DB) maybeOpenNewConnections() {
	numRequests := db.connRequests.Len() // 等待获取连接的请求数量
	if db.maxOpen > 0 {
		numCanOpen := db.maxOpen - db.numOpen // 还能新建多少连接
		if numRequests > numCanOpen {
			numRequests = numCanOpen // 最多只创建剩余可新建的连接数量
		}
	}
	// 循环发送信号，每一次信号代表要创建一条连接
	for numRequests > 0 {
		db.numOpen++ // 乐观预加计数：先+1，后续失败要回滚减回去！重点
		numRequests--
		if db.closed {
			return
		}
		db.openerCh <- struct{}{} // 发送信号唤醒connectionOpener协程
	}
}

// connectionOpener：独立后台goroutine，循环监听openerCh信号，收到信号就创建连接
func (db *DB) connectionOpener(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return // DB.Close触发cancel，退出协程
		case <-db.openerCh:
			db.openNewConnection(ctx) // 执行创建单条连接逻辑
		}
	}
}

// openNewConnection：创建一条底层driverConn连接
// 注意：maybeOpenNewConnections已经提前执行db.numOpen++；创建失败必须把numOpen--回滚
func (db *DB) openNewConnection(ctx context.Context) {
	ci, err := db.connector.Connect(ctx) // 调用驱动建立真实TCP连接
	db.mu.Lock()
	defer db.mu.Unlock()
	if db.closed {
		if err == nil {
			ci.Close()
		}
		db.numOpen-- // DB已经关闭，回滚计数
		return
	}
	if err != nil {
		db.numOpen-- // 连接创建失败，回滚numOpen计数
		db.putConnDBLocked(nil, err)
		db.maybeOpenNewConnections() // 还有等待请求，继续尝试新建连接
		return
	}
	// 封装成driverConn对象
	dc := &driverConn{
		db:         db,
		createdAt:  time.Now(),
		returnedAt: time.Now(),
		ci:         ci,
	}
	// putConnDBLocked：尝试把新连接放入空闲队列；返回true代表入队成功
	if db.putConnDBLocked(dc, err) {
		db.addDepLocked(dc, dc)
	} else {
		// 空闲队列满了，无法放入freeConn，直接关闭这个新连接，回滚计数
		db.numOpen--
		ci.Close()
	}
}
```

#### connRequest / db.conn() / putConn 源码精读笔记

```go
// connRequest：单个等待连接的请求。无空闲连接时，构建此对象放入connRequests等待队列
type connRequest struct {
	conn *driverConn
	err  error
}
var errDBClosed = errors.New("sql: database is closed")

// conn：获取一条连接，优先复用空闲连接，没有则新建；strategy控制复用策略
func (db *DB) conn(ctx context.Context, strategy connReuseStrategy) (*driverConn, error) {
	db.mu.Lock()
	if db.closed {
		db.mu.Unlock()
		return nil, errDBClosed
	}
	// 检查ctx是否已经超时/取消
	select {
	default:
	case <-ctx.Done():
		db.mu.Unlock()
		return nil, ctx.Err()
	}
	lifetime := db.maxLifetime
	// 策略cachedOrNewConn：优先取freeConn空闲连接
	last := len(db.freeConn) - 1
	if strategy == cachedOrNewConn && last >= 0 {
		// freeConn栈式取用：取切片末尾的连接（**空闲时间最短**，优先复用最新归还连接）
		conn := db.freeConn[last]
		db.freeConn = db.freeConn[:last]
		conn.inUse = true
		// 检查连接是否超过maxLifetime，过期直接销毁，返回坏连接标记
		if conn.expired(lifetime) {
			db.maxLifetimeClosed++
			db.mu.Unlock()
			conn.Close()
			return nil, driver.ErrBadConn
		}
		db.mu.Unlock()
		// resetSession：重置会话状态（事务、session变量等），失败则丢弃该连接
		if err := conn.resetSession(ctx); errors.Is(err, driver.ErrBadConn) {
			conn.Close()
			return nil, err
		}
		return conn, nil
	}

	// 无空闲连接，且已达到MaxOpenConns上限 → 进入排队等待逻辑
	if db.maxOpen > 0 && db.numOpen >= db.maxOpen {
		// 创建缓冲channel，用于等待连接创建完成后的结果返回
		req := make(chan connRequest, 1)
		delHandle := db.connRequests.Add(req)
		db.waitCount++
		db.mu.Unlock()
		waitStart := time.Now()
		select {
		case <-ctx.Done():
			// 请求上下文取消：把排队请求从队列中删除，统计等待耗时
			db.mu.Lock()
			deleted := db.connRequests.Delete(delHandle)
			db.mu.Unlock()
			db.waitDuration.Add(int64(time.Since(waitStart)))
			// 如果删除失败，说明后台已经准备往req写连接；尝试读取并归还这个连接，防止泄漏
			if !deleted {
				select {
				default:
				case ret, ok := <-req:
					if ok && ret.conn != nil {
						db.putConn(ret.conn, ret.err, false)
					}
				}
			}
			return nil, ctx.Err()
		case ret, ok := <-req:
			// 成功拿到连接结果，统计等待耗时
			db.waitDuration.Add(int64(time.Since(waitStart)))
			if !ok {
				return nil, errDBClosed
			}
			// cachedOrNewConn策略才校验生命周期；requireNewConn不校验，归还池时再校验
			if strategy == cachedOrNewConn && ret.err == nil && ret.conn.expired(lifetime) {
				db.mu.Lock()
				db.maxLifetimeClosed++
				db.mu.Unlock()
				ret.conn.Close()
				return nil, driver.ErrBadConn
			}
			if ret.conn == nil {
				return nil, ret.err
			}
			// 重置会话
			if err := ret.conn.resetSession(ctx); errors.Is(err, driver.ErrBadConn) {
				ret.conn.Close()
				return nil, err
			}
			return ret.conn, ret.err
		}
	}

	// 未达到MaxOpen上限，乐观计数，直接新建连接
	db.numOpen++ // optimistically
	db.mu.Unlock()
	ci, err := db.connector.Connect(ctx)
	if err != nil {
		db.mu.Lock()
		db.numOpen-- // 创建失败，回滚乐观计数
		db.maybeOpenNewConnections()
		db.mu.Unlock()
		return nil, err
	}
	db.mu.Lock()
	dc := &driverConn{
		db:         db,
		createdAt:  time.Now(),
		returnedAt: time.Now(),
		ci:         ci,
		inUse:      true,
	}
	db.addDepLocked(dc, dc)
	db.mu.Unlock()
	return dc, nil
}

// noteUnusedDriverStatement：标记driverStmt不再使用，在连接归还时执行Close关闭statement句柄
func (db *DB) noteUnusedDriverStatement(c *driverConn, ds *driverStmt) {
	db.mu.Lock()
	defer db.mu.Unlock()
	if c.inUse {
		// 连接正在使用，把Close函数注册到onPut钩子，归还连接时执行
		c.onPut = append(c.onPut, func() {
			ds.Close()
		})
	} else {
		// 连接空闲，直接关闭statement
		c.Lock()
		fc := c.finalClosed
		c.Unlock()
		if !fc {
			ds.Close()
		}
	}
}

const debugGetPut = false
// putConn：归还连接，业务SQL执行完成后归还driverConn回池子
func (db *DB) putConn(dc *driverConn, err error, resetSession bool) {
	// 非坏连接，执行连接有效性校验
	if !errors.Is(err, driver.ErrBadConn) {
		if !dc.validateConnection(resetSession) {
			err = driver.ErrBadConn
		}
	}
	db.mu.Lock()
	// 重复归还panic保护：inUse=false说明连接已经归还过，异常
	if !dc.inUse {
		db.mu.Unlock()
		panic("sql: connection returned that was never out")
	}
	// 连接无错误但生命周期过期 → 标记为坏连接丢弃
	if !errors.Is(err, driver.ErrBadConn) && dc.expired(db.maxLifetime) {
		db.maxLifetimeClosed++
		err = driver.ErrBadConn
	}
	dc.inUse = false
	dc.returnedAt = time.Now()
	// 执行onPut注册的回调：关闭预编译stmt等清理逻辑
	for _, fn := range dc.onPut {
		fn()
	}
	dc.onPut = nil
	// 连接是坏连接：不回收到空闲池，直接Close，同时触发尝试新建连接处理排队请求
	if errors.Is(err, driver.ErrBadConn) {
		db.maybeOpenNewConnections()
		db.mu.Unlock()
		dc.Close()
		return
	}
	// putConnHook仅测试钩子
	if putConnHook != nil {
		putConnHook(db, dc)
	}
	// putConnDBLocked：尝试放入freeConn空闲队列；返回true代表入队成功
	added := db.putConnDBLocked(dc, nil)
	db.mu.Unlock()
	// 空闲队列满，无法入队，直接关闭连接
	if !added {
		dc.Close()
		return
	}
}
```

#### putConnDBLocked / retry / PrepareContext / prepare / prepareDC 源码精读笔记

```go
// putConnDBLocked：归还连接的核心内部逻辑，**必须持有db.mu调用**
// 两个去向：优先交付给正在排队等待的connRequest；无排队请求才尝试放入freeConn空闲池
// 返回true：连接成功交付给等待请求 或者 成功放进空闲池；false：连接无法入池，调用方需要Close连接
func (db *DB) putConnDBLocked(dc *driverConn, err error) bool {
	if db.closed {
		return false
	}
	if db.maxOpen > 0 && db.numOpen > db.maxOpen {
		return false
	}
	// 优先看有没有排队等待连接的请求connRequest
	if req, ok := db.connRequests.TakeRandom(); ok {
		if err == nil {
			dc.inUse = true
		}
		// 把连接结果写入请求的channel，唤醒阻塞等待的业务goroutine
		req <- connRequest{
			conn: dc,
			err:  err,
		}
		return true
	} else if err == nil && !db.closed {
		// 没有排队请求，且连接正常无错误，尝试放入freeConn空闲队列
		if db.maxIdleConnsLocked() > len(db.freeConn) {
			db.freeConn = append(db.freeConn, dc)
			db.startCleanerLocked() // 按需启动过期连接后台清理协程
			return true
		}
		// 空闲连接数量已达MaxIdleConns上限，无法入池，这个连接要被关闭
		db.maxIdleClosed++
	}
	return false
}

const maxBadConnRetries = 2 // 遇到driver.ErrBadConn坏连接时最大重试次数

// retry：封装重试逻辑，碰到ErrBadConn（连接损坏）自动重试；最多重试maxBadConnRetries次
// 前几次使用cachedOrNewConn策略优先拿空闲连接；重试耗尽后，强制alwaysNewConn，必须新建连接
func (db *DB) retry(fn func(strategy connReuseStrategy) error) error {
	for i := int64(0); i < maxBadConnRetries; i++ {
		err := fn(cachedOrNewConn)
		if err == nil || !errors.Is(err, driver.ErrBadConn) {
			return err
		}
	}
	// 重试耗尽，强制要求新建连接，不再复用空闲池连接
	return fn(alwaysNewConn)
}

// PrepareContext：创建预编译Stmt，ctx仅用于prepare阶段，**不是后续执行SQL的上下文**
func (db *DB) PrepareContext(ctx context.Context, query string) (*Stmt, error) {
	var stmt *Stmt
	var err error
	err = db.retry(func(strategy connReuseStrategy) error {
		stmt, err = db.prepare(ctx, query, strategy)
		return err
	})
	return stmt, err
}

// Prepare：PrepareContext的包装，使用context.Background()
func (db *DB) Prepare(query string) (*Stmt, error) {
	return db.PrepareContext(context.Background(), query)
}

// prepare：内部prepare实现，根据strategy策略获取一条连接，在连接上执行prepare
func (db *DB) prepare(ctx context.Context, query string, strategy connReuseStrategy) (*Stmt, error) {
	// 获取一条连接（复用空闲/新建）
	dc, err := db.conn(ctx, strategy)
	if err != nil {
		return nil, err
	}
	// 在该连接上预编译SQL，release是归还连接的回调
	return db.prepareDC(ctx, dc, dc.releaseConn, nil, query)
}

// prepareDC：在指定driverConn上执行prepare，包装成Stmt对象
// release：defer中调用，无论成功失败，最终归还这条连接回池子
// cg=nil：普通连接池Stmt；cg≠nil：仅绑定单一条连接（Tx事务场景）
func (db *DB) prepareDC(ctx context.Context, dc *driverConn, release func(error), cg stmtConnGrabber, query string) (*Stmt, error) {
	var ds *driverStmt
	var err error
	defer func() {
		release(err) // 【重点】函数退出前，归还连接
	}()
	// 加锁，在driverConn上调用底层驱动的Prepare
	withLock(dc, func() {
		ds, err = dc.prepareLocked(ctx, cg, query)
	})
	if err != nil {
		return nil, err
	}
	stmt := &Stmt{
		db:    db,
		query: query,
		cg:    cg,
		cgds:  ds,
	}
	// 普通连接池Stmt，记录预编译语句和对应连接的依赖关系
	if cg == nil {
		stmt.css = []connStmt{{dc, ds}}
		stmt.lastNumClosed = db.numClosed.Load()
		db.addDep(stmt, stmt)
	}
	return stmt, nil
}
```

#### ExecContext / Exec / execDC / QueryContext / Query / queryDC / QueryRowContext 源码精读笔记

```go
// ExecContext：执行无返回结果SQL（insert/update/delete），支持ctx
func (db *DB) ExecContext(ctx context.Context, query string, args ...any) (Result, error) {
	var res Result
	var err error
	// 套上retry，ErrBadConn坏连接自动重试
	err = db.retry(func(strategy connReuseStrategy) error {
		res, err = db.exec(ctx, query, args, strategy)
		return err
	})
	return res, err
}

// Exec：ExecContext包装，使用background ctx
func (db *DB) Exec(query string, args ...any) (Result, error) {
	return db.ExecContext(context.Background(), query, args...)
}

// exec：内部exec入口，获取一条连接，调用execDC执行SQL
func (db *DB) exec(ctx context.Context, query string, args []any, strategy connReuseStrategy) (Result, error) {
	dc, err := db.conn(ctx, strategy)
	if err != nil {
		return nil, err
	}
	return db.execDC(ctx, dc, dc.releaseConn, query, args)
}

// execDC：在拿到的driverConn上执行Exec，release是归还连接回调
func (db *DB) execDC(ctx context.Context, dc *driverConn, release func(error), query string, args []any) (res Result, err error) {
	defer func() {
		release(err) // 函数退出，归还连接；【重点】不管成功失败，归还连接
	}()
	// 优先用driver.ExecerContext（带context的新版驱动接口），降级到老版Execer
	execerCtx, ok := dc.ci.(driver.ExecerContext)
	var execer driver.Execer
	if !ok {
		execer, ok = dc.ci.(driver.Execer)
	}
	if ok {
		var nvdargs []driver.NamedValue
		var resi driver.Result
		withLock(dc, func() {
			// 把用户args转为驱动层NamedValue参数格式
			nvdargs, err = driverArgsConnLocked(dc.ci, nil, args)
			if err != nil {
				return
			}
			resi, err = ctxDriverExec(ctx, execerCtx, execer, query, nvdargs)
		})
		// driver.ErrSkip：驱动不支持直接Exec，降级走Prepare+Stmt执行路径
		if err != driver.ErrSkip {
			if err != nil {
				return nil, err
			}
			return driverResult{dc, resi}, nil
		}
	}
	// 驱动不支持直接Exec，降级：先Prepare创建stmt，再执行stmt.Exec
	var si driver.Stmt
	withLock(dc, func() {
		si, err = ctxDriverPrepare(ctx, dc.ci, query)
	})
	if err != nil {
		return nil, err
	}
	ds := &driverStmt{Locker: dc, si: si}
	defer ds.Close()
	return resultFromStatement(ctx, dc.ci, ds, args...)
}

// QueryContext：执行SELECT查询，返回多行结果Rows
func (db *DB) QueryContext(ctx context.Context, query string, args ...any) (*Rows, error) {
	var rows *Rows
	var err error
	err = db.retry(func(strategy connReuseStrategy) error {
		rows, err = db.query(ctx, query, args, strategy)
		return err
	})
	return rows, err
}

// Query：QueryContext包装，background ctx
func (db *DB) Query(query string, args ...any) (*Rows, error) {
	return db.QueryContext(context.Background(), query, args...)
}

// query：内部query入口，获取连接，调用queryDC执行查询
func (db *DB) query(ctx context.Context, query string, args []any, strategy connReuseStrategy) (*Rows, error) {
	dc, err := db.conn(ctx, strategy)
	if err != nil {
		return nil, err
	}
	return db.queryDC(ctx, nil, dc, dc.releaseConn, query, args)
}

// queryDC：在指定连接执行查询，返回Rows
func (db *DB) queryDC(ctx, txctx context.Context, dc *driverConn, releaseConn func(error), query string, args []any) (*Rows, error) {
	// 优先使用QueryerContext，降级老Queryer接口
	queryerCtx, ok := dc.ci.(driver.QueryerContext)
	var queryer driver.Queryer
	if !ok {
		queryer, ok = dc.ci.(driver.Queryer)
	}
	if ok {
		var nvdargs []driver.NamedValue
		var rowsi driver.Rows
		var err error
		withLock(dc, func() {
			nvdargs, err = driverArgsConnLocked(dc.ci, nil, args)
			if err != nil {
				return
			}
			rowsi, err = ctxDriverQuery(ctx, queryerCtx, queryer, query, nvdargs)
		})
		// ErrSkip，驱动不支持直接Query，降级Prepare+Stmt
		if err != driver.ErrSkip {
			if err != nil {
				releaseConn(err)
				return nil, err
			}
			// 关键：**连接所有权交给Rows对象**，不是立刻归还
			// Rows未Close前，连接不会放回池；Rows.Close时调用releaseConn归还连接
			rows := &Rows{
				dc:          dc,
				releaseConn:  releaseConn,
				rowsi:        rowsi,
			}
			rows.initContextClose(ctx, txctx)
			return rows, nil
		}
	}
	// 降级路径：Prepare创建stmt，再执行stmt.Query
	var si driver.Stmt
	var err error
	withLock(dc, func() {
		si, err = ctxDriverPrepare(ctx, dc.ci, query)
	})
	if err != nil {
		releaseConn(err)
		return nil, err
	}
	ds := &driverStmt{Locker: dc, si: si}
	rowsi, err := rowsiFromStatement(ctx, dc.ci, ds, args...)
	if err != nil {
		ds.Close()
		releaseConn(err)
		return nil, err
	}
	// 连接所有权交给Rows，Rows.Close归还连接
	rows := &Rows{
		dc:          dc,
		releaseConn: releaseConn,
		rowsi:       rowsi,
		closeStmt:   ds,
	}
	rows.initContextClose(ctx, txctx)
	return rows, nil
}
```

#### QueryRow / BeginTx / Tx / Conn 源码精读笔记

```go
// QueryRowContext：最多单行查询，包装QueryContext，错误延迟到Scan阶段
func (db *DB) QueryRowContext(ctx context.Context, query string, args ...any) *Row {
	rows, err := db.QueryContext(ctx, query, args...)
	return &Row{rows: rows, err: err}
}

// QueryRow：QueryRowContext包装，background ctx
func (db *DB) QueryRow(query string, args ...any) *Row {
	return db.QueryRowContext(context.Background(), query, args...)
}

// BeginTx：开启事务，ctx在事务整个生命周期生效；ctx取消会自动回滚事务
func (db *DB) BeginTx(ctx context.Context, opts *TxOptions) (*Tx, error) {
	var tx *Tx
	var err error
	err = db.retry(func(strategy connReuseStrategy) error {
		tx, err = db.begin(ctx, opts, strategy)
		return err
	})
	return tx, err
}

// Begin：BeginTx包装，background ctx
func (db *DB) Begin() (*Tx, error) {
	return db.BeginTx(context.Background(), nil)
}

// begin：事务内部入口，获取一条连接，调用beginDC启动事务
func (db *DB) begin(ctx context.Context, opts *TxOptions, strategy connReuseStrategy) (tx *Tx, err error) {
	dc, err := db.conn(ctx, strategy)
	if err != nil {
		return nil, err
	}
	return db.beginDC(ctx, dc, dc.releaseConn, opts)
}

// beginDC：在拿到的driverConn上开启数据库事务
func (db *DB) beginDC(ctx context.Context, dc *driverConn, release func(error), opts *TxOptions) (tx *Tx, err error) {
	var txi driver.Tx
	keepConnOnRollback := false
	withLock(dc, func() {
		// 判断驱动是否支持会话重置与连接校验，决定回滚后连接是否可复用
		_, hasSessionResetter := dc.ci.(driver.SessionResetter)
		_, hasConnectionValidator := dc.ci.(driver.Validator)
		keepConnOnRollback = hasSessionResetter && hasConnectionValidator
		txi, err = ctxDriverBegin(ctx, opts, dc.ci)
	})
	if err != nil {
		release(err)
		return nil, err
	}
	// 派生可取消ctx，ctx取消时自动回滚事务
	ctx, cancel := context.WithCancel(ctx)
	tx = &Tx{
		db:                 db,
		dc:                 dc,
		releaseConn:        release,
		txi:                txi,
		cancel:             cancel,
		keepConnOnRollback: keepConnOnRollback,
		ctx:                ctx,
	}
	go tx.awaitDone() // 协程监听ctx，一旦取消执行事务回滚
	return tx, nil
}

// Driver：返回底层驱动driver.Driver
func (db *DB) Driver() driver.Driver {
	return db.connector.Driver()
}

var ErrConnDone = errors.New("sql: connection is already closed")

// Conn：从池获取**独立单连接**，该连接脱离池独立使用；用完必须Conn.Close归还回池
func (db *DB) Conn(ctx context.Context) (*Conn, error) {
	var dc *driverConn
	var err error
	err = db.retry(func(strategy connReuseStrategy) error {
		dc, err = db.conn(ctx, strategy)
		return err
	})
	if err != nil {
		return nil, err
	}
	conn := &Conn{
		db: db,
		dc: dc,
	}
	return conn, nil
}

type releaseConn func(error)

// Conn 结构体：代表一条独立数据库连接，不是连接池
type Conn struct {
	db *DB
	closemu closingMutex
	dc *driverConn
	done atomic.Bool
	releaseConnOnce sync.Once
	releaseConnCache releaseConn
}

// grabConn：获取底层driverConn；如果Conn已经Close，返回ErrConnDone
func (c *Conn) grabConn(context.Context) (*driverConn, releaseConn, error) {
	if c.done.Load() {
		return nil, nil, ErrConnDone
	}
	c.releaseConnOnce.Do(func() {
		c.releaseConnCache = c.closemuRUnlockCondReleaseConn
	})
	c.closemu.RLock()
	return c.dc, c.releaseConnCache, nil
}

// PingContext：探测当前连接是否存活
func (c *Conn) PingContext(ctx context.Context) error {
	dc, release, err := c.grabConn(ctx)
	if err != nil {
		return err
	}
	return c.db.pingDC(ctx, dc, release)
}

// ExecContext：在该独立连接上执行写SQL
func (c *Conn) ExecContext(ctx context.Context, query string, args ...any) (Result, error) {
	dc, release, err := c.grabConn(ctx)
	if err != nil {
		return nil, err
	}
	return c.db.execDC(ctx, dc, release, query, args)
}

// QueryContext：在该独立连接上执行查询SQL
func (c *Conn) QueryContext(ctx context.Context, query string, args ...any) (*Rows, error) {
	dc, release, err := c.grabConn(ctx)
	if err != nil {
		return nil, err
	}
	return c.db.queryDC(ctx, dc, release, query, args)
}
```

#### Conn 扩展方法 & Tx结构体 / awaitDone / grabConn 源码精读笔记

```go
// Conn.QueryRowContext：在独立单连接上执行最多一行查询，包装QueryContext，错误延迟至Scan
func (c *Conn) QueryRowContext(ctx context.Context, query string, args ...any) *Row {
	rows, err := c.QueryContext(ctx, query, args...)
	return &Row{rows: rows, err: err}
}

// Conn.PrepareContext：在该独立连接创建预编译Stmt，ctx仅作用prepare阶段
func (c *Conn) PrepareContext(ctx context.Context, query string) (*Stmt, error) {
	dc, release, err := c.grabConn(ctx)
	if err != nil {
		return nil, err
	}
	return c.db.prepareDC(ctx, dc, release, c, query)
}

// Conn.Raw：获取底层driver原生连接，在f回调内部直接操作驱动连接
// f执行期间独占driverConn；f返回后若不是driver.ErrBadConn，Conn可继续复用
func (c *Conn) Raw(f func(driverConn any) error) (err error) {
	var dc *driverConn
	var release releaseConn
	dc, release, err = c.grabConn(nil)
	if err != nil {
		return
	}
	fPanic := true
	dc.Mutex.Lock()
	defer func() {
		dc.Mutex.Unlock()
		// f发生panic，强制标记ErrBadConn，连接会被丢弃
		if fPanic {
			err = driver.ErrBadConn
		}
		release(err)
	}()
	err = f(dc.ci)
	fPanic = false
	return
}

// Conn.BeginTx：在当前独立连接上开启事务，事务复用这条Conn绑定的driverConn
func (c *Conn) BeginTx(ctx context.Context, opts *TxOptions) (*Tx, error) {
	dc, release, err := c.grabConn(ctx)
	if err != nil {
		return nil, err
	}
	return c.db.beginDC(ctx, dc, release, opts)
}

// closemuRUnlockCondReleaseConn：查询完成，释放closemu读锁；若为坏连接，执行close丢弃连接
func (c *Conn) closemuRUnlockCondReleaseConn(err error) {
	c.closemu.RUnlock()
	if errors.Is(err, driver.ErrBadConn) {
		c.close(err)
	}
}

func (c *Conn) txCtx() context.Context {
	return nil
}

// close：标记Conn为done，上锁归还底层driverConn回池；只能调用一次
func (c *Conn) close(err error) error {
	if !c.done.CompareAndSwap(false, true) {
		return ErrConnDone
	}
	c.closemu.Lock()
	defer c.closemu.Unlock()
	c.dc.releaseConn(err)
	c.dc = nil
	c.db = nil
	return err
}

// Conn.Close：归还连接到连接池；并发安全，会等待正在执行的查询结束
func (c *Conn) Close() error {
	return c.close(nil)
}

// Tx：代表一个正在执行的数据库事务
type Tx struct {
	db *DB
	closemu closingMutex
	dc  *driverConn
	txi driver.Tx
	releaseConn func(error)
	done atomic.Bool
	keepConnOnRollback bool
	// 事务内创建的所有Stmt，Commit/Rollback时统一关闭
	stmts struct {
		sync.Mutex
		v []*Stmt
	}
	cancel func()
	ctx context.Context
}

// awaitDone：协程监听tx.ctx，ctx取消时自动回滚事务（幂等，已提交/回滚则无动作）
func (tx *Tx) awaitDone() {
	<-tx.ctx.Done()
	discardConnection := !tx.keepConnOnRollback
	tx.rollback(discardConnection)
}

func (tx *Tx) isDone() bool {
	return tx.done.Load()
}

var ErrTxDone = errors.New("sql: transaction has already been committed or rolled back")

// close：释放事务绑定的driverConn，只在Commit/Rollback内部调用
func (tx *Tx) close(err error) {
	tx.releaseConn(err)
	tx.dc = nil
	tx.txi = nil
}

var hookTxGrabConn func()

// grabConn：事务内部获取底层driverConn；检查事务是否已结束，已结束返回ErrTxDone
func (tx *Tx) grabConn(ctx context.Context) (*driverConn, releaseConn, error) {
	select {
	default:
	case <-ctx.Done():
		return nil, nil, ctx.Err()
	}
	// 先加读锁，再判断isDone，防止查询执行过程中事务被关闭
	tx.closemu.RLock()
	if tx.isDone() {
		tx.closemu.RUnlock()
		return nil, nil, ErrTxDone
	}
	if hookTxGrabConn != nil {
		hookTxGrabConn()
	}
	return tx.dc, tx.closemuRUnlockRelease, nil
}

func (tx *Tx) txCtx() context.Context {
	return tx.ctx
}
```

#### Tx Commit / Rollback / Prepare / Stmt / Exec / Query 源码精读笔记

```go
// tx.closemuRUnlockRelease：release回调，释放closemu读锁
func (tx *Tx) closemuRUnlockRelease(error) {
	tx.closemu.RUnlock()
}

// closePrepared：关闭事务内所有创建的Stmt，Commit/Rollback时调用
func (tx *Tx) closePrepared() {
	tx.stmts.Lock()
	defer tx.stmts.Unlock()
	for _, stmt := range tx.stmts.v {
		stmt.Close()
	}
}

// Commit 提交事务
func (tx *Tx) Commit() error {
	// 优先检查ctx是否取消，保证事务状态一致性
	select {
	default:
	case <-tx.ctx.Done():
		if tx.done.Load() {
			return ErrTxDone
		}
		return tx.ctx.Err()
	}
	// CAS原子标记事务为已完成，保证只能提交一次
	if !tx.done.CompareAndSwap(false, true) {
		return ErrTxDone
	}
	// 调用cancel，释放活跃的closemu读锁；加写锁等待正在执行的SQL完成
	tx.cancel()
	tx.closemu.Lock()
	tx.closemu.Unlock()
	var err error
	withLock(tx.dc, func() {
		err = tx.txi.Commit()
	})
	// 连接不是坏连接，则关闭事务内所有预编译Stmt
	if !errors.Is(err, driver.ErrBadConn) {
		tx.closePrepared()
	}
	tx.close(err)
	return err
}

var rollbackHook func()

// rollback 内部回滚实现；discardConn=true 强制丢弃这条连接，不归还池
func (tx *Tx) rollback(discardConn bool) error {
	if !tx.done.CompareAndSwap(false, true) {
		return ErrTxDone
	}
	if rollbackHook != nil {
		rollbackHook()
	}
	tx.cancel()
	tx.closemu.Lock()
	tx.closemu.Unlock()
	var err error
	withLock(tx.dc, func() {
		err = tx.txi.Rollback()
	})
	if !errors.Is(err, driver.ErrBadConn) {
		tx.closePrepared()
	}
	// discardConn=true，强制标记ErrBadConn，连接丢弃
	if discardConn {
		err = driver.ErrBadConn
	}
	tx.close(err)
	return err
}

// Rollback：对外暴露回滚接口，discardConn=false，默认尝试把连接放回池（受keepConnOnRollback控制）
func (tx *Tx) Rollback() error {
	return tx.rollback(false)
}

// PrepareContext：事务内创建预编译Stmt，stmt生命周期绑定事务，事务结束自动Close
func (tx *Tx) PrepareContext(ctx context.Context, query string) (*Stmt, error) {
	dc, release, err := tx.grabConn(ctx)
	if err != nil {
		return nil, err
	}
	stmt, err := tx.db.prepareDC(ctx, dc, release, tx, query)
	if err != nil {
		return nil, err
	}
	// 加入stmts列表，事务提交/回滚时统一关闭
	tx.stmts.Lock()
	tx.stmts.v = append(tx.stmts.v, stmt)
	tx.stmts.Unlock()
	return stmt, err
}

func (tx *Tx) Prepare(query string) (*Stmt, error) {
	return tx.PrepareContext(context.Background(), query)
}

// StmtContext：复用DB层已存在的Stmt，生成一个绑定当前事务的Stmt
func (tx *Tx) StmtContext(ctx context.Context, stmt *Stmt) *Stmt {
	dc, release, err := tx.grabConn(ctx)
	if err != nil {
		return &Stmt{stickyErr: err}
	}
	defer release(nil)
	if tx.db != stmt.db {
		return &Stmt{stickyErr: errors.New("sql: Tx.Stmt: statement from different database used")}
	}
	var si driver.Stmt
	var parentStmt *Stmt
	stmt.mu.Lock()
	if stmt.closed || stmt.cg != nil {
		// 原stmt已关闭/属于其他事务，需要在当前连接重新prepare
		stmt.mu.Unlock()
		withLock(dc, func() {
			si, err = ctxDriverPrepare(ctx, dc.ci, stmt.query)
		})
		if err != nil {
			return &Stmt{stickyErr: err}
		}
	} else {
		stmt.removeClosedStmtLocked()
		// 优先复用该连接上已经预编译好的stmt
		for _, v := range stmt.css {
			if v.dc == dc {
				si = v.ds.si
				break
			}
		}
		stmt.mu.Unlock()
		if si == nil {
			var ds *driverStmt
			withLock(dc, func() {
				ds, err = stmt.prepareOnConnLocked(ctx, dc)
			})
			if err != nil {
				return &Stmt{stickyErr: err}
			}
			si = ds.si
		}
		parentStmt = stmt
	}
	txs := &Stmt{
		db: tx.db,
		cg: tx,
		cgds: &driverStmt{
			Locker: dc,
			si:     si,
		},
		parentStmt: parentStmt,
		query:      stmt.query,
	}
	if parentStmt != nil {
		tx.db.addDep(parentStmt, txs)
	}
	tx.stmts.Lock()
	tx.stmts.v = append(tx.stmts.v, txs)
	tx.stmts.Unlock()
	return txs
}

func (tx *Tx) Stmt(stmt *Stmt) *Stmt {
	return tx.StmtContext(context.Background(), stmt)
}

// tx.ExecContext：事务内执行写SQL
func (tx *Tx) ExecContext(ctx context.Context, query string, args ...any) (Result, error) {
	dc, release, err := tx.grabConn(ctx)
	if err != nil {
		return nil, err
	}
	return tx.db.execDC(ctx, dc, release, query, args)
}

func (tx *Tx) Exec(query string, args ...any) (Result, error) {
	return tx.ExecContext(context.Background(), query, args...)
}

// tx.QueryContext：事务内执行查询，tx.ctx作为事务上下文传入queryDC
func (tx *Tx) QueryContext(ctx context.Context, query string, args ...any) (*Rows, error) {
	dc, release, err := tx.grabConn(ctx)
	if err != nil {
		return nil, err
	}
	return tx.db.queryDC(ctx, tx.ctx, dc, release, query, args)
}

func (tx *Tx) Query(query string, args ...any) (*Rows, error) {
	return tx.QueryContext(context.Background(), query, args...)
}

// tx.QueryRowContext：事务内单行查询，错误延迟到Scan
func (tx *Tx) QueryRowContext(ctx context.Context, query string, args ...any) *Row {
	rows, err := tx.QueryContext(ctx, query, args...)
	return &Row{rows: rows, err: err}
}

func (tx *Tx) QueryRow(query string, args ...any) *Row {
	return tx.QueryRowContext(context.Background(), query, args...)
}
```

#### Stmt / connStmt / stmtConnGrabber 源码精读笔记

```go
// connStmt：绑定在**单个连接**上的预编译语句
type connStmt struct {
	dc *driverConn
	ds *driverStmt
}

// stmtConnGrabber 接口：Tx / Conn 实现这个接口，用于取出底层driverConn和release回调
type stmtConnGrabber interface {
	grabConn(context.Context) (*driverConn, releaseConn, error)
	txCtx() context.Context
}
var (
	_ stmtConnGrabber = &Tx{}
	_ stmtConnGrabber = &Conn{}
)

// Stmt：预编译语句，并发安全
type Stmt struct {
	db          *DB
	query       string
	stickyErr   error
	closemu closingMutex
	// cg != nil 代表这个Stmt绑定到Tx/Conn，只能用这个cg的连接；cg==nil代表DB全局Stmt，从连接池拿连接
	cg     stmtConnGrabber
	cgds   *driverStmt
	parentStmt *Stmt
	mu sync.Mutex
	closed bool
	// css：仅DB全局Stmt使用，保存每个连接上的connStmt（一条连接对应一个driver层预编译stmt）
	css []connStmt
	lastNumClosed uint64
}

// Stmt.ExecContext：执行预编译写语句
func (s *Stmt) ExecContext(ctx context.Context, args ...any) (Result, error) {
	s.closemu.RLock()
	defer s.closemu.RUnlock()
	var res Result
	err := s.db.retry(func(strategy connReuseStrategy) error {
		dc, releaseConn, ds, err := s.connStmt(ctx, strategy)
		if err != nil {
			return err
		}
		res, err = resultFromStatement(ctx, dc.ci, ds, args...)
		releaseConn(err)
		return err
	})
	return res, err
}
func (s *Stmt) Exec(args ...any) (Result, error) {
	return s.ExecContext(context.Background(), args...)
}

// resultFromStatement：调用driver执行stmt.Exec，包装返回driverResult
func resultFromStatement(ctx context.Context, ci driver.Conn, ds *driverStmt, args ...any) (Result, error) {
	ds.Lock()
	defer ds.Unlock()
	dargs, err := driverArgsConnLocked(ci, ds, args)
	if err != nil {
		return nil, err
	}
	resi, err := ctxDriverStmtExec(ctx, ds.si, dargs)
	if err != nil {
		return nil, err
	}
	return driverResult{ds.Locker, resi}, nil
}

// removeClosedStmtLocked：清理css里面已经关闭连接对应的connStmt，惰性清理，减少锁竞争
func (s *Stmt) removeClosedStmtLocked() {
	t := len(s.css)/2 + 1
	if t > 10 {
		t = 10
	}
	dbClosed := s.db.numClosed.Load()
	if dbClosed-s.lastNumClosed < uint64(t) {
		return
	}
	s.db.mu.Lock()
	for i := 0; i < len(s.css); i++ {
		if s.css[i].dc.dbmuClosed {
			s.css[i] = s.css[len(s.css)-1]
			s.css[len(s.css)-1] = connStmt{}
			s.css = s.css[:len(s.css)-1]
			i--
		}
	}
	s.db.mu.Unlock()
	s.lastNumClosed = dbClosed
}

// connStmt：核心方法，获取执行stmt需要的driverConn、release回调、driverStmt
func (s *Stmt) connStmt(ctx context.Context, strategy connReuseStrategy) (dc *driverConn, releaseConn func(error), ds *driverStmt, err error) {
	if err = s.stickyErr; err != nil {
		return
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		err = errors.New("sql: statement is closed")
		return
	}
	// 绑定Tx/Conn的Stmt，直接从cg拿固定连接
	if s.cg != nil {
		s.mu.Unlock()
		dc, releaseConn, err = s.cg.grabConn(ctx)
		if err != nil {
			return
		}
		return dc, releaseConn, s.cgds, nil
	}
	s.removeClosedStmtLocked()
	s.mu.Unlock()
	// DB全局Stmt：从连接池取一条空闲连接
	dc, err = s.db.conn(ctx, strategy)
	if err != nil {
		return nil, nil, nil, err
	}
	s.mu.Lock()
	// 在css查找这条连接上是否已经预编译过stmt
	for _, v := range s.css {
		if v.dc == dc {
			s.mu.Unlock()
			return dc, dc.releaseConn, v.ds, nil
		}
	}
	s.mu.Unlock()
	// 当前连接不存在预编译stmt，在这条连接上prepare
	withLock(dc, func() {
		ds, err = s.prepareOnConnLocked(ctx, dc)
	})
	if err != nil {
		dc.releaseConn(err)
		return nil, nil, nil, err
	}
	return dc, dc.releaseConn, ds, nil
}

// prepareOnConnLocked：在dc连接上执行底层prepare，生成connStmt并加入s.css列表
func (s *Stmt) prepareOnConnLocked(ctx context.Context, dc *driverConn) (*driverStmt, error) {
	si, err := dc.prepareLocked(ctx, s.cg, s.query)
	if err != nil {
		return nil, err
	}
	cs := connStmt{dc, si}
	s.mu.Lock()
	s.css = append(s.css, cs)
	s.mu.Unlock()
	return cs.ds, nil
}

// Stmt.QueryContext：执行预编译查询SQL，返回Rows结果集
func (s *Stmt) QueryContext(ctx context.Context, args ...any) (*Rows, error) {
	s.closemu.RLock()
	defer s.closemu.RUnlock()
	var rowsi driver.Rows
	var rows *Rows
	err := s.db.retry(func(strategy connReuseStrategy) error {
		dc, releaseConn, ds, err := s.connStmt(ctx, strategy)
		if err != nil {
			return err
		}
		rowsi, err = rowsiFromStatement(ctx, dc.ci, ds, args...)
		if err == nil {
			rows = &Rows{
				dc:    dc,
				rowsi: rowsi,
			}
			s.db.addDep(s, rows)
			rows.releaseConn = func(err error) {
				releaseConn(err)
				s.db.removeDep(s, rows)
			}
			var txctx context.Context
			if s.cg != nil {
				txctx = s.cg.txCtx()
			}
			rows.initContextClose(ctx, txctx)
			return nil
		}
		releaseConn(err)
		return err
	})
	return rows, err
}
```

#### Stmt剩余方法 / Rows 源码精读笔记

```go
func (s *Stmt) Query(args ...any) (*Rows, error) {
	return s.QueryContext(context.Background(), args...)
}

func rowsiFromStatement(ctx context.Context, ci driver.Conn, ds *driverStmt, args ...any) (driver.Rows, error) {
	ds.Lock()
	defer ds.Unlock()
	dargs, err := driverArgsConnLocked(ci, ds, args)
	if err != nil {
		return nil, err
	}
	return ctxDriverStmtQuery(ctx, ds.si, dargs)
}

func (s *Stmt) QueryRowContext(ctx context.Context, args ...any) *Row {
	rows, err := s.QueryContext(ctx, args...)
	if err != nil {
		return &Row{err: err}
	}
	return &Row{rows: rows}
}

func (s *Stmt) QueryRow(args ...any) *Row {
	return s.QueryRowContext(context.Background(), args...)
}

func (s *Stmt) Close() error {
	s.closemu.Lock()
	defer s.closemu.Unlock()
	if s.stickyErr != nil {
		return s.stickyErr
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	txds := s.cgds
	s.cgds = nil
	s.mu.Unlock()
	if s.cg == nil {
		return s.db.removeDep(s, s)
	}
	if s.parentStmt != nil {
		return s.db.removeDep(s.parentStmt, s)
	}
	return txds.Close()
}

func (s *Stmt) finalClose() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.css != nil {
		for _, v := range s.css {
			s.db.noteUnusedDriverStatement(v.dc, v.ds)
			v.dc.removeOpenStmt(v.ds)
		}
		s.css = nil
	}
	return nil
}

// Rows：查询结果集游标
type Rows struct {
	dc             *driverConn
	releaseConn    func(error)
	rowsi          driver.Rows
	cancel         func()
	closeStmt      *driverStmt
	contextDone    atomic.Pointer[error]
	closemu        closingMutex
	lasterr        error
	closed         bool
	closemuScanHold bool
	hitEOF         bool
	nextCalled     bool
	lastcols       []driver.Value
	numCols        int
	raw            []byte
}

func (rs *Rows) lasterrOrErrLocked(err error) error {
	if rs.lasterr != nil && rs.lasterr != io.EOF {
		return rs.lasterr
	}
	return err
}

var bypassRowsAwaitDone = false

func (rs *Rows) initContextClose(ctx, txctx context.Context) {
	if ctx.Done() == nil && (txctx == nil || txctx.Done() == nil) {
		return
	}
	if bypassRowsAwaitDone {
		return
	}
	closectx, cancel := context.WithCancel(ctx)
	rs.cancel = cancel
	go rs.awaitDone(ctx, txctx, closectx)
}

func (rs *Rows) awaitDone(ctx, txctx, closectx context.Context) {
	var txctxDone <-chan struct{}
	if txctx != nil {
		txctxDone = txctx.Done()
	}
	select {
	case <-ctx.Done():
		err := ctx.Err()
		rs.contextDone.Store(&err)
	case <-txctxDone:
		err := txctx.Err()
		rs.contextDone.Store(&err)
	case <-closectx.Done():
	}
	rs.close(ctx.Err())
}

func (rs *Rows) Next() bool {
	rs.closemuRUnlockIfHeldByScan()
	if rs.contextDone.Load() != nil {
		return false
	}
	var doClose, ok bool
	func() {
		rs.closemu.RLock()
		defer rs.closemu.RUnlock()
		doClose, ok = rs.nextLocked()
	}()
	if doClose {
		rs.Close()
	}
	if doClose && !ok {
		rs.hitEOF = true
	}
	return ok
}

func (rs *Rows) nextLocked() (doClose, ok bool) {
	if rs.closed {
		return false, false
	}
	rs.dc.Lock()
	defer rs.dc.Unlock()
	if !rs.nextCalled {
		rs.numCols = len(rs.rowsi.Columns())
		rs.nextCalled = true
	}
	if rscan, ok := rs.rowsi.(driver.RowsColumnScanner); ok {
		rs.lasterr = rscan.NextRow()
	} else {
		if rs.lastcols == nil {
			rs.lastcols = make([]driver.Value, rs.numCols)
		}
		rs.lasterr = rs.rowsi.Next(rs.lastcols)
	}
	if rs.lasterr != nil {
		if rs.lasterr != io.EOF {
			return true, false
		}
		nextResultSet, ok := rs.rowsi.(driver.RowsNextResultSet)
		if !ok {
			return true, false
		}
		if !nextResultSet.HasNextResultSet() {
			doClose = true
		}
		return doClose, false
	}
	return false, true
}

func (rs *Rows) NextResultSet() bool {
	rs.closemuRUnlockIfHeldByScan()
	var doClose bool
	defer func() {
		if doClose {
			rs.Close()
		}
	}()
	rs.closemu.RLock()
	defer rs.closemu.RUnlock()
	if rs.closed {
		return false
	}
	rs.nextCalled = false
	rs.lastcols = nil
	nextResultSet, ok := rs.rowsi.(driver.RowsNextResultSet)
	if !ok {
		doClose = true
		return false
	}
	rs.dc.Lock()
	defer rs.dc.Unlock()
	rs.lasterr = nextResultSet.NextResultSet()
	if rs.lasterr != nil {
		doClose = true
		return false
	}
	return true
}
```

#### Rows剩余方法 / ColumnType 源码精读笔记

```go
func (rs *Rows) Err() error {
	if !rs.hitEOF {
		if errp := rs.contextDone.Load(); errp != nil {
			return *errp
		}
	}
	rs.closemu.RLock()
	defer rs.closemu.RUnlock()
	return rs.lasterrOrErrLocked(nil)
}

func (rs *Rows) rawbuf() []byte {
	if rs == nil {
		return nil
	}
	return rs.raw
}

func (rs *Rows) setrawbuf(b []byte) RawBytes {
	if rs == nil {
		return RawBytes(b)
	}
	off := len(rs.raw)
	rs.raw = b
	return RawBytes(rs.raw[off:])
}

var errRowsClosed = errors.New("sql: Rows are closed")
var errNoRows = errors.New("sql: no Rows available")

func (rs *Rows) Columns() ([]string, error) {
	rs.closemu.RLock()
	defer rs.closemu.RUnlock()
	if rs.closed {
		return nil, rs.lasterrOrErrLocked(errRowsClosed)
	}
	if rs.rowsi == nil {
		return nil, rs.lasterrOrErrLocked(errNoRows)
	}
	rs.dc.Lock()
	defer rs.dc.Unlock()
	return rs.rowsi.Columns(), nil
}

func (rs *Rows) ColumnTypes() ([]*ColumnType, error) {
	rs.closemu.RLock()
	defer rs.closemu.RUnlock()
	if rs.closed {
		return nil, rs.lasterrOrErrLocked(errRowsClosed)
	}
	if rs.rowsi == nil {
		return nil, rs.lasterrOrErrLocked(errNoRows)
	}
	rs.dc.Lock()
	defer rs.dc.Unlock()
	return rowsColumnInfoSetupConnLocked(rs.rowsi), nil
}

type ColumnType struct {
	name string
	hasNullable       bool
	hasLength         bool
	hasPrecisionScale bool
	nullable     bool
	length       int64
	databaseType string
	precision    int64
	scale        int64
	scanType     reflect.Type
}

func (ci *ColumnType) Name() string {
	return ci.name
}

func (ci *ColumnType) Length() (length int64, ok bool) {
	return ci.length, ci.hasLength
}

func (ci *ColumnType) DecimalSize() (precision, scale int64, ok bool) {
	return ci.precision, ci.scale, ci.hasPrecisionScale
}

func (ci *ColumnType) ScanType() reflect.Type {
	return ci.scanType
}

func (ci *ColumnType) Nullable() (nullable, ok bool) {
	return ci.nullable, ci.hasNullable
}

func (ci *ColumnType) DatabaseTypeName() string {
	return ci.databaseType
}

func rowsColumnInfoSetupConnLocked(rowsi driver.Rows) []*ColumnType {
	names := rowsi.Columns()
	list := make([]*ColumnType, len(names))
	for i := range list {
		ci := &ColumnType{
			name: names[i],
		}
		list[i] = ci
		if prop, ok := rowsi.(driver.RowsColumnTypeScanType); ok {
			ci.scanType = prop.ColumnTypeScanType(i)
		} else {
			ci.scanType = reflect.TypeFor[any]()
		}
		if prop, ok := rowsi.(driver.RowsColumnTypeDatabaseTypeName); ok {
			ci.databaseType = prop.ColumnTypeDatabaseTypeName(i)
		}
		if prop, ok := rowsi.(driver.RowsColumnTypeLength); ok {
			ci.length, ci.hasLength = prop.ColumnTypeLength(i)
		}
		if prop, ok := rowsi.(driver.RowsColumnTypeNullable); ok {
			ci.nullable, ci.hasNullable = prop.ColumnTypeNullable(i)
		}
		if prop, ok := rowsi.(driver.RowsColumnTypePrecisionScale); ok {
			ci.precision, ci.scale, ci.hasPrecisionScale = prop.ColumnTypePrecisionScale(i)
		}
	}
	return list
}

func (rs *Rows) Scan(dest ...any) error {
	if rs.closemuScanHold {
		return fmt.Errorf("sql: Scan called without calling Next (closemuScanHold)")
	}
	rs.closemu.RLock()
	rs.raw = rs.raw[:0]
	err := rs.scanLocked(dest...)
	if err == nil && scanArgsContainRawBytes(dest) {
		rs.closemuScanHold = true
	} else {
		rs.closemu.RUnlock()
	}
	return err
}

type rowsScanContext struct {
	rs *Rows
}

func (rs *Rows) scanLocked(dest ...any) error {
	if rs.lasterr != nil && rs.lasterr != io.EOF {
		return rs.lasterr
	}
	if rs.closed {
		return rs.lasterrOrErrLocked(errRowsClosed)
	}
	if !rs.nextCalled {
		return errors.New("sql: Scan called without calling Next")
	}
	if len(dest) != rs.numCols {
		return fmt.Errorf("sql: expected %d destination arguments in Scan, not %d", rs.numCols, len(dest))
	}
	if rscan, ok := rs.rowsi.(driver.RowsColumnScanner); ok {
		rs.dc.Lock()
		defer rs.dc.Unlock()
		for i, d := range dest {
			scanCtx := driver.ScanContext(internal.NewScanContext(rs))
			if err := rscan.ScanColumn(scanCtx, i, d); err != nil {
				return fmt.Errorf(`sql: Scan error on column index %d, name %q: %w`, i, rs.rowsi.Columns()[i], err)
			}
		}
		return nil
	}
	for i, sv := range rs.lastcols {
		err := convertAssignRows(dest[i], sv, rs)
		if err != nil {
			return fmt.Errorf(`sql: Scan error on column index %d, name %q: %w`, i, rs.rowsi.Columns()[i], err)
		}
	}
	return nil
}

func (rs *Rows) closemuRUnlockIfHeldByScan() {
	if rs.closemuScanHold {
		rs.closemuScanHold = false
		rs.closemu.RUnlock()
	}
}

func scanArgsContainRawBytes(args []any) bool {
	for _, a := range args {
		if _, ok := a.(*RawBytes); ok {
			return true
		}
		return false
	}
}
```

#### Rows.Close / Row / Result / connRequestSet 源码精读笔记

```go
var rowsCloseHook = func() func(*Rows, *error) { return nil }

func (rs *Rows) Close() error {
	rs.closemuRUnlockIfHeldByScan()
	return rs.close(nil)
}

func (rs *Rows) close(err error) error {
	rs.closemu.Lock()
	defer rs.closemu.Unlock()
	if rs.closed {
		return nil
	}
	rs.closed = true
	if rs.lasterr == nil {
		rs.lasterr = err
	}
	withLock(rs.dc, func() {
		err = rs.rowsi.Close()
	})
	if fn := rowsCloseHook(); fn != nil {
		fn(rs, &err)
	}
	if rs.cancel != nil {
		rs.cancel()
	}
	if rs.closeStmt != nil {
		rs.closeStmt.Close()
	}
	rs.releaseConn(err)
	rs.lasterr = rs.lasterrOrErrLocked(err)
	return err
}

type Row struct {
	err  error
	rows *Rows
}

func (r *Row) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	defer r.rows.Close()
	if scanArgsContainRawBytes(dest) {
		return errors.New("sql: RawBytes isn't allowed on Row.Scan")
	}
	if !r.rows.Next() {
		if err := r.rows.Err(); err != nil {
			return err
		}
		return ErrNoRows
	}
	err := r.rows.Scan(dest...)
	if err != nil {
		return err
	}
	return r.rows.Close()
}

func (r *Row) Err() error {
	return r.err
}

type Result interface {
	LastInsertId() (int64, error)
	RowsAffected() (int64, error)
}

type driverResult struct {
	sync.Locker
	resi driver.Result
}

func (dr driverResult) LastInsertId() (int64, error) {
	dr.Lock()
	defer dr.Unlock()
	return dr.resi.LastInsertId()
}

func (dr driverResult) RowsAffected() (int64, error) {
	dr.Lock()
	defer dr.Unlock()
	return dr.resi.RowsAffected()
}

func stack() string {
	var buf [2 << 10]byte
	return string(buf[:runtime.Stack(buf[:], false)])
}

func withLock(lk sync.Locker, fn func()) {
	lk.Lock()
	defer lk.Unlock()
	fn()
}

type connRequestSet struct {
	s []connRequestAndIndex
}

type connRequestAndIndex struct {
	req chan connRequest
	curIdx *int
}

func (s *connRequestSet) CloseAndRemoveAll() {
	for _, v := range s.s {
		*v.curIdx = -1
		close(v.req)
	}
	s.s = nil
}

func (s *connRequestSet) Len() int { return len(s.s) }

type connRequestDelHandle struct {
	idx *int
}

func (s *connRequestSet) Add(v chan connRequest) connRequestDelHandle {
	idx := len(s.s)
	idxPtr := &idx
	s.s = append(s.s, connRequestAndIndex{v, idxPtr})
	return connRequestDelHandle{idxPtr}
}

func (s *connRequestSet) Delete(h connRequestDelHandle) bool {
	idx := *h.idx
	if idx < 0 {
		return false
	}
	s.deleteIndex(idx)
	return true
}

func (s *connRequestSet) deleteIndex(idx int) {
	*(s.s[idx].curIdx) = -1
	if idx < len(s.s)-1 {
		last := s.s[len(s.s)-1]
		*last.curIdx = idx
		s.s[idx] = last
	}
	s.s[len(s.s)-1] = connRequestAndIndex{}
	s.s = s.s[:len(s.s)-1]
}

func (s *connRequestSet) TakeRandom() (v chan connRequest, ok bool) {
	if len(s.s) == 0 {
		return nil, false
	}
	pick := rand.IntN(len(s.s))
	e := s.s[pick]
	s.deleteIndex(pick)
	return e.req, true
}
```

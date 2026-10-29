## Context是只读接口

```go
type Context interface {
	Deadline() (deadline time.Time, ok bool)
	Done() <-chan struct{}
	Err() error
	Value(key any) any
}

var Canceled = errors.New("context canceled")

var DeadlineExceeded error = deadlineExceededError{}

type deadlineExceededError struct{}

func (deadlineExceededError) Error() string   { return "context deadline exceeded" }
func (deadlineExceededError) Timeout() bool   { return true }
func (deadlineExceededError) Temporary() bool { return true }

type emptyCtx struct{}

func (emptyCtx) Deadline() (deadline time.Time, ok bool) {
	return
}

func (emptyCtx) Done() <-chan struct{} {
	return nil
}

func (emptyCtx) Err() error {
	return nil
}

func (emptyCtx) Value(key any) any {
	return nil
}

```

### context：backgroundCtx、todoCtx、WithCancel、WithCancelCause、Cause、AfterFunc

> 代码功能：Background/TODO包装结构体；实现WithCancel、WithCancelCause可取消上下文API，Cause获取取消根因，AfterFunc实现ctx取消回调注册。
> 核心函数：propagateCancel 作用：建立父子 ctx 的取消传播关系

```go
type backgroundCtx struct{ emptyCtx }
func (backgroundCtx) String() string {
	return "context.Background"
}
type todoCtx struct{ emptyCtx }
func (todoCtx) String() string {
	return "context.TODO"
}
func Background() Context {
	return backgroundCtx{}
}
func TODO() Context {
	return todoCtx{}
}
type CancelFunc func()
func WithCancel(parent Context) (ctx Context, cancel CancelFunc) {
	c := withCancel(parent)
	return c, func() { c.cancel(true, Canceled, nil) }
}
type CancelCauseFunc func(cause error)
func WithCancelCause(parent Context) (ctx Context, cancel CancelCauseFunc) {
	c := withCancel(parent)
	return c, func(cause error) { c.cancel(true, Canceled, cause) }
}
func withCancel(parent Context) *cancelCtx {
	if parent == nil {
		panic("cannot create context from nil parent")
	}
	c := &cancelCtx{}
    // 建立父子ctx的取消传播关系
	c.propagateCancel(parent, c)
	return c
}
//`Cause` 获取 `WithCancelCause` 设置的**取消根因错误**
func Cause(c Context) error {
	err := c.Err()
	if err == nil {
		return nil
	}
	if cc, ok := c.Value(&cancelCtxKey).(*cancelCtx); ok {
		cc.mu.Lock()
		cause := cc.cause
		cc.mu.Unlock()
		if cause != nil {
			return cause
		}
	}
	return err
}
//`AfterFunc` 注册回调函数，当 ctx 取消时自动执行回调，同时提供 stop 函数可以提前取消注册
func AfterFunc(ctx Context, f func()) (stop func() bool) {
	a := &afterFuncCtx{
		f: f,
	}
	a.cancelCtx.propagateCancel(ctx, a)
	return func() bool {
		stopped := false
		a.once.Do(func() {
			stopped = true
		})
		if stopped {
			a.cancel(true, Canceled, nil)
		}
		return stopped
	}
}
//定义`afterFuncer`接口；`afterFuncCtx`内嵌`cancelCtx`，用来实现`AfterFunc`的回调注册逻辑；重写 cancel 方法，在上下文取消时，通过`sync.Once`新开 goroutine 执行用户回调`f`。
type afterFuncer interface {
	AfterFunc(func()) func() bool
}

type afterFuncCtx struct {
	cancelCtx
	once sync.Once
	f    func()
}

func (a *afterFuncCtx) cancel(removeFromParent bool, err, cause error) {
    // 1. 调用内嵌cancelCtx的cancel，执行基础取消逻辑
	a.cancelCtx.cancel(false, err, cause)
    //如果上层调用 cancel 传入`removeFromParent=true`，执行`removeChild`，把自己从父上下文的子节点列表删掉，不再接收后续父 ctx 事件。
	if removeFromParent {
		removeChild(a.Context, a)
	}
	a.once.Do(func() {
		go a.f()
	})
}

```

### context：stopCtx、parentCancelCtx、removeChild 源码精读

> 代码功能：`stopCtx` 包装上下文与 stop 函数；`parentCancelCtx` 尝试从父 Context 提取底层`*cancelCtx`；`removeChild` 将子节点从父 cancelCtx 的 children 集合中删除，解除父子取消绑定。

```go
type stopCtx struct {
	Context
	stop func() bool
}

var goroutines atomic.Int32
var cancelCtxKey int

func parentCancelCtx(parent Context) (*cancelCtx, bool) {
	done := parent.Done()
	if done == closedchan || done == nil {
		return nil, false
	}
	p, ok := parent.Value(&cancelCtxKey).(*cancelCtx)
	if !ok {
		return nil, false
	}
	pdone, _ := p.done.Load().(chan struct{})
	if pdone != done {
		return nil, false
	}
	return p, true
}

func removeChild(parent Context, child canceler) {
	if s, ok := parent.(stopCtx); ok {
		s.stop()
		return
	}
	p, ok := parentCancelCtx(parent)
	if !ok {
		return
	}
	p.mu.Lock()
	if p.children != nil {
		delete(p.children, child)
	}
	p.mu.Unlock()
}

```

### context：canceler 接口、cancelCtx 结构体、Value/Done/Err 方法源码精读

> 代码功能：定义内部`canceler`接口；`cancelCtx`是可取消上下文底层核心结构体；实现`Value`（支持内部 key 暴露自身）、`Done`（懒加载创建 chan）、`Err`（返回取消错误）。

```go
type canceler interface {
	cancel(removeFromParent bool, err, cause error)
	Done() <-chan struct{}
}

var closedchan = make(chan struct{})
func init() {
	close(closedchan)
}

type cancelCtx struct {
	Context
	mu       sync.Mutex
	done     atomic.Value
	children map[canceler]struct{}
	err      atomic.Value
	cause    error
}

func (c *cancelCtx) Value(key any) any {
	if key == &cancelCtxKey {
		return c
	}
	return value(c.Context, key)
}

func (c *cancelCtx) Done() <-chan struct{} {
	d := c.done.Load()
	if d != nil {
		return d.(chan struct{})
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	d = c.done.Load()
	if d == nil {
		d = make(chan struct{})
		c.done.Store(d)
	}
	return d.(chan struct{})
}

func (c *cancelCtx) Err() error {
	if err := c.err.Load(); err != nil {
		<-c.Done()
		return err.(error)
	}
	return nil
}

```

### `propagateCancel` 是上下文**取消传播的核心函数**。

> 建立父子 ctx 的绑定关系：父取消自动触发子取消；如果父已经取消，则立刻取消子。处理三种父 ctx 场景：原生 cancelCtx、afterFuncer、其他普通 Context（新开 goroutine 监听 Done）。

```go
func (c *cancelCtx) propagateCancel(parent Context, child canceler) {
	c.Context = parent
	done := parent.Done()
	if done == nil {
		return
	}
	select {
	case <-done:
		child.cancel(false, parent.Err(), Cause(parent))
		return
	default:
	}
	if p, ok := parentCancelCtx(parent); ok {
		p.mu.Lock()
		if err := p.err.Load(); err != nil {
			child.cancel(false, err.(error), p.cause)
		} else {
			if p.children == nil {
				p.children = make(map[canceler]struct{})
			}
			p.children[child] = struct{}{}
		}
		p.mu.Unlock()
		return
	}
	if a, ok := parent.(afterFuncer); ok {
		c.mu.Lock()
		stop := a.AfterFunc(func() {
			child.cancel(false, parent.Err(), Cause(parent))
		})
		c.Context = stopCtx{
			Context: parent,
			stop:    stop,
		}
		c.mu.Unlock()
		return
	}
	goroutines.Add(1)
	go func() {
		select {
		case <-parent.Done():
			child.cancel(false, parent.Err(), Cause(parent))
		case <-child.Done():
		}
	}()
}


type stringer interface {
	String() string
}

func contextName(c Context) string {
	if s, ok := c.(stringer); ok {
		return s.String()
	}
	return reflectlite.TypeOf(c).String()
}

func (c *cancelCtx) String() string {
	return contextName(c.Context) + ".WithCancel"
}

func (c *cancelCtx) cancel(removeFromParent bool, err, cause error) {
	if err == nil {
		panic("context: internal error: missing cancel error")
	}
	if cause == nil {
		cause = err
	}
	c.mu.Lock()
	if c.err.Load() != nil {
		c.mu.Unlock()
		return
	}
	c.err.Store(err)
	c.cause = cause
	d, _ := c.done.Load().(chan struct{})
	if d == nil {
		c.done.Store(closedchan)
	} else {
		close(d)
	}
	for child := range c.children {
		child.cancel(false, err, cause)
	}
	c.children = nil
	c.mu.Unlock()
	if removeFromParent {
		removeChild(c.Context, c)
	}
}
//继承父上下文的 Value 键值，但是完全隔离父的取消信号、截止时间。父 ctx 取消 / 超时，它不受任何影响。
func WithoutCancel(parent Context) Context {
	if parent == nil {
		panic("cannot create context from nil parent")
	}
	return withoutCancelCtx{parent}
}

type withoutCancelCtx struct {
	c Context
}

func (withoutCancelCtx) Deadline() (deadline time.Time, ok bool) {
	return
}

func (withoutCancelCtx) Done() <-chan struct{} {
	return nil
}

func (withoutCancelCtx) Err() error {
	return nil
}

func (c withoutCancelCtx) Value(key any) any {
	return value(c, key)
}

func (c withoutCancelCtx) String() string {
	return contextName(c.c) + ".WithoutCancel"
}

/*

`WithDeadline` 直接调用 `WithDeadlineCause`（cause 传 nil）；`WithDeadlineCause` 是 `WithDeadline/WithTimeout` 的底层实现，创建`timerCtx`，绑定截止时间，超时自动触发 cancel，同时返回手动取消函数。
*/
func WithDeadline(parent Context, d time.Time) (Context, CancelFunc) {
	return WithDeadlineCause(parent, d, nil)
}

func WithDeadlineCause(parent Context, d time.Time, cause error) (Context, CancelFunc) {
	if parent == nil {
		panic("cannot create context from nil parent")
	}
	if cur, ok := parent.Deadline(); ok && cur.Before(d) {
		return WithCancel(parent)
	}
	c := &timerCtx{
		deadline: d,
	}
	c.cancelCtx.propagateCancel(parent, c)
	dur := time.Until(d)
	if dur <= 0 {
		c.cancel(true, DeadlineExceeded, cause)
		return c, func() { c.cancel(false, Canceled, nil) }
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.err.Load() == nil {
		c.timer = time.AfterFunc(dur, func() {
			c.cancel(true, DeadlineExceeded, cause)
		})
	}
	return c, func() { c.cancel(true, Canceled, nil) }
}

```

### context：timerCtx 结构体与 cancel 方法源码精读

> 代码功能：`timerCtx` 是 `WithDeadline / WithTimeout` 的底层结构体，**内嵌 cancelCtx + 定时器 timer + deadline 截止时间**；重写 cancel 方法，取消时额外停止 timer，避免定时器继续触发、防止资源泄漏。

```go
type timerCtx struct {
	cancelCtx
	timer    *time.Timer
	deadline time.Time
}

func (c *timerCtx) Deadline() (deadline time.Time, ok bool) {
	return c.deadline, true
}

func (c *timerCtx) String() string {
	return contextName(c.cancelCtx.Context) + ".WithDeadline(" +
		c.deadline.String() + " [" +
		time.Until(c.deadline).String() + "])"
}

func (c *timerCtx) cancel(removeFromParent bool, err, cause error) {
	c.cancelCtx.cancel(false, err, cause)
	if removeFromParent {
		removeChild(c.cancelCtx.Context, c)
	}
	c.mu.Lock()
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	c.mu.Unlock()
}

```

### context：WithTimeout / WithTimeoutCause / WithValue /valueCtx/value 函数源码精读

> 代码功能：`WithTimeout` 是`WithDeadline`的简单封装；`WithValue`创建`valueCtx`，用来携带 K-V 元数据；`value()`是底层循环查找 key 的核心工具函数，沿着 ctx 链向上检索 value。

```go
func WithTimeout(parent Context, timeout time.Duration) (Context, CancelFunc) {
	return WithDeadline(parent, time.Now().Add(timeout))
}
func WithTimeoutCause(parent Context, timeout time.Duration, cause error) (Context, CancelFunc) {
	return WithDeadlineCause(parent, time.Now().Add(timeout), cause)
}
func WithValue(parent Context, key, val any) Context {
	if parent == nil {
		panic("cannot create context from nil parent")
	}
	if key == nil {
		panic("nil key")
	}
	if !reflectlite.TypeOf(key).Comparable() {
		panic("key is not comparable")
	}
	return &valueCtx{parent, key, val}
}
type valueCtx struct {
	Context
	key, val any
}
func stringify(v any) string {
	switch s := v.(type) {
	case stringer:
		return s.String()
	case string:
		return s
	case nil:
		return "<nil>"
	}
	return reflectlite.TypeOf(v).String()
}
func (c *valueCtx) String() string {
	return contextName(c.Context) + ".WithValue(" +
		stringify(c.key) + ", " +
		stringify(c.val) + ")"
}
func (c *valueCtx) Value(key any) any {
	if c.key == key {
		return c.val
	}
	return value(c.Context, key)
}
func value(c Context, key any) any {
	for {
		switch ctx := c.(type) {
		case *valueCtx:
			if key == ctx.key {
				return ctx.val
			}
			c = ctx.Context
		case *cancelCtx:
			if key == &cancelCtxKey {
				return c
			}
			c = ctx.Context
		case withoutCancelCtx:
			if key == &cancelCtxKey {
				return nil
			}
			c = ctx.c
		case *timerCtx:
			if key == &cancelCtxKey {
				return &ctx.cancelCtx
			}
			c = ctx.Context
		case backgroundCtx, todoCtx:
			return nil
		default:
			return c.Value(key)
		}
	}
}

```
